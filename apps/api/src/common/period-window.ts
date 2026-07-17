// Window pengisian realisasi KPI: mulai tanggal 25 bulan periode ybs,
// berakhir tanggal 5 bulan berikutnya (23:59:59) — deadline submit UPMK.
// Contoh: periode "Juni 2026" → window 25 Jun 2026 00:00 s.d. 5 Jul 2026 23:59:59.
export interface FillWindow {
  start: Date;
  end: Date;
}

export function getFillWindow(yearMonth: string): FillWindow {
  const [y, m] = yearMonth.split('-').map(Number); // m: 1-12
  const start = new Date(y, m - 1, 25, 0, 0, 0, 0);
  const end = new Date(y, m, 5, 23, 59, 59, 999); // bulan berikutnya (JS month 0-indexed)
  return { start, end };
}

const DAY_MS = 86400000;

export interface FillWindowStatus extends FillWindow {
  isOpen: boolean;
  overrideActive: boolean; // true bila terbuka HANYA karena override manual GM/Admin
  daysUntilClose: number;  // negatif bila sudah lewat
  daysUntilOpen: number;   // negatif bila sudah/sedang buka
}

// `overrideOpen`: flag dari Period.windowOverride — GM/Admin dapat membuka window
// secara manual di luar jadwal normal (tgl 25 - tgl 5) untuk kondisi khusus (demo,
// tutup buku molor, dsb). Tidak mengubah jadwal normal untuk periode lain.
export function getFillWindowStatus(yearMonth: string, overrideOpen = false, now: Date = new Date()): FillWindowStatus {
  const { start, end } = getFillWindow(yearMonth);
  const naturallyOpen = now >= start && now <= end;
  const isOpen = naturallyOpen || overrideOpen;
  return {
    start, end, isOpen,
    overrideActive: overrideOpen && !naturallyOpen,
    daysUntilClose: Math.ceil((end.getTime() - now.getTime()) / DAY_MS),
    daysUntilOpen: Math.ceil((start.getTime() - now.getTime()) / DAY_MS),
  };
}
