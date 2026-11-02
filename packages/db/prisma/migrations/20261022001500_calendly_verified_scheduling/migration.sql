CREATE TABLE "SchedulingBooking" (
 "id" TEXT PRIMARY KEY, "inviteeUri" TEXT NOT NULL, "eventUri" TEXT NOT NULL,
 "eventTypeUri" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL,
 "timezone" TEXT, "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3) NOT NULL,
 "status" TEXT NOT NULL CHECK ("status" IN ('confirmed','canceled','rescheduled')),
 "oldInviteeUri" TEXT, "newInviteeUri" TEXT, "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
 "lastDeliveryHash" TEXT NOT NULL, "provenance" TEXT NOT NULL,
 "verifiedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "SchedulingBooking_inviteeUri_key" ON "SchedulingBooking"("inviteeUri");
CREATE INDEX "SchedulingBooking_startAt_status_idx" ON "SchedulingBooking"("startAt", "status");
CREATE INDEX "SchedulingBooking_oldInviteeUri_idx" ON "SchedulingBooking"("oldInviteeUri");
CREATE TABLE "SchedulingDelivery" (
 "deliveryHash" TEXT PRIMARY KEY, "event" TEXT NOT NULL, "inviteeUri" TEXT NOT NULL,
 "sourceAt" TIMESTAMP(3) NOT NULL, "applied" BOOLEAN NOT NULL, "payload" JSONB NOT NULL,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SchedulingDelivery_inviteeUri_sourceAt_idx" ON "SchedulingDelivery"("inviteeUri", "sourceAt");
