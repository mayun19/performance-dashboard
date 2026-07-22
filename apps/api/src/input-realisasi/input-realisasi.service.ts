import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import { ExecutiveService } from '../executive/executive.service';
import { OperationalService } from '../operational/operational.service';
import { PeriodTargetService } from '../period-target/period-target.service';
import {
  Step, stepMatches, stepRecipientWhere, slaRemainingDays, uname,
  buildReviewerSteps, validateReviewerSelection, CHECKER_ROLES, APPROVER_ROLES,
  RPC_BIDANG,
  type ReviewerParticipant,
} from '../common/workflow-steps';
import { getFillWindowStatus } from '../common/period-window';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Evidence: batas & tipe yang diizinkan
const EVIDENCE_MAX_FILES = 5;
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB/file
const EVIDENCE_EXT = ['.pdf', '.xls', '.xlsx', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
const EVIDENCE_DIR = path.join(process.cwd(), 'uploads', 'realisasi');
type UploadFile = { originalname: string; buffer: Buffer; size: number; mimetype: string };
export interface Attachment { id: string; name: string; size: number; type: string; file: string; uploadedAt: string; uploader: string }

@Injectable()
export class InputRealisasiService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
    private executiveSvc: ExecutiveService,
    private operationalSvc: OperationalService,
    private periodTargetSvc: PeriodTargetService,
  ) {}

  private async invalidateKinerja(periodId: string, unitCode: string) {
    await this.cache.del(`realisasi:${unitCode}`);
    for (const m of ['Bulan', 'Semester', 'Tahun']) {
      await this.cache.del(`kinerja:active:${m}`);
      await this.cache.del(`kinerja:${periodId}:${m}`);
    }
  }

  async getHistory(unitCode?: string, periodId?: string) {
    return this.prisma.inputRealisasi.findMany({
      where: { ...(unitCode ? { unitCode } : {}), ...(periodId ? { periodId } : {}) },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // Daftar kandidat reviewer (Checker: ASMAN/Manajer, Approver: SRManajer/GM).
  async getReviewerCandidates() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [...CHECKER_ROLES, ...APPROVER_ROLES] } },
      orderBy: [{ role: 'asc' }, { unit: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, role: true, unit: true, bidang: true },
    });
    return {
      checkers: users.filter((u) => CHECKER_ROLES.includes(u.role)),
      approvers: users.filter((u) => APPROVER_ROLES.includes(u.role)),
    };
  }

  // PIC/Staff menyusun & submit realisasi (per unit, per bidang) → mulai jenjang alur reviewer terpilih.
  async submit(
    user: User,
    unitCode: string,
    bidang: string,
    values: Record<string, unknown>,
    checkerIds: string[],
    approverId: string,
    periodId?: string,
  ) {
    if (!bidang) throw new BadRequestException('Bidang wajib diisi');
    if (!Array.isArray(checkerIds) || checkerIds.length === 0) throw new BadRequestException('Pilih minimal satu Checker');
    if (!approverId) throw new BadRequestException('Pilih satu Approver');

    // Ambil kandidat & pertahankan urutan checker sesuai pilihan submitter.
    const picked = await this.prisma.user.findMany({
      where: { id: { in: [...checkerIds, approverId] }, isActive: true },
      select: { id: true, name: true, role: true, unit: true, bidang: true },
    });
    const checkers = checkerIds.map((id) => picked.find((u) => u.id === id)).filter(Boolean) as ReviewerParticipant[];
    const approver = picked.find((u) => u.id === approverId) as ReviewerParticipant | undefined;
    if (checkers.length !== checkerIds.length) throw new BadRequestException('Sebagian Checker tidak ditemukan atau nonaktif');

    const submitter: ReviewerParticipant = { id: user.id, name: user.name, role: user.role, unit: user.unit, bidang: user.bidang };
    const invalid = validateReviewerSelection(user.id, checkers, approver);
    if (invalid) throw new BadRequestException(invalid);

    const steps = buildReviewerSteps(submitter, checkers, approver!);

    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException(periodId ? 'Periode tidak ditemukan' : 'Tidak ada periode aktif');

    // Window pengisian: tanggal 25 bulan periode s.d. tanggal 5 bulan berikutnya
    // (atau dibuka manual via Period.windowOverride oleh GM/Admin).
    const win = getFillWindowStatus(period.yearMonth, period.windowOverride);
    if (!win.isOpen) {
      const fmt = (d: Date) => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
      throw new ForbiddenException(
        `Pengisian realisasi periode ${period.label} hanya dibuka ${fmt(win.start)} s.d. ${fmt(win.end)}. ` +
        (win.daysUntilOpen > 0 ? `Window akan dibuka dalam ${win.daysUntilOpen} hari.` : 'Window pengisian telah berakhir.'),
      );
    }

    const existing = await this.prisma.inputRealisasi.findUnique({
      where: { periodId_unitCode_bidang: { periodId: period.id, unitCode, bidang } },
    });
    const baseHistory = existing && Array.isArray(existing.history) ? (existing.history as object[]) : [];
    const history = [...baseHistory, { stepIndex: 0, actor: user.name, role: user.role, action: 'submitted', label: steps[0].label, ts: new Date().toISOString() }];

    // selfAssessment: snapshot nilai persis seperti diinput submitter — dikunci di sini,
    // TIDAK PERNAH diubah lagi oleh reviewer (mereka hanya mengoreksi `values`/working copy).
    // Diperbarui hanya saat submit BARU/re-submit (mis. setelah ditolak ke konseptor).
    const selfAssessment = values;

    // Living-target: catat target-of-record (masterKpiId -> nilai target Sementara berlaku
    // SAAT INI) di setiap (re-)submit. Karena target hidup sampai KM Final tiba, ini adalah
    // titik yang benar untuk mengunci "target yang dipakai" — re-submit setelah PIC REN
    // mengoreksi target akan menangkap nilai baru secara otomatis.
    const items = Object.values(values as Record<string, Record<string, unknown>>);
    const { targetByMaster } = await this.periodTargetSvc.resolveForPackage(period.id, unitCode, bidang, items);

    const result = await this.prisma.inputRealisasi.upsert({
      where: { periodId_unitCode_bidang: { periodId: period.id, unitCode, bidang } },
      update: {
        values: values as object, selfAssessment: selfAssessment as object, submitter: user.name, submitterId: user.id,
        status: 'submitted', steps: steps as object, currentStepIndex: 1, currentStage: 1,
        targetOfRecord: targetByMaster as object, packagePhase: 'sementara',
        history, reviewer: null, reviewNote: null, reviewedAt: null, submittedAt: new Date(),
      },
      create: {
        periodId: period.id, unitCode, bidang, submitter: user.name, submitterId: user.id,
        values: values as object, selfAssessment: selfAssessment as object,
        status: 'submitted', steps: steps as object, currentStepIndex: 1, currentStage: 1, history,
        targetOfRecord: targetByMaster as object,
      },
    });

    await this.notifyStep(result.id, steps, 1, unitCode, bidang, user.name);
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'realisasi.submit', entity: 'InputRealisasi', targetId: result.id },
    });
    await this.invalidateKinerja(period.id, unitCode);
    return result;
  }

  private async notifyStep(realisasiId: string, steps: Step[], stepIndex: number, unitCode: string, bidang: string, actorName: string) {
    const step = steps[stepIndex];
    if (!step) return;
    const recipients = await this.prisma.user.findMany({ where: stepRecipientWhere(step) });
    if (recipients.length === 0) return;
    await this.prisma.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id, type: 'approval', title: 'Realisasi Kinerja Menunggu Review',
        msg: `${actorName} meneruskan Realisasi ${uname(unitCode)} — ${bidang} untuk review: ${step.label}.`,
        route: '/approvals?type=realisasi', targetId: realisasiId, unread: true,
      })),
    });
  }

  async delete(user: User, id: string) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    if (r.status === 'approved') throw new ForbiddenException('Realisasi yang sudah disetujui final tidak dapat dihapus');
    const isOwner = r.submitterId && r.submitterId === user.id;
    if (!isOwner && user.role !== Role.GM) {
      throw new ForbiddenException('Hanya pengirim atau GM yang dapat menghapus realisasi ini');
    }
    await this.prisma.inputRealisasi.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'realisasi.delete', entity: 'InputRealisasi', targetId: id },
    });
    await this.invalidateKinerja(r.periodId, r.unitCode);
    return { success: true };
  }

  // Daftar realisasi yang menunggu review pada LANGKAH milik user.
  async getReviewList(user: User) {
    if (user.role === Role.STAFF) {
      // Staff bisa jadi penyusun langkah-0; tapi review (langkah ≥1) bukan untuk staff penyusun.
      // Tetap perbolehkan staff RPC (PIC Perencanaan) yang menjadi langkah konsolidasi.
    }
    const submitted = await this.prisma.inputRealisasi.findMany({
      where: { status: 'submitted' },
      orderBy: { submittedAt: 'desc' },
    });
    return submitted
      .filter((r) => {
        const steps = (r.steps as unknown as Step[]) ?? [];
        return stepMatches(steps[r.currentStepIndex], user);
      })
      .map((r) => {
        const steps = (r.steps as unknown as Step[]) ?? [];
        return { ...r, stepLabel: steps[r.currentStepIndex]?.label ?? '—', slaRemainingDays: slaRemainingDays(r) };
      });
  }

  // Reviewer pada langkahnya dapat mengedit nilai realisasi (revisi minor) sebelum menyetujui.
  async updateValues(user: User, id: string, values: Record<string, unknown>, note?: string) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    if (r.status !== 'submitted') throw new ForbiddenException('Hanya realisasi yang sedang direview yang dapat diedit');
    const steps = (r.steps as unknown as Step[]) ?? [];
    if (!stepMatches(steps[r.currentStepIndex], user)) {
      throw new ForbiddenException('Realisasi ini bukan pada langkah Anda');
    }
    const baseHistory = Array.isArray(r.history) ? (r.history as object[]) : [];
    const history = [...baseHistory, { stepIndex: r.currentStepIndex, actor: user.name, role: user.role, action: 'edited', ts: new Date().toISOString() }];
    const result = await this.prisma.inputRealisasi.update({ where: { id }, data: { values: values as object, history } });
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'realisasi.edit', entity: 'InputRealisasi', targetId: id },
    });
    // Audit simetris (Fase 5): koreksi nilai realisasi (KI review) dicatat berdampingan
    // dengan koreksi target (period_target) — RevisionLog jadi satu sumber kebenaran
    // level-NILAI utk timeline package, terpisah dari InputRealisasi.history (level-LANGKAH).
    const oldValues = (r.values ?? {}) as Record<string, unknown>;
    if (JSON.stringify(oldValues) !== JSON.stringify(values)) {
      await this.prisma.revisionLog.create({
        data: {
          entity: 'input_realisasi', targetId: id, periodId: r.periodId,
          actor: user.name, actorId: user.id, field: 'values',
          oldValue: oldValues as object, newValue: values as object,
          note,
        },
      });
    }
    await this.invalidateKinerja(r.periodId, r.unitCode);
    return result;
  }

  // ===== Fase 5: Audit simetris — timeline revisi gabungan (target + nilai realisasi) =====
  // InputRealisasi.history tetap mencatat level LANGKAH (approve/reject/edit per step);
  // RevisionLog di sini mencatat level NILAI (diff lama->baru), digabung dari dua entity:
  //   'input_realisasi' — koreksi values oleh reviewer (KI) via updateValues.
  //   'period_target'   — koreksi target KM Sementara oleh PIC REN (langsung atau via resolveTargetFix).
  async getRevisionHistory(id: string) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');

    const items = Object.values((r.values ?? {}) as Record<string, Record<string, unknown>>);
    const periodTargetIds = await this.periodTargetSvc.findPeriodTargetIdsForPackage(r.periodId, r.unitCode, r.bidang, items);

    const [ownRevisions, targetRevisions] = await Promise.all([
      this.prisma.revisionLog.findMany({ where: { entity: 'input_realisasi', targetId: id }, orderBy: { createdAt: 'desc' } }),
      periodTargetIds.length > 0
        ? this.prisma.revisionLog.findMany({ where: { entity: 'period_target', targetId: { in: periodTargetIds } }, orderBy: { createdAt: 'desc' } })
        : Promise.resolve([]),
    ]);

    return [...ownRevisions, ...targetRevisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ===== EVIDENCE (lampiran realisasi) =====
  async addEvidence(user: User, id: string, files: UploadFile[]) {
    if (!files?.length) throw new BadRequestException('Tidak ada berkas yang diunggah');
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    const steps = (r.steps as unknown as Step[]) ?? [];
    const allowed = r.submitterId === user.id || user.role === Role.GM || stepMatches(steps[r.currentStepIndex], user);
    if (!allowed) throw new ForbiddenException('Anda tidak berwenang melampirkan evidence pada realisasi ini');

    const existing: Attachment[] = Array.isArray(r.attachments) ? (r.attachments as unknown as Attachment[]) : [];
    if (existing.length + files.length > EVIDENCE_MAX_FILES) {
      throw new BadRequestException(`Maksimal ${EVIDENCE_MAX_FILES} berkas per realisasi`);
    }
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase();
      if (!EVIDENCE_EXT.includes(ext)) throw new BadRequestException(`Tipe berkas tidak didukung: ${f.originalname}. Hanya PDF, Excel, Word, JPG/PNG.`);
      if (f.size > EVIDENCE_MAX_BYTES) throw new BadRequestException(`Berkas ${f.originalname} melebihi 10 MB`);
    }
    const dir = path.join(EVIDENCE_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const added: Attachment[] = files.map((f) => {
      const fid = randomUUID();
      const safe = f.originalname.replace(/[^\w.\-]+/g, '_');
      const fname = `${fid}__${safe}`;
      fs.writeFileSync(path.join(dir, fname), f.buffer);
      return { id: fid, name: f.originalname, size: f.size, type: f.mimetype, file: fname, uploadedAt: new Date().toISOString(), uploader: user.name };
    });
    const attachments = [...existing, ...added];
    await this.prisma.inputRealisasi.update({ where: { id }, data: { attachments: attachments as object } });
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: 'realisasi.evidence.add', entity: 'InputRealisasi', targetId: id, note: added.map((a) => a.name).join(', ') } });
    return attachments;
  }

  async getEvidenceFile(id: string, fileId: string) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    const att = (Array.isArray(r.attachments) ? (r.attachments as unknown as Attachment[]) : []).find((a) => a.id === fileId);
    if (!att) throw new NotFoundException('Berkas tidak ditemukan');
    const fp = path.join(EVIDENCE_DIR, id, att.file);
    if (!fs.existsSync(fp)) throw new NotFoundException('Berkas hilang dari penyimpanan');
    return { path: fp, name: att.name, type: att.type };
  }

  async deleteEvidence(user: User, id: string, fileId: string) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    const list: Attachment[] = Array.isArray(r.attachments) ? (r.attachments as unknown as Attachment[]) : [];
    const att = list.find((a) => a.id === fileId);
    if (!att) throw new NotFoundException('Berkas tidak ditemukan');
    if (r.submitterId !== user.id && user.role !== Role.GM) throw new ForbiddenException('Hanya pengunggah/pengirim atau GM yang dapat menghapus evidence');
    try { fs.unlinkSync(path.join(EVIDENCE_DIR, id, att.file)); } catch { /* abaikan */ }
    const attachments = list.filter((a) => a.id !== fileId);
    await this.prisma.inputRealisasi.update({ where: { id }, data: { attachments: attachments as object } });
    return attachments;
  }

  // Review berjenjang mengikuti `steps`:
  //  approve → maju 1 langkah; bila lewat langkah terakhir → status 'ready' (menunggu bundle GM)
  //  reject  → 'konseptor' (kembali ke penyusun), 'previous' (mundur 1 langkah), atau
  //            'target' (masalah pada KM Sementara, bukan realisasi → routing ke PIC REN,
  //            lihat resolveTargetFix). Seluruh package (KM Sementara + Realisasi) mengikuti
  //            aturan whole-package bounce — tak ada unlock sebagian.
  async review(
    user: User,
    id: string,
    action: 'approve' | 'reject',
    note?: string,
    returnTo: 'konseptor' | 'previous' | 'target' = 'konseptor',
  ) {
    if (action !== 'approve' && action !== 'reject') throw new BadRequestException('Aksi tidak valid');
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    if (r.status !== 'submitted') throw new ForbiddenException('Realisasi tidak dalam status menunggu review');
    if (!note?.trim()) throw new BadRequestException('Catatan/komentar wajib diisi saat menyetujui atau menolak');

    const steps = (r.steps as unknown as Step[]) ?? [];
    const curIdx = r.currentStepIndex;
    if (!stepMatches(steps[curIdx], user)) {
      throw new ForbiddenException(`Realisasi ini menunggu langkah "${steps[curIdx]?.label ?? 'lain'}", bukan langkah Anda`);
    }
    const baseHistory = Array.isArray(r.history) ? (r.history as object[]) : [];

    if (action === 'reject' && returnTo === 'target') {
      const history = [...baseHistory, { stepIndex: curIdx, actor: user.name, role: user.role, action: 'flagged_target', label: steps[curIdx]?.label, note, ts: new Date().toISOString() }];
      const result = await this.prisma.inputRealisasi.update({
        where: { id },
        data: { status: 'target_fix', history, reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
      });
      const picRen = await this.prisma.user.findMany({
        where: { isActive: true, role: Role.STAFF, bidang: RPC_BIDANG, unit: 'KP' },
      });
      if (picRen.length) {
        await this.prisma.notification.createMany({
          data: picRen.map((u) => ({
            userId: u.id, type: 'alert', title: 'KM Sementara Perlu Dikoreksi',
            msg: `${user.name} (${steps[curIdx]?.label}) menandai target KM Sementara ${uname(r.unitCode)} — ${r.bidang} perlu koreksi: ${note}`,
            route: '/period-target', targetId: id, unread: true,
          })),
        });
      }
      await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: 'realisasi.flag_target', entity: 'InputRealisasi', targetId: id, note } });
      await this.invalidateKinerja(r.periodId, r.unitCode);
      return result;
    }

    if (action === 'reject') {
      const toPrev = returnTo === 'previous' && curIdx - 1 >= 1;
      const newIdx = toPrev ? curIdx - 1 : 0;
      const history = [...baseHistory, { stepIndex: curIdx, actor: user.name, role: user.role, action: toPrev ? 'returned_step' : 'returned', toStepIndex: newIdx, label: steps[curIdx]?.label, note, ts: new Date().toISOString() }];
      const result = await this.prisma.inputRealisasi.update({
        where: { id },
        data: {
          status: toPrev ? 'submitted' : 'rejected',
          currentStepIndex: newIdx, currentStage: newIdx,
          history, reviewer: user.name, reviewNote: note, reviewedAt: new Date(),
        },
      });
      if (toPrev) {
        await this.notifyStep(id, steps, newIdx, r.unitCode, r.bidang, user.name);
      } else if (r.submitterId) {
        await this.prisma.notification.create({
          data: {
            userId: r.submitterId, type: 'alert', title: 'Realisasi Dikembalikan ke Konseptor',
            msg: `${user.name} (${steps[curIdx]?.label}) mengembalikan Realisasi ${uname(r.unitCode)} — ${r.bidang}: ${note}`,
            route: '/input-realisasi', targetId: id, unread: true,
          },
        });
      }
      await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: toPrev ? 'realisasi.return_step' : 'realisasi.reject', entity: 'InputRealisasi', targetId: id, note } });
      await this.invalidateKinerja(r.periodId, r.unitCode);
      return result;
    }

    // approve → maju
    const nextIdx = curIdx + 1;
    const chainDone = nextIdx >= steps.length;
    const history = [...baseHistory, { stepIndex: curIdx, actor: user.name, role: user.role, action: 'approved', label: steps[curIdx]?.label, note, ts: new Date().toISOString() }];
    const result = await this.prisma.inputRealisasi.update({
      where: { id },
      data: {
        status: chainDone ? 'ready' : 'submitted',
        currentStepIndex: chainDone ? steps.length : nextIdx,
        currentStage: chainDone ? steps.length : nextIdx,
        history, reviewer: user.name, reviewNote: note, reviewedAt: new Date(),
      },
    });
    if (chainDone) {
      // Lolos sampai SM RPC → siap masuk bundle periode. Beri tahu GM.
      const gms = await this.prisma.user.findMany({ where: { role: Role.GM, isActive: true } });
      if (gms.length) {
        await this.prisma.notification.createMany({
          data: gms.map((g) => ({
            userId: g.id, type: 'approval', title: 'Realisasi Siap Masuk Bundle',
            msg: `Realisasi ${uname(r.unitCode)} — ${r.bidang} telah lolos hingga SM Perencanaan & PC dan siap dikonsolidasi periode.`,
            route: '/approvals?type=realisasi-bundle', targetId: id, unread: true,
          })),
        });
      }
    } else {
      await this.notifyStep(id, steps, nextIdx, r.unitCode, r.bidang, user.name);
    }
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: 'realisasi.approve', entity: 'InputRealisasi', targetId: id, note } });
    await this.invalidateKinerja(r.periodId, r.unitCode);
    return result;
  }

  // PIC REN mengoreksi KM Sementara untuk package yang di-flag (status 'target_fix').
  // Setelah dikoreksi, package kembali ke PIC (status 'rejected' — pola yang sama dgn
  // "kembali ke konseptor") untuk RE-VALIDASI realisasi terhadap target baru sebelum
  // resubmit — target baru mengubah capaian, jadi PIC harus mengonfirmasi ulang, bukan
  // langsung lanjut ke review.
  async resolveTargetFix(
    user: User,
    id: string,
    updates: { kpiAssignmentId: string; target: string }[],
    note: string,
  ) {
    const r = await this.prisma.inputRealisasi.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Realisasi tidak ditemukan');
    if (r.status !== 'target_fix') throw new ForbiddenException('Realisasi ini tidak sedang menunggu koreksi target');
    if (!this.periodTargetSvc.isPicRen(user)) throw new ForbiddenException('Hanya PIC REN yang dapat menyelesaikan koreksi target');
    if (!Array.isArray(updates) || updates.length === 0) throw new BadRequestException('Minimal satu koreksi target diperlukan');
    if (!note?.trim()) throw new BadRequestException('Catatan koreksi wajib diisi');

    for (const u of updates) {
      await this.periodTargetSvc.updateTarget(user, r.periodId, u.kpiAssignmentId, u.target, note);
    }

    const baseHistory = Array.isArray(r.history) ? (r.history as object[]) : [];
    const history = [...baseHistory, { stepIndex: 0, actor: user.name, role: user.role, action: 'target_fixed', note, ts: new Date().toISOString() }];
    const result = await this.prisma.inputRealisasi.update({
      where: { id },
      data: { status: 'rejected', currentStepIndex: 0, currentStage: 0, history, reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
    });
    if (r.submitterId) {
      await this.prisma.notification.create({
        data: {
          userId: r.submitterId, type: 'alert', title: 'Target KM Sementara Dikoreksi — Perlu Resubmit',
          msg: `${user.name} (PIC REN) mengoreksi target KM Sementara ${uname(r.unitCode)} — ${r.bidang}: ${note}. Mohon periksa ulang realisasi & kirim ulang.`,
          route: '/input-realisasi', targetId: id, unread: true,
        },
      });
    }
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: 'realisasi.target_fixed', entity: 'InputRealisasi', targetId: id, note } });
    await this.invalidateKinerja(r.periodId, r.unitCode);
    return result;
  }

  // ===== BUNDLE periode (persetujuan akhir oleh GM, sekali untuk seluruh komponen) =====

  async getBundle(periodId?: string) {
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) return { period: null, status: 'open', components: [], total: 0, readyCount: 0, canApprove: false };

    const components = await this.prisma.inputRealisasi.findMany({
      where: { periodId: period.id, status: { in: ['submitted', 'target_fix', 'ready', 'approved'] } },
      orderBy: [{ unitCode: 'asc' }, { bidang: 'asc' }],
    });
    const bundle = await this.prisma.realisasiBundle.findUnique({ where: { periodId: period.id } });
    const readyCount = components.filter((c) => c.status === 'ready').length;
    const approvedCount = components.filter((c) => c.status === 'approved').length;
    // All-or-nothing: package yang masih 'submitted' (dalam review) ATAU 'target_fix'
    // (menunggu koreksi PIC REN) sama-sama memblokir freeze bundle periode ini.
    const inProgressCount = components.filter((c) => c.status === 'submitted' || c.status === 'target_fix').length;
    const inflight = components.length;
    // GM dapat menyetujui bila ada komponen 'ready' & tak ada lagi yang masih dalam proses.
    const canApprove = readyCount > 0 && inProgressCount === 0;
    return {
      period,
      status: bundle?.status ?? 'open',
      reviewer: bundle?.reviewer ?? null,
      reviewNote: bundle?.reviewNote ?? null,
      reviewedAt: bundle?.reviewedAt ?? null,
      total: inflight,
      readyCount,
      approvedCount,
      canApprove,
      components: components.map((c) => ({
        id: c.id, unitCode: c.unitCode, bidang: c.bidang, status: c.status,
        submitter: c.submitter, reviewer: c.reviewer, values: c.values,
      })),
    };
  }

  async reviewBundle(user: User, action: 'approve' | 'reject', note: string, periodId?: string) {
    if (user.role !== Role.GM) throw new ForbiddenException('Hanya General Manager yang menyetujui bundle realisasi');
    if (!note?.trim()) throw new BadRequestException('Catatan/komentar wajib diisi');
    const period = periodId
      ? await this.prisma.period.findUnique({ where: { id: periodId } })
      : await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException('Periode tidak ditemukan');

    const components = await this.prisma.inputRealisasi.findMany({
      where: { periodId: period.id, status: { in: ['submitted', 'target_fix', 'ready'] } },
    });
    if (components.length === 0) throw new BadRequestException('Tidak ada realisasi yang siap dikonsolidasi pada periode ini');

    if (action === 'approve') {
      if (!components.every((c) => c.status === 'ready')) {
        throw new ForbiddenException('Masih ada komponen yang belum lolos sampai SM Perencanaan & PC (termasuk yang menunggu koreksi target)');
      }
      await this.prisma.inputRealisasi.updateMany({
        where: { periodId: period.id, status: 'ready' },
        data: { status: 'approved', reviewer: user.name, reviewedAt: new Date() },
      });
      // All-or-nothing freeze: living target (KM Sementara) periode ini dibekukan bersamaan
      // dengan persetujuan bundle — nilai target-of-record tak lagi bisa dikoreksi PIC REN
      // sampai KM Final tiba & memicu restatement.
      await this.periodTargetSvc.freezePeriod(period.id);
    } else {
      // tolak seluruh bundle → kembalikan komponen 'ready' ke konseptor
      await this.prisma.inputRealisasi.updateMany({
        where: { periodId: period.id, status: 'ready' },
        data: { status: 'rejected', currentStepIndex: 0, currentStage: 0, reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
      });
    }

    const bundle = await this.prisma.realisasiBundle.upsert({
      where: { periodId: period.id },
      update: { status: action === 'approve' ? 'approved' : 'rejected', reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
      create: { periodId: period.id, status: action === 'approve' ? 'approved' : 'rejected', reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
    });

    // Notifikasi penyusun
    const submitterIds = [...new Set(components.map((c) => c.submitterId).filter(Boolean))] as string[];
    if (submitterIds.length) {
      await this.prisma.notification.createMany({
        data: submitterIds.map((sid) => ({
          userId: sid, type: action === 'approve' ? 'success' : 'alert',
          title: action === 'approve' ? 'Bundle Realisasi Disetujui GM' : 'Bundle Realisasi Dikembalikan GM',
          msg: action === 'approve'
            ? `Realisasi periode ${period.label} disetujui penuh oleh ${user.name}.`
            : `Bundle realisasi periode ${period.label} dikembalikan oleh ${user.name}: ${note}`,
          route: action === 'approve' ? '/operational' : '/input-realisasi', unread: true,
        })),
      });
    }
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: `realisasi.bundle.${action}`, entity: 'RealisasiBundle', targetId: bundle.id, note } });
    // Segarkan dashboard kinerja
    for (const m of ['Bulan', 'Semester', 'Tahun']) {
      await this.cache.del(`kinerja:active:${m}`);
      await this.cache.del(`kinerja:${period.id}:${m}`);
    }
    // Perbarui snapshot Executive & Operational dari data realisasi aktual (fire-and-forget)
    if (action === 'approve') {
      const pid = period.id;
      setImmediate(() => {
        Promise.all([
          this.executiveSvc.refreshFromRealisasi(pid),
          this.operationalSvc.refreshFromRealisasi(pid),
        ]).catch((err: unknown) => {
          console.error('[Snapshot Refresh] Error saat memperbarui snapshot:', err);
        });
      });
    }
    return bundle;
  }
}
