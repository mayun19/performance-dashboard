-- Bobot KM pindah dari per-assignment (KpiAssignment) menjadi data parent (KpiMaster) —
-- satu nilai bobot untuk seluruh unit/bidang yang di-assign KPI ini.
ALTER TABLE "kpi_masters" ADD COLUMN "bobotKm" TEXT NOT NULL DEFAULT '';
ALTER TABLE "kpi_assignments" DROP COLUMN "bobotKm";
