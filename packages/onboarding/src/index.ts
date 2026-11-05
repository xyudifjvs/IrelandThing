import { schedulingConfig } from "./calendly";
export { calendlyWebhook } from "./calendly";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  type Principal,
  hashToken,
} from "@weatherly/platform";
import { requestLimiter } from "../../platform/src/request-limits";
import { audit, revision } from "@weatherly/matters";
const inquiryInput = z
  .object({
    requestId: z.uuid().optional(),
    website: z.string().max(0, "Leave this field empty").optional(),
    name: z.string().trim().max(150).default(""),
    email: z.email().toLowerCase(),
    kind: z.enum(["contact", "meeting", "information"]),
    payload: z
      .object({
        phone: z.string().max(60).optional(),
        brokerage: z.string().max(250).optional(),
        team: z.string().trim().max(250).optional(),
        officeAddress: z.string().trim().max(1000).optional(),
        requestType: z.enum(["service_agreement"]).optional(),
        message: z.string().max(10000).optional(),
        meetingTime: z.iso.datetime({ offset: true }).optional(),
        timezone: z.string().max(100).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if((v.kind !== "information" || v.payload.requestType === "service_agreement") && !v.name)c.addIssue({code:"custom",path:["name"],message:"Enter your name."});
    if(v.kind!=="contact" && v.payload.brokerage && !/^howard\s+hanna\b/i.test(v.payload.brokerage.trim()))c.addIssue({code:"custom",path:["payload","brokerage"],message:"Weatherly serves Howard Hanna agents only."});
    if (v.kind === "meeting" && (!v.payload.meetingTime || !v.payload.timezone))
      c.addIssue({
        code: "custom",
        path: ["payload"],
        message: "Meeting requests require an offset timestamp and timezone",
      });
    if (v.payload.timezone) {
      try {
        Intl.DateTimeFormat("en", { timeZone: v.payload.timezone });
      } catch {
        c.addIssue({
          code: "custom",
          path: ["payload", "timezone"],
          message: "Use an IANA timezone",
        });
      }
    }
  });
async function validateAgreementEvidence(documentId?: string, supportingDocumentIds: string[] = []) {
  if (supportingDocumentIds.length && !documentId)
    throw new HttpError(422, "EVIDENCE_REQUIRED", "Choose one primary signed agreement before attaching supporting files.");
  const ids = [documentId, ...supportingDocumentIds].filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length)
    throw new HttpError(422, "DUPLICATE_EVIDENCE", "Each agreement evidence document must be attached only once.");
  if (!ids.length) return;
  const docs = await prisma.document.findMany({ where: { id: { in: ids } } });
  if (docs.length !== ids.length)
    throw new HttpError(422, "INVALID_DOCUMENT", "An evidence document was not found. Refresh and choose the saved files again.");
  if (docs.some((doc) => doc.visibility !== "coordinator" || doc.matterId || doc.category !== "service_agreement"))
    throw new HttpError(422, "INVALID_AGREEMENT_EVIDENCE", "Agreement evidence must be a private service-agreement upload without a transaction association.");
}
export async function createInquiry(input: unknown) {
  const {
    requestId = randomUUID(),
    website: _trap,
    ...data
  } = inquiryInput.parse(input);
  const submissionHash = hashToken(JSON.stringify(data));
  await prisma.inquiry.createMany({
    data: [
      {
        ...data,
        requestId,
        submissionHash,
        payload: data.payload as Prisma.InputJsonValue,
        status: "new",
      },
    ],
    skipDuplicates: true,
  });
  const inquiry = await prisma.inquiry.findUniqueOrThrow({
    where: { requestId },
  });
  if (inquiry.submissionHash !== submissionHash)
    throw new HttpError(
      409,
      "INQUIRY_CONFLICT",
      "This request was already submitted with different details. Start a new request.",
    );
  return { id: inquiry.id, status: "received" };
}
export function createOnboardingRouter() {
  const r = Router();
  r.get("/scheduling", (_req, res) => res.json(schedulingConfig()));
  r.get(
    "/bookings",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      res.json(
        await prisma.schedulingBooking.findMany({
          orderBy: { startAt: "desc" },
          take: 200,
        }),
      );
    }),
  );
  r.get(
    "/bookings/:id",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      const booking = await prisma.schedulingBooking.findUnique({
        where: { id: String(req.params.id) },
      });
      if (!booking)
        throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found.");
      res.json(booking);
    }),
  );
  r.post(
    "/inquiries",
    requestLimiter("inquiry", 5, { windowMs: 10 * 60000 }),
    asyncHandler(async (req, res) =>
      res.status(201).json(await createInquiry(req.body)),
    ),
  );
  r.get(
    "/inquiries",
    asyncHandler(async (req, res) => {
      assertCoordinator(principal(req));
      res.json(
        await prisma.inquiry.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      );
    }),
  );
  r.patch(
    "/inquiries/:id",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const { expectedRevision, status } = z
        .object({
          expectedRevision: revision,
          status: z.enum([
            "new",
            "contacted",
            "meeting_requested",
            "meeting_confirmed",
            "agreement_sent",
            "approved",
            "closed",
          ]),
        })
        .strict()
        .parse(req.body);
      const id = String(req.params.id);
      res.json(
        await prisma.$transaction(async (tx) => {
          const changed = await tx.inquiry.updateMany({
            where: { id, revision: expectedRevision },
            data: { status, revision: { increment: 1 } },
          });
          if (!changed.count)
            throw new HttpError(
              409,
              "REVISION_CONFLICT",
              "Inquiry changed; refresh",
            );
          await audit(tx, actor, "inquiry.updated", "Inquiry", id, null, {
            status,
          });
          return tx.inquiry.findUniqueOrThrow({ where: { id } });
        }),
      );
    }),
  );
  r.get(
    "/agreements",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      res.json(
        await prisma.agreement.findMany({
          where: actor.role === "coordinator" ? {} : { userId: actor.id },
          orderBy: { createdAt: "desc" },
        }),
      );
    }),
  );
  r.post(
    "/agreements",
    asyncHandler(async (req, res) => {
      const actor = principal(req);
      assertCoordinator(actor);
      const { agreementRequestId, ...data } = z
        .object({
          userId: z.string(),
          version: z.string().min(1).max(100),
          documentId: z.string().optional(),
          supportingDocumentIds: z.array(z.string()).max(19).default([]),
          agreementRequestId: z.uuid().optional(),
          status: z
            .enum(["draft", "sent", "received", "approved"])
            .default("draft"),
        })
        .strict()
        .parse(req.body);
      if (
        !(await prisma.user.findUnique({ where: { id: data.userId } })) &&
        !z.email().safeParse(data.userId).success
      )
        throw new HttpError(422, "INVALID_USER", "Agreement user not found");
      if (["received", "approved"].includes(data.status) && !data.documentId)
        throw new HttpError(
          422,
          "EVIDENCE_REQUIRED",
          "Attach the signed agreement evidence",
        );
      await validateAgreementEvidence(data.documentId, data.supportingDocumentIds);
      const agreementRequestHash = hashToken(JSON.stringify({ actorId: actor.id, ...data }));
      res.status(201).json(
        await prisma.$transaction(async (tx) => {
          let row;
          if (agreementRequestId) {
            const created = await tx.agreement.createMany({
              data: [{ ...data, agreementRequestId, agreementRequestHash }],
              skipDuplicates: true,
            });
            row = await tx.agreement.findUniqueOrThrow({ where: { agreementRequestId } });
            if (row.agreementRequestHash !== agreementRequestHash)
              throw new HttpError(409, "AGREEMENT_REQUEST_CONFLICT", "This recording request was already used for different agreement details. Refresh before trying again.");
            if (!created.count) return row;
          } else row = await tx.agreement.create({ data });
          await audit(
            tx,
            actor,
            "agreement.created",
            "Agreement",
            row.id,
            null,
            { version: row.version, status: row.status, documentId: row.documentId, supportingDocumentIds: row.supportingDocumentIds },
          );
          return row;
        }),
      );
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
      const existing = await prisma.agreement.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, "AGREEMENT_NOT_FOUND", "Agreement not found");
      const supporting = supportingDocumentIds ?? existing.supportingDocumentIds;
      await validateAgreementEvidence(documentId ?? existing.documentId ?? undefined, supporting);
      res.json(
        await prisma.$transaction(async (tx) => {
          const changed = await tx.agreement.updateMany({
            where: { id, revision: expectedRevision },
            data: { status, documentId, supportingDocumentIds: supporting, revision: { increment: 1 } },
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
  return r;
}
