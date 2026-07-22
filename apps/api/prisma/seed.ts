import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs';
import * as path from 'node:path';

const prisma = new PrismaClient();

const seedData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'),
);

const DATA = seedData.DATA as Record<string, unknown>;
const ROLES = seedData.ROLES as Record<string, { name: string; unit: string; email?: string }>;

const extra = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'seed-extra.json'), 'utf8'),
) as {
  procBiz: object;
  organisasi: object;
  gcgEsg: object;
  peta: object;
  roleVariants: Array<{ code: string; label: string; tier: string; scope: string }>;
};

const ROLE_MAP: Record<string, Role> = {
  staff: Role.STAFF,
  asman: Role.ASMAN,
  manajer: Role.MANAJER,
  srmanajer: Role.SRMANAJER,
  gm: Role.GM,
};

// Varian peran representatif untuk tiap user demo
const REP_VARIANT: Record<string, string> = {
  staff: 'staff_general',
  asman: 'asman_generic',
  manajer: 'man_project_control',
  srmanajer: 'sm_pc',
  gm: 'gm_pusmanpro',
};

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Pusmanpro@2026';

async function main() {
  console.log('Seeding database…');

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Role variants catalog — taksonomi peran selaras prototipe
  for (const rv of extra.roleVariants) {
    await prisma.roleVariant.upsert({
      where: { code: rv.code },
      update: { label: rv.label, tier: ROLE_MAP[rv.tier], scope: rv.scope },
      create: { code: rv.code, label: rv.label, tier: ROLE_MAP[rv.tier], scope: rv.scope },
    });
  }
  console.log('  role_variants:', extra.roleVariants.length);

  // 4 Bidang baku PUSMANPRO (Kantor Induk) + 2 unit lintas-bidang di bawah GM
  const OMP = 'Operasi Manajemen Proyek';
  const QAQC = 'QA/QC';
  const RPC = 'Perencanaan & Project Control';
  const KKU = 'Keuangan, Komunikasi & Umum';
  const K3L = 'K3L';
  const MRO = 'MRO';

  const variantId = async (code: string) => (await prisma.roleVariant.findUnique({ where: { code } }))?.id ?? null;
  const upsertUser = async (slug: string, name: string, role: Role, bidang: string | null, variantCode: string, unit = 'KP') => {
    const email = `${slug}@pusmanpro.pln.co.id`;
    const rvId = await variantId(variantCode);
    await prisma.user.upsert({
      where: { email },
      update: { name, role, bidang, unit, roleVariantId: rvId },
      create: { email, name, role, unit, bidang, passwordHash: hash, isActive: true, roleVariantId: rvId, prefs: { create: {} } },
    });
  };

  // Akun Kantor Induk per JABATAN (sesuai pendetailan rantai per bidang).
  const KI_USERS: Array<[string, string, Role, string, string]> = [
    // OMP
    ['staff.officer', 'Staff Kinerja OMP', Role.STAFF, OMP, 'staff_general'],
    ['asman.em.omp', 'ASMAN Elektromekanik', Role.ASMAN, OMP, 'asman_elektromekanik'],
    ['asman.jr.omp', 'ASMAN Jaringan', Role.ASMAN, OMP, 'asman_jaringan'],
    ['man.pembangkit.omp', 'Manajer Operasi Proyek Pembangkit', Role.MANAJER, OMP, 'man_operasi_pembangkit'],
    ['man.jaringan.omp', 'Manajer Operasi Proyek Jaringan', Role.MANAJER, OMP, 'man_operasi_jaringan'],
    ['sm.omp', 'SM Operasi Manajemen Proyek', Role.SRMANAJER, OMP, 'sm_omp'],
    // QA/QC
    ['staff.qaqc', 'Staff Kinerja QA/QC', Role.STAFF, QAQC, 'staff_general'],
    ['man.qaqc.pembangkit', 'Manajer QA/QC Pembangkit', Role.MANAJER, QAQC, 'man_qaqc_pembangkit'],
    ['man.qaqc.jaringan', 'Manajer QA/QC Jaringan', Role.MANAJER, QAQC, 'man_qaqc_jaringan'],
    ['sm.qaqc', 'SM QA/QC', Role.SRMANAJER, QAQC, 'sm_qaqc'],
    // RPC (Perencanaan & Project Control)
    ['staff.rpc', 'Staff Kinerja RPC', Role.STAFF, RPC, 'staff_general'],
    ['man.pc', 'Manajer Project Control', Role.MANAJER, RPC, 'man_project_control'],
    ['man.perencanaan', 'Manajer Perencanaan', Role.MANAJER, RPC, 'man_perencanaan'],
    ['sm.rpc', 'SM Perencanaan & Project Control', Role.SRMANAJER, RPC, 'sm_pc'],
    // KKU
    ['staff.kku', 'Staff Kinerja KKU', Role.STAFF, KKU, 'staff_general'],
    ['man.keuangan', 'Manajer Keuangan', Role.MANAJER, KKU, 'man_keuangan'],
    ['man.akuntansi', 'Manajer Akuntansi', Role.MANAJER, KKU, 'man_akuntansi'],
    ['man.aset', 'Manajer Aset & Properti', Role.MANAJER, KKU, 'man_aset_properti'],
    ['sm.kku', 'SM Keuangan, Komunikasi & Umum', Role.SRMANAJER, KKU, 'sm_kku'],
    // K3L & MRO (langsung di bawah GM)
    ['asman.k3l', 'ASMAN K3L', Role.ASMAN, K3L, 'asman_k3l'],
    ['asman.mro', 'ASMAN Manajemen Risiko & Kepatuhan', Role.ASMAN, MRO, 'asman_risiko'],
  ];
  for (const [slug, name, role, bidang, vc] of KI_USERS) await upsertUser(slug, name, role, bidang, vc);
  await upsertUser('gm', 'General Manager PUSMANPRO', Role.GM, null, 'gm_pusmanpro');
  console.log('  KI users per jabatan:', KI_USERS.length + 1);

  // System Admin accounts (Super Admin & Developer)
  await upsertUser('superadmin', 'Super Administrator', Role.SUPERADMIN, null, 'gm_pusmanpro');
  await upsertUser('developer', 'Developer Account', Role.DEVELOPER, null, 'gm_pusmanpro');
  console.log('  system_admin_accounts: 2');

  // User UPMK (Staff Kinerja / ASMAN / MUP-Manajer) per UPMK I–V untuk alur realisasi UPMK.
  const UPMK_CODES = ['UPMK1', 'UPMK2', 'UPMK3', 'UPMK4', 'UPMK5'];
  const UPMK_ROLES: Array<{ key: string; role: Role; label: string }> = [
    { key: 'staff', role: Role.STAFF, label: 'Staff Kinerja' },
    { key: 'asman', role: Role.ASMAN, label: 'ASMAN' },
    { key: 'manajer', role: Role.MANAJER, label: 'MUP' },
  ];
  for (const code of UPMK_CODES) {
    const slug = code.toLowerCase();
    for (const r of UPMK_ROLES) {
      const email = `${r.key}.${slug}@pusmanpro.pln.co.id`;
      const variant = await prisma.roleVariant.findUnique({ where: { code: REP_VARIANT[r.key] } });
      await prisma.user.upsert({
        where: { email },
        update: { unit: code, bidang: null, roleVariantId: variant?.id ?? null },
        create: {
          email, name: `${r.label} ${code}`, role: r.role, unit: code, bidang: null,
          passwordHash: hash, isActive: true, roleVariantId: variant?.id ?? null, prefs: { create: {} },
        },
      });
    }
    console.log('  users upmk:', code);
  }

  // Periode — 12 bulan tahun berjalan 2026. Aktif = Februari 2026 (selaras snapshot domain).
  const BULAN_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const ACTIVE_YM = '2026-02';
  let period!: Awaited<ReturnType<typeof prisma.period.upsert>>;
  for (let m = 0; m < 12; m++) {
    const ym = `2026-${String(m + 1).padStart(2, '0')}`;
    const isActive = ym === ACTIVE_YM;
    const p = await prisma.period.upsert({
      where: { yearMonth: ym },
      update: { isActive, label: `${BULAN_ID[m]} 2026` },
      create: { yearMonth: ym, label: `${BULAN_ID[m]} 2026`, isActive },
    });
    if (isActive) period = p;
  }
  console.log('  periods: 12 bulan 2026, aktif:', period.label);

  // Domain snapshots — store the exact prototype DATA sections as JSON blobs
  const meta = { periodId: period.id };

  await prisma.executiveSnapshot.upsert({
    where: { periodId_phase: { periodId: period.id, phase: 'sementara' } },
    update: { data: DATA.executive as object },
    create: { ...meta, phase: 'sementara', data: DATA.executive as object },
  });

  await prisma.financialSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: DATA.financial as object },
    create: { ...meta, data: DATA.financial as object },
  });

  await prisma.operationalSnapshot.upsert({
    where: { periodId_phase: { periodId: period.id, phase: 'sementara' } },
    update: { data: DATA.operational as object },
    create: { ...meta, phase: 'sementara', data: DATA.operational as object },
  });

  await prisma.strategicSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: DATA.strategic as object },
    create: { ...meta, data: DATA.strategic as object },
  });

  await prisma.humanCapitalSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: DATA.humanCapital as object },
    create: { ...meta, data: DATA.humanCapital as object },
  });

  await prisma.riskSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: DATA.risk as object },
    create: { ...meta, data: DATA.risk as object },
  });

  // New sections ported from prototype
  await prisma.prosesBisnisSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: extra.procBiz },
    create: { ...meta, data: extra.procBiz },
  });

  await prisma.organisasiSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: extra.organisasi },
    create: { ...meta, data: extra.organisasi },
  });

  await prisma.gcgEsgSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: extra.gcgEsg },
    create: { ...meta, data: extra.gcgEsg },
  });

  await prisma.petaSnapshot.upsert({
    where: { periodId: period.id },
    update: { data: extra.peta },
    create: { ...meta, data: extra.peta },
  });

  // Reports (approvals)
  const STATUS_MAP: Record<string, 'DRAFT' | 'IN_REVIEW' | 'NEEDS_REVISION' | 'APPROVED'> = {
    draft: 'DRAFT',
    in_review: 'IN_REVIEW',
    needs_revision: 'NEEDS_REVISION',
    approved: 'APPROVED',
    // Already uppercase passthrough
    DRAFT: 'DRAFT',
    IN_REVIEW: 'IN_REVIEW',
    NEEDS_REVISION: 'NEEDS_REVISION',
    APPROVED: 'APPROVED',
  };

  const approvals = DATA.approvals as { reports: Array<Record<string, unknown>> };
  for (const r of approvals.reports) {
    const unit = r.unit as string;
    const rawStatus = (r.status as string || 'draft').toLowerCase().replace(/-/g, '_');
    const status = STATUS_MAP[rawStatus] ?? 'DRAFT';
    const nextApproverRaw = r.nextApprover;
    const nextApprover = nextApproverRaw == null
      ? null
      : typeof nextApproverRaw === 'string'
        ? nextApproverRaw
        : ((nextApproverRaw as { name?: string }).name ?? null);

    await prisma.report.upsert({
      where: { unit_periodId: { unit, periodId: period.id } },
      update: { currentStage: r.currentStage as number, status, nextApprover, history: (r.history as object) || [] },
      create: { unit, periodId: period.id, currentStage: r.currentStage as number, status, nextApprover, history: (r.history as object) || [] },
    });
  }
  console.log('  reports:', approvals.reports.length);

  // KM Documents — from workflowKM.pendingApprovals
  const wkm = DATA.workflowKM as { pendingApprovals: Array<Record<string, unknown>> };
  const TIPE_MAP: Record<string, 'WF1' | 'WF1B' | 'WF2' | 'WF3'> = {
    'WF-1': 'WF1', 'WF-1b': 'WF1B', 'WF-2': 'WF2', 'WF-3': 'WF3',
    WF1: 'WF1', WF1B: 'WF1B', WF2: 'WF2', WF3: 'WF3',
  };
  let kmDocs = 0;
  for (const doc of (wkm.pendingApprovals ?? [])) {
    const docId = doc.docId as string;
    if (!docId) continue;
    const rawTipe = (doc.tipe as string || 'WF-1');
    const tipe = TIPE_MAP[rawTipe] ?? 'WF1';
    const slaRaw = doc.slaRemain as string | number | null | undefined;
    const slaRemain = typeof slaRaw === 'number' ? slaRaw : null;
    await prisma.kMDocument.upsert({
      where: { docId },
      update: {},
      create: {
        docId,
        tipe,
        bidangUnit: doc.bidangUnit as string || '',
        holder: doc.holder as string || '',
        status: 'IN_REVIEW_C1',
        deadline: doc.deadline ? new Date(doc.deadline as string) : null,
        slaRemain,
      },
    });
    kmDocs++;
  }
  console.log('  km_documents:', kmDocs);

  // Kontrak Manajemen — sample entries for demo
  // CATATAN: Tidak ada seeding Kontrak Manajemen / Realisasi / Notifikasi contoh.
  // Fitur "Aksi Saya" (Input KM, Input Realisasi, Persetujuan) dimulai BERSIH agar
  // data demo tidak tercampur dengan input riil end-user. Pengguna membuat KM & realisasi sendiri.

  console.log('Seed complete (Aksi Saya bersih — tanpa data transaksional contoh).');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
