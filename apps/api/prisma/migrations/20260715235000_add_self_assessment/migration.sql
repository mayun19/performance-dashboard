-- Snapshot nilai self-assessment UPMK saat submit (dikunci, terpisah dari `values` yang bisa dikoreksi reviewer).
ALTER TABLE "input_realisasi" ADD COLUMN "selfAssessment" JSONB;
