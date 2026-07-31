// Helper Satuan bersama — dipakai KpiMasterPage.tsx (hint "Target Gabungan", auto-calc Bobot
// Agregasi) & DisburseTargetModal.tsx (default disbursement per bulan). Diekstrak ke sini
// (bukan diekspor langsung dari KpiMasterPage.tsx) supaya tak terjadi circular import antara
// halaman & komponen modal.

// Beda dgn num() longgar di common/capaian.ts (backend, strip huruf shg "Tanggal 5" jadi 5) —
// di sini SELURUH string harus berupa angka valid, else null. Dipakai gating fitur auto-hitung
// Bobot Agregasi supaya tak salah aktif utk target non-numerik (tanggal/milestone).
export const strictNum = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

// Kategori satuan — dipakai bersama utk hint "Target Gabungan" (rata-rata vs Σ) & default
// disbursement per bulan (replikasi vs bagi-rata vs kosong). Kata kunci dicek via .includes()
// pada satuan.trim().toLowerCase() — substring match case-insensitive.
const RATE_LIKE_KEYWORDS = ['hari', 'waktu', 'jam', 'minggu', 'bulan'];
// "milestone" ditambahkan di sini (bukan dibiarkan default 'additive' spt semula) — dikonfirmasi
// via fitur disbursement per bulan: milestone adalah kejadian diskret (mis. "3 milestone/tahun"),
// bagi-rata 3÷12=0.25 tak bermakna (tak ada "seperempat milestone"). Sebelumnya sengaja dibiarkan
// tak terkategori krn ambigu (lihat commit sebelumnya) — kasus nyata ini mengonfirmasi arahnya.
const DATE_LIKE_KEYWORDS = ['tanggal', 'tgl', 'deadline', 'milestone'];
export type SatuanCategory = 'percent' | 'rate' | 'date' | 'additive';
export const satuanCategory = (satuan: string): SatuanCategory => {
  const s = satuan.trim();
  if (s === '%') return 'percent';
  if (RATE_LIKE_KEYWORDS.some((k) => s.toLowerCase().includes(k))) return 'rate';
  if (DATE_LIKE_KEYWORDS.some((k) => s.toLowerCase().includes(k))) return 'date';
  return 'additive';
};
