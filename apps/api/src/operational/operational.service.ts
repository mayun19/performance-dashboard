import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { num, r2, resolveTarget, computeCapaian, computeNilai, scoreItems, breakdownComposite, type TargetOverrideMap } from '../common/capaian';

@Injectable()
export class OperationalService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getData(periodId?: string, phase?: 'sementara' | 'final') {
    const cacheKey = `operational:${periodId || 'active'}:${phase ?? 'auto'}`;
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
      if (phase) return this.prisma.operationalSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase } } });
      return (await this.prisma.operationalSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase: 'final' } } }))
        ?? this.prisma.operationalSnapshot.findUnique({ where: { periodId_phase: { periodId: pid, phase: 'sementara' } } });
    };
    let snap = await pick(period.id);
    // Fallback baseline ke snapshot periode aktif bila periode terpilih belum punya snapshot.
    if (!snap) {
      const active = await this.prisma.period.findFirst({ where: { isActive: true } });
      if (active && active.id !== period.id) snap = await pick(active.id);
    }
    const result = { period, data: snap?.data ?? null, phase: snap?.phase ?? (phase ?? 'sementara') };
    await this.cache.set(cacheKey, result);
    return result;
  }

  // Lihat catatan phase/targetOverrides yang sama di ExecutiveService.refreshFromRealisasi.
  async refreshFromRealisasi(periodId: string, phase: 'sementara' | 'final' = 'sementara', targetOverrides?: TargetOverrideMap): Promise<void> {
    const UNIT_NAMES: Record<string, string> = {
      KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
      UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
    };

    // Semua record approved periode ini — dipakai bersama oleh bagian KP (kpis/kepatuhan)
    // dan bagian lintas-unit (buComparison/selfAssessmentGap) agar keduanya independen:
    // absennya submission KP tidak boleh menghalangi perhitungan gap self-assessment UPMK.
    const allRecords = await this.prisma.inputRealisasi.findMany({
      where: { periodId, status: 'approved' },
    });
    if (allRecords.length === 0) return;
    const kpRecords = allRecords.filter(r => r.unitCode === 'KP');

    // Target-of-record efektif: override eksplisit (restatement KM Final) menang; selain
    // itu gabungkan targetOfRecord tiap record (living target saat submit terakhir).
    const targetOfRecord: TargetOverrideMap = { ...targetOverrides };
    if (!targetOverrides) {
      for (const r of allRecords) {
        Object.assign(targetOfRecord, (r.targetOfRecord ?? {}) as TargetOverrideMap);
      }
    }

    const allItems = kpRecords.flatMap(r =>
      Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>)
        .map(it => ({ it, bidang: r.bidang }))
    );
    const regularItems = allItems.filter(({ it }) => num(it['bobot']) > 0);
    const pengurangItems = allItems.filter(({ it }) => num(it['bobot']) < 0);

    // Get existing snapshot (SAME phase) as base
    const existing = await this.prisma.operationalSnapshot.findUnique({ where: { periodId_phase: { periodId, phase } } });
    let base: Record<string, unknown>;
    if (existing?.data) {
      base = existing.data as Record<string, unknown>;
    } else {
      const active = await this.prisma.period.findFirst({ where: { isActive: true } });
      const fallback = active && active.id !== periodId
        ? await this.prisma.operationalSnapshot.findUnique({ where: { periodId_phase: { periodId: active.id, phase } } })
        : null;
      base = (fallback?.data ?? {}) as Record<string, unknown>;
    }
    const existingKpis = (base.kpis ?? []) as Record<string, unknown>[];
    const hasKpData = kpRecords.length > 0;

    // Build kpis from positive-bobot items (hanya bila ADA submission KP periode ini —
    // jika tidak, pertahankan data KP terakhir dari base agar tidak tertimpa kosong).
    let kpiNo = 1;
    const kpisBuilt = regularItems.map(({ it, bidang }) => {
      const name = String(it['indikator'] ?? '');
      const nameLow = name.toLowerCase();
      const existingKpi = existingKpis.find(k => {
        const kname = String(k['name'] ?? '').toLowerCase();
        return kname.length > 8 && nameLow.slice(0, 20).includes(kname.slice(0, 12));
      });
      const bobot = num(it['bobot']);
      const satuan = String(it['satuan'] ?? '');
      const isInverse = satuan.toLowerCase() === 'hari kerja';

      // KPI komposit (opt-in, generik — lihat kpi-master.service.ts SubIndicatorInput):
      // nilai = Σ nilai sub (common/capaian.ts breakdownComposite); target/actual induk tak
      // berarti tunggal (per-sub) — achievement induk ditampilkan sbg rata-rata tertimbang
      // (nilai/bobot) utk konsistensi tampilan status/warna. subBreakdown dikirim ke frontend
      // untuk expand baris per sub-indikator.
      const subs = Array.isArray(it['subIndicators']) ? (it['subIndicators'] as Record<string, unknown>[]) : [];
      const isComposite = subs.length > 0;
      let target = 0, actual = 0, achievement = 0, nilai = 0;
      let subBreakdown: ReturnType<typeof breakdownComposite> | undefined;
      if (isComposite) {
        subBreakdown = breakdownComposite(it);
        nilai = r2(subBreakdown.reduce((s, si) => s + si.nilai, 0));
        achievement = bobot > 0 ? r2((nilai / bobot) * 100) : 0;
      } else {
        target = resolveTarget(it, targetOfRecord);
        actual = num(it['realisasi']);
        achievement = computeCapaian(target, actual, isInverse);
        nilai = computeNilai(bobot, achievement);
      }
      const prevSpark = (existingKpi?.['sparkline'] ?? Array(12).fill(0)) as number[];
      const no = kpiNo++;
      return {
        id:          existingKpi?.['id'] ?? `k${no}`,
        no,
        name,
        category:    existingKpi?.['category'] ?? (bobot >= 7 ? 'KPI' : 'PI'),
        unit:        satuan,
        target:      r2(target),
        actual:      r2(actual),
        achievement: r2(achievement),
        status:      achievement >= 100 ? 'success' : achievement >= 90 ? 'warning' : 'danger',
        isInverse,
        polaritas:   isInverse ? 'LB' : 'HB',
        bobot,
        nilai,
        bu:          bidang,
        owner:       existingKpi?.['owner'] ?? bidang,
        basis:       existingKpi?.['basis'] ?? null,
        sparkline:   [...prevSpark.slice(-11), r2(actual)],
        commentary:  existingKpi?.['commentary'] ?? '',
        rootCause:   existingKpi?.['rootCause'] ?? '',
        actionPlan:  existingKpi?.['actionPlan'] ?? '',
        ...(isComposite ? { subBreakdown } : {}),
      };
    });

    // Build kepatuhan from negative-bobot items
    const existingKepatuhan = (base.kepatuhan ?? []) as Record<string, unknown>[];
    const SUB = 'abcdefghij';
    const kepatuhanBuilt = pengurangItems.map(({ it }, idx) => {
      const fullName = String(it['indikator'] ?? '');
      const name = fullName.replace(/^Pengurang\s*[-–:]\s*/i, '');
      const applied = num(it['realisasi']);
      return {
        no:         existingKepatuhan[idx]?.['no'] ?? `12${SUB[idx] ?? idx}`,
        name,
        maxPenalty: num(it['bobot']),
        applied:    r2(applied),
        target:     existingKepatuhan[idx]?.['target'] ?? String(it['target'] ?? '—'),
        status:     applied === 0 ? 'success' : 'danger',
      };
    });

    const kpis = (hasKpData ? kpisBuilt : existingKpis) as Record<string, unknown>[];
    const kepatuhan = (hasKpData ? kepatuhanBuilt : existingKepatuhan) as Record<string, unknown>[];

    // Summary totals
    const kpiGroup = kpis.filter(k => k.category === 'KPI');
    const piGroup  = kpis.filter(k => k.category === 'PI');
    const kpiBobot = r2(kpiGroup.reduce((s, k) => s + Number(k.bobot ?? 0), 0));
    const kpiNilai = r2(kpiGroup.reduce((s, k) => s + Number(k.nilai ?? 0), 0));
    const piBobot  = r2(piGroup.reduce((s, k) => s + Number(k.bobot ?? 0), 0));
    const piNilai  = r2(piGroup.reduce((s, k) => s + Number(k.nilai ?? 0), 0));
    const kepatuhanPenalty = r2(kepatuhan.reduce((s, k) => s + Number(k.applied ?? 0), 0));
    const totalNilai = r2(kpiNilai + piNilai + kepatuhanPenalty);

    // buComparison from all approved units (allRecords sudah diambil di awal fungsi).
    // Track KI Adjusted (`values`) — authoritative utk rollup/perbandingan antar-unit.
    const byUnit: Record<string, typeof allRecords> = {};
    for (const r of allRecords) (byUnit[r.unitCode] ??= []).push(r);
    const unitScoreMap: Record<string, number> = {};
    for (const [code, records] of Object.entries(byUnit)) {
      const items = records.flatMap((r) => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>));
      unitScoreMap[code] = scoreItems(items, targetOfRecord);
    }
    const existingBuComp = (base.buComparison ?? {}) as Record<string, unknown>;
    const buComparison = {
      ...existingBuComp,
      rows: Object.entries(unitScoreMap)
        .map(([code, score]) => ({ bu: UNIT_NAMES[code] ?? code, code, score }))
        .sort((a, b) => b.score - a.score),
    };

    // Self-Assessment (UPMK) vs Evaluasi (hasil koreksi berjenjang s.d. SM RPC). Dua track
    // eksplisit (§5 desain): `selfAssessment` = UPMK Version (dikunci saat submit); `values`
    // = KI Adjusted Version (salinan kerja hasil koreksi berjenjang). Dihitung dgn
    // target-of-record yg SAMA agar divergensi murni mencerminkan koreksi REN PIC.
    const byUnitUpmk: Record<string, typeof allRecords> = {};
    for (const r of allRecords) {
      if (r.unitCode === 'KP') continue;
      if (r.selfAssessment == null) continue; // record lama sebelum fitur ini — tidak punya snapshot
      (byUnitUpmk[r.unitCode] ??= []).push(r);
    }
    const selfAssessmentGap = Object.entries(byUnitUpmk)
      .map(([code, records]) => {
        const selfItems = records.flatMap((r) => Object.values((r.selfAssessment ?? {}) as Record<string, Record<string, unknown>>));
        const evalItems = records.flatMap((r) => Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>));
        const selfScore = scoreItems(selfItems, targetOfRecord);
        const evaluatedScore = scoreItems(evalItems, targetOfRecord);
        const gap = r2(evaluatedScore - selfScore);
        return {
          code, unit: UNIT_NAMES[code] ?? code,
          selfScore, evaluatedScore, gap,
          gapPct: selfScore !== 0 ? r2((gap / selfScore) * 100) : 0,
          status: Math.abs(gap) <= 2 ? 'akurat' : Math.abs(gap) <= 5 ? 'perlu-perhatian' : 'signifikan',
        };
      })
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    const summary = hasKpData ? {
      kpiBobot, kpiNilai, piBobot, piNilai,
      totalBobot: r2(kpiBobot + piBobot),
      totalNilai, kepatuhanPenalty,
      status: totalNilai >= 100 ? 'Baik' : totalNilai >= 90 ? 'Hati-hati' : 'Perhatian',
    } : (base.summary ?? {});

    const newData: Record<string, unknown> = {
      ...base,
      kpis,
      kepatuhan,
      summary,
      buComparison,
      selfAssessmentGap,
    };

    await this.prisma.operationalSnapshot.upsert({
      where:  { periodId_phase: { periodId, phase } },
      update: { data: newData as unknown as Prisma.InputJsonValue, targetOfRecord: targetOfRecord as unknown as Prisma.InputJsonValue },
      create: { periodId, phase, data: newData as unknown as Prisma.InputJsonValue, targetOfRecord: targetOfRecord as unknown as Prisma.InputJsonValue },
    });
    // Bersihkan semua varian phase cache (auto/sementara/final) untuk periode ini & 'active'.
    for (const base of [`operational:${periodId}`, 'operational:active']) {
      for (const p of ['auto', 'sementara', 'final']) await this.cache.del(`${base}:${p}`);
    }
  }
}
