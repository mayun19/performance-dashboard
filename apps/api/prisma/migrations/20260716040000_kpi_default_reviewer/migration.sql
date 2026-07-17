-- Default alur reviewer (Fase C) di KPI Master, diwariskan ke picker saat submit dokumen KM.
ALTER TABLE "kpi_masters" ADD COLUMN "defaultCheckerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "kpi_masters" ADD COLUMN "defaultApproverId" TEXT;
