-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "EmailThread" ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "OAuthState" ADD COLUMN     "verifier" TEXT;
