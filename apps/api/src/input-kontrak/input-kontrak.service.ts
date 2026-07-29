import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import {
  Step, stepMatches, stepRecipientWhere, slaRemainingDays, uname,
  buildReviewerSteps, validateReviewerSelection, CHECKER_ROLES, APPROVER_ROLES,
  type ReviewerParticipant,
} from '../common/workflow-steps';

@Injectable()
export class InputKontrakService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getList(unitCode?: string, periodId?: string, kmType?: string) {
    return this.prisma.kontrakManajemen.findMany({
      where: {
        ...(unitCode ? { unitCode } : {}),
        ...(periodId ? { periodId } : {}),
        ...(kmType ? { kmType } : {}),
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getById(id: string) {
    return this.prisma.kontrakManajemen.findUnique({ where: { id } });
  }

  // Registri KM yang sudah DISETUJUI penuh (final oleh GM).
  // KM bersifat TAHUNAN: acuan realisasi dicocokkan per-tahun (bukan per-bulan),
  // sehingga realisasi bulan apa pun pada tahun yg sama memakai KM tahun itu.
  // `kmType` memfilter dokumen Draft vs Final — dua registri terpisah, tidak dicampur.
  async getApproved(unitCode?: string, year?: string, kmType?: string) {
    let periodIdsInYear: string[] | undefined;
    if (year) {
      const periods = await this.prisma.period.findMany({
        where: { yearMonth: { startsWith: `${year}-` } },
        select: { id: true },
      });
      periodIdsInYear = periods.map((p) => p.id);
    }
    return this.prisma.kontrakManajemen.findMany({
      where: {
        status: 'approved',
        ...(unitCode ? { unitCode } : {}),
        ...(periodIdsInYear ? { periodId: { in: periodIdsInYear } } : {}),
        ...(kmType ? { kmType } : {}),
      },
      orderBy: [{ unitCode: 'asc' }, { reviewedAt: 'desc' }],
    });
  }

  // KM yang bisa dipakai sebagai acuan Input Realisasi — KM Sementara berjalan PARALEL
  // dengan alur reviewnya sendiri (Staff RPC → Checker → Approver), BUKAN prasyarat serial.
  // Begitu Staff RPC men-submit (keluar dari 'draft'), unit/bidang yang dituju sudah dapat
  // mengisi realisasi terhadapnya; dokumen KM lanjut direview independen di tab Dokumen KM.
  async getForRealisasi(unitCode?: string, year?: string, kmType?: string) {
    let periodIdsInYear: string[] | undefined;
    if (year) {
      const periods = await this.prisma.period.findMany({
        where: { yearMonth: { startsWith: `${year}-` } },
        select: { id: true },
      });
      periodIdsInYear = periods.map((p) => p.id);
    }
    return this.prisma.kontrakManajemen.findMany({
      where: {
        status: { in: ['submitted', 'ready', 'approved'] },
        ...(unitCode ? { unitCode } : {}),
        ...(periodIdsInYear ? { periodId: { in: periodIdsInYear } } : {}),
        ...(kmType ? { kmType } : {}),
      },
      orderBy: [{ unitCode: 'asc' }, { submittedAt: 'desc' }],
    });
  }

  // Save: create a NEW kontrak, or update an existing one when `id` is given.
  // Tidak lagi menimpa kontrak lain pada unit/periode yang sama.
  async save(
    user: User,
    id: string | undefined,
    unitCode: string,
    bidang: string,
    holder: string,
    kpiItems: object,
    kmType: string = 'draft',
  ) {
    if (kmType !== 'draft' && kmType !== 'final') throw new BadRequestException('kmType harus "draft" atau "final"');
    // Hanya Kantor Induk yang membuat KM (termasuk KM untuk UPMK). UPMK hanya mengisi realisasi.
    if (user.unit !== 'KP') throw new ForbiddenException('Kontrak Manajemen hanya dapat dibuat oleh Kantor Induk');
    // KM untuk unit UPMK: Staff RPC dapat memilih bidang mana pun (setiap KPI UPMK punya bidang penanggung jawab tersendiri).
    // KM untuk KP sendiri: bidang harus cocok dengan bidang user.
    const isUpmkKm = unitCode !== 'KP';
    if (user.role !== Role.GM && user.bidang && !isUpmkKm && bidang !== user.bidang) {
      throw new ForbiddenException('Anda hanya dapat menyusun Kontrak Manajemen pada bidang Anda');
    }
    const period = await this.prisma.period.findFirst({ where: { isActive: true } });
    if (!period) throw new BadRequestException('Tidak ada periode aktif');

    let result;
    if (id) {
      const existing = await this.prisma.kontrakManajemen.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Kontrak tidak ditemukan');
      if (existing.status === 'submitted' || existing.status === 'approved') {
        throw new ForbiddenException('Kontrak yang sudah dikirim tidak dapat diubah');
      }
      // kmType tidak dapat diubah setelah dibuat — Draft dan Final adalah dokumen independen.
      result = await this.prisma.kontrakManajemen.update({
        where: { id },
        data: { bidang, holder, kpiItems: kpiItems as object, submitter: user.name, submitterId: user.id },
      });
    } else {
      result = await this.prisma.kontrakManajemen.create({
        data: {
          periodId: period.id, unitCode, bidang, holder, kmType,
          kpiItems: kpiItems as object, submitter: user.name, submitterId: user.id, status: 'draft',
        },
      });
    }

    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: id ? 'kontrak.update' : 'kontrak.create', entity: 'KontrakManajemen', targetId: result.id },
    });
    await this.cache.del(`kontrak:${unitCode}`);
    return result;
  }

