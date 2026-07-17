-- Default alur reviewer per-assignment (Kombinasi A+B). Kolom JSON nullable additive:
-- baris lama = NULL → fallback ke default reviewer master-level (perilaku lama).
ALTER TABLE "kpi_assignments" ADD COLUMN "reviewerSlots" JSONB;
