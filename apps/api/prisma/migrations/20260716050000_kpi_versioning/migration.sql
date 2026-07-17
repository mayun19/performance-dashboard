-- Versioning KPI Master (Fase D): edit atas definisi yang sedang berlaku membuat versi
-- baru efektif bulan berikutnya, bukan mengubah periode berjalan.
-- (Tabel kosong saat migrasi ini dibuat — default literal aman dipakai.)
ALTER TABLE "kpi_masters" ADD COLUMN "effectiveMonth" TEXT NOT NULL DEFAULT '';
ALTER TABLE "kpi_masters" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "kpi_masters" ADD COLUMN "previousVersionId" TEXT;

-- Backfill baris lama (bila ada) dari kolom "year" yang sudah ada, lalu lepas default.
UPDATE "kpi_masters" SET "effectiveMonth" = "year" || '-01' WHERE "effectiveMonth" = '';
ALTER TABLE "kpi_masters" ALTER COLUMN "effectiveMonth" DROP DEFAULT;
