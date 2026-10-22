CREATE TABLE "RequestLimit" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequestLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RequestLimit_resetAt_idx" ON "RequestLimit"("resetAt");
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Inquiry" ADD COLUMN "requestId" TEXT, ADD COLUMN "submissionHash" TEXT;
CREATE UNIQUE INDEX "Inquiry_requestId_key" ON "Inquiry"("requestId");
