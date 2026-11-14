import type { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  hashToken,
  type Principal,
} from "@weatherly/platform";
import { audit, revision } from "@weatherly/matters";
import { lockRosterAgent } from "./roster-write";
import { lockRosterEmail } from "@weatherly/identity/roster";

async function validateAgreementEvidence(
  tx: Prisma.TransactionClient,
  documentId?: string,
  supportingDocumentIds: string[] = [],
) {
  if (supportingDocumentIds.length && !documentId)
    throw new HttpError(
      422,
      "EVIDENCE_REQUIRED",
      "Choose one primary signed agreement before attaching supporting files.",
    );
  const ids = [documentId, ...supportingDocumentIds].filter(
    (id): id is string => !!id,
  );
  if (new Set(ids).size !== ids.length)
    throw new HttpError(
      422,
      "DUPLICATE_EVIDENCE",
      "Each agreement evidence document must be attached only once.",
    );
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM "Document" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const docs = await tx.document.findMany({ where: { id: { in: ids } } });
  if (docs.length !== ids.length)
    throw new HttpError(
      422,
      "INVALID_DOCUMENT",
      "An evidence document was not found. Refresh and choose the saved files again.",
    );
  if (
    docs.some(
      (doc) =>
        doc.visibility !== "coordinator" ||
        doc.shareWithAgent ||
        doc.shareWithClient ||
        doc.matterId ||
        doc.intakeSubmissionId ||
        doc.creationReviewId ||
        doc.category !== "service_agreement",
    )
  )
    throw new HttpError(
      422,
      "INVALID_AGREEMENT_EVIDENCE",
      "Agreement evidence must be a private service-agreement upload without a transaction association.",
    );
}

const agreementInput = z
  .object({
    userId: z.string(),
    rosterAgentId: z.string().min(1).max(200).optional(),
    signedOn: z.iso.date().optional(),
    version: z.string().min(1).max(100),
    documentId: z.string().optional(),
    supportingDocumentIds: z.array(z.string()).max(19).default([]),
    agreementRequestId: z.uuid().optional(),
    status: z.enum(["draft", "sent", "received", "approved"]).default("draft"),
  })
  .strict();

function checkRecordingRequest(
  row: { agreementRequestHash: string | null },
  expected: string,
) {
  if (row.agreementRequestHash !== expected)
    throw new HttpError(
      409,
      "AGREEMENT_REQUEST_CONFLICT",
      "This recording request was already used for different agreement details. Refresh before trying again.",
    );
}

async function lockLegacyRecipient(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const email =
    user?.email ?? (z.email().safeParse(userId).success ? userId : null);
  if (!email)
    throw new HttpError(422, "INVALID_USER", "Agreement user not found");
  await lockRosterEmail(tx, email);
}

/** Entry point for coordinator uploads and any verified signer adapter. */
export async function recordAgreement(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const { agreementRequestId, ...data } = agreementInput.parse(raw);
  const signed = ["received", "approved"].includes(data.status);
  if (signed && !data.documentId)
    throw new HttpError(
      422,
      "EVIDENCE_REQUIRED",
      "Attach the signed agreement evidence",
    );
  const agreementRequestHash = hashToken(
    JSON.stringify({ actorId: actor.id, ...data }),
  );
  return prisma.$transaction(async (tx) => {
    if (agreementRequestId) {
      const existing = await tx.agreement.findUnique({
        where: { agreementRequestId },
      });
      if (existing) {
        checkRecordingRequest(existing, agreementRequestHash);
        return existing;
      }
    }

    const agent = data.rosterAgentId
      ? await lockRosterAgent(tx, data.rosterAgentId)
      : null;
    if (!agent) await lockLegacyRecipient(tx, data.userId);
    if (agent) {
      if (agent.business === "hto")
        throw new HttpError(
          409,
          "HTO_AGREEMENT_NOT_REQUIRED",
          "Home Team Ohio agents do not need a service agreement.",
        );
      if (![agent.userId, agent.normalizedEmail].includes(data.userId))
        throw new HttpError(
          409,
          "AGREEMENT_RECIPIENT_MISMATCH",
          "Choose evidence for the selected roster agent.",
        );
      if (signed && !data.signedOn)
        throw new HttpError(
          422,
          "SIGNED_DATE_REQUIRED",
          "Enter the date the agreement was signed.",
        );
    }
    const matchingAccount =
      agent?.normalizedEmail && data.status === "approved" && !agent.userId
        ? await tx.user.findFirst({
            where: { email: agent.normalizedEmail, role: "agent" },
            select: { id: true },
          })
        : null;
    const values = {
      ...data,
      userId: agent?.userId ?? matchingAccount?.id ?? data.userId,
    };
    await validateAgreementEvidence(
      tx,
      data.documentId,
      data.supportingDocumentIds,
    );
    let row;
    if (agreementRequestId) {
      const created = await tx.agreement.createMany({
        data: [{ ...values, agreementRequestId, agreementRequestHash }],
        skipDuplicates: true,
      });
      row = await tx.agreement.findUniqueOrThrow({
        where: { agreementRequestId },
      });
      checkRecordingRequest(row, agreementRequestHash);
      if (!created.count) return row;
    } else {
      row = await tx.agreement.create({ data: values });
    }

    if (agent && matchingAccount)
      await tx.rosterAgent.update({
        where: { id: agent.id },
        data: { userId: matchingAccount.id, revision: { increment: 1 } },
      });
    await audit(tx, actor, "agreement.created", "Agreement", row.id, null, {
      version: row.version,
      status: row.status,
      documentId: row.documentId,
      supportingDocumentIds: row.supportingDocumentIds,
    });
    return row;
  });
}

