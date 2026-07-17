-- Override manual GM/Admin untuk membuka window pengisian realisasi di luar jadwal tgl 25-5
ALTER TABLE "periods" ADD COLUMN "windowOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "periods" ADD COLUMN "overrideBy" TEXT;
ALTER TABLE "periods" ADD COLUMN "overrideAt" TIMESTAMP(3);
