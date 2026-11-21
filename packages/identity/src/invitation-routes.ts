import type { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import { hashPassword } from "better-auth/crypto";
import { randomBytes, createHash } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { requireMatter } from "@weatherly/matters";
import {
  lockRosterEmail,
  matchingRosterInvitations,
  newestRosterInvitations,
  normalizeRosterEmail,
} from "./roster-registry";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export type InvitationOptions = {
  queueAgentInvitation?: (
    tx: Prisma.TransactionClient,
    invitation: {
      id: string;
      email: string;
      expiresAt: Date;
      acceptanceToken: string;
    },
  ) => Promise<boolean>;
};

export function registerInvitationRoutes(
  r: Router,
  options: InvitationOptions,
) {
  r.post(
    "/invitations",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const data = z
        .object({
          email: z.email().toLowerCase(),
          role: z.enum(["agent", "client"]),
          matterId: z.string().optional(),
          agreementId: z.string().optional(),
          rosterAgentId: z.string().min(1).max(200).optional(),
          approvalOverrideReason: z
            .string()
            .trim()
            .min(10)
            .max(1000)
            .optional(),
          personalTest: z
            .object({ ownEmailConfirmed: z.literal(true) })
            .strict()
            .optional(),
          expiresInHours: z.number().int().min(1).max(168).default(72),
        })
        .strict()
        .parse(req.body);
      if (
        data.personalTest &&
        (data.role !== "agent" ||
          !data.rosterAgentId ||
          data.matterId ||
          data.agreementId ||
          data.approvalOverrideReason)
      )
        throw new HttpError(
          422,
          "PERSONAL_TEST_SCOPE",
          "Personal tests require an unassigned Weatherly roster entry and confirmation that this is your own email.",
        );
      if (data.matterId) await requireMatter(actor, data.matterId, true);
      const token = randomBytes(32).toString("base64url");
      const result = await prisma.$transaction(async (tx) => {
        await lockRosterEmail(tx, data.email);
        const roster = data.rosterAgentId
          ? await tx.rosterAgent.findFirst({
              where: {
                id: data.rosterAgentId,
                normalizedEmail: data.email,
                archivedAt: null,
              },
            })
          : null;
        if (data.rosterAgentId && (!roster || data.role !== "agent"))
          throw new HttpError(
            422,
            "INVITATION_ROSTER_MISMATCH",
            "Use the selected agent’s roster email.",
          );
        if (roster?.userId)
          throw new HttpError(
            409,
            "AGENT_ALREADY_LINKED",
            "This roster agent already has a linked portal account.",
          );
        if (roster && data.approvalOverrideReason)
          throw new HttpError(
            422,
            "ROSTER_AGREEMENT_POLICY",
            "Use the selected roster agent’s current agreement requirements.",
          );

        const invitedUser = await tx.user.findUnique({
          where: { email: data.email },
        });
        const priorInvitations = roster
          ? matchingRosterInvitations(
              await tx.invitation.findMany({
                where: {
                  role: "agent",
                  email: { equals: data.email, mode: "insensitive" },
                  acceptedAt: null,
                },
                orderBy: newestRosterInvitations,
                select: {
                  id: true,
                  email: true,
                  rosterAgentId: true,
                  matterId: true,
                },
              }),
              roster,
            )
          : [];
        const [prior] = priorInvitations;
        let approvedAgreementId: string | undefined;
        let approvalOverrideReason = data.approvalOverrideReason;
        let personalTest = !!data.personalTest;
        if (data.role === "agent" && roster?.business !== "hto") {
          const agreement = await tx.agreement.findFirst({
            where: {
              ...(data.agreementId ? { id: data.agreementId } : {}),
              status: "approved",
              documentId: { not: null },
              AND: [
                recipientMatches(data.email, invitedUser?.id),
                ...(roster ? [unboundOrSameRoster(roster.id)] : []),
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (agreement) approvedAgreementId = agreement.id;
          else if (
            prior &&
            !data.agreementId &&
            (!data.matterId || data.matterId === prior.matterId)
          ) {
            const approval = await getInvitationApproval(tx, prior.id);
            if (!approval?.approvedAgreementId) {
              approvalOverrideReason = approval?.approvalOverrideReason;
              personalTest ||= approval?.personalTest === true;
            }
          }
          if (personalTest && !approvedAgreementId)
            approvalOverrideReason =
              "Coordinator confirmed this is their personal test email. No signed service agreement was recorded or approved.";
          if (!approvedAgreementId && !approvalOverrideReason)
            throw new HttpError(
              422,
              "AGREEMENT_REQUIRED",
              "Approve signed agreement evidence, or record a coordinator exception reason",
            );
        }

        if (personalTest) {
          if (
            !roster ||
            roster.business !== "weatherly" ||
            invitedUser ||
            approvedAgreementId ||
            priorInvitations.some((invite) => !!invite.matterId)
          )
            throw new HttpError(
              422,
              "PERSONAL_TEST_NOT_AVAILABLE",
              "Use a Weatherly contact with no existing account, approved agreement, or transaction invitation for a personal test.",
            );
          if (
            await tx.matter.findFirst({
              where: { agentRosterId: roster.id },
              select: { id: true },
            })
          )
            throw new HttpError(
              409,
              "PERSONAL_TEST_HAS_FILES",
              "Personal test invitations require a roster entry with no assigned transactions.",
            );
        }

        if (
          prior &&
          data.matterId !== undefined &&
          data.matterId !== prior.matterId
        )
          throw new HttpError(
            422,
            "INVITATION_SCOPE_MISMATCH",
            "Use the selected invitation’s original file.",
          );
        const now = new Date();
        const matterId = prior?.matterId ?? data.matterId;
        if (matterId && !data.matterId)
          await requireMatter(actor, matterId, true, tx);
        if (prior) {
          await tx.invitation.updateMany({
            where: {
              id: { in: priorInvitations.map(({ id }) => id) },
              matterId: prior.matterId,
              acceptedAt: null,
              expiresAt: { gt: now },
            },
            data: { expiresAt: now },
          });
        }
        const invitation = await tx.invitation.create({
          data: {
            email: data.email,
            role: data.role,
            tokenHash: hash(token),
            matterId,
            rosterAgentId: roster?.id,
            expiresAt: new Date(now.getTime() + data.expiresInHours * 3600000),
            invitedById: actor.id,
          },
        });
        const payload = {
          id: invitation.id,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          acceptanceToken: token,
        };
        const queued =
          roster && (await options.queueAgentInvitation?.(tx, payload));
        const delivery = queued ? "queued" : "manual";
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "invitation.created",
            entityType: "Invitation",
            entityId: invitation.id,
            details: {
              personalTest,
              approvedAgreementId: approvedAgreementId || null,
              approvalOverrideReason: approvalOverrideReason || null,
              ...(prior ? { priorInvitationId: prior.id } : {}),
              delivery,
            },
          },
        });
        return { ...payload, role: invitation.role, delivery, personalTest };
      });
      res.set("Cache-Control", "private, no-store").status(201).json(result);
    }),
  );
  // Only possession of an unexpired coordinator-created invitation permits account registration.
  r.post(
    "/invitations/register",
    rateLimit({
      windowMs: 60000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { token, name, password } = z
        .object({
          token: z.string().min(30),
          name: z.string().trim().min(1).max(150),
          password: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
      const passwordHash = await hashPassword(password);
      res.status(201).json(
        await prisma.$transaction(async (tx) => {
          const invitation = await openInvitation(tx, token);
          if (await tx.user.findUnique({ where: { email: invitation.email } }))
            throw new HttpError(
              409,
              "ACCOUNT_EXISTS",
              "Sign in to your existing account and accept the invitation",
            );
          const claimed = await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { acceptedAt: new Date() },
          });
          if (!claimed.count)
            throw new HttpError(
              409,
              "INVITATION_USED",
              "Invitation already accepted",
            );
          const user = await tx.user.create({
            data: {
              id: randomBytes(16).toString("hex"),
              name,
              email: invitation.email,
              emailVerified: true,
              role: invitation.role,
            },
          });
          await tx.account.create({
            data: {
              id: randomBytes(16).toString("hex"),
              accountId: user.id,
              userId: user.id,
              providerId: "credential",
              password: passwordHash,
            },
          });
          await applyInvitationApproval(tx, invitation, user.id);
          if (invitation.matterId)
            await tx.matterParticipant.upsert({
              where: {
                matterId_userId: {
                  matterId: invitation.matterId,
                  userId: user.id,
                },
              },
              create: {
                matterId: invitation.matterId,
                userId: user.id,
                role: invitation.role,
              },
              update: { revokedAt: null },
            });
          return { registered: true, email: user.email };
        }),
      );
    }),
  );
  r.post(
    "/invitations/accept",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      const { token } = z.object({ token: z.string().min(30) }).parse(req.body);
      res.json(
        await prisma.$transaction(async (tx) => {
          const invitation = await openInvitation(tx, token);
          if (
            normalizeRosterEmail(invitation.email) !==
            normalizeRosterEmail(actor.email)
          )
            throw new HttpError(
              400,
              "INVALID_INVITATION",
              "Invitation is expired, already used, or belongs to another account",
            );
          if (actor.role === "coordinator")
            throw new HttpError(
              409,
              "ROLE_CONFLICT",
              "Coordinator account cannot accept another role",
            );
          const changed = await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            data: { acceptedAt: new Date() },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "INVITATION_USED",
              "Invitation already accepted",
            );
          await applyInvitationApproval(tx, invitation, actor.id);
          await tx.user.update({
            where: { id: actor.id },
            data: { role: invitation.role },
          });
          if (invitation.matterId)
            await tx.matterParticipant.upsert({
              where: {
                matterId_userId: {
                  matterId: invitation.matterId,
                  userId: actor.id,
                },
              },
              create: {
                matterId: invitation.matterId,
                userId: actor.id,
                role: invitation.role,
              },
              update: { revokedAt: null },
            });
          await tx.session.deleteMany({
            where: { userId: actor.id, id: { not: actor.sessionId } },
          });
          return { accepted: true, role: invitation.role };
        }),
      );
    }),
  );
}

