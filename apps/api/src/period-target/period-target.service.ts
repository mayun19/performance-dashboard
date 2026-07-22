import { Injectable, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, User, PeriodTarget } from '@prisma/client';
import { RPC_BIDANG } from '../common/workflow-steps';

// Living-target workflow: KM Sementara per (periode, assignment). Hidup & bisa dikoreksi
// PIC REN sepanjang masa tunggu KM Final; dibekukan saat bundle GM disetujui, deadline
// lewat, atau restatement KM Final. Lihat docs/living-target-workflow.md.
@Injectable()
export class PeriodTargetService {
  constructor(private prisma: PrismaService) {}

  // PIC REN = Staff Kinerja Perencanaan (RPC) — warden target, satu-satunya yang boleh
  // mengoreksi KM Sementara in-cycle (selain SUPERADMIN/DEVELOPER untuk keperluan admin).
  isPicRen(user: User): boolean {
    if (user.role === Role.SUPERADMIN || user.role === Role.DEVELOPER) return true;
    return user.role === Role.STAFF && user.bidang === RPC_BIDANG && user.unit === 'KP';
  }

  // Cari assignment yang cocok (masterKpiId, unitCode, bidang) — sama seperti resolusi
  // reviewerSlots di kpi-master.service.ts, dipakai agar satu KPI ber-fan-out ke banyak
  // unit tetap punya living target TERPISAH per unit.
  async resolveAssignment(masterKpiId: string, unitCode: string, bidang: string) {
    return this.prisma.kpiAssignment.findUnique({
      where: { kpiMasterId_unitCode_bidang: { kpiMasterId: masterKpiId, unitCode, bidang } },
    });
  }

  // Ambil (atau materialisasi) living target bulan berjalan untuk satu assignment:
  //   1. sudah ada baris periode ini → pakai apa adanya.
  //   2. belum ada → cari periode sebelumnya (yearMonth < periode ini) yang sudah frozen,
  //      carry-forward nilai frozenTarget-nya (source='carried').
  //   3. tak ada riwayat sama sekali → fresh dari KpiAssignment.target (source='fresh').
  async getOrSeed(periodId: string, kpiAssignmentId: string): Promise<PeriodTarget> {
    const existing = await this.prisma.periodTarget.findUnique({
      where: { periodId_kpiAssignmentId: { periodId, kpiAssignmentId } },
    });
    if (existing) return existing;

    const period = await this.prisma.period.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');

    // PeriodTarget tak punya relasi langsung ke Period.yearMonth utk orderBy, jadi cari
    // periode-periode sebelumnya lebih dulu lalu telusuri mundur sampai temu baris frozen.
    let carried: PeriodTarget | null = null;
    const priorPeriods = await this.prisma.period.findMany({
      where: { yearMonth: { lt: period.yearMonth } },
      orderBy: { yearMonth: 'desc' },
      select: { id: true },
    });
    for (const p of priorPeriods) {
      const pt = await this.prisma.periodTarget.findUnique({
        where: { periodId_kpiAssignmentId: { periodId: p.id, kpiAssignmentId } },
      });
      if (pt?.frozen) { carried = pt; break; }
    }

    if (carried) {
      return this.prisma.periodTarget.create({
        data: {
          periodId, kpiAssignmentId,
          target: carried.frozenTarget ?? carried.target,
          source: 'carried',
        },
      });
    }

    const assignment = await this.prisma.kpiAssignment.findUnique({ where: { id: kpiAssignmentId } });
    if (!assignment) throw new NotFoundException('KPI assignment tidak ditemukan');
    return this.prisma.periodTarget.create({
      data: { periodId, kpiAssignmentId, target: assignment.target, source: 'fresh' },
    });
  }

  // Resolusi living target untuk seluruh item realisasi (values) satu package, dikembalikan
  // sebagai peta masterKpiId -> nilai target numerik (dipakai executive/operational service
  // sbg target-of-record) + peta masterKpiId -> kpiAssignmentId (dipakai updateTarget dari UI).
  async resolveForPackage(periodId: string, unitCode: string, bidang: string, items: Record<string, unknown>[]) {
    const targetByMaster: Record<string, number> = {};
    const assignmentByMaster: Record<string, string> = {};
    for (const it of items) {
      const masterKpiId = it['masterKpiId'];
      if (typeof masterKpiId !== 'string') continue;
      const assignment = await this.resolveAssignment(masterKpiId, unitCode, bidang);
      if (!assignment) continue;
      const pt = await this.getOrSeed(periodId, assignment.id);
      const n = parseFloat(String(pt.target).replace(',', '.').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) targetByMaster[masterKpiId] = n;
      assignmentByMaster[masterKpiId] = assignment.id;
    }
    return { targetByMaster, assignmentByMaster };
  }

  // Koreksi target oleh PIC REN (in-cycle, sepanjang masa tunggu KM Final). Menulis RevisionLog
  // append-only untuk audit simetris dengan koreksi realisasi.
  async updateTarget(user: User, periodId: string, kpiAssignmentId: string, newTarget: string, note?: string) {
    if (!this.isPicRen(user)) throw new ForbiddenException('Hanya PIC REN (Staff Perencanaan) yang dapat mengoreksi target KM Sementara');
    if (!newTarget?.trim()) throw new BadRequestException('Target baru wajib diisi');

    const pt = await this.getOrSeed(periodId, kpiAssignmentId);
    if (pt.frozen) throw new ForbiddenException('Target periode ini sudah dibekukan, tidak dapat dikoreksi lagi');

    const oldValue = pt.target;
    const updated = await this.prisma.periodTarget.update({
      where: { id: pt.id },
      data: { target: newTarget, source: 'fresh' },
    });
    await this.prisma.revisionLog.create({
      data: {
        entity: 'period_target', targetId: pt.id, periodId,
        actor: user.name, actorId: user.id, field: 'target',
        oldValue: oldValue as unknown as object, newValue: newTarget as unknown as object,
        note,
      },
    });
    return updated;
  }