  // Notifikasi ke pemegang langkah berjalan.
  private async notifyStep(kontrakId: string, steps: Step[], stepIndex: number, unitCode: string, bidang: string, actorName: string) {
    const step = steps[stepIndex];
    if (!step) return;
    const recipients = await this.prisma.user.findMany({ where: stepRecipientWhere(step) });
    if (recipients.length === 0) return;
    await this.prisma.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id, type: 'approval', title: 'Usulan Kontrak Manajemen Menunggu Review',
        msg: `${actorName} meneruskan usulan KM ${uname(unitCode)} — ${bidang} untuk review: ${step.label}.`,
        route: '/approvals?type=km', targetId: kontrakId, unread: true,
      })),
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

  // Submit untuk review → mulai jenjang alur reviewer terpilih submitter.
  async submit(user: User, id: string, checkerIds: string[], approverIds: string[]) {
    if (user.unit !== 'KP') throw new ForbiddenException('Kontrak Manajemen hanya dapat dikirim oleh Kantor Induk');
    const kontrak = await this.prisma.kontrakManajemen.findUnique({ where: { id } });
    if (!kontrak) throw new NotFoundException('Kontrak tidak ditemukan');
    if (!Array.isArray(checkerIds) || checkerIds.length === 0) throw new BadRequestException('Pilih minimal satu Checker');
    if (!Array.isArray(approverIds) || approverIds.length === 0) throw new BadRequestException('Pilih minimal satu Approver');
    // Hanya penyusun (pembuat draft) yang dapat mengirim KM ini.
    if (kontrak.submitterId && kontrak.submitterId !== user.id) {
      throw new ForbiddenException('Hanya penyusun KM ini yang dapat mengirimnya');
    }

    const picked = await this.prisma.user.findMany({
      where: { id: { in: [...checkerIds, ...approverIds] }, isActive: true },
      select: { id: true, name: true, role: true, unit: true, bidang: true },
    });
    const checkers = checkerIds.map((cid) => picked.find((u) => u.id === cid)).filter(Boolean) as ReviewerParticipant[];
    const approvers = approverIds.map((aid) => picked.find((u) => u.id === aid)).filter(Boolean) as ReviewerParticipant[];
    if (checkers.length !== checkerIds.length) throw new BadRequestException('Sebagian Checker tidak ditemukan atau nonaktif');
    if (approvers.length !== approverIds.length) throw new BadRequestException('Sebagian Approver tidak ditemukan atau nonaktif');

    const submitter: ReviewerParticipant = { id: user.id, name: user.name, role: user.role, unit: user.unit, bidang: user.bidang };
    const srManajer = await this.prisma.user.findFirst({
      where: { role: Role.SRMANAJER, bidang: kontrak.bidang, unit: 'KP', isActive: true },
    });
    const invalid = validateReviewerSelection(user.id, checkers, approvers, !!srManajer);
    if (invalid) throw new BadRequestException(invalid);

    const steps = buildReviewerSteps(submitter, checkers, approvers);
    const history = [
      ...(Array.isArray(kontrak.history) ? (kontrak.history as object[]) : []),
      { stepIndex: 0, actor: user.name, role: user.role, action: 'submitted', label: steps[0].label, ts: new Date().toISOString() },
    ];
    const result = await this.prisma.kontrakManajemen.update({
      where: { id },
      data: {
        status: 'submitted', steps: steps as object, currentStepIndex: 1, currentStage: 1,
        history, reviewer: null, reviewNote: null, reviewedAt: null,
        submitter: user.name, submitterId: user.id, submittedAt: new Date(),
      },
    });
    await this.notifyStep(id, steps, 1, kontrak.unitCode, kontrak.bidang, user.name);
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'kontrak.submit', entity: 'KontrakManajemen', targetId: id },
    });
    await this.cache.del(`kontrak:${kontrak.unitCode}`);
    return result;
  }

  async delete(user: User, id: string) {
    const kontrak = await this.prisma.kontrakManajemen.findUnique({ where: { id } });
    if (!kontrak) throw new NotFoundException('Kontrak tidak ditemukan');
    if (kontrak.status === 'submitted' || kontrak.status === 'approved') {
      throw new ForbiddenException('Kontrak yang sudah dikirim tidak dapat dihapus');
    }

    await this.prisma.kontrakManajemen.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'kontrak.delete', entity: 'KontrakManajemen', targetId: id },
    });
    await this.cache.del(`kontrak:${kontrak.unitCode}`);
    return { success: true };
  }

  // Daftar usulan KM yang menunggu review pada LANGKAH milik user.
  async getReviewList(user: User) {
    const submitted = await this.prisma.kontrakManajemen.findMany({
      where: { status: 'submitted' },
      orderBy: { submittedAt: 'desc' },
    });
    return submitted
      .filter((k) => {
        const steps = (k.steps as unknown as Step[]) ?? [];
        return stepMatches(steps[k.currentStepIndex], user);
      })
      .map((k) => {
        const steps = (k.steps as unknown as Step[]) ?? [];
        return { ...k, stepLabel: steps[k.currentStepIndex]?.label ?? '—', slaRemainingDays: slaRemainingDays(k) };
      });
  }

  // Review berjenjang mengikuti `steps` (rantai bidang KI → RPC). GM menyetujui via BUNDLE tahunan.
  async review(
    user: User,
    id: string,
    action: 'approve' | 'reject',
    note?: string,
    returnTo: 'konseptor' | 'previous' = 'konseptor',
  ) {
    if (action !== 'approve' && action !== 'reject') throw new BadRequestException('Aksi tidak valid');
    const k = await this.prisma.kontrakManajemen.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('Kontrak tidak ditemukan');
    if (k.status !== 'submitted') throw new ForbiddenException('Kontrak tidak dalam status menunggu review');
    if (!note?.trim()) throw new BadRequestException('Catatan/komentar wajib diisi saat menyetujui atau menolak');

    const steps = (k.steps as unknown as Step[]) ?? [];
    const curIdx = k.currentStepIndex;
    if (!stepMatches(steps[curIdx], user)) {
      throw new ForbiddenException(`Usulan ini menunggu langkah "${steps[curIdx]?.label ?? 'lain'}", bukan langkah Anda`);
    }
    const baseHistory = Array.isArray(k.history) ? (k.history as object[]) : [];

    if (action === 'reject') {
      const toPrev = returnTo === 'previous' && curIdx - 1 >= 1;
      const newIdx = toPrev ? curIdx - 1 : 0;
      const history = [...baseHistory, { stepIndex: curIdx, actor: user.name, role: user.role, action: toPrev ? 'returned_step' : 'returned', toStepIndex: newIdx, label: steps[curIdx]?.label, note, ts: new Date().toISOString() }];
      const result = await this.prisma.kontrakManajemen.update({
        where: { id },
        data: { status: toPrev ? 'submitted' : 'rejected', currentStepIndex: newIdx, currentStage: newIdx, history, reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
      });
      if (toPrev) {
        await this.notifyStep(id, steps, newIdx, k.unitCode, k.bidang, user.name);
      } else if (k.submitterId) {
        await this.prisma.notification.create({
          data: {
            userId: k.submitterId, type: 'alert', title: 'Usulan KM Dikembalikan ke Konseptor',
            msg: `${user.name} (${steps[curIdx]?.label}) mengembalikan usulan KM ${uname(k.unitCode)} — ${k.bidang}: ${note}`,
            route: '/input-kontrak', targetId: id, unread: true,
          },
        });
      }
      await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: toPrev ? 'kontrak.return_step' : 'kontrak.reject', entity: 'KontrakManajemen', targetId: id, note } });
      await this.cache.del(`kontrak:${k.unitCode}`);
      return result;
    }

    // approve → maju
    const nextIdx = curIdx + 1;
    const chainDone = nextIdx >= steps.length;
    const history = [...baseHistory, { stepIndex: curIdx, actor: user.name, role: user.role, action: 'approved', label: steps[curIdx]?.label, note, ts: new Date().toISOString() }];
    const result = await this.prisma.kontrakManajemen.update({
      where: { id },
      data: {
        status: chainDone ? 'ready' : 'submitted',
        currentStepIndex: chainDone ? steps.length : nextIdx,
        currentStage: chainDone ? steps.length : nextIdx,
        history, reviewer: user.name, reviewNote: note, reviewedAt: new Date(),
      },
    });
    if (chainDone) {
      // Reset bundle scope yang relevan ke 'open' agar GM bisa menyahkan ulang.
      const period = await this.prisma.period.findUnique({ where: { id: k.periodId }, select: { yearMonth: true } });
      const yr = period?.yearMonth.slice(0, 4);
      if (yr) {
        const scope = k.unitCode === 'KP' ? 'KP' : 'UPMK';
        await this.prisma.kMBundle.updateMany({ where: { year: yr, scope, status: { in: ['rejected', 'approved'] } }, data: { status: 'open' } });
      }
      const gms = await this.prisma.user.findMany({ where: { role: Role.GM, isActive: true } });
      if (gms.length) {
        await this.prisma.notification.createMany({
          data: gms.map((g) => ({
            userId: g.id, type: 'approval', title: 'KM Siap Masuk Bundle Tahunan',
            msg: `KM ${uname(k.unitCode)} — ${k.bidang} lolos hingga SM Perencanaan & PC, siap dikonsolidasi tahunan.`,
            route: '/approvals?type=km-bundle', targetId: id, unread: true,
          })),
        });
      }
    } else {
      await this.notifyStep(id, steps, nextIdx, k.unitCode, k.bidang, user.name);
    }
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: 'kontrak.approve', entity: 'KontrakManajemen', targetId: id, note } });
    await this.cache.del(`kontrak:${k.unitCode}`);
    return result;
  }

  // Setujui semua dokumen yang menunggu di langkah user sekaligus — reuse getReviewList +
  // review() per-dokumen (chain advance/chainDone/notifikasi/reset bundle tetap ditangani di
  // sana). Satu note dipakai untuk semua; satu dokumen gagal tak menggagalkan sisanya.
  async bulkApprove(user: User, note: string) {
    if (!note?.trim()) throw new BadRequestException('Catatan/komentar wajib diisi saat menyetujui');
    const list = await this.getReviewList(user);
    let approved = 0, failed = 0;
    for (const doc of list) {
      try {
        await this.review(user, doc.id, 'approve', note);
        approved++;
      } catch {
        failed++;
      }
    }
    return { total: list.length, approved, failed };
  }

  // Edit KPI items oleh reviewer pada langkah aktif (status=submitted, stepMatches user).
  async updateKpiItems(user: User, id: string, kpiItems: object[]) {
    const km = await this.prisma.kontrakManajemen.findUnique({ where: { id } });
    if (!km) throw new NotFoundException('Kontrak tidak ditemukan');
    if (km.status !== 'submitted') throw new ForbiddenException('Hanya KM yang sedang direview yang dapat diedit');
    const steps = (km.steps as unknown as Step[]) ?? [];
    if (!stepMatches(steps[km.currentStepIndex], user)) {
      throw new ForbiddenException('KM ini bukan pada langkah Anda');
    }
    const history = [
      ...(Array.isArray(km.history) ? (km.history as object[]) : []),
      { stepIndex: km.currentStepIndex, actor: user.name, role: user.role, action: 'edited', ts: new Date().toISOString() },
    ];
    const result = await this.prisma.kontrakManajemen.update({ where: { id }, data: { kpiItems: kpiItems as object, history } });
    await this.prisma.auditLog.create({
      data: { actor: user.name, userId: user.id, action: 'kontrak.edit', entity: 'KontrakManajemen', targetId: id },
    });
    await this.cache.del(`kontrak:${km.unitCode}`);
    return result;
  }

  // ===== BUNDLE KM tahunan (persetujuan akhir GM, sekali untuk seluruh KM tahun tsb) =====
  private async periodIdsForYear(year: string) {
    const periods = await this.prisma.period.findMany({ where: { yearMonth: { startsWith: `${year}-` } }, select: { id: true } });
    return periods.map((p) => p.id);
  }
  private async resolveYear(year?: string) {
    if (year) return year;
    const active = await this.prisma.period.findFirst({ where: { isActive: true } });
    return active ? active.yearMonth.slice(0, 4) : String(new Date().getFullYear());
  }

  async getBundle(scope: 'KP' | 'UPMK' = 'KP', year?: string, kmType: string = 'draft') {
    const yr = await this.resolveYear(year);
    const pids = await this.periodIdsForYear(yr);
    const unitFilter = scope === 'KP' ? { unitCode: 'KP' } : { unitCode: { not: 'KP' } };
    const components = await this.prisma.kontrakManajemen.findMany({
      where: { periodId: { in: pids }, status: { in: ['submitted', 'ready', 'approved'] }, kmType, ...unitFilter },
      orderBy: [{ unitCode: 'asc' }, { bidang: 'asc' }],
    });
    const bundle = await this.prisma.kMBundle.findUnique({ where: { year_scope_kmType: { year: yr, scope, kmType } } });
    const readyCount = components.filter((c) => c.status === 'ready').length;
    const submittedCount = components.filter((c) => c.status === 'submitted').length;
    const canApprove = readyCount > 0 && submittedCount === 0;
    // effectiveStatus: 'approved' bila semua komponen sudah disahkan (meski belum ada bundle record
    // untuk scope ini — misal UPMK yang disahkan lewat bundle lama sebelum fitur pisah scope).
    const allApproved = components.length > 0 && components.every((c) => c.status === 'approved');
    const effectiveStatus = readyCount > 0 ? 'open' : allApproved ? 'approved' : (bundle?.status ?? 'open');
    // Sisipkan persenAgregasi ke tiap item (read-only, tak ditulis balik ke DB) — konsumen
    // (print bundle di FE) pakai ini utk membagi bobot sesuai porsi assignment alih-alih
    // mencetak bobotKm penuh berulang di tiap bidang saat 1 KPI di-assign ke banyak bidang.
    const masterIds = Array.from(new Set(
      components.flatMap((c) => (Array.isArray(c.kpiItems) ? c.kpiItems as Record<string, unknown>[] : [])
        .map((it) => it['masterKpiId']).filter((v): v is string => typeof v === 'string')),
    ));
    const assignments = masterIds.length
      ? await this.prisma.kpiAssignment.findMany({ where: { kpiMasterId: { in: masterIds } } })
      : [];
    const persenLookup = new Map(assignments.map((a) => [`${a.kpiMasterId}|${a.unitCode}|${a.bidang}`, a.persenAgregasi]));
    return {
      year: yr, scope, kmType, status: effectiveStatus, reviewer: bundle?.reviewer ?? null,
      reviewNote: bundle?.reviewNote ?? null, reviewedAt: bundle?.reviewedAt ?? null,
      total: components.length, readyCount, canApprove,
      components: components.map((c) => ({
        id: c.id, unitCode: c.unitCode, bidang: c.bidang, status: c.status,
        submitter: c.submitter, holder: c.holder, history: c.history,
        kpiItems: (Array.isArray(c.kpiItems) ? c.kpiItems as Record<string, unknown>[] : []).map((it) => ({
          ...it, persenAgregasi: persenLookup.get(`${it['masterKpiId']}|${c.unitCode}|${c.bidang}`),
        })),
      })),
    };
  }

  async reviewBundle(user: User, scope: 'KP' | 'UPMK', action: 'approve' | 'reject', note: string, year?: string, kmType: string = 'draft') {
    if (user.role !== Role.GM) throw new ForbiddenException('Hanya General Manager yang menyetujui bundle KM');
    if (!note?.trim()) throw new BadRequestException('Catatan/komentar wajib diisi');
    const yr = await this.resolveYear(year);
    const pids = await this.periodIdsForYear(yr);
    const unitFilter = scope === 'KP' ? { unitCode: 'KP' } : { unitCode: { not: 'KP' } };
    const scopeLabel = `${scope === 'KP' ? 'Kantor Induk' : 'UPMK'} (${kmType === 'draft' ? 'Draft' : 'Final'})`;
    const components = await this.prisma.kontrakManajemen.findMany({ where: { periodId: { in: pids }, status: { in: ['submitted', 'ready'] }, kmType, ...unitFilter } });
    if (components.length === 0) throw new BadRequestException(`Tidak ada KM ${scopeLabel} yang siap dikonsolidasi pada tahun ini`);

    if (action === 'approve') {
      if (!components.every((c) => c.status === 'ready')) throw new ForbiddenException(`Masih ada KM ${scopeLabel} yang belum lolos sampai SM Perencanaan & PC`);
      await this.prisma.kontrakManajemen.updateMany({ where: { periodId: { in: pids }, status: 'ready', kmType, ...unitFilter }, data: { status: 'approved', reviewer: user.name, reviewedAt: new Date() } });
    } else {
      // GM tolak bundle → kembalikan tiap komponen 'ready' ke langkah Manajer Perencanaan.
      for (const c of components.filter((x) => x.status === 'ready')) {
        const cSteps = (c.steps as unknown as Step[]) ?? [];
        let idx = cSteps.findIndex((s) => s.variant === 'man_perencanaan');
        if (idx < 0) idx = Math.max(0, cSteps.length - 2); // fallback: 1 langkah sebelum SM
        const baseHist = Array.isArray(c.history) ? (c.history as object[]) : [];
        const history = [...baseHist, {
          stepIndex: cSteps.length, actor: user.name, role: user.role,
          action: 'bundle_returned', toStepIndex: idx, label: cSteps[idx]?.label ?? 'Manajer Perencanaan',
          note, ts: new Date().toISOString(),
        }];
        await this.prisma.kontrakManajemen.update({
          where: { id: c.id },
          data: { status: 'submitted', currentStepIndex: idx, currentStage: idx, history, reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
        });
      }
    }
    const bundle = await this.prisma.kMBundle.upsert({
      where: { year_scope_kmType: { year: yr, scope, kmType } },
      update: { status: action === 'approve' ? 'approved' : 'rejected', reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
      create: { year: yr, scope, kmType, status: action === 'approve' ? 'approved' : 'rejected', reviewer: user.name, reviewNote: note, reviewedAt: new Date() },
    });
    const kmTypeLabel = kmType === 'draft' ? 'Draft' : 'Final';
    if (action === 'approve') {
      const submitterIds = [...new Set(components.map((c) => c.submitterId).filter(Boolean))] as string[];
      if (submitterIds.length) {
        await this.prisma.notification.createMany({
          data: submitterIds.map((sid) => ({
            userId: sid, type: 'success', title: 'Bundle KM Disetujui GM',
            msg: `Kontrak Manajemen ${kmTypeLabel} tahun ${yr} disahkan penuh oleh ${user.name}.`,
            route: '/input-kontrak', unread: true,
          })),
        });
      }
    } else {
      // Notifikasi ke Manajer Perencanaan (penerima limpahan tolakan bundle GM).
      const manPer = await this.prisma.user.findMany({ where: { isActive: true, roleVariant: { code: 'man_perencanaan' } } });
      if (manPer.length) {
        await this.prisma.notification.createMany({
          data: manPer.map((u) => ({
            userId: u.id, type: 'alert', title: 'Bundle KM Dikembalikan GM',
            msg: `${user.name} menolak bundle KM ${kmTypeLabel} tahun ${yr}. Komponen dikembalikan ke Manajer Perencanaan untuk ditinjau: ${note}`,
            route: '/approvals?type=km', unread: true,
          })),
        });
      }
    }
    await this.prisma.auditLog.create({ data: { actor: user.name, userId: user.id, action: `kontrak.bundle.${action}`, entity: 'KMBundle', targetId: bundle.id, note } });
    for (const c of components) await this.cache.del(`kontrak:${c.unitCode}`);
    return bundle;
  }
}
