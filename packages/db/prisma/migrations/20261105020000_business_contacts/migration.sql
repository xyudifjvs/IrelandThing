CREATE TABLE "BusinessContact" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "identityKey" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessContact_ownerId_identityKey_key" ON "BusinessContact"("ownerId", "identityKey");
CREATE INDEX "BusinessContact_ownerId_kind_idx" ON "BusinessContact"("ownerId", "kind");
CREATE INDEX "BusinessContact_ownerId_favorite_idx" ON "BusinessContact"("ownerId", "favorite");
CREATE INDEX "BusinessContact_ownerId_lastUsedAt_idx" ON "BusinessContact"("ownerId", "lastUsedAt");
ALTER TABLE "BusinessContact" ADD CONSTRAINT "BusinessContact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
