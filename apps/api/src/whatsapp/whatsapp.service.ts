import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getFillWindowStatus } from '../common/period-window';
import type { Step } from '../common/workflow-steps';

// Simulasi notifikasi WhatsApp ke Checker yang punya realisasi KPI menunggu tinjauan,
// dikirim setiap 3 hari SELAMA window pengisian (tgl 25 - tgl 5) berlangsung.
// Belum terhubung provider nyata — hanya mencatat pesan yang AKAN dikirim (WhatsAppLog)
// agar konten & jadwal bisa divalidasi sebelum integrasi Fonnte/WA Business API produksi.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // cek tiap 1 jam (real-world cadence)
const REMINDER_INTERVAL_DAYS = 3;

export interface PendingReminderGroup {
  recipientId: string;
  recipientName: string;
  phone: string | null;
  items: Array<{ unitCode: string; bidang: string }>;
}

@Injectable()
export class WhatsappSimService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappSimService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.checkAndSendReminders(false).catch((err) =>
        this.logger.error('Gagal menjalankan pengecekan reminder WhatsApp terjadwal', err),
      );
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  buildReminderMessage(recipientName: string, periodLabel: string, deadlineLabel: string, items: Array<{ unitCode: string; bidang: string }>): string {
    const UNIT_NAMES: Record<string, string> = {
      KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
      UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
    };
    const list = items.map((it) => `- ${UNIT_NAMES[it.unitCode] ?? it.unitCode} — ${it.bidang}`).join('\n');
    return (
      `🔔 *Pengingat Realisasi KPI*\n\n` +
      `Yth. ${recipientName},\n\n` +
      `Terdapat *${items.length} dokumen* realisasi KPI periode *${periodLabel}* yang menunggu tinjauan Anda sebagai Checker:\n` +
      `${list}\n\n` +
      `Batas pengisian: *${deadlineLabel}*. Mohon segera ditindaklanjuti melalui SIMPP Performance Dashboard.\n\n` +
      `_Pesan otomatis PUSMANPRO Performance Dashboard — pengingat dikirim setiap ${REMINDER_INTERVAL_DAYS} hari selama window pengisian._`
    );
  }

  // Kelompokkan realisasi 'submitted' yang sedang menunggu langkah CHECKER (bukan approver/submitter)
  // per penerima. Hanya dokumen dari alur reviewer terpilih (Fase 2) yang punya `kind` pada steps.
  async getPendingCheckers(periodId: string): Promise<PendingReminderGroup[]> {
    const records = await this.prisma.inputRealisasi.findMany({
      where: { periodId, status: 'submitted' },
    });
    const byRecipient = new Map<string, PendingReminderGroup>();
    for (const r of records) {
      const steps = (r.steps as unknown as Step[]) ?? [];
      const step = steps[r.currentStepIndex];
      if (!step || step.kind !== 'checker' || !step.userId) continue;
      const key = step.userId;
      if (!byRecipient.has(key)) {
        byRecipient.set(key, { recipientId: key, recipientName: step.userName ?? 'Checker', phone: null, items: [] });
      }
      byRecipient.get(key)!.items.push({ unitCode: r.unitCode, bidang: r.bidang });
    }
    // Lengkapi nomor telepon dari data User (bila tersedia).
    const ids = [...byRecipient.keys()];
    if (ids.length > 0) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true } });
      for (const u of users) {
        const g = byRecipient.get(u.id);
        if (g) g.phone = u.phone ?? null;
      }
    }
    return [...byRecipient.values()];
  }

  // Preview tanpa menyimpan log — dipakai UI untuk menampilkan apa yang AKAN dikirim.
  async preview(periodId: string): Promise<Array<PendingReminderGroup & { message: string }>> {
    const period = await this.prisma.period.findUnique({ where: { id: periodId } });
    if (!period) return [];
    const groups = await this.getPendingCheckers(periodId);
    const win = getFillWindowStatus(period.yearMonth, period.windowOverride);
    const deadlineLabel = win.end.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
    return groups.map((g) => ({
      ...g,
      message: this.buildReminderMessage(g.recipientName, period.label, deadlineLabel, g.items),
    }));
  }

  // Jalankan pengecekan & catat simulasi pengiriman.
  //   force=false (jadwal otomatis): hanya kirim bila window terbuka DAN hari ini kelipatan-3
  //     sejak window dibuka, DAN belum ada log untuk periode ini hari ini (anti-duplikat).
  //   force=true (tombol admin "Jalankan Sekarang" untuk demo): abaikan kedua guard tsb,
  //     tetap hanya untuk periode yang window-nya sedang terbuka.
  async checkAndSendReminders(force: boolean): Promise<{ periodsChecked: number; remindersSent: number }> {
    const periods = await this.prisma.period.findMany();
    let remindersSent = 0;
    let periodsChecked = 0;

    for (const period of periods) {
      const win = getFillWindowStatus(period.yearMonth, period.windowOverride);
      if (!win.isOpen) continue;
      periodsChecked++;

      if (!force) {
        const daysSinceStart = Math.floor((Date.now() - win.start.getTime()) / 86400000);
        if (daysSinceStart < 0 || daysSinceStart % REMINDER_INTERVAL_DAYS !== 0) continue;

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const alreadySentToday = await this.prisma.whatsAppLog.findFirst({
          where: { periodId: period.id, templateType: 'reminder_checker', createdAt: { gte: todayStart } },
        });
        if (alreadySentToday) continue;
      }

      const groups = await this.getPendingCheckers(period.id);
      if (groups.length === 0) continue;

      const deadlineLabel = win.end.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
      for (const g of groups) {
        const message = this.buildReminderMessage(g.recipientName, period.label, deadlineLabel, g.items);
        await this.prisma.whatsAppLog.create({
          data: {
            periodId: period.id, recipientId: g.recipientId, recipientName: g.recipientName,
            phone: g.phone, templateType: 'reminder_checker', message,
            pendingCount: g.items.length, forced: force,
          },
        });
        remindersSent++;
      }
    }
    this.logger.log(`Cek reminder WhatsApp (force=${force}): ${periodsChecked} periode terbuka, ${remindersSent} pesan disimulasikan.`);
    return { periodsChecked, remindersSent };
  }

  async getLogs(limit = 50) {
    return this.prisma.whatsAppLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}
