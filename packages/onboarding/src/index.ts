import { Router } from "express";
import { prisma } from "@weatherly/db";
import {
  HttpError,
  asyncHandler,
  principal,
  assertCoordinator,
} from "@weatherly/platform";
import { schedulingConfig } from "./calendly";
import { registerAgreementRoutes } from "./agreements";
import { registerInquiryRoutes } from "./inquiries";
import { registerRosterRoutes } from "./roster-routes";

export { calendlyWebhook } from "./calendly";
export { createInquiry } from "./inquiries";
export { recordAgreement } from "./agreements";
export { listRoster, getRosterAgent } from "./roster-read";

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
  registerInquiryRoutes(r);
  registerAgreementRoutes(r);
  registerRosterRoutes(r);
  return r;
}
