import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { num, r2, resolveTarget, resolveCapaian, computeNilai, dedupFanOutRealisasi, specimenOrder, resolvePolarity, type PersenLookup, type TargetOverrideMap } from '../common/capaian';

const UNIT_NAMES: Record<string, string> = {
  KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
  UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
};

const round2 = r2;

interface KpiRekap {
  indikator: string;
  satuan: string;
  bobot: number;
  target: number;
  realisasi: number;
  capaian: number; // %
  nilai: number;   // capaian/100 * bobot
}

interface UnitRekap {
  code: string;
  name: string;
  score: number;       // total nilai (≈ skor 0..>100 bila Σbobot=100)
  totalBobot: number;
  status: string;      // Baik | Hati-hati | Tertinggal
  submitter: string;
  reviewer: string | null;
  kpis: KpiRekap[];
}

@Injectable()
export class KinerjaService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  // Periode terbaru (by yearMonth) yang memiliki realisasi DISETUJUI.
  // Dipakai dashboard sebagai default agar realisasi terbaru langsung terlihat.
  async getLatestPeriodWithData() {
    const approved = await this.prisma.inputRealisasi.findMany({
      where: { status: 'approved' },
      select: { periodId: true },
    });
    if (approved.length === 0) return null;
    const ids = [...new Set(approved.map((a) => a.periodId))];
    const periods = await this.prisma.period.findMany({
      where: { id: { in: ids } },
      orderBy: { yearMonth: 'desc' },
    });
    return periods[0] ?? null;
  }

  // Rekap kinerja dari REALISASI yang sudah DISETUJUI final (status approved).
  // mode: 'Bulan' = periode terpilih saja; 'Semester' = rata-rata Jan–Jun / Jul–Des;
  //       'Tahun' = rata-rata seluruh bulan tahun berjalan. Agregasi = rata-rata realisasi
  //       bulanan per indikator, lalu dijumlahkan menjadi skor unit.
  async getRekap(periodId?: string, mode: 'Bulan' | 'Semester' | 'Tahun' = 'Bulan') {
    const cacheKey = `kinerja:${periodId || 'active'}:${mode}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });

    if (!period) {
      return { period: null, mode, hasData: false, overall: null, units: [] as UnitRekap[] };
    }

    // Tentukan kumpulan periode dalam cakupan mode.
    const year = period.yearMonth.slice(0, 4);
    const month = parseInt(period.yearMonth.slice(5, 7), 10);
    let scopePeriodIds: string[] = [period.id];
    if (mode === 'Tahun' || mode === 'Semester') {
      const yearPeriods = await this.prisma.period.findMany({
        where: { yearMonth: { startsWith: `${year}-` } },
        select: { id: true, yearMonth: true },
      });
      const inScope = yearPeriods.filter((p) => {
        if (mode === 'Tahun') return true;
        const m = parseInt(p.yearMonth.slice(5, 7), 10);
        return month <= 6 ? m <= 6 : m >= 7; // semester sesuai bulan terpilih
      });
      scopePeriodIds = inScope.map((p) => p.id);
    }

    const realisasi = await this.prisma.inputRealisasi.findMany({
      where: { periodId: { in: scopePeriodIds }, status: 'approved' },
      orderBy: { unitCode: 'asc' },
    });

    // Target-of-record efektif (living Sementara / KM Final beku) — gabungkan targetOfRecord
    // seluruh record dalam cakupan, sama seperti executive/operational.service.ts.
    const targetOfRecord: TargetOverrideMap = {};
    for (const r of realisasi) Object.assign(targetOfRecord, (r.targetOfRecord ?? {}) as TargetOverrideMap);

    // persenAgregasi lookup (dipakai dedupFanOutRealisasi utk KPI lintas-bidang) — dihitung
    // sekali dari seluruh masterKpiId yang muncul di cakupan periode ini.
    const allMasterIds = Array.from(new Set(
      realisasi.flatMap((r) => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>))
        .map((it) => it['masterKpiId']).filter((v): v is string => typeof v === 'string'),
    ));
    const allAssignments = allMasterIds.length
      ? await this.prisma.kpiAssignment.findMany({ where: { kpiMasterId: { in: allMasterIds } } })
      : [];
    const persenLookup: PersenLookup = new Map(allAssignments.map((a) => [`${a.kpiMasterId}|${a.unitCode}|${a.bidang}`, a.persenAgregasi]));

    // Kelompokkan per unit (gabung semua bidang & semua bulan dalam cakupan).
    const byUnit: Record<string, typeof realisasi> = {};
    for (const r of realisasi) (byUnit[r.unitCode] ||= []).push(r);

    const units: UnitRekap[] = Object.entries(byUnit).map(([code, records]) => {
      // Dedup fan-out KPI lintas-bidang PER BULAN (persenAgregasi rollup hanya valid dalam satu
      // periode) — lihat common/capaian.ts dedupFanOutRealisasi. Setelah dedup per-bulan, realisasi
      // (item biasa) / realisasi tiap sub (komposit) dikumpulkan lintas-bulan lalu dirata-rata.
      const byPeriod = new Map<string, typeof records>();
      for (const r of records) {
        const arr = byPeriod.get(r.periodId) ?? [];
        arr.push(r);
        byPeriod.set(r.periodId, arr);
      }
      const kpiMap = new Map<string, { it: Record<string, unknown>; reals: number[]; subReals: number[][] }>();
      let lastSubmitter = '';
      let lastReviewer: string | null = null;
      for (const [, periodRecords] of byPeriod) {
        const rawItems = periodRecords.flatMap((r) => {
          lastSubmitter = r.submitter;
          lastReviewer = r.reviewer ?? lastReviewer;
          return Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>).map((it) => ({ it, bidang: r.bidang }));
        });
        const deduped = dedupFanOutRealisasi(rawItems, persenLookup, code);
        for (const { it } of deduped) {
          const key = String(it['masterKpiId'] ?? it['indikator'] ?? '');
          const subs = Array.isArray(it['subIndicators']) ? (it['subIndicators'] as Record<string, unknown>[]) : [];
          const e = kpiMap.get(key) ?? { it, reals: [], subReals: subs.map(() => []) };
          if (subs.length > 0) {
            subs.forEach((si, j) => e.subReals[j]?.push(num(si['realisasi'])));
          } else {
            e.reals.push(num(it['realisasi']));
          }
          kpiMap.set(key, e);
        }
      }

      let totalBobot = 0;
      let totalNilai = 0;
      const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
      const kpis: KpiRekap[] = [...kpiMap.values()]
        .sort((a, b) => specimenOrder(String(a.it['indikator'] ?? '')) - specimenOrder(String(b.it['indikator'] ?? '')))
        .map((e) => {
        const subs = Array.isArray(e.it['subIndicators']) ? (e.it['subIndicators'] as Record<string, unknown>[]) : [];
        const indikator = String(e.it['indikator'] ?? '—');
        const bobotInduk = num(e.it['bobot']);
        totalBobot += bobotInduk;
        if (subs.length > 0) {
          // Komposit: rata-rata realisasi tiap sub lintas-bulan, lalu skor per-sub (sama formula
          // dgn common/capaian.ts breakdownComposite — termasuk sub pengurang bobot negatif).
          let nilaiSum = 0;
          subs.forEach((si, j) => {
            const subBobot = num(si['bobot']);
            const avgReal = avg(e.subReals[j] ?? []);
            if (subBobot < 0) {
              nilaiSum += avgReal > 0 ? -Math.min(avgReal, Math.abs(subBobot)) : 0;
              return;
            }
            const target = num(si['target2'] ?? si['target']);
            const satuan = String(si['satuan'] ?? '').toLowerCase();
            const capaian = subBobot > 0 && target > 0 && avgReal > 0 ? resolveCapaian(target, avgReal, resolvePolarity(satuan, si['polaritas']), si['capaianResmi']) : 0;
            nilaiSum += computeNilai(subBobot, capaian);
          });
          const nilai = r2(nilaiSum);
          totalNilai += nilai;
          const achievement = bobotInduk !== 0 ? r2((nilai / bobotInduk) * 100) : 0;
          return { indikator, satuan: '', bobot: round2(bobotInduk), target: 0, realisasi: 0, capaian: achievement, nilai };
        }
        const avgReal = avg(e.reals);
        if (bobotInduk < 0) {
          const nilai = avgReal > 0 ? r2(-Math.min(avgReal, Math.abs(bobotInduk))) : 0;
          totalNilai += nilai;
          return { indikator, satuan: String(e.it['satuan'] ?? ''), bobot: round2(bobotInduk), target: 0, realisasi: round2(avgReal), capaian: 0, nilai };
        }
        const target = resolveTarget(e.it, targetOfRecord);
        const satuan = String(e.it['satuan'] ?? '').toLowerCase();
        const capaian = bobotInduk > 0 && target > 0 && avgReal > 0 ? resolveCapaian(target, avgReal, resolvePolarity(satuan, e.it['polaritas']), e.it['capaianResmi']) : 0;
        const nilai = computeNilai(bobotInduk, capaian);
        totalNilai += nilai;
        return { indikator, satuan: String(e.it['satuan'] ?? ''), bobot: round2(bobotInduk), target: round2(target), realisasi: round2(avgReal), capaian: round2(capaian), nilai: round2(nilai) };
      });
      const score = round2(totalNilai);
      const status = score >= 100 ? 'Baik' : score >= 90 ? 'Hati-hati' : 'Tertinggal';
      return {
        code,
        name: UNIT_NAMES[code] ?? code,
        score,
        totalBobot: round2(totalBobot),
        status,
        submitter: lastSubmitter,
        reviewer: lastReviewer,
        kpis,
      };
    });

    const overall = units.length
      ? round2(units.reduce((s, u) => s + u.score, 0) / units.length)
      : null;

    const result = {
      period,
      mode,
      monthsIncluded: scopePeriodIds.length,
      hasData: units.length > 0,
      overall,
      units: units.sort((a, b) => b.score - a.score),
    };
    await this.cache.set(cacheKey, result);
    return result;
  }
}