export function registerAgreementRoutes(r: Router) {
  r.use("/agreements", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  r.get(
    "/agreements",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      res.json(
        await prisma.agreement.findMany({
          orderBy: { createdAt: "desc" },
        }),
      );
    }),
  );
  r.post(
    "/agreements",
    asyncHandler(async (req, res) => {
      res.status(201).json(await recordAgreement(principal(req), req.body));
    }),
  );
  r.patch(
    "/agreements/:id",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const { expectedRevision, status, documentId, supportingDocumentIds } = z
        .object({
          expectedRevision: revision,
          status: z.enum(["draft", "sent", "received", "approved"]),
          documentId: z.string().optional(),
          supportingDocumentIds: z.array(z.string()).max(19).optional(),
        })
        .strict()
        .parse(req.body);
      if (["received", "approved"].includes(status) && !documentId)
        throw new HttpError(
          422,
          "EVIDENCE_REQUIRED",
          "Attach the signed agreement evidence",
        );
      const id = String(req.params.id);
      res.json(
        await prisma.$transaction(async (tx) => {
          const initial = await tx.agreement.findUnique({ where: { id } });
          if (!initial)
            throw new HttpError(
              404,
              "AGREEMENT_NOT_FOUND",
              "Agreement not found",
            );
          if (!initial.rosterAgentId)
            await lockLegacyRecipient(tx, initial.userId);
          const roster = initial.rosterAgentId
            ? await lockRosterAgent(tx, initial.rosterAgentId)
            : null;
          const existing = await tx.agreement.findUniqueOrThrow({
            where: { id },
          });
          if (existing.revision !== expectedRevision)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "Agreement changed; refresh",
            );
          const supporting =
            supportingDocumentIds ?? existing.supportingDocumentIds;
          if (existing.rosterAgentId) {
            const agent =
              roster ?? (await lockRosterAgent(tx, existing.rosterAgentId));
            if (agent.business === "hto")
              throw new HttpError(
                409,
                "HTO_AGREEMENT_NOT_REQUIRED",
                "Home Team Ohio agents do not need a service agreement.",
              );
            if (
              existing.status === "approved" &&
              (status !== "approved" ||
                (documentId !== undefined &&
                  existing.documentId !== documentId) ||
                (supportingDocumentIds !== undefined &&
                  JSON.stringify(existing.supportingDocumentIds) !==
                    JSON.stringify(supportingDocumentIds)))
            )
              throw new HttpError(
                409,
                "AGREEMENT_HISTORY_RETAINED",
                "Record a new version to replace signed agreement evidence.",
              );
          }
          await validateAgreementEvidence(
            tx,
            documentId ?? existing.documentId ?? undefined,
            supporting,
          );
          const changed = await tx.agreement.updateMany({
            where: { id, revision: expectedRevision },
            data: {
              status,
              documentId,
              supportingDocumentIds: supporting,
              revision: { increment: 1 },
            },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "Agreement changed; refresh",
            );
          await audit(tx, actor, "agreement.updated", "Agreement", id, null, {
            status,
            documentId: documentId || null,
            supportingDocumentIds: supporting,
          });
          return tx.agreement.findUniqueOrThrow({ where: { id } });
        }),
      );
    }),
  );
}
