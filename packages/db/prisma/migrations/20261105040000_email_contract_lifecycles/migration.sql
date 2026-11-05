-- Preserve existing local threads and messages as the primary lifecycle. New
-- contract cycles may share Gmail's actual providerThreadId without sharing data.
ALTER TABLE "EmailThread" ADD COLUMN "lifecycleKey" TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE "EmailThread" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DROP INDEX "EmailThread_ownerId_providerThreadId_key";
CREATE UNIQUE INDEX "EmailThread_ownerId_providerThreadId_lifecycleKey_key" ON "EmailThread"("ownerId", "providerThreadId", "lifecycleKey");
