-- Metode agregasi per-KPI (Fase E): 'weighted' (rata-rata tertimbang, existing) atau
-- 'sum' (jumlah polos, cocok untuk KPI penalti/pengurang lintas bidang).
ALTER TABLE "kpi_masters" ADD COLUMN "aggregationMethod" TEXT NOT NULL DEFAULT 'weighted';
