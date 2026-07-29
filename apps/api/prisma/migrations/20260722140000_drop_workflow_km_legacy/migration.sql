-- Hapus fitur workflow-km lama: tabel legacy km_documents/km_reviews (status ladder
-- IN_REVIEW_C1->C2->SM->APPROVED) yang terpisah dari alur nyata (kontrak_manajemen /
-- input_realisasi dengan steps[]+currentStepIndex). Halaman-halamannya tak terhubung
-- di navigasi mana pun dan hanya berisi data seed palsu — dua sumber kebenaran yang
-- membingungkan.
DROP TABLE IF EXISTS "km_reviews";
DROP TABLE IF EXISTS "km_documents";
DROP TYPE IF EXISTS "KMDocStatus";
DROP TYPE IF EXISTS "KMDocType";
