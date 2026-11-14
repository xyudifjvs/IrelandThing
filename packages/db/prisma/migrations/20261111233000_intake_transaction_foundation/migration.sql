-- Additive only. Existing rows retain their classifications, access and history.
BEGIN;

-- CreateEnum
CREATE TYPE "Business" AS ENUM ('hto', 'weatherly');

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "rosterAgentId" TEXT;

-- AlterTable
ALTER TABLE "Matter" ADD COLUMN     "acceptanceAt" TIMESTAMPTZ(3),
ADD COLUMN     "acceptanceDate" TEXT,
ADD COLUMN     "agentRosterId" TEXT,
ADD COLUMN     "business" "Business",
ADD COLUMN     "checklistVersion" INTEGER,
ADD COLUMN     "deadlineTimeZone" TEXT,
ADD COLUMN     "purchasePriceCents" DECIMAL(16,0);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "actualAt" TIMESTAMPTZ(3),
ADD COLUMN     "actualDate" TEXT,
ADD COLUMN     "dateCapable" BOOLEAN,
ADD COLUMN     "dateRule" JSONB,
ADD COLUMN     "dueAt" TIMESTAMPTZ(3),
ADD COLUMN     "stepKey" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "creationReviewId" TEXT,
ADD COLUMN     "intakeSubmissionId" TEXT,
ADD COLUMN     "shareWithAgent" BOOLEAN,
ADD COLUMN     "shareWithClient" BOOLEAN;

-- AlterTable
ALTER TABLE "IntakeSubmission" ADD COLUMN     "business" "Business",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "rosterAgentId" TEXT;

-- AlterTable
ALTER TABLE "Agreement" ADD COLUMN     "rosterAgentId" TEXT,
ADD COLUMN     "signedOn" TEXT;

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "workItemId" TEXT;

-- AlterTable
ALTER TABLE "CommunicationTemplate" ADD COLUMN     "isPlaceholder" BOOLEAN,
ADD COLUMN     "linkedStepKey" TEXT,
ADD COLUMN     "position" INTEGER,
ADD COLUMN     "recipientGroup" TEXT,
ADD COLUMN     "recipientRoles" JSONB;

-- AlterTable
ALTER TABLE "SchedulingBooking" ADD COLUMN     "rosterAgentId" TEXT;

-- CreateTable
CREATE TABLE "RosterAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "phone" TEXT,
    "brokerage" TEXT,
    "userId" TEXT,
    "business" "Business",
    "agreementSentOn" TEXT,
    "archivedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationReview" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT,
    "ownerId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "extractionGeneration" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sourceRefs" JSONB NOT NULL DEFAULT '[]',
    "startRequestId" TEXT NOT NULL,
    "confirmedMatterId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmationRequestId" TEXT,
    "confirmationFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationExtraction" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "model" TEXT,
    "provider" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreationExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterContact" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "directoryContactId" TEXT,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "company" TEXT,
    "shareWithAgent" BOOLEAN NOT NULL DEFAULT false,
    "shareWithClient" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatterContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistShareSecret" (
    "matterId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,

    CONSTRAINT "ChecklistShareSecret_pkey" PRIMARY KEY ("matterId")
);

-- CreateTable
CREATE TABLE "EmailWork" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateRevision" INTEGER,
    "linkedStepKey" TEXT,
    "laterAt" TIMESTAMP(3),
    "remindOn" TEXT,
    "manualCompletedAt" TIMESTAMP(3),
    "manualCompletedById" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateTodo" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "matterId" TEXT,
    "body" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateTodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateScratchpad" (
    "ownerId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateScratchpad_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "HtoClosing" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "manualAgentRosterId" TEXT,
    "manualPropertyAddress" TEXT,
    "manualAddress" JSONB,
    "manualClients" JSONB NOT NULL DEFAULT '[]',
    "manualSide" TEXT,
    "manualStatus" TEXT,
    "manualCloseDate" TEXT,
    "manualListedDate" TEXT,
    "manualPriceCents" DECIMAL(16,0),
    "matchKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HtoClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestCursor" (
    "recipientId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "highWaterAt" TIMESTAMPTZ(3),
    "pendingWindowStart" TIMESTAMPTZ(3),
    "pendingWindowEnd" TIMESTAMPTZ(3),
    "pendingJobKey" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestCursor_pkey" PRIMARY KEY ("recipientId","stream")
);

