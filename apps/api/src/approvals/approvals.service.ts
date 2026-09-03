import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma, Role, User } from "@prisma/client";

const ROLE_TO_STAGE: Record<Role, number> = {
  STAFF: 1,
  ASMAN: 2,
  MANAJER: 3,
  SRMANAJER: 4,
  GM: 5,
  SUPERADMIN: 0,
  DEVELOPER: 0,
};

interface WorkflowStep {
  label?: string;
}

export type DocJenis = "Kontrak Manajemen" | "Realisasi Kinerja";

export interface DocRow {
  id: string;
  jenis: DocJenis;
  detail: string;
  unitCode: string;
  periodId: string;
  status: string;
  reviewer: string | null;
  history: unknown;
  stepLabel: string;
  stepIndex: number;
  stepCount: number;
  kpiItems?: Record<string, unknown>[];
  submittedAt?: Date;
  kmType?: "draft" | "final" | null;
}

export interface PaginatedDocRows {
  data: DocRow[];
  pagination: {
    currentPage: number;
    perPage: number;
    totalData: number;
    totalPage: number;
  };
}

export type DocStatusSummary = {
  submitted: number;
  ready: number;
  approved: number;
  rejected: number;
};

const TRACKED_STATUSES = [
  "submitted",
  "ready",
  "approved",
  "rejected",
] as const;

export type DocRowsResult =
  | DocRow[]
  | (PaginatedDocRows & { summary: DocStatusSummary });