async function openInvitation(tx: Prisma.TransactionClient, token: string) {
  const candidate = await tx.invitation.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, email: true },
  });
  if (candidate) await lockRosterEmail(tx, candidate.email);
  const row =
    candidate &&
    (await tx.invitation.findUnique({ where: { id: candidate.id } }));
  if (!row || row.expiresAt <= new Date() || row.acceptedAt)
    throw new HttpError(
      400,
      "INVALID_INVITATION",
      "Invitation is expired or already used",
    );
  return row;
}

type Invitation = Prisma.InvitationGetPayload<object>;

function recipientMatches(
  email: string,
  userId?: string,
): Prisma.AgreementWhereInput {
  return {
    OR: [
      { userId: { equals: normalizeRosterEmail(email), mode: "insensitive" } },
      ...(userId ? [{ userId }] : []),
    ],
  };
}

function unboundOrSameRoster(
  rosterAgentId: string,
): Prisma.AgreementWhereInput {
  return { OR: [{ rosterAgentId }, { rosterAgentId: null }] };
}

async function applyInvitationApproval(
  tx: Prisma.TransactionClient,
  invitation: Invitation,
  userId: string,
) {
  if (invitation.role !== "agent") return;
  const roster =
    invitation.rosterAgentId &&
    (await tx.rosterAgent.findFirst({
      where: {
        id: invitation.rosterAgentId,
        normalizedEmail: normalizeRosterEmail(invitation.email),
        archivedAt: null,
      },
    }));
  if (
    invitation.rosterAgentId &&
    (!roster || (roster.userId && roster.userId !== userId))
  )
    throw new HttpError(
      409,
      "INVITATION_ROSTER_MISMATCH",
      "This invitation no longer belongs to the selected roster agent.",
    );
  if (!roster || roster.business !== "hto")
    await applyWeatherlyApproval(tx, invitation, userId);
  if (roster && !roster.userId) {
    await tx.rosterAgent.update({
      where: { id: roster.id },
      data: { userId, revision: { increment: 1 } },
    });
    if (roster.brokerage)
      await tx.user.updateMany({
        where: { id: userId, brokerage: null },
        data: { brokerage: roster.brokerage },
      });
  }
}

