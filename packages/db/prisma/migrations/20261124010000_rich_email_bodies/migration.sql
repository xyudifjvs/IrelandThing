ALTER TABLE "CommunicationTemplate" ADD COLUMN "bodyFormat" TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE "EmailDraft" ADD COLUMN "bodyFormat" TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE "MergeFieldSettings" ADD COLUMN "signatureFormat" TEXT NOT NULL DEFAULT 'plain';
