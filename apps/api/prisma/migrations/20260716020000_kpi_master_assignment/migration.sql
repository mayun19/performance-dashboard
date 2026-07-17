-- KPI sebagai entitas parent: definisi KPI dapat di-assign ke banyak unit/bidang.
CREATE TABLE "kpi_masters" (
    "id" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "kmType" TEXT NOT NULL DEFAULT 'draft',
    "indikator" TEXT NOT NULL,
    "formula" TEXT NOT NULL DEFAULT '',
    "satuan" TEXT NOT NULL DEFAULT '',
    "targetParent" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_masters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kpi_masters_year_kmType_idx" ON "kpi_masters"("year", "kmType");

CREATE TABLE "kpi_assignments" (
    "id" TEXT NOT NULL,
    "kpiMasterId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "bidang" TEXT NOT NULL,
    "holder" TEXT NOT NULL DEFAULT '',
    "bobotKm" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "target2" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kpi_assignments_kpiMasterId_unitCode_bidang_key" ON "kpi_assignments"("kpiMasterId", "unitCode", "bidang");
CREATE INDEX "kpi_assignments_unitCode_bidang_idx" ON "kpi_assignments"("unitCode", "bidang");

ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_kpiMasterId_fkey" FOREIGN KEY ("kpiMasterId") REFERENCES "kpi_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
