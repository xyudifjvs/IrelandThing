ALTER TABLE "IntakeSubmission" ADD COLUMN "processedAt" TIMESTAMP(3), ADD COLUMN "processedById" TEXT;
UPDATE "IntakeSubmission" AS i SET "processedAt" = i."createdAt" FROM "Matter" AS m WHERE m.id = i."matterId" AND m.stage <> 'pending_review';
CREATE INDEX "IntakeSubmission_processedAt_createdAt_id_idx" ON "IntakeSubmission"("processedAt", "createdAt", "id");
