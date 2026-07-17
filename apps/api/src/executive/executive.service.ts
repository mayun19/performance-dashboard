import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExecutiveService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getSummary(periodId?: string) {
    const cacheKey = `executive:${periodId || 'active'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });

    if (!period) return null;

    let snap = await this.prisma.executiveSnapshot.findUnique({
      where: { periodId: period.id },
    });
    // Fallback: bila periode terpilih belum punya snapshot naratif, pakai snapshot periode aktif
    // sebagai baseline. Angka kinerja LIVE tetap mengikuti realisasi periode terpilih (via /kinerja/rekap).
    if (!snap) {
      const active = await this.prisma.period.findFirst({ where: { isActive: true } });
      if (active && active.id !== period.id) {
        snap = await this.prisma.executiveSnapshot.findUnique({ where: { periodId: active.id } });
      }
    }
    const result = { period, data: snap?.data ?? null };
    await this.cache.set(cacheKey, result);
    return result;
  }

  async refreshFromRealisasi(periodId: string): Promise<void> {
    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const UNIT_NAMES: Record<string, string> = {
      KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
      UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
    };

    const allRecords = await this.prisma.inputRealisasi.findMany({
      where: { periodId, status: 'approved' },
    });
    if (allRecords.length === 0) return;

    // Per-unit score computation
    const byUnit: Record<string, typeof allRecords> = {};
    for (const r of allRecords) (byUnit[r.unitCode] ??= []).push(r);
    const unitScores = Object.entries(byUnit).map(([code, records]) => {
      let totalNilai = 0;
      for (const r of records) {
        for (const it of Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>)) {
          const bobot = num(it['bobot']);
          const target = num(it['target2'] ?? it['target']);
          const actual = num(it['realisasi']);
          const satuan = String(it['satuan'] ?? '').toLowerCase();
          if (bobot > 0 && target > 0 && actual > 0) {
            const inv = satuan === 'hari kerja';
            const capaian = inv ? Math.min((target / actual) * 100, 110) : Math.min((actual / target) * 100, 110);
            totalNilai += (capaian / 100) * bobot;
          }
        }
      }
      return { code, name: UNIT_NAMES[code] ?? code, score: r2(totalNilai) };
    });
    const overall = unitScores.length > 0
      ? r2(unitScores.reduce((s, u) => s + u.score, 0) / unitScores.length)
      : 0;

    // Extract KP-specific KPI values
    const kpItems = allRecords
      .filter(r => r.unitCode === 'KP')
      .flatMap(r => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>));
    const findKp = (test: (s: string) => boolean) =>
      kpItems.find(it => test(String(it['indikator'] ?? '').toLowerCase()));
    const iqcItem    = findKp(s => s.includes('inspection quality') || s.includes('iqc'));
    const pctItem    = findKp(s => s.includes('persentase pelaksanaan'));
    const kepatuhanItem = findKp(s => s.includes('pengurang') && s.includes('kepatuhan'));
    const pembangkitItem = findKp(s => s.includes('kapasitas pembangkit'));
    const transmisiItem  = findKp(s => s.includes('kapasitas transmisi'));
    const giItem     = findKp(s => s.includes('gardu induk'));
    const capexItem  = findKp(s => s.includes('pengendalian') && (s.includes('anggaran investasi') || s.includes('penggunaan anggaran')));

    // Get existing snapshot as base (or active period fallback)
    const existing = await this.prisma.executiveSnapshot.findUnique({ where: { periodId } });
    let base: Record<string, unknown>;
    if (existing?.data) {
      base = existing.data as Record<string, unknown>;
    } else {
      const active = await this.prisma.period.findFirst({ where: { isActive: true } });
      const fallback = active && active.id !== periodId
        ? await this.prisma.executiveSnapshot.findUnique({ where: { periodId: active.id } })
        : null;
      base = (fallback?.data ?? {}) as Record<string, unknown>;
    }

    // Update unitTrend (shift + push new score)
    const existingTrend = (base.unitTrend ?? {}) as Record<string, number[]>;
    const unitTrend: Record<string, number[]> = {};
    for (const u of unitScores) {
      const prev = existingTrend[u.code] ?? Array(12).fill(0) as number[];
      unitTrend[u.code] = [...prev.slice(-11), u.score];
    }

    // Update unitRanking (preserve extra fields like projects, criticalKpi)
    const existingRanking = (base.unitRanking ?? []) as Record<string, unknown>[];
    const unitRanking = [...unitScores]
      .sort((a, b) => b.score - a.score)
      .map(u => ({
        ...(existingRanking.find(r => r['code'] === u.code) ?? {}),
        code: u.code, name: u.name, score: u.score,
        status: u.score >= 100 ? 'Baik' : u.score >= 90 ? 'Hati-hati' : 'Tertinggal',
      }));

    const prevHealthValue = num((base.healthScore as Record<string, unknown> | undefined)?.value ?? 100);
    const mergeField = (field: string, item: Record<string, unknown> | undefined) => ({
      ...((base[field] ?? {}) as object),
      ...(item ? { value: num(item['realisasi']) } : {}),
    });

    // Update kpis sparklines (match by id or label keyword)
    const existingKpis = (base.kpis ?? []) as Record<string, unknown>[];
    const kpisUpdated = existingKpis.map(kpi => {
      const label = String(kpi['label'] ?? '').toLowerCase();
      const id = String(kpi['id'] ?? '').toLowerCase();
      let item: Record<string, unknown> | undefined;
      if (id === 'iqc' || label.includes('iqc') || label.includes('inspection quality')) item = iqcItem;
      else if (label.includes('pelaksanaan konstruksi') || label.includes('persentase pelaksanaan')) item = pctItem;
      else if (id === 'mw' || label.includes('pembangkit')) item = pembangkitItem;
      else if (id === 'capex' || label.includes('capex') || label.includes('anggaran')) item = capexItem;
      if (!item) return kpi;
      const newVal = num(item['realisasi']);
      const prevSpark = (kpi['sparkline'] ?? Array(12).fill(0)) as number[];
      return { ...kpi, value: newVal, sparkline: [...prevSpark.slice(-11), newVal] };
    });

    // capacityAddition: shift + push monthly values
    const period = await this.prisma.period.findUnique({ where: { id: periodId } });
    const monthLabel = this.formatMonthLabel(period?.label ?? '');
    const existingCap = (base.capacityAddition ?? {}) as Record<string, unknown>;
    const capacityAddition = {
      ...existingCap,
      months:     [...((existingCap.months     ?? []) as string[]).slice(-11), monthLabel],
      pembangkit: [...((existingCap.pembangkit  ?? []) as number[]).slice(-11), pembangkitItem ? num(pembangkitItem['realisasi']) : 0],
      transmisi:  [...((existingCap.transmisi   ?? []) as number[]).slice(-11), transmisiItem  ? num(transmisiItem['realisasi'])  : 0],
      gi:         [...((existingCap.gi          ?? []) as number[]).slice(-11), giItem         ? num(giItem['realisasi'])         : 0],
    };

    // Prepend approval alert (keep last 5)
    const newAlert = {
      type: 'success',
      title: `Bundle Realisasi ${period?.label ?? ''} disetujui GM`,
      timestamp: new Date().toISOString(),
      route: 'operational',
    };
    const alerts = [newAlert, ...((base.alerts ?? []) as Record<string, unknown>[])].slice(0, 5);

    // Akurasi Self-Assessment UPMK: headline ringkas dari selisih skor self-assessment
    // (dikunci saat submit) vs skor hasil evaluasi berjenjang (values setelah dikoreksi RPC/KI).
    const scoreFromSource = (records: typeof allRecords, pick: (r: typeof records[0]) => unknown): number => {
      let total = 0;
      for (const r of records) {
        const src = (pick(r) ?? {}) as Record<string, Record<string, unknown>>;
        for (const it of Object.values(src)) {
          const bobot = num(it['bobot']);
          const target = num(it['target2'] ?? it['target']);
          const actual = num(it['realisasi']);
          const satuan = String(it['satuan'] ?? '').toLowerCase();
          if (bobot > 0 && target > 0 && actual > 0) {
            const inv = satuan === 'hari kerja';
            const capaian = inv ? Math.min((target / actual) * 100, 110) : Math.min((actual / target) * 100, 110);
            total += (capaian / 100) * bobot;
          }
        }
      }
      return r2(total);
    };
    const byUnitUpmk: Record<string, typeof allRecords> = {};
    for (const r of allRecords) {
      if (r.unitCode === 'KP' || r.selfAssessment == null) continue;
      (byUnitUpmk[r.unitCode] ??= []).push(r);
    }
    const unitGaps = Object.values(byUnitUpmk).map((records) => {
      const selfScore = scoreFromSource(records, (r) => r.selfAssessment);
      const evaluatedScore = scoreFromSource(records, (r) => r.values);
      return Math.abs(r2(evaluatedScore - selfScore));
    });
    const avgGap = unitGaps.length ? r2(unitGaps.reduce((s, g) => s + g, 0) / unitGaps.length) : 0;
    const selfAssessmentAccuracy = {
      avgGap, unitsWithData: unitGaps.length,
      status: unitGaps.length === 0 ? 'no-data' : avgGap <= 2 ? 'akurat' : avgGap <= 5 ? 'perlu-perhatian' : 'signifikan',
    };

    const newData: Record<string, unknown> = {
      ...base,
      healthScore: {
        ...((base.healthScore ?? {}) as object),
        value: overall, previous: prevHealthValue, delta: r2(overall - prevHealthValue),
        status: overall >= 100 ? 'Baik' : overall >= 90 ? 'Hati-hati' : 'Tertinggal',
      },
      unitRanking, unitTrend,
      efficiency: mergeField('efficiency', pctItem),
      csat:       mergeField('csat', iqcItem),
      safety:     mergeField('safety', kepatuhanItem),
      capacityAddition, kpis: kpisUpdated, alerts, selfAssessmentAccuracy,
    };

    await this.prisma.executiveSnapshot.upsert({
      where:  { periodId },
      update: { data: newData as unknown as Prisma.InputJsonValue },
      create: { periodId, data: newData as unknown as Prisma.InputJsonValue },
    });
    await this.cache.del(`executive:${periodId}`);
    await this.cache.del('executive:active');
  }

  private formatMonthLabel(label: string): string {
    const MAP: Record<string, string> = {
      Januari: 'Jan', Februari: 'Feb', Maret: 'Mar', April: 'Apr',
      Mei: 'Mei', Juni: 'Jun', Juli: 'Jul', Agustus: 'Ags',
      September: 'Sep', Oktober: 'Okt', November: 'Nov', Desember: 'Des',
    };
    const parts = label.trim().split(/\s+/);
    return `${MAP[parts[0]] ?? parts[0]?.slice(0, 3)} ${(parts[1] ?? '').slice(2)}`;
  }
}
