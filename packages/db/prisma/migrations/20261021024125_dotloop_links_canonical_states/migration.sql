-- AlterTable
ALTER TABLE "Matter" ALTER COLUMN "stage" SET DEFAULT 'under_contract';

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'pending';

-- CreateTable
CREATE TABLE "DotloopLink" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "loopId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'linked',
    "lastSyncedAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DotloopLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DotloopLink_matterId_key" ON "DotloopLink"("matterId");
