import { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  type Principal,
} from "@weatherly/platform";
import { audit, revision } from "@weatherly/matters";
const contact = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email(),
    phone: z.string().min(1).max(60),
    relationship: z.string().max(200).optional(),
  })
  .strict();
const handling = z
  .object({
    choice: z.enum(["have", "listing_agent", "mls", "dotloop", "buyers_agent"]),
    name: z.string().max(250).optional(),
    email: z.email().optional(),
    phone: z.string().max(60).optional(),
  })
  .strict();
export const intakePayload = z
  .object({
    packageCode: z.enum(["essentials", "complete", "full_listing"]),
    side: z.enum(["buyer", "seller"]),
    propertyAddress: z.string().trim().min(1).max(500),
    purchaseType: z.enum(["cash", "financed"]),
    contractSource: z.enum(["upload", "dotloop", "not_yet_executed"]),
    documentIds: z.array(z.string()).max(30).default([]),
    dotloopLoopId: z.string().max(200).optional(),
    clients: z.array(contact).min(1).max(12),
    relationship: z.string().max(200).optional(),
    directContact: z.enum(["copy_agent", "through_agent"]),
    title: handling,
    lender: handling.optional(),
    hoa: z.enum([
      "none",
      "received_sent",
      "mls_dotloop_send",
      "request_listing_agent",
      "agent_will_email",
      "sent_buyers_agent",
      "seller_will_email",
    ]),
    priorPolicy: z
      .enum([
        "not_applicable",
        "dotloop_send",
        "request_sellers",
        "agent_will_email",
      ])
      .optional(),
    broker: z
      .object({
        name: z.string().min(1).max(200),
        email: z.email(),
        pre1978: z.boolean(),
        ownChecklist: z.boolean(),
        checklistDocumentId: z.string().optional(),
      })
      .strict()
      .optional(),
    notes: z.string().max(20000).default(""),
    gift: z
      .object({
        requested: z.boolean(),
        tier: z.enum(["classic", "signature", "luxury"]).optional(),
        choice: z.string().max(200).optional(),
        personalization: z.string().max(2000).optional(),
        deliveryAddress: z.string().max(500).optional(),
      })
      .strict(),
    linkedMatterId: z.string().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const err = (path: (string | number)[], message: string) =>
      c.addIssue({ code: "custom", path, message });
    if (v.packageCode !== "essentials" && !v.broker)
      err(["broker"], "Compliance and Full Listing require broker details");
    if (v.packageCode === "full_listing" && v.side !== "seller")
      err(["side"], "Full Listing requires seller representation");
    if (v.contractSource !== "dotloop" && v.dotloopLoopId)
      err(
        ["dotloopLoopId"],
        "Remove Dotloop selection when another contract source is selected",
      );
    if (v.contractSource === "dotloop" && v.documentIds.length)
      err(["documentIds"], "Use one contract source");
    if (
      v.packageCode !== "full_listing" &&
      v.contractSource === "not_yet_executed"
    )
      err(["contractSource"], "An executed contract is required");
    if (v.contractSource === "upload" && !v.documentIds.length)
      err(["documentIds"], "Upload the executed contract");
    if (v.contractSource === "dotloop" && v.packageCode === "essentials")
      err(["contractSource"], "Dotloop intake requires Complete");
    if (v.contractSource === "dotloop" && !v.dotloopLoopId)
      err(["dotloopLoopId"], "Select the Dotloop loop");
    if (v.purchaseType === "financed" && !v.lender)
      err(["lender"], "Provide lender handling");
    if (v.purchaseType === "cash" && v.lender)
      err(["lender"], "Cash purchases must not include lender instructions");
    for (const key of ["title", "lender"] as const) {
      const h = v[key];
      if (!h) continue;
      if (h.choice !== "have" && (h.name || h.email || h.phone))
        err([key], "Remove contact details when requesting lookup");
      if (
        key === "title" &&
        !["have", "listing_agent", "mls"].includes(h.choice)
      )
        err([key, "choice"], "Select title details, listing agent, or MLS");
      if (
        key === "lender" &&
        !["have", "dotloop", "buyers_agent"].includes(h.choice)
      )
        err([key, "choice"], "Select lender details, Dotloop, or buyer agent");
      if (h.choice === "have" && !h.name)
        err([key, "name"], "Company or officer name is required");
      if (h.choice === "dotloop" && v.packageCode === "essentials")
        err([key, "choice"], "Dotloop requires Complete");
      if (h.choice === "listing_agent" && v.side !== "buyer")
        err([key, "choice"], "Listing-agent lookup applies to buyers");
      if (h.choice === "buyers_agent" && v.side !== "seller")
        err([key, "choice"], "Buyer-agent lookup applies to sellers");
      if (h.choice === "mls" && v.side !== "seller")
        err([key, "choice"], "MLS lookup applies to sellers");
    }
    if (
      v.side === "buyer" &&
      v.priorPolicy &&
      v.priorPolicy !== "not_applicable"
    )
      err(["priorPolicy"], "Prior title policy applies to sellers");
    const buyer = [
      "none",
      "received_sent",
      "mls_dotloop_send",
      "request_listing_agent",
      "agent_will_email",
    ];
    const seller = [
      "none",
      "sent_buyers_agent",
      "mls_dotloop_send",
      "seller_will_email",
    ];
    if (!(v.side === "buyer" ? buyer : seller).includes(v.hoa))
      err(["hoa"], "HOA handling does not match the represented side");
    if (v.gift.requested && (!v.gift.tier || !v.gift.choice))
      err(["gift"], "Select gift tier and choice");
    if (
      !v.gift.requested &&
      (v.gift.tier ||
        v.gift.choice ||
        v.gift.personalization ||
        v.gift.deliveryAddress)
    )
      err(["gift"], "Remove gift details when no gift is requested");
  });
