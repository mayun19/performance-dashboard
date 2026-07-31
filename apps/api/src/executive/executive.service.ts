import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { num, r2, scoreItems, dedupFanOutRealisasi, resolveTarget, resolveCapaian, computeNilai, breakdownComposite, specimenOrder, resolvePolarity, type TargetOverrideMap } from '../common/capaian';

@Injectable()
export class ExecutiveService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getSummary(periodId?: string, phase?: 'sementara' | 'final') {
    const cacheKey = `executive:${periodId || 'active'}:${phase ?? 'auto'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });

    if (!period) return null;

    // Living-target: bila phase eksplisit diminta (toggle dashboard), ambil phase itu saja;
    // else default ke 'final' (KM Final, sudah direstate) bila ada, jatuh ke 'sementara'
    // (provisional, masih hidup) selama masa tunggu KM Final.
    const pick = async (pid: string) => {
      if (phase) return this.prisma.executiveSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase } } });
      return (await this.prisma.executiveSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase: 'final' } } }))
        ?? this.prisma.executiveSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase: 'sementara' } } });
    };
    // Tidak ada fallback ke snapshot periode lain — periode tanpa snapshot sendiri berarti
    // benar-benar belum ada data kinerja utk periode itu (FE tampilkan empty state), bukan
    // menampilkan angka periode lain seolah-olah itu data periode terpilih.
    const snap = await pick(period.id);
    const result = { period, data: snap?.data ?? null, phase: snap?.phase ?? (phase ?? 'sementara') };
    await this.cache.set(cacheKey, result);
    return result;
  }

  // phase='sementara' (default): refresh provisional, dipicu tiap bundle GM disetujui selama
  // masa tunggu KM Final — target-of-record diambil dari InputRealisasi.targetOfRecord (living
  // target saat submit terakhir). phase='final': dipanggil SEKALI oleh RestatementService saat
  // KM Final tiba, dengan targetOverrides = target KM Final beku (menimpa target-of-record lama).
  async refreshFromRealisasi(periodId: string, phase: 'sementara' | 'final' = 'sementara', targetOverrides?: TargetOverrideMap): Promise<void> {
    const UNIT_NAMES: Record<string, string> = {
      KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
      UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
    };

    const allRecords = await this.prisma.inputRealisasi.findMany({
      where: { periodId, status: 'approved' },
    });
    if (allRecords.length === 0) return;

    // Target-of-record efektif: override eksplisit (restatement KM Final) menang; selain itu
    // gabungkan targetOfRecord tiap record (living target saat submit terakhir).
    const targetOfRecord: TargetOverrideMap = { ...targetOverrides };
    if (!targetOverrides) {
      for (const r of allRecords) {
        Object.assign(targetOfRecord, (r.targetOfRecord ?? {}) as TargetOverrideMap);
      }
    }

    // Dedup KPI lintas-bidang (fan-out) SEBELUM discoring — lihat catatan dedupFanOutRealisasi
    // di common/capaian.ts. Tanpa ini, KPI yang di-assign ke >1 bidang dalam unit yang sama
    // (mis. "Pengendalian Anggaran" = OMP+KKU) dihitung berkali-kali di overall/unitScores.
    const allMasterIds = Array.from(new Set(
      allRecords.flatMap((r) => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>))
        .map((it) => it['masterKpiId']).filter((v): v is string => typeof v === 'string'),
    ));
    const allAssignments = allMasterIds.length
      ? await this.prisma.kpiAssignment.findMany({ where: { kpiMasterId: { in: allMasterIds } } })
      : [];
    const persenLookup = new Map(allAssignments.map((a) => [`${a.kpiMasterId}|${a.unitCode}|${a.bidang}`, a.persenAgregasi]));

    // Per-unit score computation (KI-adjusted track — `values` adalah salinan kerja hasil
    // koreksi berjenjang, yang rolls up ke agregat parent).
    const byUnit: Record<string, typeof allRecords> = {};
    for (const r of allRecords) (byUnit[r.unitCode] ??= []).push(r);
    const unitScores = Object.entries(byUnit).map(([code, records]) => {
      const rawItems = records.flatMap((r) => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>).map((it) => ({ it, bidang: r.bidang })));
      const items = dedupFanOutRealisasi(rawItems, persenLookup, code).map((f) => f.it);
      return { code, name: UNIT_NAMES[code] ?? code, score: scoreItems(items, targetOfRecord) };
    });
    // UPMK track (self-reported) — dihitung terpisah, tak pernah menimpa track KI.
    const upmkUnitScores = Object.entries(byUnit).map(([code, records]) => {
      const items = records.filter((r) => r.selfAssessment != null)
        .flatMap((r) => Object.values((r.selfAssessment ?? {}) as Record<string, Record<string, unknown>>));
      return { code, score: scoreItems(items, targetOfRecord) };
    });
    const overall = unitScores.length > 0
      ? r2(unitScores.reduce((s, u) => s + u.score, 0) / unitScores.length)
      : 0;

    // Extract KP-specific KPI values (deduped — dipakai widget efficiency/csat/safety dsb.)
    const kpRawItems = allRecords
      .filter(r => r.unitCode === 'KP')
      .flatMap(r => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>).map((it) => ({ it, bidang: r.bidang })));
    const kpItems = dedupFanOutRealisasi(kpRawItems, persenLookup, 'KP').map((f) => f.it);
    const findKp = (test: (s: string) => boolean) =>
      kpItems.find(it => test(String(it['indikator'] ?? '').toLowerCase()));
    const iqcItem    = findKp(s => s.includes('inspection quality') || s.includes('iqc'));
    const pctItem    = findKp(s => s.includes('persentase pelaksanaan'));
    const kepatuhanItem = findKp(s => s.includes('pengurang') && s.includes('kepatuhan'));
    const pembangkitItem = findKp(s => s.includes('kapasitas pembangkit'));
    const transmisiItem  = findKp(s => s.includes('kapasitas transmisi'));
    const giItem     = findKp(s => s.includes('gardu induk'));
    const capexItem  = findKp(s => s.includes('pengendalian') && (s.includes('anggaran investasi') || s.includes('penggunaan anggaran')));

    // Get existing snapshot (SAME phase) as base, or active period fallback
    const existing = await this.prisma.executiveSnapshot.findUnique({ where: { periodId_phase: { periodId, phase } } });
    let base: Record<string, unknown>;
    if (existing?.data) {
      base = existing.data as Record<string, unknown>;
    } else {
      const active = await this.prisma.period.findFirst({ where: { isActive: true } });
      const fallback = active && active.id !== periodId
        ? await this.prisma.executiveSnapshot.findUnique({ where: { periodId_phase: { periodId: active.id, phase } } })
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

    // Bangun ulang daftar kartu KPI Executive Summary SEPENUHNYA dari data live tiap refresh
    // (sebelumnya hanya "menempel" nilai ke beberapa entri prototype tetap — tak pernah
    // mencerminkan seluruh KPI nyata, & tak bisa pulih sendiri bila basisnya tertimpa data
    // seed). Sekarang mirror operational.service.ts: 1 kartu per KPI (termasuk item pengurang),
    // diurutkan sesuai dokumen spesimen resmi (specimenOrder). id berbasis masterKpiId/nama
    // (stabil lintas-refresh) — sparkline existing tetap dilanjutkan bila id cocok.
    const existingKpisById = new Map(
      ((base.kpis ?? []) as Record<string, unknown>[]).map((k) => [String(k['id'] ?? ''), k]),
    );
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const kpisBuilt = [...kpItems]
      .sort((a, b) => specimenOrder(String(a['indikator'] ?? '')) - specimenOrder(String(b['indikator'] ?? '')))
      .map((it, idx) => {
        const name = String(it['indikator'] ?? '');
        const id = typeof it['masterKpiId'] === 'string' ? (it['masterKpiId'] as string) : (slug(name) || `k${idx}`);
        const existing = existingKpisById.get(id);
        const bobot = num(it['bobot']);
        const satuan = String(it['satuan'] ?? '');
        const isInverse = resolvePolarity(satuan, it['polaritas']);
        const subs = Array.isArray(it['subIndicators']) ? (it['subIndicators'] as Record<string, unknown>[]) : [];
        let target = 0, actual = 0, achievement = 0, nilai = 0;
        if (subs.length > 0) {
          nilai = r2(breakdownComposite(it).reduce((s, si) => s + si.nilai, 0));
          achievement = bobot !== 0 ? r2((nilai / bobot) * 100) : 0;
        } else if (bobot < 0) {
          actual = num(it['realisasi']);
          nilai = actual > 0 ? r2(-Math.min(actual, Math.abs(bobot))) : 0;
          achievement = bobot !== 0 ? r2((nilai / bobot) * 100) : 0;
        } else {
          target = resolveTarget(it, targetOfRecord);
          actual = num(it['realisasi']);
          achievement = resolveCapaian(target, actual, isInverse, it['capaianResmi']);
          nilai = computeNilai(bobot, achievement);
        }
        const prevSpark = (existing?.['sparkline'] ?? Array(12).fill(0)) as number[];
        return {
          id, label: name, name, bidang: it['bidang'] ?? '', category: bobot >= 7 ? 'KPI' : 'PI',
          satuan, unit: satuan, target: r2(target), actual: r2(actual), value: r2(actual),
          achievement: r2(achievement), status: achievement >= 100 ? 'Baik' : achievement >= 90 ? 'Hati-hati' : 'Tertinggal',
          polarity: isInverse ? 'lower-is-better' : 'higher-is-better', polaritas: isInverse ? 'LB' : 'HB',
          bobot, nilai, sparkline: [...prevSpark.slice(-11), r2(actual)],
          commentary: existing?.['commentary'] ?? '', rootCause: existing?.['rootCause'] ?? '', actionPlan: existing?.['actionPlan'] ?? '',
        };
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
    // Dua-duanya dihitung dgn target-of-record yg SAMA (targetOfRecord) — divergensi murni
    // mencerminkan koreksi REN PIC, bukan perbedaan target.
    const upmkByUnit = new Map(upmkUnitScores.map((u) => [u.code, u.score]));
    const unitGaps = unitScores
      .filter((u) => u.code !== 'KP' && upmkByUnit.has(u.code))
      .map((u) => Math.abs(r2(u.score - (upmkByUnit.get(u.code) ?? 0))));
    const avgGap = unitGaps.length ? r2(unitGaps.reduce((s, g) => s + g, 0) / unitGaps.length) : 0;
    const selfAssessmentAccuracy = {
      avgGap, unitsWithData: unitGaps.length,
      status: unitGaps.length === 0 ? 'no-data' : avgGap <= 2 ? 'akurat' : avgGap <= 5 ? 'perlu-perhatian' : 'signifikan',
    };

    // Dua track eksplisit (§5 desain): UPMK Version vs KI Adjusted Version, sisi-bersisi.
    const overallUpmk = upmkUnitScores.length > 0
      ? r2(upmkUnitScores.reduce((s, u) => s + u.score, 0) / upmkUnitScores.length)
      : 0;

    const newData: Record<string, unknown> = {
      ...base,
      healthScore: {
        ...((base.healthScore ?? {}) as object),
        value: overall, previous: prevHealthValue, delta: r2(overall - prevHealthValue),
        status: overall >= 100 ? 'Baik' : overall >= 90 ? 'Hati-hati' : 'Tertinggal',
      },
      unitRanking, unitTrend,
      // Dua track: unitRanking/healthScore = KI Adjusted (authoritative utk rollup);
      // upmkTrack = UPMK self-reported, disandingkan di dashboard.
      upmkTrack: { overall: overallUpmk, unitScores: upmkUnitScores },
      efficiency: mergeField('efficiency', pctItem),
      csat:       mergeField('csat', iqcItem),
      safety:     mergeField('safety', kepatuhanItem),
      capacityAddition, kpis: kpisBuilt, alerts, selfAssessmentAccuracy,
    };

    await this.prisma.executiveSnapshot.upsert({
      where:  { periodId_phase: { periodId, phase } },
      update: { data: newData as unknown as Prisma.InputJsonValue, targetOfRecord: targetOfRecord as unknown as Prisma.InputJsonValue },
      create: { periodId, phase, data: newData as unknown as Prisma.InputJsonValue, targetOfRecord: targetOfRecord as unknown as Prisma.InputJsonValue },
    });
    // Bersihkan semua varian phase cache (auto/sementara/final) untuk periode ini & 'active'.
    for (const base of [`executive:${periodId}`, 'executive:active']) {
      for (const p of ['auto', 'sementara', 'final']) await this.cache.del(`${base}:${p}`);
    }
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
