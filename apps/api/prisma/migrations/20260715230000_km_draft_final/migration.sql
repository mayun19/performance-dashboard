-- KM Draft vs KM Final: dua dokumen independen per unit/bidang, masing-masing alur sendiri.
ALTER TABLE "kontrak_manajemen" ADD COLUMN "kmType" TEXT NOT NULL DEFAULT 'draft';
CREATE INDEX "kontrak_manajemen_kmType_idx" ON "kontrak_manajemen"("kmType");

-- Bundle KM kini per TAHUN + SCOPE + TIPE (bukan hanya TAHUN + SCOPE).
ALTER TABLE "km_bundles" ADD COLUMN "kmType" TEXT NOT NULL DEFAULT 'draft';
DROP INDEX IF EXISTS "km_bundles_year_scope_key";
CREATE UNIQUE INDEX "km_bundles_year_scope_kmType_key" ON "km_bundles"("year", "scope", "kmType");

-- Acuan aktif KM untuk pengisian realisasi per periode (bulan): default cerdas
-- Jan-Jun = 'draft', Jul-Des = 'final'. Dapat diubah manual oleh GM/Admin kapan pun.
ALTER TABLE "periods" ADD COLUMN "kmReference" TEXT NOT NULL DEFAULT 'draft';
UPDATE "periods" SET "kmReference" = 'final'
  WHERE CAST(substring("yearMonth" FROM 6 FOR 2) AS INTEGER) >= 7;
