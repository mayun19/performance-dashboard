import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutiveService } from '../executive/executive.service';
import { OperationalService } from '../operational/operational.service';
import { User } from '@prisma/client';
import type { TargetOverrideMap } from '../common/capaian';

// KM Final tiba dari top holding (eksternal, ~Mei/Juni) → restatement: recompute SEMUA
// bulan sebelumnya dalam tahun yang sama terhadap target final yang beku, tulis snapshot
// 'final' (immutable). Realisasi (actual) TIDAK berubah — hanya capaian/skor yang direstate.
// Dipicu dari AdminController.setKmReference saat kmReference periode diubah ke 'final'.
@Injectable()
export class RestatementService {
  constructor(
    private prisma: PrismaService,
    private executiveSvc: ExecutiveService,
    private operationalSvc: OperationalService,
  ) {}

  async restatePeriod(periodId: string, actor: User): Promise<{ periodsRestated: string[] }> {
    const target = await this.prisma.period.findUnique({ where: { id: periodId } });
    if (!target) throw new BadRequestException('Periode tidak ditemukan');
    if (target.kmReference !== 'final') {
      throw new BadRequestException('Restatement hanya berlaku setelah acuan KM periode ini diset ke "final"');
    }

    const year = target.yearMonth.slice(0, 4);
    const periods = await this.prisma.period.findMany({
      where: { yearMonth: { gte: `${year}-01`, lte: target.yearMonth } },
      orderBy: { yearMonth: 'asc' },
    });

    const restated: string[] = [];
    for (const period of periods) {
      const overridesByMaster = await this.freezeToFinalAndBuildOverrides(period.id, actor);
      if (Object.keys(overridesByMaster).length === 0) continue; // periode tanpa living target — lewati
      await Promise.all([
        this.executiveSvc.refreshFromRealisasi(period.id, 'final', overridesByMaster),
        this.operationalSvc.refreshFromRealisasi(period.id, 'final', overridesByMaster),
      ]);
      await this.prisma.period.update({ where: { id: period.id }, data: { restatedAt: new Date() } });
      restated.push(period.id);
    }

    await this.prisma.auditLog.create({
      data: {
        actor: actor.name, userId: actor.id, action: 'period.restatement.run',
        entity: 'Period', targetId: periodId,
        note: `KM Final tiba — restatement dijalankan untuk ${restated.length} periode (${year}): ${periods.map((p) => p.label).join(', ')}`,
      },
    });
    return { periodsRestated: restated };
  }

  // Timpa living target periode ini dengan target KM Final saat ini (KpiAssignment.target,
  // diasumsikan sudah diperbarui RPC sebelum flip kmReference), kunci sbg frozenTarget, log
  // RevisionLog per baris (actor sistem), lalu kembalikan peta masterKpiId -> nilai numerik.
  private async freezeToFinalAndBuildOverrides(periodId: string, actor: User): Promise<TargetOverrideMap> {
    const periodTargets = await this.prisma.periodTarget.findMany({
      where: { periodId },
      include: { assignment: true },
    });
    const overrides: TargetOverrideMap = {};
    for (const pt of periodTargets) {
      const finalTarget = pt.assignment.target;
      const n = parseFloat(String(finalTarget).replace(',', '.').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n)) overrides[pt.assignment.kpiMasterId] = n;

      if (pt.frozenTarget !== finalTarget) {
        const oldValue = pt.frozenTarget ?? pt.target;
        await this.prisma.periodTarget.update({
          where: { id: pt.id },
          data: { frozen: true, frozenAt: new Date(), frozenTarget: finalTarget },
        });
        await this.prisma.revisionLog.create({
          data: {
            entity: 'period_target', targetId: pt.id, periodId,
            actor: actor.name, actorId: actor.id, field: 'frozenTarget',
            oldValue: oldValue as unknown as object, newValue: finalTarget as unknown as object,
            note: 'Restatement KM Final — target-of-record direstate dari KpiAssignment.target',
          },
        });
      }
    }
    return overrides;
  }
}
