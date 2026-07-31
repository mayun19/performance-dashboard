// Perhitungan capaian/nilai KPI dipakai bersama oleh Executive & Operational service.
// Dipisah agar resolusi "target-of-record" (living KM Sementara / KM Final beku) konsisten
// di kedua tempat alih-alih membaca target statis langsung dari item realisasi.

export function num(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const r2 = (n: number): number => Math.round(n * 100) / 100;

// Target-of-record: peta masterKpiId -> nilai target yang berlaku (living Sementara saat
// realisasi disubmit, atau KM Final beku saat restatement). Item tanpa masterKpiId (dokumen
// KM legacy pra-KpiMaster) tetap fallback ke target bawaannya sendiri (target2/target).
export type TargetOverrideMap = Record<string, number>;

export function resolveTarget(item: Record<string, unknown>, overrides?: TargetOverrideMap): number {
  const masterKpiId = item['masterKpiId'];
  if (typeof masterKpiId === 'string' && overrides && masterKpiId in overrides) {
    return overrides[masterKpiId];
  }
  return num(item['target2'] ?? item['target']);
}

// Capaian (%) dibatasi 110%. `isInverse` = polaritas "Low Better" (mis. satuan 'hari kerja').
export function computeCapaian(target: number, actual: number, isInverse: boolean): number {
  if (target <= 0 || actual <= 0) return 0;
  return isInverse ? Math.min((target / actual) * 100, 110) : Math.min((actual / target) * 100, 110);
}

// Pencapaian RESMI (field `capaianResmi`, diisi reviewer via updateValues() saat proses review)
// menang atas hasil computeCapaian() otomatis — staff hanya bisa isi `capaianSaran` (saran,
// tak pernah dibaca di sini). Reviewer kosong → fallback computeCapaian seperti sebelumnya
// (backward-compat, tak mengubah skor data lama/tanpa override).
export function resolveCapaian(target: number, actual: number, isInverse: boolean, override?: unknown): number {
  const resmi = num(override);
  if (resmi > 0) return Math.min(resmi, 110);
  return computeCapaian(target, actual, isInverse);
}

// Resolusi polaritas → isInverse (boolean) dipakai computeCapaian(). PRIORITAS: field eksplisit
// `polaritas` ('positive'|'negative', dipilih RPC saat definisi KPI Master) — baru fallback ke
// heuristik lama (satuan === 'hari kerja') utk item lama yg belum py field ini (backward compat,
// TAK mengubah perilaku item existing). Field eksplisit menggantikan heuristik yg terbukti keliru
// utk KPI Minimize bersatuan lain (mis. "Pengendalian NAC", satuan Rp Miliar — lihat commit terkait).
export function resolvePolarity(satuan: string, polaritas?: unknown): boolean {
  if (polaritas === 'negative') return true;
  if (polaritas === 'positive') return false;
  return satuan.trim().toLowerCase() === 'hari kerja';
}

export function computeNilai(bobot: number, capaian: number): number {
  return r2((capaian / 100) * bobot);
}

// Sub-indikator KPI komposit (opt-in, generik — lihat kpi-master.service.ts SubIndicatorInput).
// Target sub diambil LANGSUNG dari definisi dokumen KM (sub.target/target2) — TIDAK memakai
// target-of-record living-target/PeriodTarget (itu khusus KPI nilai-tunggal, lihat resolveTarget
// di atas). Sub tanpa bobot/target/realisasi valid dilewati (belum dinilai), sama seperti item biasa.
export type SubIndicatorScore = { nama: string; satuan: string; bobot: number; target: number; actual: number; capaian: number; nilai: number; formula: string };

export function breakdownComposite(item: Record<string, unknown>): SubIndicatorScore[] {
  const subs = Array.isArray(item['subIndicators']) ? (item['subIndicators'] as Record<string, unknown>[]) : [];
  return subs.map((si) => {
    const bobot = num(si['bobot']);
    const target = num(si['target2'] ?? si['target']);
    const actual = num(si['realisasi']);
    const satuan = String(si['satuan'] ?? '').toLowerCase();
    // Sub pengurang/penalti (bobot < 0, "Max Penalti"): realisasi = jumlah poin pelanggaran,
    // langsung jadi pengurang, dibatasi plafon |bobot| (tak bisa melebihi Max Penalti).
    if (bobot < 0) {
      const nilai = actual > 0 ? r2(-Math.min(actual, Math.abs(bobot))) : 0;
      const capaian = bobot !== 0 ? r2((nilai / bobot) * 100) : 0; // % plafon penalti terpakai
      return { nama: String(si['nama'] ?? ''), satuan, bobot, target, actual, capaian, nilai, formula: String(si['formula'] ?? '') };
    }
    const capaian = bobot > 0 && target > 0 && actual > 0 ? resolveCapaian(target, actual, resolvePolarity(satuan, si['polaritas']), si['capaianResmi']) : 0;
    return { nama: String(si['nama'] ?? ''), satuan, bobot, target, actual, capaian, nilai: computeNilai(bobot, capaian), formula: String(si['formula'] ?? '') };
  });
}

// Nilai satu item komposit = Σ nilai tiap sub-indikator ("bobot poin sendiri" — Σ bobot sub =
// bobot induk, ditetapkan saat definisi KPI Master; lihat kpi-master.service.ts save()).
export function scoreCompositeItem(item: Record<string, unknown>): number {
  return r2(breakdownComposite(item).reduce((s, si) => s + si.nilai, 0));
}

// Jumlah nilai tertimbang satu set item (satu unit/track), memakai target-of-record bila ada.
// Item komposit (punya subIndicators non-kosong) dinilai via scoreCompositeItem — target/
// realisasi/bobot milik item induk DILEWATI utk item tsb (turunan dari sub, bukan dientri).
export function scoreItems(items: Record<string, unknown>[], overrides?: TargetOverrideMap): number {
  let total = 0;
  for (const it of items) {
    const subs = it['subIndicators'];
    if (Array.isArray(subs) && subs.length > 0) {
      total += scoreCompositeItem(it);
      continue;
    }
    const bobot = num(it['bobot']);
    const actual = num(it['realisasi']);
    // Item pengurang/penalti legacy (flat, tanpa sub-indikator): realisasi = poin pelanggaran,
    // dibatasi plafon |bobot| — sama seperti sub pengurang komposit di breakdownComposite().
    if (bobot < 0) {
      total += actual > 0 ? -Math.min(actual, Math.abs(bobot)) : 0;
      continue;
    }
    const target = resolveTarget(it, overrides);
    const satuan = String(it['satuan'] ?? '').toLowerCase();
    if (bobot > 0 && target > 0 && actual > 0) {
      const capaian = resolveCapaian(target, actual, resolvePolarity(satuan, it['polaritas']), it['capaianResmi']);
      total += (capaian / 100) * bobot;
    }
  }
  return r2(total);
}

// Urutan indikator sesuai dokumen spesimen resmi (KM 2026 GM PUSMANPRO) — dipakai bersama oleh
// executive.service.ts & operational.service.ts (kartu KPI) dan mirror print Bundle KM Kantor
// Induk (getItemOrder di apps/web/src/pages/ApprovalsPage.tsx).
export function specimenOrder(indikator: string): number {
  const s = indikator.toLowerCase();
  if (s.includes('inspection quality') || s.includes('iqc')) return 10;
  if (s.includes('kajian supervisi')) return 20;
  if (s.includes('evaluasi') && s.includes('analisa') && s.includes('rekomendasi')) return 30;
  if (s.includes('persentase pelaksanaan')) return 40;
  if (s.includes('kapasitas pembangkit')) return 50;
  if (s.includes('kapasitas transmisi')) return 60;
  if (s.includes('kapasitas gardu induk')) return 70;
  if (s.includes('pengendalian') && (s.includes('anggaran investasi') || s.includes('penggunaan anggaran'))) return 81;
  if (s.includes('pengendalian nac') || s.includes('non allowable')) return 82;
  if (s.includes('pengendalian') && s.includes('anggaran')) return 80;
  if (s.includes('evaluasi akurasi data')) return 90;
  if (s.includes('pemenuhan pdn') || s.includes('pdn korporat')) return 100;
  if (s.includes('dokumen legal aset tanah') || s.includes('penyelesaian dokumen legal')) return 110;
  if (s.includes('maturity level')) return 121;
  if (s.includes('pengurang') && s.includes('kepatuhan')) return 122;
  if (s.includes('tata kelola')) return 123;
  return 999;
}

export type FlatFannedItem = { it: Record<string, unknown>; bidang: string };
// key: `${masterKpiId}|${unitCode}|${bidang}` -> persenAgregasi (0-100)
export type PersenLookup = Map<string, number>;

const fanOutKey = (it: Record<string, unknown>): string => String(it['masterKpiId'] ?? it['indikator'] ?? '');

// Gabung fan-out KPI lintas-bidang (KPI Master yang di-assign ke >1 bidang dalam unit yang
// sama, mis. "Pengendalian Anggaran" = OMP+KKU, "Kepatuhan..." = 6 bidang KP) → satu entri per
// KPI, SEBELUM dipakai skoring dashboard (operational/executive) — mencegah KPI lintas-bidang
// dihitung berkali-kali (identik prinsipnya dgn dedupFlat di print FE, lihat ApprovalsPage.tsx).
// Item wakil = kemunculan pertama; realisasi (item biasa) atau realisasi tiap sub (komposit,
// per-index) di-rollup dari SELURUH anggota grup: tertimbang persenAgregasi bila Σpct>0, else
// jumlah polos (metode SUM / persenAgregasi tak diketahui/0). Item dgn 1 assignment tak disentuh.
export function dedupFanOutRealisasi(
  flat: FlatFannedItem[],
  persenLookup: PersenLookup,
  unitCode: string,
): FlatFannedItem[] {
  const order: string[] = [];
  const groups = new Map<string, FlatFannedItem[]>();
  for (const entry of flat) {
    const key = fanOutKey(entry.it);
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(entry);
  }
  return order.map((key) => {
    const members = groups.get(key)!;
    const first = members[0];
    if (members.length === 1) return first;
    const masterKpiId = first.it['masterKpiId'];
    const pcts = members.map((m) => (
      typeof masterKpiId === 'string' ? persenLookup.get(`${masterKpiId}|${unitCode}|${m.bidang}`) ?? 0 : 0
    ));
    const rollup = (vals: number[]): number => {
      const totalPct = pcts.reduce((s, p) => s + p, 0);
      const r = totalPct > 0
        ? vals.reduce((s, v, i) => s + v * (pcts[i] / 100), 0)
        : vals.reduce((s, v) => s + v, 0);
      return r2(r);
    };
    const subs = Array.isArray(first.it['subIndicators']) ? (first.it['subIndicators'] as Record<string, unknown>[]) : [];
    if (subs.length > 0) {
      const rolledSubs = subs.map((si, j) => ({
        ...si,
        realisasi: rollup(members.map((m) => {
          const mSubs = Array.isArray(m.it['subIndicators']) ? (m.it['subIndicators'] as Record<string, unknown>[]) : [];
          return num(mSubs[j]?.['realisasi']);
        })),
      }));
      return { it: { ...first.it, subIndicators: rolledSubs }, bidang: first.bidang };
    }
    return { it: { ...first.it, realisasi: rollup(members.map((m) => num(m.it['realisasi']))) }, bidang: first.bidang };
  });
}
