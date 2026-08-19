import {
  Injectable,
  Inject,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, Role, User } from "@prisma/client";
import {
  CHECKER_ROLES,
  APPROVER_ROLES,
  RPC_BIDANG,
  stepRecipientWhere,
} from "../common/workflow-steps";

// Slot alur reviewer per-assignment (Kombinasi A+B): peran + opsi override orang.
export type ReviewerSlot = {
  role: "ASMAN" | "MANAJER" | "SRMANAJER" | "GM";
  userId?: string; // ada → override orang spesifik (A); kosong → resolve peran (B)
};
export type ReviewerSlots = {
  checkers: ReviewerSlot[];
  approver: ReviewerSlot | null;
};

export interface AssignmentInput {
  unitCode: string;
  bidang: string;
  holder?: string;
  target?: string;
  target2?: string;
  persenAgregasi?: number; // bobot rollup ke parent (0-100), diinput RPC Perencanaan
  reviewerSlots?: unknown; // default alur reviewer per-assignment (A+B); divalidasi di service
  // Override target per sub-indikator (KPI Komposit) — array sejajar index dgn
  // SaveMasterInput.subIndicators. Kosong/tak diisi di suatu index = warisi target template
  // global. Opsional — bukan validasi wajib (lihat sanitizeSubIndicatorTargets).
  subIndicatorTargets?: Array<{ target?: string; target2?: string }>;
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
  // Polaritas eksplisit sub ini ('positive'|'negative') — hanya berlaku utk sub bobot>0 (positif/
  // weighted); sub bobot<0 (penalti/SUM) pakai formula pengurang sendiri, tak terpengaruh field ini.
  // Kosong = fallback heuristik lama (satuan==='hari kerja') di common/capaian.ts resolvePolarity().
  polaritas?: string;
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
  polaritas?: string; // 'positive' | 'negative' — indikator non-komposit; lihat SubIndicatorInput.polaritas
}

// Item yang disebar (fan-out) ke kpiItems dokumen KM. Bentuknya kompatibel dengan
// KpiItem existing (indikator/formula/satuan/bobot/target/target2) + tautan masterKpiId.
// `subIndicators` (opsional) menandai item ini komposit — lihat SubIndicatorInput. Ini
// dokumen KM (definisi TARGET), belum ada realisasi — realisasi per-sub diisi belakangan
// saat submit Input Realisasi (sama seperti item non-komposit, pola existing).
type FannedItem = {
  masterKpiId: string;
  indikator: string;
  formula: string;
  satuan: string;
  bobot: string;
  target: string;
  target2: string;
  polaritas: string;
  holder: string;
  subIndicators?: SubIndicatorInput[];
};

type MasterDerivedItemPatch = Partial<
  Pick<FannedItem, "indikator" | "formula" | "satuan" | "bobot" | "polaritas">
>;

// Item KM legacy dikumpulkan utk backfill (Fase F) — belum bertag masterKpiId.
type BackfillGroupItem = {
  docId: string;
  unitCode: string;
  bidang: string;
  item: Record<string, unknown>;
};

export interface ReviseAssignmentPatch {
  holder?: string;
  target?: string;
  target2?: string;
  persenAgregasi?: number;
}

// Patch sempit utk reviseRejectedAssignment() — HANYA 4 field ini yang boleh diubah lewat
// jalur revisi cepat (beda dgn save() yang mengedit definisi penuh / bikin versi baru).
export interface ReviseRejectedAssignmentInput {
  persenAgregasi?: number;
  indikator?: string;
  formula?: string;
  satuan?: string;
  bobotKm?: string; // ditolak jika KPI ini komposit — lihat validasi di bawah
  targetParent?: string; // field parent saja, tak disalin ke item
  target?: string;
  polaritas?: "positive" | "negative";
  aggregationMethod?: "weighted" | "sum";
  kmType?: string;
  otherAssignments?: Array<{ id: string } & ReviseAssignmentPatch>;
}

