import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { PrismaService } from "../prisma/prisma.service";
import { Role, User } from "@prisma/client";

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
}

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
  ): Promise<DocRow[]> {
    const scopeAll = this.canSeeAllBidang(user);
    const bidangFilter = scopeAll ? {} : { bidang: user.bidang as string };
    const statusFilter = status && status !== "all" ? { status } : {};
    const periodFilter = periodId && periodId !== "all" ? { periodId } : {};

    const [kmRows, realRows] = await Promise.all([
      type === "real"
        ? Promise.resolve([])
        : this.prisma.kontrakManajemen.findMany({
            where: { ...bidangFilter, ...statusFilter, ...periodFilter },
            orderBy: { submittedAt: "desc" },
          }),
      type === "km"
        ? Promise.resolve([])
        : this.prisma.inputRealisasi.findMany({
            where: { ...bidangFilter, ...statusFilter, ...periodFilter },
            orderBy: { submittedAt: "desc" },
          }),
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
        ...this.stepInfo(
          k as unknown as { steps?: unknown; currentStepIndex?: number },
        ),
        kpiItems: Array.isArray(k.kpiItems)
          ? (k.kpiItems as Record<string, unknown>[])
          : [],
        ...this.stepInfo(
          k as unknown as { steps?: unknown; currentStepIndex?: number },
        ),
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
        ...this.stepInfo(
          r as unknown as { steps?: unknown; currentStepIndex?: number },
        ),
      }),
    );

    return [...kmDocs, ...realDocs];
  }
}
