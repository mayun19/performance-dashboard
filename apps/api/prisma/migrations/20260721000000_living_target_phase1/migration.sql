-- DropIndex
DROP INDEX "executive_snapshots_periodId_key";

-- DropIndex
DROP INDEX "operational_snapshots_periodId_key";

-- AlterTable
ALTER TABLE "executive_snapshots" ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'sementara',
ADD COLUMN     "targetOfRecord" JSONB;

-- AlterTable
ALTER TABLE "input_realisasi" ADD COLUMN     "packagePhase" TEXT NOT NULL DEFAULT 'sementara',
ADD COLUMN     "targetOfRecord" JSONB;

-- AlterTable
ALTER TABLE "kpi_rollup_reviews" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operational_snapshots" ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'sementara',
ADD COLUMN     "targetOfRecord" JSONB;

-- AlterTable
ALTER TABLE "periods" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "restatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "period_targets" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kpiAssignmentId" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'fresh',
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenTarget" TEXT,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_logs" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorId" TEXT,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_targets_periodId_idx" ON "period_targets"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "period_targets_periodId_kpiAssignmentId_key" ON "period_targets"("periodId", "kpiAssignmentId");

-- CreateIndex
CREATE INDEX "revision_logs_entity_targetId_idx" ON "revision_logs"("entity", "targetId");

-- CreateIndex
CREATE INDEX "revision_logs_periodId_idx" ON "revision_logs"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "executive_snapshots_periodId_phase_key" ON "executive_snapshots"("periodId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "operational_snapshots_periodId_phase_key" ON "operational_snapshots"("periodId", "phase");

-- AddForeignKey
ALTER TABLE "period_targets" ADD CONSTRAINT "period_targets_kpiAssignmentId_fkey" FOREIGN KEY ("kpiAssignmentId") REFERENCES "kpi_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