@Injectable()
export class KpiMasterService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  // Default: sembunyikan versi 'superseded' (riwayat) — hanya tampilkan versi yang masih
  // hidup (berlaku sekarang ATAU pending berlaku bulan berikutnya). includeSuperseded=true
  // untuk melihat seluruh riwayat versi.
  async list(
    year?: string,
    kmType?: string,
    includeSuperseded = false,
    currentPage?: number,
    perPage?: number,
  ) {
    const activePeriod = await this.prisma.period.findFirst({
      where: { isActive: true },
    });

    const where = {
      ...(year ? { year } : {}),
      ...(kmType ? { kmType } : {}),
      ...(includeSuperseded ? {} : { status: { not: "superseded" } }),
    };

    const include = {
      assignments: {
        orderBy: [{ unitCode: "asc" as const }, { bidang: "asc" as const }],
      },
    };

    if (!currentPage && !perPage) {
      const master = await this.prisma.kpiMaster.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
      });
      const withFlags = master.map((m) =>
        this.withVersionFlags(m, activePeriod?.yearMonth),
      );
      return this.attachAssignmentStatuses(withFlags);
    }

    const page = currentPage ?? 1;
    const limit = perPage ?? 20;
    const skip = (page - 1) * limit;
    const [masters, totalData] = await Promise.all([
      this.prisma.kpiMaster.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.kpiMaster.count({ where }),
    ]);
    const withFlags = masters.map((m) =>
      this.withVersionFlags(m, activePeriod?.yearMonth),
    );

    return {
      data: await this.attachAssignmentStatuses(withFlags),
      pagination: {
        currentPage: page,
        perPage: limit,
        totalData,
        totalPage: Math.ceil(totalData / limit),
      },
    };
  }

  // Sinkronisasi status dokumen KM ke tiap assignment untuk view list(). Satu KpiAssignment
  // (unit,bidang) tak punya FK langsung ke KontrakManajemen — hubungannya hanya lewat
  // kpiItems[].masterKpiId di dalam dokumen yang cocok (periodId + kmType + unitCode + bidang),
  // sama seperti pola pencarian di getPerKpiReview()/getRollup(). Dibatch (bukan query per
  // assignment) supaya list() tetap O(1) query tambahan terlepas dari jumlah master/assignment.
  // Nilai status: 'draft' | 'submitted' | 'ready' | 'approved' | 'rejected' | 'none'
  // ('none' = belum ada dokumen KM untuk kombinasi unit/bidang/periode/kmType ini).
  // reviewNote & step ikut disalin dari dokumen yang sama (label langkah berjalan/terakhir —
  // sama pola dengan stepLabel di InputKontrakService.getReviewList()) — null bila status 'none'.
  private async attachAssignmentStatuses<
    T extends {
      id: string;
      kmType: string;
      effectiveMonth: string;
      previousVersionId?: string | null;
      assignments: Array<
        Record<string, unknown> & { unitCode: string; bidang: string }
      >;
    },
  >(masters: T[]): Promise<T[]> {
    const emptyInfo = {
      status: "none",
      reviewNote: null,
      reviewer: null,
      updatedAt: new Date(0),
    } as const;
    if (masters.length === 0) return masters;

    const STATUS_PRIORITY: Record<string, number> = {
      rejected: 0,
      revised: 0,
      submitted: 1,
      ready: 2,
      approved: 3,
      draft: 4,
      none: 5,
    };

    // ini — dibatasi hops utk jaga-jaga siklus data yang tak terduga.
    const ancestorIds = new Set<string>();
    {
      const queue = masters
        .map((m) => m.previousVersionId)
        .filter((id): id is string => !!id);
      const seen = new Set(queue);
      let hops = 0;
      while (queue.length > 0 && hops < 200) {
        const id = queue.shift()!;
        ancestorIds.add(id);
        const anc = await this.prisma.kpiMaster.findUnique({
          where: { id },
          select: { previousVersionId: true },
        });
        if (anc?.previousVersionId && !seen.has(anc.previousVersionId)) {
          seen.add(anc.previousVersionId);
          queue.push(anc.previousVersionId);
        }
        hops++;
      }
    }
    const ancestorMasters = ancestorIds.size
      ? await this.prisma.kpiMaster.findMany({
          where: { id: { in: [...ancestorIds] } },
          include: {
            assignments: {
              orderBy: [{ unitCode: "asc" }, { bidang: "asc" }],
            },
          },
        })
      : [];

    // Gabungan current masters + ancestor masters — dipakai bersama utk resolve periodId
    // (tiap versi punya effectiveMonth sendiri) & mencari dokumen yang relevan.
    const allForLookup = [...masters, ...(ancestorMasters as unknown as T[])];

    const yearMonths = [...new Set(allForLookup.map((m) => m.effectiveMonth))];
    const periods = await this.prisma.period.findMany({
      where: { yearMonth: { in: yearMonths } },
    });
    const periodIdByYearMonth = new Map(
      periods.map((p) => [p.yearMonth, p.id]),
    );
    const periodIds = periods.map((p) => p.id);

    if (periodIds.length === 0) {
      return masters.map((m) => ({
        ...m,
        assignments: m.assignments.map((a) => ({ ...a, ...emptyInfo })),
      }));
    }

    const kmTypes = [...new Set(allForLookup.map((m) => m.kmType))];

    // Satu query untuk semua dokumen relevan, diurutkan terbaru dulu — pengisian Map di
    // bawah pakai "first write wins" sehingga otomatis mengambil status paling mutakhir
    // (mengakomodasi kasus 1 assignment punya >1 dokumen: submitted lama + draft baru,
    // lihat catatan di fanOut()).
    const docs = await this.prisma.kontrakManajemen.findMany({
      where: { periodId: { in: periodIds }, kmType: { in: kmTypes } },
      select: {
        periodId: true,
        kmType: true,
        unitCode: true,
        bidang: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        steps: true,
        updatedAt: true,
        currentStepIndex: true,
        kpiItems: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    type AssignmentDocInfo = {
      status: string;
      reviewNote: string | null;
      reviewer: string | null;
      updatedAt: Date;
    };

    type PrimaryDocInfo = AssignmentDocInfo & { updatedAt: Date };
    const infoByMasterKey = new Map<string, AssignmentDocInfo>();

    for (const doc of docs) {
      const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<
        string,
        unknown
      >[];
      if (items.length === 0) continue;
      const steps = (Array.isArray(doc.steps) ? doc.steps : []) as Array<
        Record<string, unknown>
      >;
      // Klem index ke batas array — dokumen 'ready'/'approved' punya currentStepIndex ===
      // steps.length (chain selesai), sehingga step terakhir yang dilewati lebih informatif
      // daripada undefined.
      const stepIdx = Math.min(
        Math.max(doc.currentStepIndex, 0),
        Math.max(steps.length - 1, 0),
      );
      const stepLabel =
        typeof steps[stepIdx]?.["label"] === "string"
          ? (steps[stepIdx]["label"] as string)
          : null;
      const reviewedAtMs = doc.reviewedAt ? doc.reviewedAt.getTime() : 0;
      for (const it of items) {
        const masterId = it["masterKpiId"];
        if (typeof masterId !== "string") continue;

        // Gating per-item hanya relevan utk dokumen yang sedang dalam alur revisi
        // ('rejected'/'revised') — status lain berlaku apa adanya ke semua item.
        let itemStatus = doc.status;
        if (doc.status === "rejected" || doc.status === "revised") {
          const revisedAt = it["revisedAt"];
          const isRevised =
            typeof revisedAt === "string" &&
            new Date(revisedAt).getTime() > reviewedAtMs;
          itemStatus = isRevised ? "draft" : "rejected";
        }

        const key = `${masterId}|${doc.periodId}|${doc.kmType}|${doc.unitCode}|${doc.bidang}`;
        const candidate: PrimaryDocInfo = {
          status: itemStatus,
          reviewNote: doc.reviewNote ?? null,
          reviewer: stepLabel,
          updatedAt: doc.updatedAt,
        };
        const candidatePriority = STATUS_PRIORITY[itemStatus] ?? 99;
        const existing = infoByMasterKey.get(key);
        const currentPriority = existing
          ? (STATUS_PRIORITY[existing.status] ?? 99)
          : Infinity;
        // Prioritas lebih rendah menang; seri prioritas → dokumen ter-update lebih baru menang.
        // Perbandingan eksplisit (bukan cuma andalkan orderBy) supaya urutan iterasi docs tak
        // memengaruhi hasil akhir.
        if (
          !existing ||
          candidatePriority < currentPriority ||
          (candidatePriority === currentPriority &&
            candidate.updatedAt > existing.updatedAt)
        ) {
          infoByMasterKey.set(key, candidate);
        }
      }
    }

    const masterById = new Map(allForLookup.map((m) => [m.id, m]));
    const getInfo = (
      masterId: string,
      unitCode: string,
      bidang: string,
    ): AssignmentDocInfo | undefined => {
      const master = masterById.get(masterId);
      if (!master) return undefined;
      const periodId = periodIdByYearMonth.get(master.effectiveMonth);
      if (!periodId) return undefined;
      return infoByMasterKey.get(
        `${masterId}|${periodId}|${master.kmType}|${unitCode}|${bidang}`,
      );
    };

    return masters.map((m) => ({
      ...m,
      assignments: m.assignments.map((a) => {
        const own = getInfo(m.id, a.unitCode, a.bidang) ?? emptyInfo;
        // Susuri rantai versi lama mencari status paling mendesak utk (unitCode,bidang)
        // yang sama — assignment versi baru yang tampak 'draft' bersih semestinya tetap
        // menampilkan isu yang belum selesai dari versi sebelumnya (mis. 'rejected').
        let best: AssignmentDocInfo = own;
        let ancestorId = m.previousVersionId ?? null;
        let hops = 0;
        while (ancestorId && hops < 20) {
          const ancInfo = getInfo(ancestorId, a.unitCode, a.bidang);
          if (
            ancInfo &&
            (STATUS_PRIORITY[ancInfo.status] ?? 99) <
              (STATUS_PRIORITY[best.status] ?? 99)
          ) {
            best = ancInfo;
          }
          const anc = masterById.get(ancestorId);
          ancestorId = anc?.previousVersionId ?? null;
          hops++;
        }
        return { ...a, ...best };
      }),
    }));
  }

  private withVersionFlags<
    T extends { effectiveMonth: string; status: string },
  >(m: T, activeYearMonth?: string) {
    const isPending = !!activeYearMonth && m.effectiveMonth > activeYearMonth;
    return { ...m, isPending, isCurrent: m.status === "active" && !isPending };
  }

  // Default reviewer untuk pre-fill picker submit dokumen KM. Prioritas (Kombinasi A+B):
  //   1. Slot per-assignment (reviewerSlots) yang cocok (masterKpiId, unitCode, bidang) dokumen —
  //      slot peran di-resolve ke orang di-scope unit/bidang assignment; slot ber-userId = override.
  //   2. Fallback: default reviewer master-level (defaultCheckerIds/defaultApproverId) dari
  //      masterKpiId pertama dokumen (perilaku lama).
  // Return kontrak tetap { checkerIds, approverId } (userId konkret) — hilir tak berubah.
  async getDefaultsForKm(kmId: string) {
    const km = await this.prisma.kontrakManajemen.findUnique({
      where: { id: kmId },
    });
    if (!km)
      return { checkerIds: [] as string[], approverId: null as string | null };

    const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<
      string,
      unknown
    >[];
    const masterIds = items
      .map((it) => it["masterKpiId"])
      .filter((v): v is string => typeof v === "string");
    if (masterIds.length === 0) return { checkerIds: [], approverId: null };

    // (1) Cari assignment (unit,bidang) dokumen yang punya reviewerSlots terisi.
    const assignments = await this.prisma.kpiAssignment.findMany({
      where: {
        kpiMasterId: { in: masterIds },
        unitCode: km.unitCode,
        bidang: km.bidang,
      },
    });
    const withSlots = assignments.find(
      (a) => this.parseReviewerSlots(a.reviewerSlots) !== null,
    );
    if (withSlots) {
      const resolved = await this.resolveReviewerSlots(
        km.unitCode,
        km.bidang,
        this.parseReviewerSlots(withSlots.reviewerSlots)!,
      );
      if (resolved.checkerIds.length > 0 && resolved.approverId)
        return resolved;
      // Hasil tak lengkap (mis. peran tak ketemu orang) → jatuh ke fallback master-level.
    }

    // (2) Fallback master-level dari masterKpiId pertama.
    const master = await this.prisma.kpiMaster.findUnique({
      where: { id: masterIds[0] },
    });
    if (!master) return { checkerIds: [], approverId: null };
    return {
      checkerIds: master.defaultCheckerIds,
      approverId: master.defaultApproverId,
    };
  }

  private parseReviewerSlots(raw: unknown): ReviewerSlots | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as { checkers?: unknown; approver?: unknown };
    const cleanSlot = (s: unknown): ReviewerSlot | null => {
      if (!s || typeof s !== "object") return null;
      const slot = s as { role?: unknown; userId?: unknown };
      if (typeof slot.role !== "string") return null;
      const out: ReviewerSlot = { role: slot.role as ReviewerSlot["role"] };
      if (typeof slot.userId === "string" && slot.userId.trim())
        out.userId = slot.userId.trim();
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
  private sanitizeSubIndicators(
    input: unknown,
    aggregationMethod: "weighted" | "sum",
  ): SubIndicatorInput[] | null {
    if (!Array.isArray(input) || input.length === 0) return null;
    const seen = new Set<string>();
    const out: SubIndicatorInput[] = [];
    for (const raw of input) {
      const r = raw as Record<string, unknown>;
      const nama = String(r?.nama ?? "").trim();
      if (!nama)
        throw new BadRequestException("Nama sub-indikator wajib diisi");
      if (seen.has(nama))
        throw new BadRequestException(`Sub-indikator "${nama}" terpilih ganda`);
      seen.add(nama);
      const bobotStr = String(r?.bobot ?? "").trim();
      const bobotNum = Number(bobotStr.replace(",", "."));
      if (aggregationMethod === "sum") {
        if (!Number.isFinite(bobotNum) || bobotNum >= 0)
          throw new BadRequestException(
            `Max penalti sub-indikator "${nama}" harus angka negatif (mis. -3)`,
          );
      } else if (!Number.isFinite(bobotNum) || bobotNum <= 0) {
        throw new BadRequestException(
          `Bobot sub-indikator "${nama}" harus angka > 0`,
        );
      }
      const target = String(r?.target ?? "").trim();
      if (!target)
        throw new BadRequestException(
          `Target sub-indikator "${nama}" wajib diisi`,
        );
      const polaritas =
        r?.polaritas === "negative"
          ? "negative"
          : r?.polaritas === "positive"
            ? "positive"
            : undefined;
      out.push({
        nama,
        satuan: String(r?.satuan ?? ""),
        bobot: bobotStr,
        target,
        target2: String(r?.target2 ?? "") || undefined,
        formula: String(r?.formula ?? "") || undefined,
        polaritas,
      });
    }
    return out;
  }

  // Override target sub-indikator per assignment (KPI Komposit) — array sejajar index dgn
  // subIndicators template. Beda dgn sanitizeSubIndicators: TIDAK ada validasi "wajib diisi",
  // sebab kosong justru berarti "warisi target template global" (lihat catatan di fanOut()).
  // Hasil selalu sepanjang subCount (elemen tak diisi/tak ada → string kosong).
  private sanitizeSubIndicatorTargets(
    input: unknown,
    subCount: number,
  ): Array<{ target: string; target2: string }> | null {
    if (subCount === 0) return null;
    const arr = Array.isArray(input) ? input : [];
    const out: Array<{ target: string; target2: string }> = [];
    for (let i = 0; i < subCount; i++) {
      const r = (arr[i] ?? {}) as Record<string, unknown>;
      out.push({
        target: String(r?.target ?? "").trim(),
        target2: String(r?.target2 ?? "").trim(),
      });
    }
    return out;
  }

  // Resolusi slot peran → userId konkret, di-scope ke (unitCode,bidang) dokumen.
  // Aturan scoping: UPMK (unit≠KP) diidentifikasi by (role,unit) TANPA bidang (user UPMK
  // bidang=null); KP sertakan bidang. Approver SRMANAJER selalu di KP per-bidang; GM tunggal.
  // Slot ber-userId = override langsung. Tiap slot ambil satu orang deterministik (first).
  private async resolveReviewerSlots(
    unitCode: string,
    bidang: string,
    slots: ReviewerSlots,
  ) {
    const resolveOne = async (
      slot: ReviewerSlot,
      kind: "checker" | "approver",
    ): Promise<User | null> => {
      const role = slot.role as Role;
      const allowed = kind === "checker" ? CHECKER_ROLES : APPROVER_ROLES;
      if (!allowed.includes(role)) return null;
      if (slot.userId) {
        const u = await this.prisma.user.findFirst({
          where: stepRecipientWhere({ role, userId: slot.userId, label: "" }),
        });
        return u && allowed.includes(u.role) ? u : null;
      }
      // Slot peran (B): scope by unit; KP tambah bidang; approver SM selalu KP per-bidang.
      const where =
        kind === "approver"
          ? role === Role.GM
            ? stepRecipientWhere({ role, label: "" })
            : stepRecipientWhere({ role, unit: "KP", bidang, label: "" })
          : unitCode === "KP"
            ? stepRecipientWhere({ role, unit: "KP", bidang, label: "" })
            : stepRecipientWhere({ role, unit: unitCode, label: "" });
      return this.prisma.user.findFirst({ where, orderBy: { name: "asc" } });
    };

    const checkerIds: string[] = [];
    const seen = new Set<string>();
    for (const slot of slots.checkers) {
      const u = await resolveOne(slot, "checker");
      if (u && !seen.has(u.id)) {
        checkerIds.push(u.id);
        seen.add(u.id);
      }
    }
    let approverId: string | null = null;
    if (slots.approver) {
      const u = await resolveOne(slots.approver, "approver");
      if (u && !seen.has(u.id)) approverId = u.id;
    }
    return { checkerIds, approverId };
  }

  async getById(id: string) {
    const m = await this.prisma.kpiMaster.findUnique({
      where: { id },
      include: {
        assignments: { orderBy: [{ unitCode: "asc" }, { bidang: "asc" }] },
      },
    });
    if (!m) throw new NotFoundException("KPI master tidak ditemukan");
    const activePeriod = await this.prisma.period.findFirst({
      where: { isActive: true },
    });
    return this.withVersionFlags(m, activePeriod?.yearMonth);
  }

  // Sinkronkan perubahan definisi KpiMaster ke SELURUH dokumen KM yang memuat item ber-
  // masterKpiId ini — lintas status (draft/submitted/ready/approved/rejected), sebab field-field
  // ini metadata definisi bersama, bukan bagian dari alur review per-dokumen. Hanya field yang
  // disertakan di itemPatch yang ditulis ulang; field lain pada item (target/holder/bobot yang
  // tak disertakan, dst.) tidak disentuh.
  private async syncMasterFieldsAcrossDocuments(
    masterId: string,
    kmType: string,
    itemPatch: MasterDerivedItemPatch,
  ): Promise<number> {
    if (Object.keys(itemPatch).length === 0) return 0;
    const docs = await this.prisma.kontrakManajemen.findMany({
      where: { kmType },
    });
    let updated = 0;
    for (const doc of docs) {
      const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<
        string,
        unknown
      >[];
      let changed = false;
      const next = items.map((it) => {
        if (it["masterKpiId"] !== masterId) return it;
        const patchedFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(itemPatch)) {
          if (it[k] !== v) {
            patchedFields[k] = v;
            changed = true;
          }
        }
        return Object.keys(patchedFields).length
          ? { ...it, ...patchedFields }
          : it;
      });
      if (changed) {
        await this.prisma.kontrakManajemen.update({
          where: { id: doc.id },
          data: { kpiItems: next as object },
        });
        updated++;
      }
    }
    return updated;
  }

  // Terapkan revisi ke SATU assignment + dokumen KM 'rejected'-nya. Dipanggil sekali per
  // assignment (utama maupun tiap otherAssignments) — logikanya identik, hanya scoping dokumen
  // (unitCode/bidang) yang beda per assignment. Nama indikator TIDAK ditangani di sini (sudah
  // disinkronkan terpisah oleh syncIndikatorAcrossDocuments sebelum loop ini berjalan).
  private async reviseOneAssignmentDocument(
    user: User,
    assignment: { id: string; unitCode: string; bidang: string },
    master: { id: string; kmType: string; indikator: string },
    period: { id: string },
    patch: ReviseAssignmentPatch,
  ) {
    const doc = await this.prisma.kontrakManajemen.findFirst({
      where: {
        periodId: period.id,
        unitCode: assignment.unitCode,
        bidang: assignment.bidang,
        kmType: master.kmType,
        status: "rejected",
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!doc)
      throw new BadRequestException(
        `Tidak ada dokumen KM berstatus 'Dikembalikan' untuk assignment ${assignment.unitCode} — ${assignment.bidang}`,
      );
    const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<
      string,
      unknown
    >[];
    const idx = items.findIndex((it) => it["masterKpiId"] === master.id);
    if (idx < 0)
      throw new BadRequestException(
        `Item KPI "${master.indikator}" tidak ditemukan pada dokumen KM ${assignment.unitCode} — ${assignment.bidang} yang ditolak`,
      );

    const updatedAssignment = await this.prisma.kpiAssignment.update({
      where: { id: assignment.id },
      data: {
        ...(patch.holder !== undefined ? { holder: patch.holder } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.target2 !== undefined ? { target2: patch.target2 } : {}),
        ...(patch.persenAgregasi !== undefined
          ? { persenAgregasi: Number(patch.persenAgregasi) || 0 }
          : {}),
      },
    });

    const nextItems = [...items];
    const nowIso = new Date().toISOString();
    nextItems[idx] = {
      ...nextItems[idx],
      target: updatedAssignment.target,
      target2: updatedAssignment.target2,
      holder: updatedAssignment.holder,
      revisedAt: nowIso,
    };

    const reviewedAtMs = doc.reviewedAt ? doc.reviewedAt.getTime() : 0;
    const itemsWithMaster = nextItems.filter(
      (it) => typeof it["masterKpiId"] === "string",
    );
    const revisedSet = new Set<string>();
    for (const it of itemsWithMaster) {
      const revisedAt = it["revisedAt"];
      if (
        typeof revisedAt === "string" &&
        new Date(revisedAt).getTime() > reviewedAtMs
      ) {
        revisedSet.add(String(it["masterKpiId"]));
      }
    }
    const totalTrackedItems = itemsWithMaster.length;
    const revisedCount = revisedSet.size;
    const allItemsRevised =
      totalTrackedItems === 0 || revisedCount === totalTrackedItems;

    const history = [
      ...(Array.isArray(doc.history) ? (doc.history as object[]) : []),
      allItemsRevised
        ? {
            stepIndex: 0,
            actor: user.name,
            role: user.role,
            action: "revised_after_reject",
            note: `Seluruh ${totalTrackedItems} indikator KPI pada dokumen ini telah direvisi — dikembalikan ke draft`,
            ts: nowIso,
          }
        : {
            stepIndex: 0,
            actor: user.name,
            role: user.role,
            action: "revised_item_after_reject",
            note: `Indikator KPI "${master.indikator}" direvisi (${revisedCount}/${totalTrackedItems} indikator KPI pada dokumen ini sudah direvisi) — dokumen masih menunggu revisi indikator lain sebelum dapat dikirim ulang`,
            ts: nowIso,
          },
    ];

    const updatedDoc = await this.prisma.kontrakManajemen.update({
      where: { id: doc.id },
      data: {
        kpiItems: nextItems as object,
        ...(allItemsRevised
          ? {
              status: "draft",
              reviewer: null,
              reviewNote: null,
              reviewedAt: null,
              currentStepIndex: 0,
              currentStage: 0,
            }
          : {}),
        ...(patch.holder && allItemsRevised ? { holder: patch.holder } : {}),
        history,
      },
    });

    return {
      assignmentId: assignment.id,
      unitCode: assignment.unitCode,
      bidang: assignment.bidang,
      document: updatedDoc,
      allItemsRevised,
      revisedCount,
      totalItems: totalTrackedItems,
    };
  }

  // ===== Revisi cepat 1 assignment yang dokumen KM-nya baru saja DITOLAK reviewer =====
  // Dipisah dari save() dengan sengaja:
  //   - save() selalu mengedit definisi PENUH (indikator/formula/satuan/bobot/polaritas) &
  //     — untuk master yang sudah berlaku — membuat VERSI BARU yang fan-out ke periode
  //     BERIKUTNYA (lihat catatan Versioning di save()). Itu bukan yang dibutuhkan di sini:
  //     dokumen yang ditolak ada di periode BERJALAN & harus diperbaiki DI TEMPAT, bukan
  //     dibuatkan versi baru bulan depan.
  //   - fanOut() (dipakai save()) hanya mencari dokumen existing berstatus 'draft' saat
  //     menyisipkan/memperbarui item — dokumen berstatus 'rejected' tidak match, sehingga
  //     fanOut akan membuat dokumen BARU (findFirst → null → create) alih-alih memperbaiki
  //     dokumen yang ditolak → muncul 2 dokumen utk (unit,bidang) yang sama. Method ini
  //     mencari & meng-update dokumen 'rejected' itu langsung, lalu mengembalikannya ke
  //     'draft' agar siap dikirim ulang — TANPA menyentuh assignment/dokumen lain.
  // Field yang boleh diubah SENGAJA dibatasi ke holder/target/target2/persenAgregasi —
  // definisi item (formula/satuan/bobot/polaritas/subIndicators) tetap warisan dari master,
  // TIDAK di-refan di sini (beda dgn fanOut() yang selalu menulis ulang definisi penuh).
  async reviseRejectedAssignment(
    user: User,
    assignmentId: string,
    patch: ReviseRejectedAssignmentInput,
  ) {
    const isAdminOverride =
      user.role === Role.GM ||
      user.role === Role.SUPERADMIN ||
      user.role === Role.DEVELOPER;
    const isRpc = user.unit === "KP" && user.bidang === RPC_BIDANG;
    if (!isAdminOverride && !isRpc) {
      throw new ForbiddenException(
        "Hanya Perencanaan & Project Control (RPC), GM, atau Admin yang dapat merevisi assignment KM",
      );
    }
    if (patch.indikator !== undefined && !patch.indikator.trim())
      throw new BadRequestException("Nama indikator wajib diisi");

    const assignment = await this.prisma.kpiAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException("Assignment tidak ditemukan");
    let master = await this.prisma.kpiMaster.findUnique({
      where: { id: assignment.kpiMasterId },
    });
    if (!master) throw new NotFoundException("KPI master tidak ditemukan");
    if (master.status === "superseded")
      throw new BadRequestException(
        "Versi KPI ini sudah digantikan versi yang lebih baru — assignment ini tidak dapat direvisi",
      );

    const period = await this.prisma.period.findUnique({
      where: { yearMonth: master.effectiveMonth },
    });
    if (!period)
      throw new BadRequestException(
        `Periode ${master.effectiveMonth} tidak ditemukan`,
      );

    // ===== Validasi & siapkan rebalancing bobot agregasi assignment lain (opsional) =====
    // Scoped ketat ke master ini — id yang bukan milik KPI Master yang sama ditolak langsung,
    // supaya satu panggilan revise tidak bisa diam-diam mengubah bobot KPI lain.
    const otherPatches = patch.otherAssignments ?? [];
    const otherIds = otherPatches.map((o) => o.id);
    if (new Set(otherIds).size !== otherIds.length)
      throw new BadRequestException(
        "otherAssignments memuat id assignment duplikat",
      );
    if (otherIds.includes(assignment.id))
      throw new BadRequestException(
        "otherAssignments tidak boleh menyertakan assignment yang sedang direvisi — gunakan field utama",
      );

    let otherAssignmentRows: (typeof assignment)[] = [];
    if (otherIds.length > 0) {
      const rows = await this.prisma.kpiAssignment.findMany({
        where: { id: { in: otherIds } },
      });
      if (rows.length !== otherIds.length)
        throw new BadRequestException(
          "Salah satu assignment pada otherAssignments tidak ditemukan",
        );
      const foreign = rows.find((r) => r.kpiMasterId !== master!.id);
      if (foreign)
        throw new BadRequestException(
          "Semua otherAssignments harus berada pada KPI Master yang sama",
        );
      otherAssignmentRows = otherIds.map(
        (id) => rows.find((r) => r.id === id)!,
      );
    }

    const requireTarget = (t: string | undefined, label: string) => {
      if (t !== undefined && !t.trim())
        throw new BadRequestException(`Target Sem I wajib diisi (${label})`);
    };
    requireTarget(
      patch.target,
      `${assignment.unitCode} — ${assignment.bidang}`,
    );
    for (const o of otherPatches) {
      const row = otherAssignmentRows.find((r) => r.id === o.id)!;
      requireTarget(o.target, `${row.unitCode} — ${row.bidang}`);
      if (
        o.persenAgregasi !== undefined &&
        !Number.isFinite(Number(o.persenAgregasi))
      )
        throw new BadRequestException(
          "Bobot agregasi pada otherAssignments harus berupa angka",
        );
    }

    // ===== Validasi field definisi KPI Master (opsional) — SHARED lintas semua assignment. =====
    if (patch.kmType !== undefined && patch.kmType !== master.kmType) {
      throw new BadRequestException(
        "kmType tidak dapat diubah lewat revisi — Draft dan Final adalah registri dokumen yang independen. Untuk memindahkan KPI ke jenis dokumen lain, buat ulang lewat menu KPI Master.",
      );
    }

    if (
      patch.polaritas !== undefined &&
      patch.polaritas !== "positive" &&
      patch.polaritas !== "negative"
    )
      throw new BadRequestException(
        "Polaritas harus 'positive' atau 'negative'",
      );

    const isComposite =
      Array.isArray(master.subIndicators) &&
      (master.subIndicators as unknown[]).length > 0;

    if (patch.bobotKm !== undefined && isComposite)
      throw new BadRequestException(
        "Bobot KM (poin) KPI komposit diturunkan otomatis dari total bobot sub-indikator — ubah lewat edit KPI Master (Sub-Indikator), bukan lewat revisi",
      );

    const nextAggregationMethod =
      patch.aggregationMethod === "sum" ||
      patch.aggregationMethod === "weighted"
        ? patch.aggregationMethod
        : undefined;

    if (
      nextAggregationMethod &&
      nextAggregationMethod !== master.aggregationMethod
    ) {
      // KPI komposit: tanda bobot tiap sub-indikator harus konsisten dgn metode baru (lihat
      // sanitizeSubIndicators — 'sum' = penalti/negatif, 'weighted' = poin/positif). Cegah
      // pindah metode di sini bila akan membuat data sub-indikator existing tak konsisten;
      // arahkan ke edit KPI Master penuh agar sub-indikator ikut disesuaikan.
      if (isComposite) {
        const subs = master.subIndicators as unknown as Array<{
          nama: string;
          bobot: string;
        }>;
        for (const si of subs) {
          const n = Number(String(si.bobot).replace(",", "."));
          if (nextAggregationMethod === "sum" && !(n < 0))
            throw new BadRequestException(
              `Tidak dapat pindah ke metode 'sum' — sub-indikator "${si.nama}" masih bertanda positif; sesuaikan bobot sub-indikator lebih dulu lewat edit KPI Master`,
            );
          if (nextAggregationMethod === "weighted" && !(n > 0))
            throw new BadRequestException(
              `Tidak dapat pindah ke metode 'weighted' — sub-indikator "${si.nama}" masih bertanda negatif; sesuaikan bobot sub-indikator lebih dulu lewat edit KPI Master`,
            );
        }
      }
    }

    // Total 100% (metode weighted, >1 assignment) dihitung dari: nilai BARU assignment yang
    // direvisi + nilai BARU tiap otherAssignments yang dikirim, digabung dengan nilai EXISTING
    // assignment lain milik master ini yang tidak ikut dikirim. Pakai metode agregasi BARU
    // (bila ikut diubah di payload ini) supaya validasi konsisten dgn hasil akhir.
    const effectiveAggregationMethod =
      nextAggregationMethod ?? master.aggregationMethod;
    if (effectiveAggregationMethod !== "sum") {
      const allAssignments = await this.prisma.kpiAssignment.findMany({
        where: { kpiMasterId: master.id },
      });
      if (allAssignments.length > 1) {
        const newPersenById = new Map<string, number>();
        newPersenById.set(
          assignment.id,
          patch.persenAgregasi !== undefined
            ? Number(patch.persenAgregasi) || 0
            : assignment.persenAgregasi,
        );
        for (const o of otherPatches)
          newPersenById.set(o.id, Number(o.persenAgregasi) || 0);
        const total = allAssignments.reduce(
          (s, a) => s + (newPersenById.get(a.id) ?? a.persenAgregasi),
          0,
        );
        if (Math.abs(total - 100) > 0.01)
          throw new BadRequestException(
            `Total bobot agregasi seluruh assignment harus 100%, saat ini ${Math.round(total * 100) / 100}%`,
          );
      }
    }

    // ===== Terapkan perubahan definisi KpiMaster (opsional) — SEBELUM memproses per-dokumen,
    // supaya dokumen yang dibaca berikutnya (termasuk yang direvisi di payload ini) sudah
    // memuat definisi terbaru. targetParent & kmType TIDAK disinkron ke item (lihat
    // MasterDerivedItemPatch); kmType sudah ditolak di atas bila berbeda. =====
    const newIndikator = patch.indikator?.trim();
    const masterUpdateData: Record<string, unknown> = {};
    if (newIndikator && newIndikator !== master.indikator)
      masterUpdateData.indikator = newIndikator;
    if (patch.formula !== undefined && patch.formula !== master.formula)
      masterUpdateData.formula = patch.formula;
    if (patch.satuan !== undefined && patch.satuan !== master.satuan)
      masterUpdateData.satuan = patch.satuan;
    if (patch.polaritas !== undefined && patch.polaritas !== master.polaritas)
      masterUpdateData.polaritas = patch.polaritas;
    if (patch.bobotKm !== undefined && patch.bobotKm !== master.bobotKm)
      masterUpdateData.bobotKm = patch.bobotKm;
    if (
      patch.targetParent !== undefined &&
      patch.targetParent !== master.targetParent
    )
      masterUpdateData.targetParent = patch.targetParent;
    if (
      nextAggregationMethod &&
      nextAggregationMethod !== master.aggregationMethod
    )
      masterUpdateData.aggregationMethod = nextAggregationMethod;

    let syncedDocsCount = 0;
    if (Object.keys(masterUpdateData).length > 0) {
      master = await this.prisma.kpiMaster.update({
        where: { id: master.id },
        data: masterUpdateData,
      });

      const itemPatch: MasterDerivedItemPatch = {};
      if (masterUpdateData.indikator !== undefined)
        itemPatch.indikator = master.indikator;
      if (masterUpdateData.formula !== undefined)
        itemPatch.formula = master.formula;
      if (masterUpdateData.satuan !== undefined)
        itemPatch.satuan = master.satuan;
      if (masterUpdateData.polaritas !== undefined)
        itemPatch.polaritas = master.polaritas;
      if (masterUpdateData.bobotKm !== undefined)
        itemPatch.bobot = master.bobotKm;

      syncedDocsCount = await this.syncMasterFieldsAcrossDocuments(
        master.id,
        master.kmType,
        itemPatch,
      );
    }

    // ===== Terapkan revisi (holder/target/target2/persenAgregasi) ke SETIAP assignment yang
    // dikirim (utama + otherAssignments) — tiap satu punya dokumen KM 'rejected' sendiri
    // (unitCode/bidang berbeda), diproses independen supaya SEMUA ikut ter-update. =====
    const targets = [
      { assignment: assignment, patch },
      ...otherPatches.map((o) => ({
        assignment: otherAssignmentRows.find((r) => r.id === o.id)!,
        patch: o,
      })),
    ];

    const results: Array<{
      assignmentId: string;
      unitCode: string;
      bidang: string;
      document: unknown;
      allItemsRevised: boolean;
      revisedCount: number;
      totalItems: number;
    }> = [];
    const touchedUnitCodes = new Set<string>();

    for (const t of targets) {
      const r = await this.reviseOneAssignmentDocument(
        user,
        t.assignment,
        master,
        period,
        t.patch,
      );
      results.push(r);
      touchedUnitCodes.add(t.assignment.unitCode);
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: "kpi_master.assignment_revise",
        entity: "KpiAssignment",
        targetId: assignment.id,
        note:
          `Assignment KPI "${master.indikator}" direvisi pada ${targets.length} unit/bidang (${targets
            .map((t) => `${t.assignment.unitCode} — ${t.assignment.bidang}`)
            .join(", ")})` +
          (Object.keys(masterUpdateData).length > 0
            ? `; definisi diubah: ${Object.keys(masterUpdateData).join(", ")}${
                syncedDocsCount > 0
                  ? ` (disinkronkan ke ${syncedDocsCount} dokumen KM)`
                  : ""
              }`
            : "") +
          (results.every((r) => r.allItemsRevised)
            ? "; seluruh dokumen KM terkait dikembalikan ke draft"
            : "; sebagian dokumen masih menunggu revisi indikator lain"),
      },
    });
    for (const uc of touchedUnitCodes) await this.cache.del(`kontrak:${uc}`);

    return {
      results,
      allDone: results.every((r) => r.allItemsRevised),
      master: {
        indikator: master.indikator,
        formula: master.formula,
        satuan: master.satuan,
        polaritas: master.polaritas,
        bobotKm: master.bobotKm,
        targetParent: master.targetParent,
        aggregationMethod: master.aggregationMethod,
      },
      syncedDocsCount,
    };
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
    if (!period) throw new BadRequestException("Periode tidak ditemukan");

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(
        String(v)
          .replace(",", ".")
          .replace(/[^0-9.-]/g, ""),
      );
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const isSum = master.aggregationMethod === "sum";

    const totalPersen = r2(
      master.assignments.reduce((s, a) => s + a.persenAgregasi, 0),
    );
    let nilaiParent = 0;
    const breakdown: Array<{
      unitCode: string;
      bidang: string;
      persenAgregasi: number;
      realisasi: number | null;
      kontribusi: number;
      hasData: boolean;
    }> = [];

    for (const a of master.assignments) {
      const record = await this.prisma.inputRealisasi.findFirst({
        where: {
          periodId: period.id,
          unitCode: a.unitCode,
          bidang: a.bidang,
          status: "approved",
        },
      });
      const values = (record?.values ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const item = Object.values(values).find(
        (it) => it["masterKpiId"] === master.id,
      );
      const realisasi = item ? num(item["realisasi"]) : null;
      const kontribusi =
        realisasi == null
          ? 0
          : isSum
            ? r2(realisasi)
            : r2((realisasi * a.persenAgregasi) / 100);
      nilaiParent += kontribusi;
      breakdown.push({
        unitCode: a.unitCode,
        bidang: a.bidang,
        persenAgregasi: a.persenAgregasi,
        realisasi,
        kontribusi,
        hasData: realisasi != null,
      });
    }

    return {
      masterId: master.id,
      indikator: master.indikator,
      targetParent: master.targetParent,
      periodId: period.id,
      periodLabel: period.label,
      aggregationMethod: master.aggregationMethod,
      totalPersen,
      nilaiParent: r2(nilaiParent),
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
    if (!period) throw new BadRequestException("Periode tidak ditemukan");

    const activePeriod = await this.prisma.period.findFirst({
      where: { isActive: true },
    });
    const masters = await this.prisma.kpiMaster.findMany({
      where: { status: { not: "superseded" } },
      include: {
        assignments: { orderBy: [{ unitCode: "asc" }, { bidang: "asc" }] },
      },
      orderBy: { createdAt: "desc" },
    });

    // Status konsolidasi (Fase H2) tiap KPI untuk periode ini.
    const reviews = await this.prisma.kpiRollupReview.findMany({
      where: { periodId: period.id },
    });
    const reviewByMaster = new Map(reviews.map((rv) => [rv.kpiMasterId, rv]));

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(
        String(v)
          .replace(",", ".")
          .replace(/[^0-9.-]/g, ""),
      );
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // Hanya KPI bersama (dimiliki >1 bidang) — inti dari lensa konsolidasi lintas-dokumen.
    const shared = masters.filter((m) => m.assignments.length > 1);

    type PerKpiSlice = {
      unitCode: string;
      bidang: string;
      holder: string;
      persenAgregasi: number;
      realisasi: number | null;
      status: string;
      reviewer: string | null;
      isApproved: boolean;
      kontribusi: number;
      hasData: boolean;
    };
    const items: Array<Record<string, unknown>> = [];
    for (const master of shared) {
      const isSum = master.aggregationMethod === "sum";
      const slices: PerKpiSlice[] = [];
      let nilaiParent = 0;
      let approvedCount = 0;

      for (const a of master.assignments) {
        const record = await this.prisma.inputRealisasi.findFirst({
          where: {
            periodId: period.id,
            unitCode: a.unitCode,
            bidang: a.bidang,
          },
          orderBy: { updatedAt: "desc" },
        });
        const values = (record?.values ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const item = Object.values(values).find(
          (it) => it["masterKpiId"] === master.id,
        );
        const realisasi = item ? num(item["realisasi"]) : null;
        const status = record?.status ?? "none";
        const isApproved = status === "approved";
        const kontribusi =
          realisasi == null || !isApproved
            ? 0
            : isSum
              ? r2(realisasi)
              : r2((realisasi * a.persenAgregasi) / 100);
        if (isApproved) {
          nilaiParent += kontribusi;
          approvedCount++;
        }
        slices.push({
          unitCode: a.unitCode,
          bidang: a.bidang,
          holder: a.holder,
          persenAgregasi: a.persenAgregasi,
          realisasi,
          status,
          reviewer: record?.reviewer ?? null,
          isApproved,
          kontribusi,
          hasData: realisasi != null,
        });
      }

      const totalPersen = r2(
        master.assignments.reduce((s, a) => s + a.persenAgregasi, 0),
      );
      const isPending =
        !!activePeriod?.yearMonth &&
        master.effectiveMonth > activePeriod.yearMonth;
      const allApproved = approvedCount === master.assignments.length;
      const rv = reviewByMaster.get(master.id);
      const consolidation = rv
        ? {
            status: rv.status,
            reviewer: rv.reviewer,
            reviewNote: rv.reviewNote,
            nilaiParent: rv.nilaiParent,
            reviewedAt: rv.reviewedAt,
          }
        : null;
      items.push({
        masterId: master.id,
        indikator: master.indikator,
        targetParent: master.targetParent,
        aggregationMethod: master.aggregationMethod,
        kmType: master.kmType,
        version: master.version,
        effectiveMonth: master.effectiveMonth,
        isPending,
        totalAssignments: master.assignments.length,
        approvedCount,
        allApproved,
        totalPersen,
        nilaiParent: r2(nilaiParent),
        isFullyConfigured: isSum || Math.abs(totalPersen - 100) < 0.01,
        // Siap dikonsolidasi bila semua bidang approved & belum ada keputusan 'approved'.
        readyForConsolidation:
          allApproved && consolidation?.status !== "approved",
        consolidation,
        slices,
      });
    }

    return {
      periodId: period.id,
      periodLabel: period.label,
      viewerCanConsolidate: this.isRpcConsolidator(user),
      items,
    };
  }

  // Guard konsolidasi (Fase H2): RPC Perencanaan (Staff/Manajer/SM bidang Perencanaan &
  // Project Control di Kantor Induk) menyetujui agregat; GM & admin sistem diizinkan juga.
  private isRpcConsolidator(user: User): boolean {
    if (
      user.role === Role.GM ||
      user.role === Role.SUPERADMIN ||
      user.role === Role.DEVELOPER
    )
      return true;
    return user.unit === "KP" && user.bidang === RPC_BIDANG;
  }

  // ===== Fase H2: Approval konsolidasi agregat KPI lintas-bidang =====
  // Setelah semua bidang kontributor menyetujui realisasinya, RPC Perencanaan meninjau nilai
  // parent (agregat). approve → kunci snapshot nilaiParent (final). reject → catat + notifikasi
  // ke penyusun realisasi bidang kontributor agar merevisi.
  async reviewConsolidation(
    user: User,
    kpiMasterId: string,
    action: "approve" | "reject",
    note?: string,
    periodId?: string,
  ) {
    if (!this.isRpcConsolidator(user)) {
      throw new ForbiddenException(
        "Hanya RPC Perencanaan atau General Manager yang dapat menyetujui konsolidasi KPI",
      );
    }
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException("Periode tidak ditemukan");

    const master = await this.prisma.kpiMaster.findUnique({
      where: { id: kpiMasterId },
      include: { assignments: true },
    });
    if (!master) throw new NotFoundException("KPI master tidak ditemukan");
    if (master.assignments.length <= 1)
      throw new BadRequestException(
        "KPI ini tidak lintas-bidang — tidak memerlukan konsolidasi",
      );

    const num = (v: unknown): number => {
      if (v == null) return 0;
      const n = parseFloat(
        String(v)
          .replace(",", ".")
          .replace(/[^0-9.-]/g, ""),
      );
      return Number.isFinite(n) ? n : 0;
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const isSum = master.aggregationMethod === "sum";

    // Hitung ulang nilaiParent dari slice approved + kumpulkan penyusun (untuk notifikasi).
    let nilaiParent = 0;
    let approvedCount = 0;
    const contributorSubmitterIds = new Set<string>();
    for (const a of master.assignments) {
      const record = await this.prisma.inputRealisasi.findFirst({
        where: {
          periodId: period.id,
          unitCode: a.unitCode,
          bidang: a.bidang,
          status: "approved",
        },
      });
      if (!record) continue;
      const values = (record.values ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const item = Object.values(values).find(
        (it) => it["masterKpiId"] === master.id,
      );
      if (!item) continue;
      const realisasi = num(item["realisasi"]);
      nilaiParent += isSum
        ? r2(realisasi)
        : r2((realisasi * a.persenAgregasi) / 100);
      approvedCount++;
      if (record.submitterId) contributorSubmitterIds.add(record.submitterId);
    }
    const allApproved = approvedCount === master.assignments.length;

    if (action === "approve") {
      if (!allApproved)
        throw new ForbiddenException(
          "Belum semua bidang kontributor menyetujui realisasinya — konsolidasi belum dapat disetujui",
        );
      const review = await this.prisma.kpiRollupReview.upsert({
        where: { kpiMasterId_periodId: { kpiMasterId, periodId: period.id } },
        update: {
          status: "approved",
          reviewer: user.name,
          reviewerId: user.id,
          reviewNote: note?.trim() || null,
          nilaiParent: r2(nilaiParent),
          reviewedAt: new Date(),
        },
        create: {
          kpiMasterId,
          periodId: period.id,
          status: "approved",
          reviewer: user.name,
          reviewerId: user.id,
          reviewNote: note?.trim() || null,
          nilaiParent: r2(nilaiParent),
          reviewedAt: new Date(),
        },
      });
      await this.prisma.auditLog.create({
        data: {
          actor: user.name,
          userId: user.id,
          action: "kpi_rollup.approve",
          entity: "KpiRollupReview",
          targetId: review.id,
          note: `Konsolidasi KPI "${master.indikator}" periode ${period.label} disetujui — nilai parent final ${r2(nilaiParent)}`,
        },
      });
      return review;
    }

    // reject
    if (!note?.trim())
      throw new BadRequestException("Catatan penolakan wajib diisi");
    const review = await this.prisma.kpiRollupReview.upsert({
      where: { kpiMasterId_periodId: { kpiMasterId, periodId: period.id } },
      update: {
        status: "rejected",
        reviewer: user.name,
        reviewerId: user.id,
        reviewNote: note.trim(),
        nilaiParent: null,
        reviewedAt: new Date(),
      },
      create: {
        kpiMasterId,
        periodId: period.id,
        status: "rejected",
        reviewer: user.name,
        reviewerId: user.id,
        reviewNote: note.trim(),
        nilaiParent: null,
        reviewedAt: new Date(),
      },
    });
    if (contributorSubmitterIds.size > 0) {
      await this.prisma.notification.createMany({
        data: [...contributorSubmitterIds].map((uid) => ({
          userId: uid,
          type: "alert",
          title: "Konsolidasi KPI Ditolak",
          msg: `Konsolidasi "${master.indikator}" periode ${period.label} ditolak RPC Perencanaan: ${note.trim()}`,
          route: "/kpi-master",
          targetId: kpiMasterId,
          unread: true,
        })),
      });
    }
    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: "kpi_rollup.reject",
        entity: "KpiRollupReview",
        targetId: review.id,
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
    const isAdminOverride =
      user.role === Role.GM ||
      user.role === Role.SUPERADMIN ||
      user.role === Role.DEVELOPER;
    const isRpc = user.unit === "KP" && user.bidang === RPC_BIDANG;
    if (!isAdminOverride && !isRpc) {
      throw new ForbiddenException(
        "KPI Master hanya dapat disusun oleh Perencanaan & Project Control (RPC), GM, atau Admin",
      );
    }
    if (!dto.indikator?.trim())
      throw new BadRequestException("Nama indikator wajib diisi");
    if (!Array.isArray(dto.assignments) || dto.assignments.length === 0) {
      throw new BadRequestException(
        "Pilih minimal satu unit/bidang untuk di-assign",
      );
    }
    for (const a of dto.assignments) {
      if (!a.unitCode?.trim() || !a.bidang?.trim())
        throw new BadRequestException(
          "Setiap assignment wajib punya unit & bidang",
        );
    }
    // Cegah duplikat (unit,bidang) dalam satu master.
    const keys = new Set<string>();
    for (const a of dto.assignments) {
      const k = `${a.unitCode}||${a.bidang}`;
      if (keys.has(k))
        throw new BadRequestException(
          `Assignment ganda untuk ${a.unitCode} — ${a.bidang}`,
        );
      keys.add(k);
    }
    // Target wajib diisi — KPI tanpa target diam-diam dilewati dari penilaian (scoreItems di
    // common/capaian.ts, target<=0 → item dilewati) tanpa peringatan. Komposit taruh target di
    // level sub-indikator (divalidasi di sanitizeSubIndicators), bukan di assignment.
    const isCompositeDto =
      Array.isArray(dto.subIndicators) && dto.subIndicators.length > 0;
    if (!isCompositeDto) {
      for (const a of dto.assignments) {
        if (!a.target?.trim())
          throw new BadRequestException(
            `Target Sem I wajib diisi untuk ${a.unitCode} — ${a.bidang}`,
          );
      }
    }
    // Metode agregasi (Fase E) — dipilih per-KPI. 'sum' = jumlah polos tiap kontribusi
    // (KPI penalti/pengurang, tanpa syarat Σ=100%). 'weighted' = rata-rata tertimbang
    // pakai persenAgregasi (Σ=100% wajib bila diisi) — perilaku Fase B, default.
    const aggregationMethod =
      dto.aggregationMethod === "sum" ? "sum" : "weighted";
    if (aggregationMethod === "weighted") {
      // 1 assignment saja → tak ada yang perlu dibagi, paksa 100% (tak bergantung pada apa
      // yang dikirim klien — konsisten dengan default FE, sekaligus jaga-jaga klien lama/API langsung).
      if (dto.assignments.length === 1) {
        dto.assignments[0].persenAgregasi = 100;
      } else {
        const totalPersen = dto.assignments.reduce(
          (s, a) => s + (Number(a.persenAgregasi) || 0),
          0,
        );
        const anyPersenSet = dto.assignments.some(
          (a) => Number(a.persenAgregasi) > 0,
        );
        if (anyPersenSet && Math.abs(totalPersen - 100) > 0.01) {
          throw new BadRequestException(
            `Total bobot agregasi harus 100%, saat ini ${totalPersen}%`,
          );
        }
      }
    }

    // Default alur reviewer (Fase C): opsional — bila diisi, harus resolve ke user aktif
    // dengan role yang sesuai (Checker=ASMAN/Manajer, Approver=SRManajer/GM). Ini hanya
    // DEFAULT untuk mengisi picker submit; submitter tetap bisa mengubahnya.
    const defaultCheckerIds = (dto.defaultCheckerIds ?? []).filter(Boolean);
    const defaultApproverId = dto.defaultApproverId?.trim() || null;
    if (defaultCheckerIds.length > 0 || defaultApproverId) {
      const ids = [
        ...defaultCheckerIds,
        ...(defaultApproverId ? [defaultApproverId] : []),
      ];
      const users = await this.prisma.user.findMany({
        where: { id: { in: ids }, isActive: true },
      });
      for (const cid of defaultCheckerIds) {
        const u = users.find((x) => x.id === cid);
        if (!u || !CHECKER_ROLES.includes(u.role))
          throw new BadRequestException(
            "Default Checker harus user aktif berperan ASMAN/Manajer",
          );
      }
      if (defaultApproverId) {
        const u = users.find((x) => x.id === defaultApproverId);
        if (!u || !APPROVER_ROLES.includes(u.role))
          throw new BadRequestException(
            "Default Approver harus user aktif berperan Sr. Manajer/GM",
          );
      }
    }

    // Validasi reviewerSlots per-assignment (A+B): role token harus valid per jenis; slot
    // ber-override (userId) harus user aktif dengan role sesuai.
    for (const a of dto.assignments) {
      const slots = this.sanitizeReviewerSlots(a.reviewerSlots);
      if (!slots) continue;
      const check = async (
        slot: ReviewerSlot,
        allowed: Role[],
        labelKind: string,
      ) => {
        if (!allowed.includes(slot.role as Role)) {
          throw new BadRequestException(
            `Slot ${labelKind} (${a.unitCode}/${a.bidang}) harus berperan ${allowed.join("/")}`,
          );
        }
        if (slot.userId) {
          const u = await this.prisma.user.findFirst({
            where: { id: slot.userId, isActive: true },
          });
          if (!u || !allowed.includes(u.role))
            throw new BadRequestException(
              `Override ${labelKind} (${a.unitCode}/${a.bidang}) harus user aktif berperan ${allowed.join("/")}`,
            );
        }
      };
      for (const c of slots.checkers) await check(c, CHECKER_ROLES, "Checker");
      if (slots.approver)
        await check(slots.approver, APPROVER_ROLES, "Approver");
    }

    // Sub-indikator (opt-in, generik): non-kosong → KPI ini "komposit". bobotKm (kini data
    // parent di KpiMaster, sama untuk semua assignment) jadi TURUNAN (Σ bobot sub) — override
    // input user.
    const subIndicators = this.sanitizeSubIndicators(
      dto.subIndicators,
      aggregationMethod,
    );
    if (subIndicators) {
      const compositeBobot = subIndicators.reduce(
        (s, si) => s + (Number(String(si.bobot).replace(",", ".")) || 0),
        0,
      );
      dto.bobotKm = String(compositeBobot);
    }
    const subIndicatorsJson = subIndicators
      ? (subIndicators as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    // Polaritas eksplisit indikator induk (non-komposit) — 'positive'|'negative', default
    // 'positive' bila tak dikirim/nilai tak dikenal (lihat resolvePolarity() di common/capaian.ts).
    const polaritas = dto.polaritas === "negative" ? "negative" : "positive";
    // Override target per sub-indikator per assignment (opsional, non-destructive — lihat
    // sanitizeSubIndicatorTargets & fanOut()).
    const subCount = subIndicators?.length ?? 0;
    const subTargetsByAssignment = dto.assignments.map((a) =>
      this.sanitizeSubIndicatorTargets(a.subIndicatorTargets, subCount),
    );

    const activePeriod = await this.prisma.period.findFirst({
      where: { isActive: true },
    });
    if (!activePeriod) throw new BadRequestException("Tidak ada periode aktif");
    const kmType = dto.kmType === "final" ? "final" : "draft";

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
      const existing = await this.prisma.kpiMaster.findUnique({
        where: { id: dto.id },
      });
      if (!existing) throw new NotFoundException("KPI master tidak ditemukan");
      if (existing.status === "superseded") {
        throw new BadRequestException(
          "Versi KPI ini sudah digantikan versi yang lebih baru — edit versi terbaru sebagai gantinya",
        );
      }
      const isPending = existing.effectiveMonth > activePeriod.yearMonth;

      if (isPending) {
        const targetPeriod = await this.prisma.period.findUnique({
          where: { yearMonth: existing.effectiveMonth },
        });
        if (!targetPeriod)
          throw new BadRequestException(
            `Periode ${existing.effectiveMonth} tidak ditemukan`,
          );
        master = await this.prisma.kpiMaster.update({
          where: { id: dto.id },
          data: {
            indikator: dto.indikator.trim(),
            formula: dto.formula ?? "",
            satuan: dto.satuan ?? "",
            bobotKm: dto.bobotKm ?? "",
            targetParent: dto.targetParent ?? "",
            kmType,
            defaultCheckerIds,
            defaultApproverId,
            aggregationMethod,
            subIndicators: subIndicatorsJson,
            polaritas,
          },
        });
        await this.prisma.kpiAssignment.deleteMany({
          where: { kpiMasterId: master.id },
        });
        targetPeriodId = targetPeriod.id;
      } else {
        const nextMonth = this.incrementYearMonth(activePeriod.yearMonth);
        const nextPeriod = await this.prisma.period.findUnique({
          where: { yearMonth: nextMonth },
        });
        if (!nextPeriod)
          throw new BadRequestException(
            `Periode ${nextMonth} belum tersedia di sistem — tidak dapat membuat versi baru`,
          );
        master = await this.prisma.kpiMaster.create({
          data: {
            year: nextPeriod.yearMonth.slice(0, 4),
            kmType,
            indikator: dto.indikator.trim(),
            formula: dto.formula ?? "",
            satuan: dto.satuan ?? "",
            bobotKm: dto.bobotKm ?? "",
            targetParent: dto.targetParent ?? "",
            createdBy: user.name,
            createdById: user.id,
            defaultCheckerIds,
            defaultApproverId,
            aggregationMethod,
            subIndicators: subIndicatorsJson,
            polaritas,
            effectiveMonth: nextMonth,
            version: existing.version + 1,
            previousVersionId: existing.id,
          },
        });
        supersedeId = existing.id;
        targetPeriodId = nextPeriod.id;
      }
    } else {
      master = await this.prisma.kpiMaster.create({
        data: {
          year: activePeriod.yearMonth.slice(0, 4),
          kmType,
          indikator: dto.indikator.trim(),
          formula: dto.formula ?? "",
          satuan: dto.satuan ?? "",
          bobotKm: dto.bobotKm ?? "",
          targetParent: dto.targetParent ?? "",
          createdBy: user.name,
          createdById: user.id,
          defaultCheckerIds,
          defaultApproverId,
          aggregationMethod,
          subIndicators: subIndicatorsJson,
          polaritas,
          effectiveMonth: activePeriod.yearMonth,
          version: 1,
        },
      });
      targetPeriodId = activePeriod.id;
    }

    await this.prisma.kpiAssignment.createMany({
      data: dto.assignments.map((a, i) => {
        const slots = this.sanitizeReviewerSlots(a.reviewerSlots);
        const subTargets = subTargetsByAssignment[i];
        return {
          kpiMasterId: master.id,
          unitCode: a.unitCode,
          bidang: a.bidang,
          holder: a.holder ?? "",
          target: a.target ?? "",
          target2: a.target2 ?? "",
          persenAgregasi: Number(a.persenAgregasi) || 0,
          reviewerSlots:
            slots === null
              ? Prisma.DbNull
              : (slots as unknown as Prisma.InputJsonValue),
          subIndicatorTargets:
            subTargets === null
              ? Prisma.DbNull
              : (subTargets as unknown as Prisma.InputJsonValue),
        };
      }),
    });

    const assignments = await this.prisma.kpiAssignment.findMany({
      where: { kpiMasterId: master.id },
    });
    const fanOut = await this.fanOut(master, assignments, targetPeriodId);

    if (supersedeId) {
      await this.prisma.kpiMaster.update({
        where: { id: supersedeId },
        data: { status: "superseded" },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: dto.id ? "kpi_master.update" : "kpi_master.create",
        entity: "KpiMaster",
        targetId: master.id,
        note: supersedeId
          ? `KPI "${master.indikator}" diedit — versi baru (v${master.version}) berlaku mulai ${master.effectiveMonth}, versi lama diarsipkan`
          : `KPI "${master.indikator}" di-assign ke ${assignments.length} unit/bidang (${fanOut.docsAffected} dokumen KM diperbarui)`,
      },
    });
    for (const a of assignments) await this.cache.del(`kontrak:${a.unitCode}`);
    return this.getById(master.id);
  }

  private incrementYearMonth(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }

  async delete(user: User, id: string) {
    if (user.unit !== "KP")
      throw new ForbiddenException(
        "Hanya Kantor Induk yang dapat menghapus KPI Master",
      );
    const master = await this.prisma.kpiMaster.findUnique({ where: { id } });
    if (!master) throw new NotFoundException("KPI master tidak ditemukan");

    // Hapus item yang sudah disebar dari dokumen KM DRAFT (dokumen submitted/approved tak disentuh).
    const removed = await this.removeFannedItems(id, master.kmType);
    await this.prisma.kpiMaster.delete({ where: { id } }); // cascade menghapus assignments

    // Bila yang dihapus adalah versi baru hasil edit, versi sebelumnya kembali jadi versi berlaku.
    if (master.previousVersionId) {
      await this.prisma.kpiMaster
        .update({
          where: { id: master.previousVersionId },
          data: { status: "active" },
        })
        .catch(() => {});
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: "kpi_master.delete",
        entity: "KpiMaster",
        targetId: id,
        note: `KPI "${master.indikator}" (v${master.version}) dihapus (${removed} item dibersihkan dari dokumen KM draft)`,
      },
    });
    return { success: true, docsCleaned: removed };
  }

  // ===== Fan-out: sinkronkan item KPI ke dokumen KM DRAFT per-(unit,bidang) =====
  private async fanOut(
    master: {
      id: string;
      kmType: string;
      indikator: string;
      formula: string;
      satuan: string;
      bobotKm: string;
      createdBy: string;
      createdById: string | null;
      subIndicators?: Prisma.JsonValue | null;
      polaritas?: string;
    },
    assignments: Array<{
      unitCode: string;
      bidang: string;
      holder: string;
      target: string;
      target2: string;
      subIndicatorTargets?: Prisma.JsonValue | null;
    }>,
    periodId: string,
  ): Promise<{ docsAffected: number }> {
    // Sub-indikator (opt-in): definisi (nama/formula/satuan/bobot) sama utk SEMUA assignment,
    // tapi target/target2 tiap sub BOLEH dioverride per assignment (KpiAssignment.subIndicatorTargets,
    // array sejajar index) — mis. "Pengendalian NAC" bisa ditarget beda per UPMK sesuai skala
    // anggaran masing-masing. Kosong/tak diisi di suatu index = warisi target template global.
    const subIndicatorsTemplate = Array.isArray(master.subIndicators)
      ? (master.subIndicators as unknown as SubIndicatorInput[])
      : undefined;
    const assignedKeys = new Set(
      assignments.map((a) => `${a.unitCode}||${a.bidang}`),
    );
    let docsAffected = 0;

    // 1. Bersihkan item KPI ini dari dokumen KM draft yang (unit,bidang)-nya tak lagi di-assign.
    const draftKms = await this.prisma.kontrakManajemen.findMany({
      where: { periodId, kmType: master.kmType, status: "draft" },
    });
    for (const km of draftKms) {
      const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<
        string,
        unknown
      >[];
      const hasMaster = items.some((it) => it["masterKpiId"] === master.id);
      const key = `${km.unitCode}||${km.bidang}`;
      if (hasMaster && !assignedKeys.has(key)) {
        const filtered = items.filter((it) => it["masterKpiId"] !== master.id);
        await this.prisma.kontrakManajemen.update({
          where: { id: km.id },
          data: { kpiItems: filtered as object },
        });
        docsAffected++;
      }
    }

    // 2. Sisipkan/perbarui item KPI di dokumen KM draft tiap (unit,bidang) yang di-assign.
    for (const a of assignments) {
      const overrides = Array.isArray(a.subIndicatorTargets)
        ? (a.subIndicatorTargets as unknown as Array<{
            target?: string;
            target2?: string;
          }>)
        : [];
      const mergedSubIndicators = subIndicatorsTemplate?.map((si, idx) => {
        const ov = overrides[idx];
        return {
          ...si,
          target: ov?.target?.trim() || si.target,
          target2: ov?.target2?.trim() || si.target2,
        };
      });
      const item: FannedItem = {
        masterKpiId: master.id,
        indikator: master.indikator,
        formula: master.formula,
        satuan: master.satuan,
        bobot: master.bobotKm,
        target: a.target,
        target2: a.target2,
        polaritas: master.polaritas ?? "positive",
        holder: a.holder || master.createdBy,
        ...(mergedSubIndicators ? { subIndicators: mergedSubIndicators } : {}),
      };
      const existingKm = await this.prisma.kontrakManajemen.findFirst({
        where: {
          periodId,
          unitCode: a.unitCode,
          bidang: a.bidang,
          kmType: master.kmType,
          status: "draft",
        },
        orderBy: { updatedAt: "desc" },
      });
      if (!existingKm) {
        await this.prisma.kontrakManajemen.create({
          data: {
            periodId,
            unitCode: a.unitCode,
            bidang: a.bidang,
            kmType: master.kmType,
            holder: a.holder || master.createdBy,
            kpiItems: [item] as object,
            status: "draft",
            submitter: master.createdBy,
            submitterId: master.createdById,
          },
        });
        docsAffected++;
      } else {
        const items = (
          Array.isArray(existingKm.kpiItems) ? existingKm.kpiItems : []
        ) as Record<string, unknown>[];
        const idx = items.findIndex((it) => it["masterKpiId"] === master.id);
        if (idx >= 0) items[idx] = item as unknown as Record<string, unknown>;
        else items.push(item as unknown as Record<string, unknown>);
        await this.prisma.kontrakManajemen.update({
          where: { id: existingKm.id },
          data: {
            kpiItems: items as object,
            ...(a.holder ? { holder: a.holder } : {}),
          },
        });
        docsAffected++;
      }
    }
    return { docsAffected };
  }

  private async removeFannedItems(
    masterId: string,
    kmType: string,
  ): Promise<number> {
    const draftKms = await this.prisma.kontrakManajemen.findMany({
      where: { kmType, status: "draft" },
    });
    let cleaned = 0;
    for (const km of draftKms) {
      const items = (Array.isArray(km.kpiItems) ? km.kpiItems : []) as Record<
        string,
        unknown
      >[];
      if (!items.some((it) => it["masterKpiId"] === masterId)) continue;
      const filtered = items.filter((it) => it["masterKpiId"] !== masterId);
      if (filtered.length === 0) {
        // Dokumen jadi kosong setelah item ini dihapus — bukan dokumen valid, hapus sekalian
        // daripada meninggalkan baris kpiItems:[] yang tak bisa direview/submit.
        await this.prisma.kontrakManajemen.delete({ where: { id: km.id } });
      } else {
        await this.prisma.kontrakManajemen.update({
          where: { id: km.id },
          data: { kpiItems: filtered as object },
        });
      }
      cleaned++;
    }
    return cleaned;
  }

  // Helper konstanta role (dipakai controller bila perlu guard tambahan).
  static isAuthor(user: User): boolean {
    return (
      user.unit === "KP" && (user.role === Role.STAFF || user.role === Role.GM)
    );
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
      orderBy: [{ submittedAt: "asc" }],
    });

    const groups = new Map<string, BackfillGroupItem[]>();

    for (const doc of docs) {
      const items = (Array.isArray(doc.kpiItems) ? doc.kpiItems : []) as Record<
        string,
        unknown
      >[];
      for (const item of items) {
        const indikator =
          typeof item["indikator"] === "string" ? item["indikator"].trim() : "";
        if (!indikator) continue;
        if (item["masterKpiId"]) continue; // sudah ditag (backfill sebelumnya atau KPI Master)
        const key = `${doc.kmType}||${indikator}`;
        const arr = groups.get(key) ?? [];
        arr.push({
          docId: doc.id,
          unitCode: doc.unitCode,
          bidang: doc.bidang,
          item,
        });
        groups.set(key, arr);
      }
    }
    return groups;
  }

  private summarizeGroups(groups: Map<string, BackfillGroupItem[]>) {
    const details: Array<{
      kmType: string;
      indikator: string;
      assignmentCount: number;
      docCount: number;
    }> = [];
    let assignmentsTotal = 0;
    let docsToTag = 0;
    for (const [key, entries] of groups) {
      const [kmType, indikator] = key.split("||");
      const distinctAssignments = new Set(
        entries.map((e) => `${e.unitCode}||${e.bidang}`),
      );
      details.push({
        kmType,
        indikator,
        assignmentCount: distinctAssignments.size,
        docCount: entries.length,
      });
      assignmentsTotal += distinctAssignments.size;
      docsToTag += entries.length;
    }
    details.sort((a, b) => a.indikator.localeCompare(b.indikator));
    return {
      groupCount: groups.size,
      mastersToCreate: groups.size,
      assignmentsTotal,
      docsToTag,
      details,
    };
  }

  async previewBackfill() {
    const groups = await this.collectBackfillGroups();
    return this.summarizeGroups(groups);
  }

  async runBackfill(user: User) {
    const groups = await this.collectBackfillGroups();
    const activePeriod = await this.prisma.period.findFirst({
      where: { isActive: true },
    });
    if (!activePeriod) throw new BadRequestException("Tidak ada periode aktif");

    let mastersCreated = 0;
    let assignmentsCreated = 0;
    let docsTagged = 0;

    for (const [key, entries] of groups) {
      const [kmType, indikator] = key.split("||");
      const first = entries[0].item; // kemunculan pertama -> definisi master
      const formula =
        typeof first["formula"] === "string" ? first["formula"] : "";
      const satuan = typeof first["satuan"] === "string" ? first["satuan"] : "";
      const bobotKm = typeof first["bobot"] === "string" ? first["bobot"] : ""; // kini data parent

      // Satu assignment per (unitCode,bidang) — target ambil kemunculan pertama pasangan tsb.
      const byPair = new Map<string, BackfillGroupItem>();
      for (const e of entries) {
        const pairKey = `${e.unitCode}||${e.bidang}`;
        if (!byPair.has(pairKey)) byPair.set(pairKey, e);
      }

      const master = await this.prisma.kpiMaster.create({
        data: {
          year: activePeriod.yearMonth.slice(0, 4),
          kmType,
          indikator,
          formula,
          satuan,
          bobotKm,
          targetParent: "",
          createdBy: user.name,
          createdById: user.id,
          effectiveMonth: activePeriod.yearMonth,
          version: 1,
          status: "active",
        },
      });
      mastersCreated++;

      await this.prisma.kpiAssignment.createMany({
        data: Array.from(byPair.values()).map((e) => ({
          kpiMasterId: master.id,
          unitCode: e.unitCode,
          bidang: e.bidang,
          target: typeof e.item["target"] === "string" ? e.item["target"] : "",
          target2:
            typeof e.item["target2"] === "string" ? e.item["target2"] : "",
        })),
      });
      assignmentsCreated += byPair.size;

      // Tag masterKpiId pada SEMUA dokumen (semua periode/status) yang memuat indikator ini —
      // hanya menambah field masterKpiId, field lain & status dokumen tidak disentuh.
      const docIds = Array.from(new Set(entries.map((e) => e.docId)));
      for (const docId of docIds) {
        const doc = await this.prisma.kontrakManajemen.findUnique({
          where: { id: docId },
        });
        if (!doc) continue;
        const items = (
          Array.isArray(doc.kpiItems) ? doc.kpiItems : []
        ) as Record<string, unknown>[];
        let changed = false;
        const tagged = items.map((it) => {
          const itIndikator =
            typeof it["indikator"] === "string" ? it["indikator"].trim() : "";
          if (itIndikator === indikator && !it["masterKpiId"]) {
            changed = true;
            return { ...it, masterKpiId: master.id };
          }
          return it;
        });
        if (changed) {
          await this.prisma.kontrakManajemen.update({
            where: { id: doc.id },
            data: { kpiItems: tagged as object },
          });
          docsTagged++;
        }
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: "kpi_master.backfill",
        entity: "KpiMaster",
        note: `Backfill KM legacy: ${mastersCreated} KPI Master dibuat, ${assignmentsCreated} assignment, ${docsTagged} dokumen KM ditandai`,
      },
    });

    return { mastersCreated, assignmentsCreated, docsTagged };
  }
}