export type IntakePayload = z.infer<typeof intakePayload>;
async function draftFor(
  actor: Principal,
  id: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const draft = await db.intakeDraft.findFirst({
    where: {
      id,
      ...(actor.role === "coordinator" ? {} : { userId: actor.id }),
    },
  });
  if (!draft) throw new HttpError(404, "DRAFT_NOT_FOUND", "Draft not found");
  if (actor.role === "client")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only agents may submit transactions",
    );
  return draft;
}
function permitted(actor: Principal) {
  if (actor.role === "client")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only agents may submit transactions",
    );
}
export async function saveIntakeDraft(
  actor: Principal,
  id: string,
  input: unknown,
) {
  permitted(actor);
  const { expectedRevision, payload } = z
    .object({
      expectedRevision: revision,
      payload: z.record(z.string(), z.json()),
    })
    .strict()
    .parse(input);
  return prisma.$transaction(async (tx) => {
    const draft = await draftFor(actor, id, tx);
    if (draft.status === "submitted")
      throw new HttpError(
        409,
        "ALREADY_SUBMITTED",
        "Submitted intake is immutable",
      );
    const result = await tx.intakeDraft.updateMany({
      where: { id, revision: expectedRevision, status: "draft" },
      data: {
        payload: payload as Prisma.InputJsonValue,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new HttpError(409, "REVISION_CONFLICT", "Draft changed; refresh");
    return tx.intakeDraft.findUniqueOrThrow({ where: { id } });
  });
}
export async function submitIntake(
  actor: Principal,
  id: string,
  input: unknown,
) {
  permitted(actor);
  const { expectedRevision, idempotencyKey } = z
    .object({
      expectedRevision: revision,
      idempotencyKey: z.string().min(8).max(150),
    })
    .strict()
    .parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const draft = await draftFor(actor, id, tx);
      const existing = await tx.intakeSubmission.findUnique({
        where: { draftId: id },
      });
      if (existing) {
        if (existing.idempotencyKey !== idempotencyKey)
          throw new HttpError(
            409,
            "ALREADY_SUBMITTED",
            "This draft has already been submitted",
          );
        return {
          submission: existing,
          matter: await tx.matter.findUniqueOrThrow({
            where: { id: existing.matterId },
          }),
        };
      }
      const data = intakePayload.parse(draft.payload);
      if (data.linkedMatterId) {
        const linked = await tx.matter.findFirst({
          where: {
            id: data.linkedMatterId,
            ...(actor.role === "coordinator" ? {} : { agentId: actor.id }),
          },
        });
        if (
          !linked ||
          linked.propertyAddress.toLowerCase() !==
            data.propertyAddress.toLowerCase() ||
          linked.side === data.side
        )
          throw new HttpError(
            422,
            "INVALID_LINK",
            "Linked representation must be the opposite side of the same property",
          );
      }
      // Claim the exact saved revision before creating any downstream records; all effects roll back on a race.
      const claim = await tx.intakeDraft.updateMany({
        where: { id, revision: expectedRevision, status: "draft" },
        data: {
          status: "submitted",
          submittedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (!claim.count)
        throw new HttpError(409, "REVISION_CONFLICT", "Draft changed; refresh");
      const docs = await tx.document.findMany({
        where: { id: { in: data.documentIds }, createdById: draft.userId },
      });
      if (docs.length !== new Set(data.documentIds).size)
        throw new HttpError(
          422,
          "INVALID_DOCUMENT",
          "Uploaded files must belong to this submitting agent",
        );
      const matter = await tx.matter.create({
        data: {
          title: data.propertyAddress,
          propertyAddress: data.propertyAddress,
          side: data.side,
          packageCode: data.packageCode,
          stage:
            data.packageCode === "full_listing" ? "listing" : "under_contract",
          agentId: draft.userId,
          details: data as Prisma.InputJsonValue,
        },
      });
      for (const doc of docs) {
        if (doc.matterId)
          throw new HttpError(
            422,
            "DOCUMENT_ALREADY_ASSIGNED",
            "Upload a separate copy of evidence for another matter",
          );
        await tx.document.update({
          where: { id: doc.id },
          data: { matterId: matter.id },
        });
      }
      const tasks: {
        title: string;
        kind: string;
        visibility: string;
        details: Prisma.InputJsonValue;
      }[] = [];
      const add = (title: string, kind = "intake") =>
        tasks.push({
          title,
          kind,
          visibility: "agent",
          details: { intakeDraftId: id },
        });
      add(
        data.contractSource === "not_yet_executed"
          ? "Obtain executed contract"
          : data.contractSource === "dotloop"
            ? "Import executed contract from Dotloop"
            : "Review executed contract",
      );
      add(
        data.title.choice === "have"
          ? "Confirm title company details"
          : `Resolve title company via ${data.title.choice}`,
      );
      if (data.lender)
        add(
          data.lender.choice === "have"
            ? "Confirm lender details"
            : `Resolve lender details via ${data.lender.choice}`,
        );
      if (data.hoa !== "none") add(`HOA follow-up: ${data.hoa}`);
      if (data.priorPolicy && data.priorPolicy !== "not_applicable")
        add(`Prior title policy: ${data.priorPolicy}`);
      if (data.broker?.pre1978)
        add("Review lead-based paint disclosure evidence", "compliance");
      if (data.broker?.ownChecklist)
        add("Obtain and apply brokerage checklist", "compliance");
      if (data.packageCode !== "essentials")
        add("Review broker compliance file", "compliance");
      if (data.gift.requested)
        add("Confirm gift catalog and payment before ordering", "gift");
      for (const title of [
        "Earnest money evidence",
        "Inspection and remedies",
        "Title review",
        "Final walkthrough",
        "Closing",
        "Possession",
      ])
        add(title, "milestone");
      if (data.purchaseType === "financed")
        for (const title of [
          "Preapproval evidence",
          "Loan application",
          "Appraisal",
          "Financing commitment",
        ])
          add(title, "milestone");
      await tx.task.createMany({
        data: tasks.map((task) => ({ ...task, matterId: matter.id })),
      });
      await tx.deadline.createMany({
        data: ["Closing", "Possession", "Inspection"].map((label) => ({
          matterId: matter.id,
          label,
          status: "unknown",
          details: { source: "intake", reviewRequired: true },
        })),
      });
      const submission = await tx.intakeSubmission.create({
        data: {
          draftId: id,
          idempotencyKey,
          userId: draft.userId,
          matterId: matter.id,
          snapshot: data as Prisma.InputJsonValue,
        },
      });
      await tx.intakeDraft.update({
        where: { id },
        data: { submittedMatterId: matter.id },
      });
      await tx.outboxJob.create({
        data: {
          topic: "intake.submitted",
          idempotencyKey: `intake-submitted:${submission.id}`,
          payload: { matterId: matter.id, submissionId: submission.id },
        },
      });
      await audit(
        tx,
        actor,
        "intake.submitted",
        "IntakeSubmission",
        submission.id,
        matter.id,
        { draftId: id },
      );
      return { submission, matter };
    });
  } catch (error) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      (error instanceof HttpError && error.code === "REVISION_CONFLICT")
    ) {
      const existing = await prisma.intakeSubmission.findFirst({
        where: { draftId: id, userId: actor.id, idempotencyKey },
      });
      if (existing)
        return {
          submission: existing,
          matter: await prisma.matter.findUniqueOrThrow({
            where: { id: existing.matterId },
          }),
        };
    }
    throw error;
  }
}
export function createIntakeRouter() {
  const r = Router();
  r.get(
    "/drafts",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      permitted(actor);
      res.json(
        await prisma.intakeDraft.findMany({
          where: actor.role === "coordinator" ? {} : { userId: actor.id },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
      );
    }),
  );
  r.post(
    "/drafts",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      permitted(actor);
      const { payload } = z
        .object({ payload: z.record(z.string(), z.json()).default({}) })
        .strict()
        .parse(req.body);
      res.status(201).json(
        await prisma.intakeDraft.create({
          data: {
            userId: actor.id,
            payload: payload as Prisma.InputJsonValue,
            status: "draft",
          },
        }),
      );
    }),
  );
  r.get(
    "/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json(await draftFor(principal(req), String(req.params.id))),
    ),
  );
  r.patch(
    "/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json(
        await saveIntakeDraft(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  r.post(
    "/drafts/:id/submit",
    asyncHandler(async (req, res) =>
      res.json(
        await submitIntake(principal(req), String(req.params.id), req.body),
      ),
    ),
  );
  return r;
}
