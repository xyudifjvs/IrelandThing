-- Each selected file has a stable replay key, scoped to the authenticated uploader.
ALTER TABLE "DocumentVersion"
  ADD COLUMN "uploadedById" TEXT,
  ADD COLUMN "uploadRequestId" TEXT,
  ADD COLUMN "uploadContextHash" TEXT;
CREATE UNIQUE INDEX "DocumentVersion_uploadedById_uploadRequestId_key"
  ON "DocumentVersion"("uploadedById", "uploadRequestId");

-- An agreement still has exactly one primary signed document. Extra selected
-- evidence is explicitly attached to the same agreement, never auto-approved.
ALTER TABLE "Agreement" ADD COLUMN "supportingDocumentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
