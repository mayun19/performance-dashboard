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

export function computeNilai(bobot: number, capaian: number): number {
  return r2((capaian / 100) * bobot);
}

// Jumlah nilai tertimbang satu set item (satu unit/track), memakai target-of-record bila ada.
export function scoreItems(items: Record<string, unknown>[], overrides?: TargetOverrideMap): number {
  let total = 0;
  for (const it of items) {
    const bobot = num(it['bobot']);
    const target = resolveTarget(it, overrides);
    const actual = num(it['realisasi']);
    const satuan = String(it['satuan'] ?? '').toLowerCase();
    if (bobot > 0 && target > 0 && actual > 0) {
      const capaian = computeCapaian(target, actual, satuan === 'hari kerja');
      total += (capaian / 100) * bobot;
    }
  }
  return r2(total);
}
