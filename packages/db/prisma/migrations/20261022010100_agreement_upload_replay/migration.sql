ALTER TABLE "DocumentVersion" ADD COLUMN "originalName" TEXT;
ALTER TABLE "Agreement"
  ADD COLUMN "agreementRequestId" TEXT,
  ADD COLUMN "agreementRequestHash" TEXT;
CREATE UNIQUE INDEX "Agreement_agreementRequestId_key" ON "Agreement"("agreementRequestId");