-- CreateIndex
CREATE UNIQUE INDEX "RosterAgent_normalizedEmail_key" ON "RosterAgent"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "RosterAgent_userId_key" ON "RosterAgent"("userId");

-- CreateIndex
CREATE INDEX "RosterAgent_business_archivedAt_name_idx" ON "RosterAgent"("business", "archivedAt", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CreationReview_intakeId_key" ON "CreationReview"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "CreationReview_startRequestId_key" ON "CreationReview"("startRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "CreationReview_confirmedMatterId_key" ON "CreationReview"("confirmedMatterId");

-- CreateIndex
CREATE UNIQUE INDEX "CreationReview_confirmationRequestId_key" ON "CreationReview"("confirmationRequestId");

-- CreateIndex
CREATE INDEX "CreationReview_ownerId_state_updatedAt_idx" ON "CreationReview"("ownerId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreationExtraction_reviewId_generation_key" ON "CreationExtraction"("reviewId", "generation");

-- CreateIndex
CREATE INDEX "MatterContact_matterId_retiredAt_role_idx" ON "MatterContact"("matterId", "retiredAt", "role");

-- CreateIndex
CREATE INDEX "MatterContact_directoryContactId_idx" ON "MatterContact"("directoryContactId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistShareSecret_shareId_key" ON "ChecklistShareSecret"("shareId");

-- CreateIndex
CREATE INDEX "EmailWork_templateId_idx" ON "EmailWork"("templateId");

-- CreateIndex
CREATE INDEX "EmailWork_remindOn_matterId_idx" ON "EmailWork"("remindOn", "matterId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailWork_matterId_templateId_key" ON "EmailWork"("matterId", "templateId");

-- CreateIndex
CREATE INDEX "PrivateTodo_ownerId_createdAt_id_idx" ON "PrivateTodo"("ownerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PrivateTodo_ownerId_matterId_completedAt_idx" ON "PrivateTodo"("ownerId", "matterId", "completedAt");

-- CreateIndex
CREATE INDEX "PrivateTodo_matterId_idx" ON "PrivateTodo"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "HtoClosing_matterId_key" ON "HtoClosing"("matterId");

-- CreateIndex
CREATE INDEX "HtoClosing_matchKey_matterId_idx" ON "HtoClosing"("matchKey", "matterId");

-- CreateIndex
CREATE INDEX "HtoClosing_manualAgentRosterId_manualCloseDate_idx" ON "HtoClosing"("manualAgentRosterId", "manualCloseDate");

-- CreateIndex
CREATE INDEX "HtoClosing_manualStatus_manualCloseDate_idx" ON "HtoClosing"("manualStatus", "manualCloseDate");

-- CreateIndex
CREATE UNIQUE INDEX "DigestCursor_pendingJobKey_key" ON "DigestCursor"("pendingJobKey");

-- CreateIndex
CREATE INDEX "Invitation_rosterAgentId_createdAt_idx" ON "Invitation"("rosterAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "Matter_business_stage_idx" ON "Matter"("business", "stage");

-- CreateIndex
CREATE INDEX "Matter_agentRosterId_stage_idx" ON "Matter"("agentRosterId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Task_matterId_stepKey_key" ON "Task"("matterId", "stepKey");

-- CreateIndex
CREATE INDEX "Document_intakeSubmissionId_idx" ON "Document"("intakeSubmissionId");

-- CreateIndex
CREATE INDEX "Document_creationReviewId_idx" ON "Document"("creationReviewId");

-- CreateIndex
CREATE INDEX "IntakeSubmission_createdAt_id_idx" ON "IntakeSubmission"("createdAt", "id");

-- CreateIndex
CREATE INDEX "IntakeSubmission_userId_createdAt_id_idx" ON "IntakeSubmission"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Inquiry_rosterAgentId_createdAt_idx" ON "Inquiry"("rosterAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_rosterAgentId_createdAt_idx" ON "Agreement"("rosterAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDraft_workItemId_idx" ON "EmailDraft"("workItemId");

-- CreateIndex
CREATE INDEX "SchedulingBooking_rosterAgentId_startAt_idx" ON "SchedulingBooking"("rosterAgentId", "startAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_rosterAgentId_fkey" FOREIGN KEY ("rosterAgentId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_agentRosterId_fkey" FOREIGN KEY ("agentRosterId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_intakeSubmissionId_fkey" FOREIGN KEY ("intakeSubmissionId") REFERENCES "IntakeSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_creationReviewId_fkey" FOREIGN KEY ("creationReviewId") REFERENCES "CreationReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_rosterAgentId_fkey" FOREIGN KEY ("rosterAgentId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_rosterAgentId_fkey" FOREIGN KEY ("rosterAgentId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "EmailWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingBooking" ADD CONSTRAINT "SchedulingBooking_rosterAgentId_fkey" FOREIGN KEY ("rosterAgentId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterAgent" ADD CONSTRAINT "RosterAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationReview" ADD CONSTRAINT "CreationReview_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "IntakeSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationReview" ADD CONSTRAINT "CreationReview_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationReview" ADD CONSTRAINT "CreationReview_confirmedMatterId_fkey" FOREIGN KEY ("confirmedMatterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationExtraction" ADD CONSTRAINT "CreationExtraction_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CreationReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContact" ADD CONSTRAINT "MatterContact_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterContact" ADD CONSTRAINT "MatterContact_directoryContactId_fkey" FOREIGN KEY ("directoryContactId") REFERENCES "BusinessContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistShareSecret" ADD CONSTRAINT "ChecklistShareSecret_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailWork" ADD CONSTRAINT "EmailWork_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailWork" ADD CONSTRAINT "EmailWork_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateTodo" ADD CONSTRAINT "PrivateTodo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateTodo" ADD CONSTRAINT "PrivateTodo_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateScratchpad" ADD CONSTRAINT "PrivateScratchpad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HtoClosing" ADD CONSTRAINT "HtoClosing_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HtoClosing" ADD CONSTRAINT "HtoClosing_manualAgentRosterId_fkey" FOREIGN KEY ("manualAgentRosterId") REFERENCES "RosterAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestCursor" ADD CONSTRAINT "DigestCursor_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma's schema cannot express these checks. They apply only to new data.
ALTER TABLE "Matter"
  ADD CONSTRAINT "Matter_purchasePriceCents_safe_check"
    CHECK ("purchasePriceCents" BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT "Matter_acceptanceAt_requires_date_check"
    CHECK ("acceptanceAt" IS NULL OR "acceptanceDate" IS NOT NULL),
  ADD CONSTRAINT "Matter_checklistVersion_positive_check"
    CHECK ("checklistVersion" > 0);

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_stepKey_format_check"
    CHECK ("stepKey" ~ '^[a-z][a-z0-9_-]{0,79}$'),
  ADD CONSTRAINT "Task_dueAt_requires_date_check"
    CHECK ("dueAt" IS NULL OR "dueDate" IS NOT NULL),
  ADD CONSTRAINT "Task_actualAt_requires_date_check"
    CHECK ("actualAt" IS NULL OR "actualDate" IS NOT NULL);

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_share_flags_pair_check"
    CHECK (("shareWithAgent" IS NULL) = ("shareWithClient" IS NULL));

ALTER TABLE "RosterAgent"
  ADD CONSTRAINT "RosterAgent_email_pair_check"
    CHECK (("email" IS NULL) = ("normalizedEmail" IS NULL) AND "normalizedEmail" <> '');

ALTER TABLE "CreationReview"
  ADD CONSTRAINT "CreationReview_extractionGeneration_nonnegative_check"
    CHECK ("extractionGeneration" >= 0),
  ADD CONSTRAINT "CreationReview_confirmation_receipt_check"
    CHECK (
      ("confirmationRequestId" IS NULL) = ("confirmationFingerprint" IS NULL)
      AND ("confirmationRequestId" IS NULL) = ("confirmedAt" IS NULL)
      AND ("confirmedMatterId" IS NULL OR "confirmationRequestId" IS NOT NULL)
    );

ALTER TABLE "CreationExtraction"
  ADD CONSTRAINT "CreationExtraction_generation_positive_check"
    CHECK ("generation" > 0);

ALTER TABLE "HtoClosing"
  ADD CONSTRAINT "HtoClosing_manualPriceCents_safe_check"
    CHECK ("manualPriceCents" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "DigestCursor"
  ADD CONSTRAINT "DigestCursor_pending_window_check"
    CHECK (
      ("pendingWindowStart" IS NULL AND "pendingWindowEnd" IS NULL AND "pendingJobKey" IS NULL)
      OR
      ("pendingWindowStart" IS NOT NULL AND "pendingWindowEnd" IS NOT NULL
        AND "pendingJobKey" IS NOT NULL AND "pendingWindowStart" <= "pendingWindowEnd")
    );

COMMIT;
