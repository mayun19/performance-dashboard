-- Persetujuan konsolidasi agregat KPI lintas-bidang (Fase H2).
CREATE TABLE "kpi_rollup_reviews" (
    "id" TEXT NOT NULL,
    "kpiMasterId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewer" TEXT,
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "nilaiParent" DOUBLE PRECISION,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kpi_rollup_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kpi_rollup_reviews_kpiMasterId_periodId_key" ON "kpi_rollup_reviews"("kpiMasterId", "periodId");
CREATE INDEX "kpi_rollup_reviews_periodId_idx" ON "kpi_rollup_reviews"("periodId");
