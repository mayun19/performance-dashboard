import { Injectable, Inject, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Role, User } from '@prisma/client';
import { CHECKER_ROLES, APPROVER_ROLES, RPC_BIDANG, stepRecipientWhere } from '../common/workflow-steps';

// Slot alur reviewer per-assignment (Kombinasi A+B): peran + opsi override orang.
export type ReviewerSlot = {
  role: 'ASMAN' | 'MANAJER' | 'SRMANAJER' | 'GM';
  userId?: string; // ada → override orang spesifik (A); kosong → resolve peran (B)
};
export type ReviewerSlots = { checkers: ReviewerSlot[]; approver: ReviewerSlot | null };

export interface AssignmentInput {
  unitCode: string;
  bidang: string;
  holder?: string;
  target?: string;
  target2?: string;
  persenAgregasi?: number; // bobot rollup ke parent (0-100), diinput RPC Perencanaan
  reviewerSlots?: unknown; // default alur reviewer per-assignment (A+B); divalidasi di service
}

// Sub-indikator (opt-in, generik — KPI mana pun boleh dipakai). Didefinisikan sekali di KPI
// Master, dinilai seperti baris KPI penuh sendiri-sendiri, lalu digulung: nilai induk = Σ nilai
// sub, bobot induk = Σ bobot sub. Sub yang sama dipakai di SEMUA assignment (unit/bidang) KPI ini.
export interface SubIndicatorInput {
  nama: string;
  satuan?: string;
  bobot: string; // poin KM (Σ seluruh sub = bobotKm assignment, turunan otomatis)
  target: string;
  target2?: string;
  formula?: string; // teks deskriptif cara pengukuran sub ini — tak memengaruhi nilai (sama sifatnya dgn KpiMaster.formula)
}
export interface SaveMasterInput {
  id?: string;
  kmType?: string; // 'draft' | 'final'
  indikator: string;
  formula?: string;
  satuan?: string;
  bobotKm?: string; // bobot skor KM (poin) — data parent, sama untuk semua assignment
  targetParent?: string;
  assignments: AssignmentInput[];
  defaultCheckerIds?: string[]; // default alur reviewer (Fase C) — diwariskan ke picker submit
  defaultApproverId?: string;
  aggregationMethod?: string; // 'weighted' | 'sum' (Fase E) — dipilih per-KPI
  subIndicators?: SubIndicatorInput[]; // non-kosong = KPI ini "komposit"
}

// Item yang disebar (fan-out) ke kpiItems dokumen KM. Bentuknya kompatibel dengan
// KpiItem existing (indikator/formula/satuan/bobot/target/target2) + tautan masterKpiId.
// `subIndicators` (opsional) menandai item ini komposit — lihat SubIndicatorInput. Ini
// dokumen KM (definisi TARGET), belum ada realisasi — realisasi per-sub diisi belakangan
// saat submit Input Realisasi (sama seperti item non-komposit, pola existing).
type FannedItem = {
  masterKpiId: string;
  indikator: string; formula: string; satuan: string;
  bobot: string; target: string; target2: string;
  subIndicators?: SubIndicatorInput[];
};

// Item KM legacy dikumpulkan utk backfill (Fase F) — belum bertag masterKpiId.
type BackfillGroupItem = { docId: string; unitCode: string; bidang: string; item: Record<string, unknown> };

