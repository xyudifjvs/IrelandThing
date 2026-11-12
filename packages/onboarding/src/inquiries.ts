import type { Router } from "express";
import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
  hashToken,
} from "@weatherly/platform";
import { audit, revision } from "@weatherly/matters";
import {
  captureRosterLead,
  normalizeRosterEmail,
} from "@weatherly/identity/roster";

import { randomUUID } from "node:crypto";
import { requestLimiter } from "../../platform/src/request-limits";

const inquiryInput = z
  .object({
    requestId: z.uuid().optional(),
    website: z.string().max(0, "Leave this field empty").optional(),
    name: z.string().trim().max(150).default(""),
    email: z.email().transform(normalizeRosterEmail),
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
    if (
      (v.kind !== "information" ||
        v.payload.requestType === "service_agreement") &&
      !v.name
    )
      c.addIssue({
        code: "custom",
        path: ["name"],
        message: "Enter your name.",
      });
    if (
      v.kind !== "contact" &&
      v.payload.brokerage &&
      !/^howard\s+hanna\b/i.test(v.payload.brokerage.trim())
    )
      c.addIssue({
        code: "custom",
        path: ["payload", "brokerage"],
        message: "Weatherly serves Howard Hanna agents only.",
      });
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
  return prisma.$transaction(async (tx) => {
    await tx.inquiry.createMany({
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
    const inquiry = await tx.inquiry.findUniqueOrThrow({
      where: { requestId },
    });
    if (inquiry.submissionHash !== submissionHash)
      throw new HttpError(
        409,
        "INQUIRY_CONFLICT",
        "This request was already submitted with different details. Start a new request.",
      );
    if (!inquiry.rosterAgentId) {
      const agent = await captureRosterLead(tx, {
        email: data.email,
        name: data.name,
        phone: data.payload.phone,
        brokerage: data.payload.brokerage,
      });
      await tx.inquiry.update({
        where: { id: inquiry.id },
        data: { rosterAgentId: agent.id },
      });
    }
    return { id: inquiry.id, status: "received" };
  });
}
export function registerInquiryRoutes(r: Router) {
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
}
