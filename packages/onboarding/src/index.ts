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
    name: z.string().trim().min(1).max(150),
    email: z.email().toLowerCase(),
    kind: z.enum(["contact", "meeting", "information"]),
    payload: z
      .object({
        phone: z.string().max(60).optional(),
        brokerage: z.string().max(250).optional(),
        message: z.string().max(10000).optional(),
        meetingTime: z.iso.datetime({ offset: true }).optional(),
        timezone: z.string().max(100).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
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
      const data = z
        .object({
          userId: z.string(),
          version: z.string().min(1).max(100),
          documentId: z.string().optional(),
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
      if (
        data.documentId &&
        !(await prisma.document.findUnique({ where: { id: data.documentId } }))
      )
        throw new HttpError(
          422,
          "INVALID_DOCUMENT",
          "Evidence document not found",
        );
      res.status(201).json(
        await prisma.$transaction(async (tx) => {
          const row = await tx.agreement.create({ data });
          await audit(
            tx,
            actor,
            "agreement.created",
            "Agreement",
            row.id,
            null,
            { version: row.version, status: row.status },
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
      const { expectedRevision, status, documentId } = z
        .object({
          expectedRevision: revision,
          status: z.enum(["draft", "sent", "received", "approved"]),
          documentId: z.string().optional(),
        })
        .strict()
        .parse(req.body);
      if (["received", "approved"].includes(status) && !documentId)
        throw new HttpError(
          422,
          "EVIDENCE_REQUIRED",
          "Attach the signed agreement evidence",
        );
      if (
        documentId &&
        !(await prisma.document.findUnique({ where: { id: documentId } }))
      )
        throw new HttpError(
          422,
          "INVALID_DOCUMENT",
          "Evidence document not found",
        );
      const id = String(req.params.id);
      res.json(
        await prisma.$transaction(async (tx) => {
          const changed = await tx.agreement.updateMany({
            where: { id, revision: expectedRevision },
            data: { status, documentId, revision: { increment: 1 } },
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
          });
          return tx.agreement.findUniqueOrThrow({ where: { id } });
        }),
      );
    }),
  );
  return r;
}