@Injectable()
export class KpiMasterService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  // Default: sembunyikan versi 'superseded' (riwayat) — hanya tampilkan versi yang masih
  // hidup (berlaku sekarang ATAU pending berlaku bulan berikutnya). includeSuperseded=true
  // untuk melihat seluruh riwayat versi.
  async list(year?: string, kmType?: string, includeSuperseded = false) {
    const activePeriod = await this.prisma.period.findFirst({ where: { isActive: true } });
    const masters = await this.prisma.kpiMaster.findMany({
      where: {
        ...(year ? { year } : {}), ...(kmType ? { kmType } : {}),
        ...(includeSuperseded ? {} : { status: { not: 'superseded' } }),
      },
      include: { assignments: { orderBy: [{ unitCode: 'asc' }, { bidang: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    return masters.map((m) => this.withVersionFlags(m, activePeriod?.yearMonth));
  }

  private withVersionFlags<T extends { effectiveMonth: string; status: string }>(m: T, activeYearMonth?: string) {
    const isPending = !!activeYearMonth && m.effectiveMonth > activeYearMonth;
    return { ...m, isPending, isCurrent: m.status === 'active' && !isPending };
  }

  // Default reviewer untuk pre-fill picker submit dokumen KM. Prioritas (Kombinasi A+B):
  //   1. Slot per-assignment (reviewerSlots) yang cocok (masterKpiId, unitCode, bidang) dokumen —
  //      slot peran di-resolve ke orang di-scope unit/bidang assignment; slot ber-userId = override.
  //   2. Fallback: default reviewer master-level (defaultCheckerIds/defaultApproverId) dari
  //      masterKpiId pertama dokumen (perilaku lama).
  // Return kontrak tetap { checkerIds, approverId } (userId konkret) — hilir tak berubah.
  async getDefaultsForKm(kmId: string) {
    const km = await this.prisma.kontrakManajemen.findUnique({ where: { id: kmId } });
    if (!km) return { checkerIds: [] as string[], approverId: null as string | null };

    const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<string, unknown>[];
    const masterIds = items.map((it) => it['masterKpiId']).filter((v): v is string => typeof v === 'string');
    if (masterIds.length === 0) return { checkerIds: [], approverId: null };

    // (1) Cari assignment (unit,bidang) dokumen yang punya reviewerSlots terisi.
    const assignments = await this.prisma.kpiAssignment.findMany({
      where: { kpiMasterId: { in: masterIds }, unitCode: km.unitCode, bidang: km.bidang },
    });
    const withSlots = assignments.find((a) => this.parseReviewerSlots(a.reviewerSlots) !== null);
    if (withSlots) {
      const resolved = await this.resolveReviewerSlots(km.unitCode, km.bidang, this.parseReviewerSlots(withSlots.reviewerSlots)!);
      if (resolved.checkerIds.length > 0 && resolved.approverId) return resolved;
      // Hasil tak lengkap (mis. peran tak ketemu orang) → jatuh ke fallback master-level.
    }

    // (2) Fallback master-level dari masterKpiId pertama.
    const master = await this.prisma.kpiMaster.findUnique({ where: { id: masterIds[0] } });
    if (!master) return { checkerIds: [], approverId: null };
    return { checkerIds: master.defaultCheckerIds, approverId: master.defaultApproverId };
  }

  private parseReviewerSlots(raw: unknown): ReviewerSlots | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as { checkers?: unknown; approver?: unknown };
    const cleanSlot = (s: unknown): ReviewerSlot | null => {
      if (!s || typeof s !== 'object') return null;
      const slot = s as { role?: unknown; userId?: unknown };
      if (typeof slot.role !== 'string') return null;
      const out: ReviewerSlot = { role: slot.role as ReviewerSlot['role'] };
      if (typeof slot.userId === 'string' && slot.userId.trim()) out.userId = slot.userId.trim();
      return out;
    };
    const checkers = Array.isArray(obj.checkers)
      ? obj.checkers.map(cleanSlot).filter((s): s is ReviewerSlot => s !== null)
      : [];
    const approver = cleanSlot(obj.approver);
    if (checkers.length === 0 && !approver) return null;
    return { checkers, approver };
  }

  // Normalisasi reviewerSlots dari input authoring → bentuk tersimpan bersih, atau null.
  private sanitizeReviewerSlots(input: unknown): ReviewerSlots | null {
    return this.parseReviewerSlots(input ?? null);
  }

  // Validasi & normalisasi sub-indikator (opt-in, generik — lihat SubIndicatorInput). Array
  // kosong/tak ada → null (KPI ini bukan komposit). Melempar bila ada baris tak valid.
  // aggregationMethod menentukan tanda bobot yang sah: 'sum' (KPI penalti/pengurang, mis.
  // "Kepatuhan, Maturity Level & Tata Kelola") → bobot = max penalti, harus NEGATIF (mis. -3);
  // 'weighted' (KPI positif biasa) → bobot = poin, harus POSITIF. Rumus nilai (breakdownComposite
  // di common/capaian.ts) tak berubah — tetap (capaian% × bobot), jadi bobot negatif otomatis
  // menghasilkan nilai negatif proporsional ke capaian.
  private sanitizeSubIndicators(input: unknown, aggregationMethod: 'weighted' | 'sum'): SubIndicatorInput[] | null {
    if (!Array.isArray(input) || input.length === 0) return null;
    const seen = new Set<string>();
    const out: SubIndicatorInput[] = [];
    for (const raw of input) {
      const r = raw as Record<string, unknown>;
      const nama = String(r?.nama ?? '').trim();
      if (!nama) throw new BadRequestException('Nama sub-indikator wajib diisi');
      if (seen.has(nama)) throw new BadRequestException(`Sub-indikator "${nama}" terpilih ganda`);
      seen.add(nama);
      const bobotStr = String(r?.bobot ?? '').trim();
      const bobotNum = Number(bobotStr.replace(',', '.'));
      if (aggregationMethod === 'sum') {
        if (!Number.isFinite(bobotNum) || bobotNum >= 0) throw new BadRequestException(`Max penalti sub-indikator "${nama}" harus angka negatif (mis. -3)`);
      } else if (!Number.isFinite(bobotNum) || bobotNum <= 0) {
        throw new BadRequestException(`Bobot sub-indikator "${nama}" harus angka > 0`);
      }
      const target = String(r?.target ?? '').trim();
      if (!target) throw new BadRequestException(`Target sub-indikator "${nama}" wajib diisi`);
      out.push({
        nama, satuan: String(r?.satuan ?? ''), bobot: bobotStr, target,
        target2: String(r?.target2 ?? '') || undefined,
        formula: String(r?.formula ?? '') || undefined,
      });
    }
    return out;
  }

  // Resolusi slot peran → userId konkret, di-scope ke (unitCode,bidang) dokumen.
  // Aturan scoping: UPMK (unit≠KP) diidentifikasi by (role,unit) TANPA bidang (user UPMK
  // bidang=null); KP sertakan bidang. Approver SRMANAJER selalu di KP per-bidang; GM tunggal.
  // Slot ber-userId = override langsung. Tiap slot ambil satu orang deterministik (first).
  private async resolveReviewerSlots(unitCode: string, bidang: string, slots: ReviewerSlots) {
    const resolveOne = async (slot: ReviewerSlot, kind: 'checker' | 'approver'): Promise<User | null> => {
      const role = slot.role as Role;
      const allowed = kind === 'checker' ? CHECKER_ROLES : APPROVER_ROLES;
      if (!allowed.includes(role)) return null;
      if (slot.userId) {
        const u = await this.prisma.user.findFirst({ where: stepRecipientWhere({ role, userId: slot.userId, label: '' }) });
        return u && allowed.includes(u.role) ? u : null;
      }
      // Slot peran (B): scope by unit; KP tambah bidang; approver SM selalu KP per-bidang.
      const where =
        kind === 'approver'
          ? role === Role.GM
            ? stepRecipientWhere({ role, label: '' })
            : stepRecipientWhere({ role, unit: 'KP', bidang, label: '' })
          : unitCode === 'KP'
            ? stepRecipientWhere({ role, unit: 'KP', bidang, label: '' })
            : stepRecipientWhere({ role, unit: unitCode, label: '' });
      return this.prisma.user.findFirst({ where, orderBy: { name: 'asc' } });
    };

    const checkerIds: string[] = [];
    const seen = new Set<string>();
    for (const slot of slots.checkers) {
      const u = await resolveOne(slot, 'checker');
      if (u && !seen.has(u.id)) { checkerIds.push(u.id); seen.add(u.id); }
    }
    let approverId: string | null = null;
    if (slots.approver) {
      const u = await resolveOne(slots.approver, 'approver');
      if (u && !seen.has(u.id)) approverId = u.id;
    }
    return { checkerIds, approverId };
  }

  async getById(id: string) {
    const m = await this.prisma.kpiMaster.findUnique({
      where: { id },
      include: { assignments: { orderBy: [{ unitCode: 'asc' }, { bidang: 'asc' }] } },
    });
    if (!m) throw new NotFoundException('KPI master tidak ditemukan');
    const activePeriod = await this.prisma.period.findFirst({ where: { isActive: true } });
    return this.withVersionFlags(m, activePeriod?.yearMonth);
  }

  // Rollup: gulung realisasi tiap assignment (child) menjadi nilai parent. Realisasi
  // diambil dari InputRealisasi yang APPROVED pada periode terkait — dicari item dengan
  // masterKpiId yang cocok (masterKpiId ikut tersalin ke realisasi karena fan-out
  // menyisipkannya di kpiItems KM). Metode agregasi (Fase E) dipilih per-KPI:
  //   'weighted' — rata-rata tertimbang pakai persenAgregasi (Σ=100% jadi syarat lengkap).
  //   'sum'      — jumlah polos tiap kontribusi (cocok utk KPI penalti/pengurang lintas
  //                bidang); tidak ada syarat Σ=100%, selalu dianggap "lengkap".
  async getRollup(id: string, periodId?: string) {
    const master = await this.getById(id);
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException('Periode tidak ditemukan');

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const isSum = master.aggregationMethod === 'sum';

    const totalPersen = r2(master.assignments.reduce((s, a) => s + a.persenAgregasi, 0));
    let nilaiParent = 0;
    const breakdown: Array<{
      unitCode: string; bidang: string; persenAgregasi: number;
      realisasi: number | null; kontribusi: number; hasData: boolean;
    }> = [];

    for (const a of master.assignments) {
      const record = await this.prisma.inputRealisasi.findFirst({
        where: { periodId: period.id, unitCode: a.unitCode, bidang: a.bidang, status: 'approved' },
      });
      const values = (record?.values ?? {}) as Record<string, Record<string, unknown>>;
      const item = Object.values(values).find((it) => it['masterKpiId'] === master.id);
      const realisasi = item ? num(item['realisasi']) : null;
      const kontribusi = realisasi == null ? 0 : isSum ? r2(realisasi) : r2((realisasi * a.persenAgregasi) / 100);
      nilaiParent += kontribusi;
      breakdown.push({
        unitCode: a.unitCode, bidang: a.bidang, persenAgregasi: a.persenAgregasi,
        realisasi, kontribusi, hasData: realisasi != null,
      });
    }

    return {
      masterId: master.id, indikator: master.indikator, targetParent: master.targetParent,
      periodId: period.id, periodLabel: period.label,
      aggregationMethod: master.aggregationMethod,
      totalPersen, nilaiParent: r2(nilaiParent),
      isFullyConfigured: isSum || Math.abs(totalPersen - 100) < 0.01,
      breakdown,
    };
  }

  // ===== Fase H1: View "Review per-KPI" (read-only) =====
  // Lensa lintas-dokumen untuk konsolidator (RPC Perencanaan): tiap KPI yang dimiliki
  // LEBIH DARI SATU bidang ditampilkan dengan seluruh slice bidang berdampingan —
  // realisasi + status dokumen realisasi + reviewer per bidang. nilaiParent dihitung
  // hanya dari slice yang realisasinya sudah 'approved' (konsisten dgn getRollup);
  // slice non-approved tetap ditampilkan (realisasi berjalan + status) agar terlihat
  // progres, tetapi belum ikut dihitung. KPI single-bidang tidak muncul di view ini.
  async getPerKpiReview(user: User, periodId?: string) {
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException('Periode tidak ditemukan');

    const activePeriod = await this.prisma.period.findFirst({ where: { isActive: true } });
    const masters = await this.prisma.kpiMaster.findMany({
      where: { status: { not: 'superseded' } },
      include: { assignments: { orderBy: [{ unitCode: 'asc' }, { bidang: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });

    // Status konsolidasi (Fase H2) tiap KPI untuk periode ini.
    const reviews = await this.prisma.kpiRollupReview.findMany({ where: { periodId: period.id } });
    const reviewByMaster = new Map(reviews.map((rv) => [rv.kpiMasterId, rv]));

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // Hanya KPI bersama (dimiliki >1 bidang) — inti dari lensa konsolidasi lintas-dokumen.
    const shared = masters.filter((m) => m.assignments.length > 1);

    type PerKpiSlice = {
      unitCode: string; bidang: string; holder: string; persenAgregasi: number;
      realisasi: number | null; status: string; reviewer: string | null;
      isApproved: boolean; kontribusi: number; hasData: boolean;
    };
    const items: Array<Record<string, unknown>> = [];
    for (const master of shared) {
      const isSum = master.aggregationMethod === 'sum';
      const slices: PerKpiSlice[] = [];
      let nilaiParent = 0;
      let approvedCount = 0;

      for (const a of master.assignments) {
        const record = await this.prisma.inputRealisasi.findFirst({
          where: { periodId: period.id, unitCode: a.unitCode, bidang: a.bidang },
          orderBy: { updatedAt: 'desc' },
        });
        const values = (record?.values ?? {}) as Record<string, Record<string, unknown>>;
        const item = Object.values(values).find((it) => it['masterKpiId'] === master.id);
        const realisasi = item ? num(item['realisasi']) : null;
        const status = record?.status ?? 'none';
        const isApproved = status === 'approved';
        const kontribusi = realisasi == null || !isApproved
          ? 0
          : isSum ? r2(realisasi) : r2((realisasi * a.persenAgregasi) / 100);
        if (isApproved) { nilaiParent += kontribusi; approvedCount++; }
        slices.push({
          unitCode: a.unitCode, bidang: a.bidang, holder: a.holder,
          persenAgregasi: a.persenAgregasi,
          realisasi, status, reviewer: record?.reviewer ?? null,
          isApproved, kontribusi, hasData: realisasi != null,
        });
      }

      const totalPersen = r2(master.assignments.reduce((s, a) => s + a.persenAgregasi, 0));
      const isPending = !!activePeriod?.yearMonth && master.effectiveMonth > activePeriod.yearMonth;
      const allApproved = approvedCount === master.assignments.length;
      const rv = reviewByMaster.get(master.id);
      const consolidation = rv
        ? { status: rv.status, reviewer: rv.reviewer, reviewNote: rv.reviewNote, nilaiParent: rv.nilaiParent, reviewedAt: rv.reviewedAt }
        : null;
      items.push({
        masterId: master.id, indikator: master.indikator, targetParent: master.targetParent,
        aggregationMethod: master.aggregationMethod, kmType: master.kmType,
        version: master.version, effectiveMonth: master.effectiveMonth, isPending,
        totalAssignments: master.assignments.length, approvedCount, allApproved,
        totalPersen, nilaiParent: r2(nilaiParent),
        isFullyConfigured: isSum || Math.abs(totalPersen - 100) < 0.01,
        // Siap dikonsolidasi bila semua bidang approved & belum ada keputusan 'approved'.
        readyForConsolidation: allApproved && consolidation?.status !== 'approved',
        consolidation,
        slices,
      });
    }

    return {
      periodId: period.id, periodLabel: period.label,
      viewerCanConsolidate: this.isRpcConsolidator(user),
      items,
    };
  }

  // Guard konsolidasi (Fase H2): RPC Perencanaan (Staff/Manajer/SM bidang Perencanaan &
  // Project Control di Kantor Induk) menyetujui agregat; GM & admin sistem diizinkan juga.
  private isRpcConsolidator(user: User): boolean {
    if (user.role === Role.GM || user.role === Role.SUPERADMIN || user.role === Role.DEVELOPER) return true;
    return user.unit === 'KP' && user.bidang === RPC_BIDANG;
  }

  // ===== Fase H2: Approval konsolidasi agregat KPI lintas-bidang =====
  // Setelah semua bidang kontributor menyetujui realisasinya, RPC Perencanaan meninjau nilai
  // parent (agregat). approve → kunci snapshot nilaiParent (final). reject → catat + notifikasi
  // ke penyusun realisasi bidang kontributor agar merevisi.
  async reviewConsolidation(user: User, kpiMasterId: string, action: 'approve' | 'reject', note?: string, periodId?: string) {
    if (!this.isRpcConsolidator(user)) {
      throw new ForbiddenException('Hanya RPC Perencanaan atau General Manager yang dapat menyetujui konsolidasi KPI');
    }
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException('Periode tidak ditemukan');

    const master = await this.prisma.kpiMaster.findUnique({ where: { id: kpiMasterId }, include: { assignments: true } });
    if (!master) throw new NotFoundException('KPI master tidak ditemukan');
    if (master.assignments.length <= 1) throw new BadRequestException('KPI ini tidak lintas-bidang — tidak memerlukan konsolidasi');

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const isSum = master.aggregationMethod === 'sum';

    // Hitung ulang nilaiParent dari slice approved + kumpulkan penyusun (untuk notifikasi).
    let nilaiParent = 0;
    let approvedCount = 0;
    const contributorSubmitterIds = new Set<string>();
    for (const a of master.assignments) {
      const record = await this.prisma.inputRealisasi.findFirst({
        where: { periodId: period.id, unitCode: a.unitCode, bidang: a.bidang, status: 'approved' },
      });
      if (!record) continue;
      const values = (record.values ?? {}) as Record<string, Record<string, unknown>>;
      const item = Object.values(values).find((it) => it['masterKpiId'] === master.id);
      if (!item) continue;
      const realisasi = num(item['realisasi']);
      nilaiParent += isSum ? r2(realisasi) : r2((realisasi * a.persenAgregasi) / 100);
      approvedCount++;
      if (record.submitterId) contributorSubmitterIds.add(record.submitterId);
    }
    const allApproved = approvedCount === master.assignments.length;

    if (action === 'approve') {
      if (!allApproved) throw new ForbiddenException('Belum semua bidang kontributor menyetujui realisasinya — konsolidasi belum dapat disetujui');
      const review = await this.prisma.kpiRollupReview.upsert({
        where: { kpiMasterId_periodId: { kpiMasterId, periodId: period.id } },
        update: { status: 'approved', reviewer: user.name, reviewerId: user.id, reviewNote: note?.trim() || null, nilaiParent: r2(nilaiParent), reviewedAt: new Date() },
        create: { kpiMasterId, periodId: period.id, status: 'approved', reviewer: user.name, reviewerId: user.id, reviewNote: note?.trim() || null, nilaiParent: r2(nilaiParent), reviewedAt: new Date() },
      });
      await this.prisma.auditLog.create({
        data: {
          actor: user.name, userId: user.id, action: 'kpi_rollup.approve', entity: 'KpiRollupReview', targetId: review.id,
          note: `Konsolidasi KPI "${master.indikator}" periode ${period.label} disetujui — nilai parent final ${r2(nilaiParent)}`,
        },
      });
      return review;
    }

    // reject
    if (!note?.trim()) throw new BadRequestException('Catatan penolakan wajib diisi');
    const review = await this.prisma.kpiRollupReview.upsert({
      where: { kpiMasterId_periodId: { kpiMasterId, periodId: period.id } },
      update: { status: 'rejected', reviewer: user.name, reviewerId: user.id, reviewNote: note.trim(), nilaiParent: null, reviewedAt: new Date() },
      create: { kpiMasterId, periodId: period.id, status: 'rejected', reviewer: user.name, reviewerId: user.id, reviewNote: note.trim(), nilaiParent: null, reviewedAt: new Date() },
    });
    if (contributorSubmitterIds.size > 0) {
      await this.prisma.notification.createMany({
        data: [...contributorSubmitterIds].map((uid) => ({
          userId: uid, type: 'alert', title: 'Konsolidasi KPI Ditolak',
          msg: `Konsolidasi "${master.indikator}" periode ${period.label} ditolak RPC Perencanaan: ${note.trim()}`,
          route: '/kpi-master', targetId: kpiMasterId, unread: true,
        })),
      });
    }
    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'kpi_rollup.reject', entity: 'KpiRollupReview', targetId: review.id,
        note: `Konsolidasi KPI "${master.indikator}" periode ${period.label} ditolak: ${note.trim()}`,
      },
    });
    return review;
  }

  // Buat/ubah definisi KPI parent + assignment-nya, lalu sebar (fan-out) ke dokumen KM.
  async save(user: User, dto: SaveMasterInput) {
    // KPI Master mendefinisikan KPI lintas-bidang/unit — dipersempit ke RPC (Perencanaan &
    // Project Control, semua jenjang: Staff/Manajer/SM), sesuai peran RPC sbg pemilik cascading
    // KPI (selaras isPicRen() di period-target.service.ts). GM & Admin tetap boleh override.
    const isAdminOverride = user.role === Role.GM || user.role === Role.SUPERADMIN || user.role === Role.DEVELOPER;
    const isRpc = user.unit === 'KP' && user.bidang === RPC_BIDANG;
    if (!isAdminOverride && !isRpc) {
      throw new ForbiddenException('KPI Master hanya dapat disusun oleh Perencanaan & Project Control (RPC), GM, atau Admin');
    }
    if (!dto.indikator?.trim()) throw new BadRequestException('Nama indikator wajib diisi');
    if (!Array.isArray(dto.assignments) || dto.assignments.length === 0) {
      throw new BadRequestException('Pilih minimal satu unit/bidang untuk di-assign');
    }
    for (const a of dto.assignments) {
      if (!a.unitCode?.trim() || !a.bidang?.trim()) throw new BadRequestException('Setiap assignment wajib punya unit & bidang');
    }
    // Cegah duplikat (unit,bidang) dalam satu master.
    const keys = new Set<string>();
    for (const a of dto.assignments) {
      const k = `${a.unitCode}||${a.bidang}`;
      if (keys.has(k)) throw new BadRequestException(`Assignment ganda untuk ${a.unitCode} — ${a.bidang}`);
      keys.add(k);
    }
    // Target wajib diisi — KPI tanpa target diam-diam dilewati dari penilaian (scoreItems di
    // common/capaian.ts, target<=0 → item dilewati) tanpa peringatan. Komposit taruh target di
    // level sub-indikator (divalidasi di sanitizeSubIndicators), bukan di assignment.
    const isCompositeDto = Array.isArray(dto.subIndicators) && dto.subIndicators.length > 0;
    if (!isCompositeDto) {
      for (const a of dto.assignments) {
        if (!a.target?.trim()) throw new BadRequestException(`Target Sem I wajib diisi untuk ${a.unitCode} — ${a.bidang}`);
      }
    }
    // Metode agregasi (Fase E) — dipilih per-KPI. 'sum' = jumlah polos tiap kontribusi
    // (KPI penalti/pengurang, tanpa syarat Σ=100%). 'weighted' = rata-rata tertimbang
    // pakai persenAgregasi (Σ=100% wajib bila diisi) — perilaku Fase B, default.
    const aggregationMethod = dto.aggregationMethod === 'sum' ? 'sum' : 'weighted';
    if (aggregationMethod === 'weighted') {
      // 1 assignment saja → tak ada yang perlu dibagi, paksa 100% (tak bergantung pada apa
      // yang dikirim klien — konsisten dengan default FE, sekaligus jaga-jaga klien lama/API langsung).
      if (dto.assignments.length === 1) {
        dto.assignments[0].persenAgregasi = 100;
      } else {
        const totalPersen = dto.assignments.reduce((s, a) => s + (Number(a.persenAgregasi) || 0), 0);
        const anyPersenSet = dto.assignments.some((a) => Number(a.persenAgregasi) > 0);
        if (anyPersenSet && Math.abs(totalPersen - 100) > 0.01) {
          throw new BadRequestException(`Total bobot agregasi harus 100%, saat ini ${totalPersen}%`);
        }
      }
    }

    // Default alur reviewer (Fase C): opsional — bila diisi, harus resolve ke user aktif
    // dengan role yang sesuai (Checker=ASMAN/Manajer, Approver=SRManajer/GM). Ini hanya
    // DEFAULT untuk mengisi picker submit; submitter tetap bisa mengubahnya.
    const defaultCheckerIds = (dto.defaultCheckerIds ?? []).filter(Boolean);
    const defaultApproverId = dto.defaultApproverId?.trim() || null;
    if (defaultCheckerIds.length > 0 || defaultApproverId) {
      const ids = [...defaultCheckerIds, ...(defaultApproverId ? [defaultApproverId] : [])];
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true } });
      for (const cid of defaultCheckerIds) {
        const u = users.find((x) => x.id === cid);
        if (!u || !CHECKER_ROLES.includes(u.role)) throw new BadRequestException('Default Checker harus user aktif berperan ASMAN/Manajer');
      }
      if (defaultApproverId) {
        const u = users.find((x) => x.id === defaultApproverId);
        if (!u || !APPROVER_ROLES.includes(u.role)) throw new BadRequestException('Default Approver harus user aktif berperan Sr. Manajer/GM');
      }
    }

    // Validasi reviewerSlots per-assignment (A+B): role token harus valid per jenis; slot
    // ber-override (userId) harus user aktif dengan role sesuai.
    for (const a of dto.assignments) {
      const slots = this.sanitizeReviewerSlots(a.reviewerSlots);
      if (!slots) continue;
      const check = async (slot: ReviewerSlot, allowed: Role[], labelKind: string) => {
        if (!allowed.includes(slot.role as Role)) {
          throw new BadRequestException(`Slot ${labelKind} (${a.unitCode}/${a.bidang}) harus berperan ${allowed.join('/')}`);
        }
        if (slot.userId) {
          const u = await this.prisma.user.findFirst({ where: { id: slot.userId, isActive: true } });
          if (!u || !allowed.includes(u.role)) throw new BadRequestException(`Override ${labelKind} (${a.unitCode}/${a.bidang}) harus user aktif berperan ${allowed.join('/')}`);
        }
      };
      for (const c of slots.checkers) await check(c, CHECKER_ROLES, 'Checker');
      if (slots.approver) await check(slots.approver, APPROVER_ROLES, 'Approver');
    }

    // Sub-indikator (opt-in, generik): non-kosong → KPI ini "komposit". bobotKm (kini data
    // parent di KpiMaster, sama untuk semua assignment) jadi TURUNAN (Σ bobot sub) — override
    // input user.
    const subIndicators = this.sanitizeSubIndicators(dto.subIndicators, aggregationMethod);
    if (subIndicators) {
      const compositeBobot = subIndicators.reduce((s, si) => s + (Number(String(si.bobot).replace(',', '.')) || 0), 0);
      dto.bobotKm = String(compositeBobot);
    }
    const subIndicatorsJson = subIndicators ? (subIndicators as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;

    const activePeriod = await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!activePeriod) throw new BadRequestException('Tidak ada periode aktif');
    const kmType = dto.kmType === 'final' ? 'final' : 'draft';

    // ===== Versioning (Fase D) =====
    // Master BARU: berlaku langsung mulai periode aktif.
    // Master EDIT, versi SEDANG BERLAKU (effectiveMonth <= periode aktif): tidak diubah di
    //   tempat — dibuat VERSI BARU berlaku bulan BERIKUTNYA; versi lama ditandai 'superseded'
    //   tanpa disentuh datanya (periode berjalan tetap memakai definisi lama).
    // Master EDIT, versi PENDING (effectiveMonth > periode aktif, belum berlaku): masih boleh
    //   diedit langsung di tempat karena belum pernah "hidup" di periode manapun.
    let master;
    let targetPeriodId: string;
    let supersedeId: string | null = null;

    if (dto.id) {
      const existing = await this.prisma.kpiMaster.findUnique({ where: { id: dto.id } });
      if (!existing) throw new NotFoundException('KPI master tidak ditemukan');
      if (existing.status === 'superseded') {
        throw new BadRequestException('Versi KPI ini sudah digantikan versi yang lebih baru — edit versi terbaru sebagai gantinya');
      }
      const isPending = existing.effectiveMonth > activePeriod.yearMonth;

      if (isPending) {
        const targetPeriod = await this.prisma.period.findUnique({ where: { yearMonth: existing.effectiveMonth } });
        if (!targetPeriod) throw new BadRequestException(`Periode ${existing.effectiveMonth} tidak ditemukan`);
        master = await this.prisma.kpiMaster.update({
          where: { id: dto.id },
          data: {
            indikator: dto.indikator.trim(), formula: dto.formula ?? '', satuan: dto.satuan ?? '',
            bobotKm: dto.bobotKm ?? '', targetParent: dto.targetParent ?? '', kmType, defaultCheckerIds, defaultApproverId, aggregationMethod,
            subIndicators: subIndicatorsJson,
          },
        });
        await this.prisma.kpiAssignment.deleteMany({ where: { kpiMasterId: master.id } });
        targetPeriodId = targetPeriod.id;
      } else {
        const nextMonth = this.incrementYearMonth(activePeriod.yearMonth);
        const nextPeriod = await this.prisma.period.findUnique({ where: { yearMonth: nextMonth } });
        if (!nextPeriod) throw new BadRequestException(`Periode ${nextMonth} belum tersedia di sistem — tidak dapat membuat versi baru`);
        master = await this.prisma.kpiMaster.create({
          data: {
            year: nextPeriod.yearMonth.slice(0, 4), kmType, indikator: dto.indikator.trim(), formula: dto.formula ?? '',
            satuan: dto.satuan ?? '', bobotKm: dto.bobotKm ?? '', targetParent: dto.targetParent ?? '', createdBy: user.name, createdById: user.id,
            defaultCheckerIds, defaultApproverId, aggregationMethod, subIndicators: subIndicatorsJson,
            effectiveMonth: nextMonth, version: existing.version + 1, previousVersionId: existing.id,
          },
        });
        supersedeId = existing.id;
        targetPeriodId = nextPeriod.id;
      }
    } else {
      master = await this.prisma.kpiMaster.create({
        data: {
          year: activePeriod.yearMonth.slice(0, 4), kmType, indikator: dto.indikator.trim(), formula: dto.formula ?? '',
          satuan: dto.satuan ?? '', bobotKm: dto.bobotKm ?? '', targetParent: dto.targetParent ?? '', createdBy: user.name, createdById: user.id,
          defaultCheckerIds, defaultApproverId, aggregationMethod, subIndicators: subIndicatorsJson,
          effectiveMonth: activePeriod.yearMonth, version: 1,
        },
      });
      targetPeriodId = activePeriod.id;
    }

    await this.prisma.kpiAssignment.createMany({
      data: dto.assignments.map((a) => {
        const slots = this.sanitizeReviewerSlots(a.reviewerSlots);
        return {
          kpiMasterId: master.id, unitCode: a.unitCode, bidang: a.bidang,
          holder: a.holder ?? '', target: a.target ?? '', target2: a.target2 ?? '',
          persenAgregasi: Number(a.persenAgregasi) || 0,
          reviewerSlots: slots === null ? Prisma.DbNull : (slots as unknown as Prisma.InputJsonValue),
        };
      }),
    });

    const assignments = await this.prisma.kpiAssignment.findMany({ where: { kpiMasterId: master.id } });
    const fanOut = await this.fanOut(master, assignments, targetPeriodId);

    if (supersedeId) {
      await this.prisma.kpiMaster.update({ where: { id: supersedeId }, data: { status: 'superseded' } });
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: dto.id ? 'kpi_master.update' : 'kpi_master.create',
        entity: 'KpiMaster', targetId: master.id,
        note: supersedeId
          ? `KPI "${master.indikator}" diedit — versi baru (v${master.version}) berlaku mulai ${master.effectiveMonth}, versi lama diarsipkan`
          : `KPI "${master.indikator}" di-assign ke ${assignments.length} unit/bidang (${fanOut.docsAffected} dokumen KM diperbarui)`,
      },
    });
    for (const a of assignments) await this.cache.del(`kontrak:${a.unitCode}`);
    return this.getById(master.id);
  }

  private incrementYearMonth(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }

  async delete(user: User, id: string) {
    if (user.unit !== 'KP') throw new ForbiddenException('Hanya Kantor Induk yang dapat menghapus KPI Master');
    const master = await this.prisma.kpiMaster.findUnique({ where: { id } });
    if (!master) throw new NotFoundException('KPI master tidak ditemukan');

    // Hapus item yang sudah disebar dari dokumen KM DRAFT (dokumen submitted/approved tak disentuh).
    const removed = await this.removeFannedItems(id, master.kmType);
    await this.prisma.kpiMaster.delete({ where: { id } }); // cascade menghapus assignments

    // Bila yang dihapus adalah versi baru hasil edit, versi sebelumnya kembali jadi versi berlaku.
    if (master.previousVersionId) {
      await this.prisma.kpiMaster.update({ where: { id: master.previousVersionId }, data: { status: 'active' } }).catch(() => {});
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'kpi_master.delete', entity: 'KpiMaster', targetId: id,
        note: `KPI "${master.indikator}" (v${master.version}) dihapus (${removed} item dibersihkan dari dokumen KM draft)`,
      },
    });
    return { success: true, docsCleaned: removed };
  }

  // ===== Fan-out: sinkronkan item KPI ke dokumen KM DRAFT per-(unit,bidang) =====
  private async fanOut(
    master: { id: string; kmType: string; indikator: string; formula: string; satuan: string; bobotKm: string; createdBy: string; createdById: string | null; subIndicators?: Prisma.JsonValue | null },
    assignments: Array<{ unitCode: string; bidang: string; holder: string; target: string; target2: string }>,
    periodId: string,
  ): Promise<{ docsAffected: number }> {
    // Sub-indikator (opt-in): template sama disebar ke SEMUA assignment (definisi target,
    // belum ada realisasi — sama seperti item non-komposit).
    const subIndicatorsTemplate = Array.isArray(master.subIndicators)
      ? (master.subIndicators as unknown as SubIndicatorInput[])
      : undefined;
    const assignedKeys = new Set(assignments.map((a) => `${a.unitCode}||${a.bidang}`));
    let docsAffected = 0;

    // 1. Bersihkan item KPI ini dari dokumen KM draft yang (unit,bidang)-nya tak lagi di-assign.
    const draftKms = await this.prisma.kontrakManajemen.findMany({
      where: { periodId, kmType: master.kmType, status: 'draft' },
    });
    for (const km of draftKms) {
      const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<string, unknown>[];
      const hasMaster = items.some((it) => it['masterKpiId'] === master.id);
      const key = `${km.unitCode}||${km.bidang}`;
      if (hasMaster && !assignedKeys.has(key)) {
        const filtered = items.filter((it) => it['masterKpiId'] !== master.id);
        await this.prisma.kontrakManajemen.update({ where: { id: km.id }, data: { kpiItems: filtered as object } });
        docsAffected++;
      }
    }

    // 2. Sisipkan/perbarui item KPI di dokumen KM draft tiap (unit,bidang) yang di-assign.
    for (const a of assignments) {
      const item: FannedItem = {
        masterKpiId: master.id,
        indikator: master.indikator, formula: master.formula, satuan: master.satuan,
        bobot: master.bobotKm, target: a.target, target2: a.target2,
        ...(subIndicatorsTemplate ? { subIndicators: subIndicatorsTemplate } : {}),
      };
      const existingKm = await this.prisma.kontrakManajemen.findFirst({
        where: { periodId, unitCode: a.unitCode, bidang: a.bidang, kmType: master.kmType, status: 'draft' },
        orderBy: { updatedAt: 'desc' },
      });
      if (!existingKm) {
        await this.prisma.kontrakManajemen.create({
          data: {
            periodId, unitCode: a.unitCode, bidang: a.bidang, kmType: master.kmType,
            holder: a.holder || master.createdBy, kpiItems: [item] as object, status: 'draft',
            submitter: master.createdBy, submitterId: master.createdById,
          },
        });
        docsAffected++;
      } else {
        const items = (Array.isArray(existingKm.kpiItems) ? existingKm.kpiItems : []) as Record<string, unknown>[];
        const idx = items.findIndex((it) => it['masterKpiId'] === master.id);
        if (idx >= 0) items[idx] = item as unknown as Record<string, unknown>;
        else items.push(item as unknown as Record<string, unknown>);
        await this.prisma.kontrakManajemen.update({
          where: { id: existingKm.id },
          data: { kpiItems: items as object, ...(a.holder ? { holder: a.holder } : {}) },
        });
        docsAffected++;
      }
    }
    return { docsAffected };
  }

  private async removeFannedItems(masterId: string, kmType: string): Promise<number> {
    const draftKms = await this.prisma.kontrakManajemen.findMany({ where: { kmType, status: 'draft' } });
    let cleaned = 0;
    for (const km of draftKms) {
      const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<string, unknown>[];
      if (items.some((it) => it['masterKpiId'] === masterId)) {
        const filtered = items.filter((it) => it['masterKpiId'] !== masterId);
        await this.prisma.kontrakManajemen.update({ where: { id: km.id }, data: { kpiItems: filtered as object } });
        cleaned++;
      }
    }
    return cleaned;
  }

  // Helper konstanta role (dipakai controller bila perlu guard tambahan).
  static isAuthor(user: User): boolean {
    return user.unit === 'KP' && (user.role === Role.STAFF || user.role === Role.GM);
  }

  // ===== Fase F: Backfill dokumen KM legacy → KPI Master =====
  // Dokumen KM lama (authoring manual Input KM) menyimpan kpiItems TANPA masterKpiId.
  // Backfill mengelompokkan item-item ini by (kmType, indikator) lalu membuat satu
  // KpiMaster + satu KpiAssignment per (unitCode,bidang) yang memuat indikator tsb —
  // definisi (formula/satuan) diambil dari kemunculan PERTAMA; variasi bobot/target per
  // (unit,bidang) tetap tersimpan di assignment masing-masing. HANYA menambahkan tag
  // masterKpiId pada item existing (additive) — field lain & status dokumen tidak disentuh,
  // sehingga dokumen submitted/approved aman ikut ditandai tanpa mengubah nilai apa pun.
  // Idempoten: item yang sudah bertag masterKpiId dilewati, sehingga backfill boleh
  // dijalankan berulang tanpa membuat master duplikat.
  private async collectBackfillGroups() {
    const docs = await this.prisma.kontrakManajemen.findMany({
      orderBy: [{ submittedAt: 'asc' }],
    });

    const groups = new Map<string, BackfillGroupItem[]>();

    for (const doc of docs) {
      const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<string, unknown>[];
      for (const item of items) {
        const indikator = typeof item['indikator'] === 'string' ? item['indikator'].trim() : '';
        if (!indikator) continue;
        if (item['masterKpiId']) continue; // sudah ditag (backfill sebelumnya atau KPI Master)
        const key = `${doc.kmType}||${indikator}`;
        const arr = groups.get(key) ?? [];
        arr.push({ docId: doc.id, unitCode: doc.unitCode, bidang: doc.bidang, item });
        groups.set(key, arr);
      }
    }
    return groups;
  }

  private summarizeGroups(groups: Map<string, BackfillGroupItem[]>) {
    const details: Array<{ kmType: string; indikator: string; assignmentCount: number; docCount: number }> = [];
    let assignmentsTotal = 0;
    let docsToTag = 0;
    for (const [key, entries] of groups) {
      const [kmType, indikator] = key.split('||');
      const distinctAssignments = new Set(entries.map((e) => `${e.unitCode}||${e.bidang}`));
      details.push({ kmType, indikator, assignmentCount: distinctAssignments.size, docCount: entries.length });
      assignmentsTotal += distinctAssignments.size;
      docsToTag += entries.length;
    }
    details.sort((a, b) => a.indikator.localeCompare(b.indikator));
    return { groupCount: groups.size, mastersToCreate: groups.size, assignmentsTotal, docsToTag, details };
  }

  async previewBackfill() {
    const groups = await this.collectBackfillGroups();
    return this.summarizeGroups(groups);
  }

  async runBackfill(user: User) {
    const groups = await this.collectBackfillGroups();
    const activePeriod = await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!activePeriod) throw new BadRequestException('Tidak ada periode aktif');

    let mastersCreated = 0;
    let assignmentsCreated = 0;
    let docsTagged = 0;

    for (const [key, entries] of groups) {
      const [kmType, indikator] = key.split('||');
      const first = entries[0].item; // kemunculan pertama -> definisi master
      const formula = typeof first['formula'] === 'string' ? first['formula'] : '';
      const satuan = typeof first['satuan'] === 'string' ? first['satuan'] : '';
      const bobotKm = typeof first['bobot'] === 'string' ? first['bobot'] : ''; // kini data parent

      // Satu assignment per (unitCode,bidang) — target ambil kemunculan pertama pasangan tsb.
      const byPair = new Map<string, BackfillGroupItem>();
      for (const e of entries) {
        const pairKey = `${e.unitCode}||${e.bidang}`;
        if (!byPair.has(pairKey)) byPair.set(pairKey, e);
      }

      const master = await this.prisma.kpiMaster.create({
        data: {
          year: activePeriod.yearMonth.slice(0, 4), kmType, indikator, formula, satuan, bobotKm,
          targetParent: '', createdBy: user.name, createdById: user.id,
          effectiveMonth: activePeriod.yearMonth, version: 1, status: 'active',
        },
      });
      mastersCreated++;

      await this.prisma.kpiAssignment.createMany({
        data: Array.from(byPair.values()).map((e) => ({
          kpiMasterId: master.id, unitCode: e.unitCode, bidang: e.bidang,
          target: typeof e.item['target'] === 'string' ? e.item['target'] : '',
          target2: typeof e.item['target2'] === 'string' ? e.item['target2'] : '',
        })),
      });
      assignmentsCreated += byPair.size;

      // Tag masterKpiId pada SEMUA dokumen (semua periode/status) yang memuat indikator ini —
      // hanya menambah field masterKpiId, field lain & status dokumen tidak disentuh.
      const docIds = Array.from(new Set(entries.map((e) => e.docId)));
      for (const docId of docIds) {
        const doc = await this.prisma.kontrakManajemen.findUnique({ where: { id: docId } });
        if (!doc) continue;
        const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<string, unknown>[];
        let changed = false;
        const tagged = items.map((it) => {
          const itIndikator = typeof it['indikator'] === 'string' ? it['indikator'].trim() : '';
          if (itIndikator === indikator && !it['masterKpiId']) {
            changed = true;
            return { ...it, masterKpiId: master.id };
          }
          return it;
        });
        if (changed) {
          await this.prisma.kontrakManajemen.update({ where: { id: doc.id }, data: { kpiItems: tagged as object } });
          docsTagged++;
        }
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'kpi_master.backfill',
        entity: 'KpiMaster',
        note: `Backfill KM legacy: ${mastersCreated} KPI Master dibuat, ${assignmentsCreated} assignment, ${docsTagged} dokumen KM ditandai`,
      },
    });

    return { mastersCreated, assignmentsCreated, docsTagged };
  }
}