  // Bekukan seluruh living target periode ini — dipanggil saat bundle GM disetujui
  // (all-or-nothing) atau deadline lewat (force-freeze). Idempoten: baris yang sudah
  // frozen dilewati.
  async freezePeriod(periodId: string): Promise<number> {
    const result = await this.prisma.periodTarget.updateMany({
      where: { periodId, frozen: false },
      data: { frozen: true, frozenAt: new Date() },
    });
    // frozenTarget disalin per-baris (updateMany tak bisa referensikan kolom sendiri di Postgres via Prisma).
    const rows = await this.prisma.periodTarget.findMany({ where: { periodId, frozen: true, frozenTarget: null } });
    for (const r of rows) {
      await this.prisma.periodTarget.update({ where: { id: r.id }, data: { frozenTarget: r.target } });
    }
    return result.count;
  }

  // Force-freeze deadline: PIC REN's target-of-record saat ini MENANG — sama seperti
  // freezePeriod, tapi dipanggil terpisah dari alur bundle GM (mis. dari admin endpoint)
  // sehingga jejak audit/actor bisa dibedakan.
  async forceFreezeAtDeadline(periodId: string, actor: User) {
    const count = await this.freezePeriod(periodId);
    await this.prisma.revisionLog.create({
      data: {
        entity: 'period_target', targetId: periodId, periodId,
        actor: actor.name, actorId: actor.id, field: 'freeze',
        note: `Deadline lewat — ${count} target dibekukan paksa pada nilai PIC REN saat ini`,
      },
    });
    return { frozen: count };
  }

  async getForPeriod(periodId: string) {
    return this.prisma.periodTarget.findMany({ where: { periodId }, include: { assignment: true } });
  }

  // ===== Fase 6: Backfill KM Sementara (materialisasi PeriodTarget) =====
  // getOrSeed() sudah membuat baris on-demand saat diakses (submit/resolveTargetFix/dsb),
  // tapi periode yang BELUM PERNAH diakses (mis. bulan lama sebelum fitur ini ada, atau bulan
  // yang belum ada realisasi masuk) tetap nol baris PeriodTarget — dan restatement KM Final
  // MELEWATI periode tanpa baris PeriodTarget sama sekali (lihat RestatementService, "periode
  // tanpa living target — lewati"). Backfill memastikan setiap KpiAssignment aktif punya baris
  // utk periode ini SEBELUM restatement dijalankan, dengan aturan carry-forward/fresh yang
  // identik (reuse getOrSeed, bukan duplikasi logika).
  async previewBackfill(periodId: string) {
    const period = await this.prisma.period.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');
    const assignments = await this.prisma.kpiAssignment.findMany({ select: { id: true } });
    const existing = await this.prisma.periodTarget.findMany({ where: { periodId }, select: { kpiAssignmentId: true } });
    const existingIds = new Set(existing.map((e) => e.kpiAssignmentId));
    const missing = assignments.filter((a) => !existingIds.has(a.id));
    return { periodId, periodLabel: period.label, totalAssignments: assignments.length, alreadySeeded: existingIds.size, toSeed: missing.length };
  }

  async runBackfill(periodId: string, user: User) {
    const period = await this.prisma.period.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');
    const assignments = await this.prisma.kpiAssignment.findMany({ select: { id: true } });
    const existing = await this.prisma.periodTarget.findMany({ where: { periodId }, select: { kpiAssignmentId: true } });
    const existingIds = new Set(existing.map((e) => e.kpiAssignmentId));
    const missing = assignments.filter((a) => !existingIds.has(a.id));

    let carried = 0, fresh = 0;
    for (const a of missing) {
      const pt = await this.getOrSeed(periodId, a.id);
      if (pt.source === 'carried') carried++; else fresh++;
    }
    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'period_target.backfill', entity: 'Period', targetId: periodId,
        note: `Backfill KM Sementara periode ${period.label}: ${missing.length} baris dibuat (${carried} carry-forward, ${fresh} fresh dari KpiAssignment.target)`,
      },
    });
    return { created: missing.length, carried, fresh };
  }

  // Resolusi read-only (Fase 5, audit simetris): id baris PeriodTarget yang berlaku untuk
  // satu package realisasi, dipakai untuk menautkan RevisionLog (entity='period_target') ke
  // timeline package. Tidak memakai getOrSeed — baris yang belum pernah dibuat berarti belum
  // pernah dikoreksi, jadi memang tak punya riwayat (bukan error).
  async findPeriodTargetIdsForPackage(periodId: string, unitCode: string, bidang: string, items: Record<string, unknown>[]): Promise<string[]> {
    const ids: string[] = [];
    for (const it of items) {
      const masterKpiId = it['masterKpiId'];
      if (typeof masterKpiId !== 'string') continue;
      const assignment = await this.resolveAssignment(masterKpiId, unitCode, bidang);
      if (!assignment) continue;
      const pt = await this.prisma.periodTarget.findUnique({
        where: { periodId_kpiAssignmentId: { periodId, kpiAssignmentId: assignment.id } },
      });
      if (pt) ids.push(pt.id);
    }
    return ids;
  }
}
