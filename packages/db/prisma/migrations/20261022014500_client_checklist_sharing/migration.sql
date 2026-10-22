ALTER TABLE "Task" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing chronological order when upgrading a populated database.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "matterId" ORDER BY "createdAt", "id") - 1 AS position
  FROM "Task"
)
UPDATE "Task" SET "position" = ordered.position FROM ordered WHERE "Task"."id" = ordered."id";
CREATE INDEX "Task_matterId_position_idx" ON "Task"("matterId", "position");

CREATE TABLE "ChecklistShare" (
  "id" TEXT NOT NULL,
  "matterId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ChecklistShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChecklistShare_matterId_key" ON "ChecklistShare"("matterId");
CREATE UNIQUE INDEX "ChecklistShare_tokenHash_key" ON "ChecklistShare"("tokenHash");
CREATE INDEX "ChecklistShare_issuedById_idx" ON "ChecklistShare"("issuedById");
ALTER TABLE "ChecklistShare" ADD CONSTRAINT "ChecklistShare_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChecklistShare" ADD CONSTRAINT "ChecklistShare_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