async function applyWeatherlyApproval(
  tx: Prisma.TransactionClient,
  invitation: Invitation,
  userId: string,
) {
  const details = await getInvitationApproval(tx, invitation.id);
  if (details?.approvedAgreementId) {
    const agreement = await tx.agreement.findFirst({
      where: {
        id: details.approvedAgreementId,
        status: "approved",
        documentId: { not: null },
        AND: [
          recipientMatches(invitation.email, userId),
          ...(invitation.rosterAgentId
            ? [unboundOrSameRoster(invitation.rosterAgentId)]
            : []),
        ],
      },
    });
    if (!agreement)
      throw new HttpError(
        422,
        "AGREEMENT_REQUIRED",
        "The signed agreement approval is no longer valid",
      );
    await tx.agreement.update({
      where: { id: agreement.id },
      data: {
        userId,
        ...(invitation.rosterAgentId
          ? { rosterAgentId: invitation.rosterAgentId }
          : {}),
      },
    });
    return;
  }
  if (details?.approvalOverrideReason) {
    if (details.personalTest) {
      if (
        !invitation.rosterAgentId ||
        invitation.matterId ||
        (await tx.matter.findFirst({
          where: {
            OR: [
              { agentRosterId: invitation.rosterAgentId },
              { agentId: userId },
              { participants: { some: { userId, revokedAt: null } } },
            ],
          },
          select: { id: true },
        }))
      )
        throw new HttpError(
          409,
          "PERSONAL_TEST_HAS_FILES",
          "This test invitation can only activate an account with no assigned transactions. Ask Ireland to review the roster entry.",
        );
    }
    await tx.auditEvent.create({
      data: {
        actorId: invitation.invitedById,
        action: "agent.access_override",
        entityType: "User",
        entityId: userId,
        details: {
          personalTest: details.personalTest === true,
          reason: details.approvalOverrideReason,
          invitationId: invitation.id,
        },
      },
    });
    return;
  }
  throw new HttpError(
    422,
    "AGREEMENT_REQUIRED",
    "Approve signed agreement evidence before agent access",
  );
}

async function getInvitationApproval(
  tx: Prisma.TransactionClient,
  invitationId: string,
) {
  const decision = await tx.auditEvent.findFirst({
    where: {
      entityType: "Invitation",
      entityId: invitationId,
      action: "invitation.created",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return decision?.details as
    | {
        approvedAgreementId?: string;
        approvalOverrideReason?: string;
        personalTest?: boolean;
      }
    | undefined;
}