const normalizeFilterValue = (v?: string | null): string | undefined => {
  const trimmed = v?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return undefined;
  return trimmed;
};

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getReports(user: User, periodId?: string) {
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });

    if (!period) return [];

    const reports = await this.prisma.report.findMany({
      where: { periodId: period.id },
      orderBy: { unit: "asc" },
    });

    const userStage = ROLE_TO_STAGE[user.role] ?? 0;

    return reports.map((r) => ({
      ...r,
      canApprove: r.currentStage === userStage && r.status === "IN_REVIEW",
    }));
  }

  async advanceStage(reportId: string, user: User, note?: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException("Report not found");

    const userStage = ROLE_TO_STAGE[user.role] ?? 0;
    if (report.currentStage !== userStage)
      throw new ForbiddenException("Not your stage");
    if (report.status !== "IN_REVIEW")
      throw new ForbiddenException("Report not in review");

    const nextStage = report.currentStage + 1;
    const isApproved = nextStage > 5;
    const history = [
      ...(report.history as object[]),
      {
        stage: report.currentStage,
        actor: user.name,
        role: user.role,
        action: "approved",
        note,
        ts: new Date().toISOString(),
      },
    ];

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        currentStage: isApproved ? 5 : nextStage,
        status: isApproved ? "APPROVED" : "IN_REVIEW",
        nextApprover: isApproved
          ? null
          : (Object.keys(ROLE_TO_STAGE).find(
              (k) => ROLE_TO_STAGE[k as Role] === nextStage,
            ) ?? null),
        history,
      },
    });

    await this.cache.del(`approvals:${report.periodId}`);

    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: isApproved ? "report.approved" : "report.advanced",
        entity: "Report",
        targetId: reportId,
        note,
      },
    });

    return updated;
  }

  async returnReport(reportId: string, user: User, note: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException("Report not found");

    const userStage = ROLE_TO_STAGE[user.role] ?? 0;
    if (report.currentStage !== userStage)
      throw new ForbiddenException("Not your stage");

    const history = [
      ...(report.history as object[]),
      {
        stage: report.currentStage,
        actor: user.name,
        role: user.role,
        action: "returned",
        note,
        ts: new Date().toISOString(),
      },
    ];

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: "NEEDS_REVISION",
        currentStage: Math.max(1, report.currentStage - 1),
        history,
      },
    });

    await this.cache.del(`approvals:${report.periodId}`);
    await this.prisma.auditLog.create({
      data: {
        actor: user.name,
        userId: user.id,
        action: "report.returned",
        entity: "Report",
        targetId: reportId,
        note,
      },
    });

    return updated;
  }

  // ===== Semua Dokumen Persetujuan (KM + Realisasi) — server-side of `filteredDocRows` =====

  private stepInfo(rec: { steps?: unknown; currentStepIndex?: number }) {
    const steps = (rec.steps as WorkflowStep[] | undefined) ?? [];
    const idx = rec.currentStepIndex ?? 0;
    return {
      stepLabel: steps[idx]?.label ?? "—",
      stepIndex: idx,
      stepCount: steps.length,
    };
  }

  // Mirrors `scopeByBidang` in ApprovalsPage.tsx.
  private canSeeAllBidang(user: User): boolean {
    if (user.role === Role.GM) return true;
    const vc = (user as User & { roleVariant?: { code?: string } }).roleVariant
      ?.code;
    if (vc === "man_perencanaan" || vc === "sm_pc") return true;
    if (
      user.role === Role.STAFF &&
      user.bidang === "Perencanaan & Project Control"
    )
      return true;
    if (!user.bidang) return true;
    return false;
  }

  async getDocuments(
    user: User,
    type: "all" | "km" | "real" = "all",
    status?: string,
    periodId?: string,
    kmType?: string,
    currentPage?: number,
    perPage?: number,
  ): Promise<DocRow[] | (PaginatedDocRows & { summary: DocStatusSummary })> {
    const scopeAll = this.canSeeAllBidang(user);
    const bidangFilter = scopeAll ? {} : { bidang: user.bidang as string };

    const normalizedStatus = normalizeFilterValue(status);
    const normalizedPeriodId = normalizeFilterValue(periodId);
    const normalizedKmType = normalizeFilterValue(kmType);

    const statusFilter = normalizedStatus ? { status: normalizedStatus } : {};
    const periodFilter = normalizedPeriodId
      ? { periodId: normalizedPeriodId }
      : {};
    const kmTypeFilter = normalizedKmType ? { kmType: normalizedKmType } : {};

    // Filter dasar (unit/bidang, periode, tipe KM) — dipakai bersama oleh query data & summary.
    const kmBaseWhere: Prisma.KontrakManajemenWhereInput = {
      ...bidangFilter,
      ...periodFilter,
      ...kmTypeFilter,
    };
    const realBaseWhere: Prisma.InputRealisasiWhereInput = {
      ...bidangFilter,
      ...periodFilter,
    };

    // Where lengkap (+ status) — dipakai baik oleh query data MAUPUN summary, supaya summary
    // ikut menyempit sesuai status yang sedang difilter di tabel (bukan lagi breakdown penuh).
    const kmFullWhere: Prisma.KontrakManajemenWhereInput = {
      ...kmBaseWhere,
      ...statusFilter,
    };
    const realFullWhere: Prisma.InputRealisasiWhereInput = {
      ...realBaseWhere,
      ...statusFilter,
    };

    const [kmRows, realRows, summary] = await Promise.all([
      type === "real"
        ? Promise.resolve([])
        : this.prisma.kontrakManajemen.findMany({
            where: kmFullWhere,
            orderBy: { submittedAt: "desc" },
          }),
      type === "km"
        ? Promise.resolve([])
        : this.prisma.inputRealisasi.findMany({
            where: realFullWhere,
            orderBy: { submittedAt: "desc" },
          }),
      this.getDocumentsSummary(kmFullWhere, realFullWhere, type),
    ]);

    const kmDocs: DocRow[] = kmRows.map(
      (k): DocRow => ({
        id: k.id,
        jenis: "Kontrak Manajemen" as DocJenis,
        detail: k.bidang,
        unitCode: k.unitCode,
        periodId: k.periodId,
        status: k.status,
        reviewer: k.reviewer,
        history: k.history,
        kmType: (k.kmType as "draft" | "final") ?? null,
        ...this.stepInfo(
          k as unknown as { steps?: unknown; currentStepIndex?: number },
        ),
        kpiItems: Array.isArray(k.kpiItems)
          ? (k.kpiItems as Record<string, unknown>[])
          : [],
        submittedAt: k.submittedAt,
      }),
    );

    const realDocs: DocRow[] = realRows.map(
      (r): DocRow => ({
        id: r.id,
        jenis: "Realisasi Kinerja" as DocJenis,
        detail: r.bidang,
        unitCode: r.unitCode,
        periodId: r.periodId,
        status: r.status,
        reviewer: r.reviewer,
        history: r.history,
        kmType: null,
        ...this.stepInfo(
          r as unknown as { steps?: unknown; currentStepIndex?: number },
        ),
        submittedAt: r.submittedAt,
      }),
    );

    const merged = [...kmDocs, ...realDocs].sort(
      (a, b) =>
        (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0),
    );

    if (!currentPage && !perPage) return merged;

    const page = currentPage ?? 1;
    const limit = perPage ?? 10;
    const skip = (page - 1) * limit;
    const totalData = merged.length;

    return {
      data: merged.slice(skip, skip + limit),
      pagination: {
        currentPage: page,
        perPage: limit,
        totalData,
        totalPage: Math.ceil(totalData / limit),
      },
      summary,
    };
  }

  // groupBy, bukan findMany + count di JS — hanya menghitung jumlah per status tanpa menarik
  // seluruh baris ke memori. `kmBaseWhere`/`realBaseWhere` di sini TIDAK BOLEH mengandung
  // filter status — parameter ini sengaja bertipe ketat (bukan Record<string, unknown>) supaya
  // pemanggil yang keliru menyelipkan status akan terlihat jelas di review/diff.
  private async getDocumentsSummary(
    kmBaseWhere: Prisma.KontrakManajemenWhereInput,
    realBaseWhere: Prisma.InputRealisasiWhereInput,
    type: "all" | "km" | "real",
  ): Promise<DocStatusSummary> {

    const [kmGrouped, realGrouped] = await Promise.all([
      type === "real"
        ? Promise.resolve([])
        : this.prisma.kontrakManajemen.groupBy({
            by: ["status"],
            where: kmBaseWhere,
            _count: { _all: true },
          }),
      type === "km"
        ? Promise.resolve([])
        : this.prisma.inputRealisasi.groupBy({
            by: ["status"],
            where: realBaseWhere,
            _count: { _all: true },
          }),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...kmGrouped, ...realGrouped]) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + row._count._all);
    }

    const result = TRACKED_STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: counts.get(s) ?? 0 }),
      {} as DocStatusSummary,
    );
    return result;
  }
}
