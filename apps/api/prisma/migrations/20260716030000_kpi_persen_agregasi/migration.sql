-- Bobot rollup (0-100) per assignment ke nilai parent KPI, diinput RPC Perencanaan.
ALTER TABLE "kpi_assignments" ADD COLUMN "persenAgregasi" DOUBLE PRECISION NOT NULL DEFAULT 0;
