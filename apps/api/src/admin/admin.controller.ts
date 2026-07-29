import { Controller, Delete, Patch, Get, Post, Param, Body, Query, UseGuards, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { getFillWindowStatus } from '../common/period-window';
import { WhatsappSimService } from '../whatsapp/whatsapp.service';
import { KpiMasterService } from '../kpi-master/kpi-master.service';
import { PeriodTargetService } from '../period-target/period-target.service';
import { RestatementService } from '../period-target/restatement.service';

class WindowOverrideDto {
  @IsBoolean() enabled: boolean;
}

class KmReferenceDto {
  @IsIn(['draft', 'final']) kmReference: 'draft' | 'final';
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.DEVELOPER)
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappSimService,
    private kpiMaster: KpiMasterService,
    private periodTarget: PeriodTargetService,
    private restatement: RestatementService,
  ) {}

  @Delete('reset-test-data')
  async resetTestData(@CurrentUser() user: User) {
    if (user.role !== Role.SUPERADMIN && user.role !== Role.DEVELOPER) {
      throw new ForbiddenException('Hanya SUPERADMIN atau DEVELOPER yang dapat mereset data');
    }
    await this.prisma.notification.deleteMany({});
    await this.prisma.auditLog.deleteMany({});
    await this.prisma.revisionLog.deleteMany({});
    await this.prisma.kpiRollupReview.deleteMany({});
    await this.prisma.realisasiBundle.deleteMany({});
    await this.prisma.inputRealisasi.deleteMany({});
    await this.prisma.kMBundle.deleteMany({});
    await this.prisma.kontrakManajemen.deleteMany({});
    // PeriodTarget & KpiAssignment ikut terhapus otomatis (onDelete: Cascade dari KpiMaster).
    await this.prisma.kpiMaster.deleteMany({});
    return { success: true, message: 'Semua data KPI Master, KM, realisasi, target periode, notifikasi, dan log audit berhasil dihapus.' };
  }

  // Override manual window pengisian realisasi — keputusan bisnis GM, bukan hanya admin sistem.
  @Patch('periods/:id/window-override')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  async toggleWindowOverride(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: WindowOverrideDto) {
    const period = await this.prisma.period.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');

    const updated = await this.prisma.period.update({
      where: { id },
      data: {
        windowOverride: dto.enabled,
        overrideBy: dto.enabled ? user.name : null,
        overrideAt: dto.enabled ? new Date() : null,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id,
        action: dto.enabled ? 'period.window_override.enable' : 'period.window_override.disable',
        entity: 'Period', targetId: id,
        note: `Periode ${period.label}: window pengisian ${dto.enabled ? 'dibuka manual' : 'dikembalikan ke jadwal normal'}`,
      },
    });
    return { ...updated, fillWindow: getFillWindowStatus(updated.yearMonth, updated.windowOverride) };
  }

  // Acuan aktif KM (Draft/Final) untuk pengisian realisasi periode ini — keputusan bisnis GM.
  @Patch('periods/:id/km-reference')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  async setKmReference(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: KmReferenceDto) {
    const period = await this.prisma.period.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');
    if (dto.kmReference !== 'draft' && dto.kmReference !== 'final') {
      throw new BadRequestException('kmReference harus "draft" atau "final"');
    }
    const updated = await this.prisma.period.update({ where: { id }, data: { kmReference: dto.kmReference } });
    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'period.km_reference.set',
        entity: 'Period', targetId: id,
        note: `Periode ${period.label}: acuan KM diubah ke "${dto.kmReference}"`,
      },
    });

    // KM Final tiba dari holding (draft → final) → living-target workflow: restatement
    // otomatis merecompute seluruh bulan tahun berjalan terhadap target final yang beku.
    let restatement: { periodsRestated: string[] } | null = null;
    if (period.kmReference === 'draft' && dto.kmReference === 'final') {
      restatement = await this.restatement.restatePeriod(id, user);
    }
    return { ...updated, restatement };
  }

  // Deadline konvergensi bulanan lewat & belum ada kesepakatan → force-freeze: target-of-record
  // PIC REN yang berlaku saat ini MENANG (lihat docs/living-target-workflow.md §4 circuit-breaker).
  @Post('periods/:id/force-freeze')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  async forceFreezeDeadline(@CurrentUser() user: User, @Param('id') id: string) {
    const period = await this.prisma.period.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Periode tidak ditemukan');
    return this.periodTarget.forceFreezeAtDeadline(id, user);
  }

  // ===== Simulasi Notifikasi WhatsApp (belum terhubung provider nyata) =====

  @Get('whatsapp-sim/logs')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  getWhatsappLogs() {
    return this.whatsapp.getLogs(50);
  }

  @Get('whatsapp-sim/preview')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  previewWhatsapp(@Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    return this.whatsapp.preview(periodId);
  }

  @Post('whatsapp-sim/run')
  @Roles(Role.GM, Role.SUPERADMIN, Role.DEVELOPER)
  async runWhatsappSim(@CurrentUser() user: User) {
    const result = await this.whatsapp.checkAndSendReminders(true);
    await this.prisma.auditLog.create({
      data: {
        actor: user.name, userId: user.id, action: 'whatsapp_sim.run_manual',
        entity: 'WhatsAppLog',
        note: `Simulasi dijalankan manual: ${result.remindersSent} pesan dari ${result.periodsChecked} periode terbuka`,
      },
    });
    return result;
  }

  // ===== Fase F: Backfill dokumen KM legacy → KPI Master =====

  @Get('backfill-kpi-master/preview')
  previewBackfillKpiMaster() {
    return this.kpiMaster.previewBackfill();
  }

  @Post('backfill-kpi-master/run')
  async runBackfillKpiMaster(@CurrentUser() user: User) {
    return this.kpiMaster.runBackfill(user);
  }

  // ===== Fase 6: Backfill KM Sementara (materialisasi PeriodTarget per periode) =====

  @Get('backfill-period-target/preview')
  previewBackfillPeriodTarget(@Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    return this.periodTarget.previewBackfill(periodId);
  }

  @Post('backfill-period-target/run')
  async runBackfillPeriodTarget(@CurrentUser() user: User, @Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId diperlukan');
    return this.periodTarget.runBackfill(periodId, user);
  }
}
