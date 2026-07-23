import { Role, Prisma } from '@prisma/client';

export const UNIT_NAMES: Record<string, string> = {
  KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II',
  UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
};
export const uname = (u: string) => UNIT_NAMES[u] ?? u;

export const RPC_BIDANG = 'Perencanaan & Project Control';
export const OMP_BIDANG = 'Operasi Manajemen Proyek';
export const QAQC_BIDANG = 'QA/QC';
export const KKU_BIDANG = 'Keuangan, Komunikasi & Umum';
export const K3L_BIDANG = 'K3L';
export const MRO_BIDANG = 'MRO';

// Langkah alur. Tiga mode pencocokan (diperiksa berurutan di stepMatches):
//   1. userId  → langkah ditujukan ke ORANG spesifik (alur reviewer pilihan submitter).
//   2. variant → langkah dicocokkan ke JABATAN spesifik (roleVariant.code).
//   3. role (+bidang/unit) → langkah dicocokkan ke peran generik (mesin template lama).
export interface Step {
  role: Role;
  variant?: string; // kode jabatan (roleVariant) — pembeda sub-posisi dalam satu bidang
  bidang?: string;
  unit?: string;
  userId?: string;   // pengguna spesifik (alur checker/approver terpilih)
  userName?: string; // nama untuk tampilan/riwayat
  label: string;
  kind?: 'submitter' | 'checker' | 'approver'; // peran langkah pada alur terpilih
}

// User minimal untuk pencocokan langkah (req.user menyertakan roleVariant).
export type WorkflowUser = { id?: string; role: Role; bidang?: string | null; unit?: string | null; roleVariant?: { code: string } | null };

// ===== Alur reviewer terpilih (Fase 2) =====
// Submitter memilih daftar Checker (berurutan) + satu Approver. Kandidat dibatasi role.
export const CHECKER_ROLES: Role[] = [Role.ASMAN, Role.MANAJER];
export const APPROVER_ROLES: Role[] = [Role.SRMANAJER, Role.GM];

const ROLE_LABEL: Record<string, string> = {
  STAFF: 'Staff', ASMAN: 'ASMAN', MANAJER: 'Manajer', SRMANAJER: 'Senior Manajer', GM: 'General Manager',
};

// Peserta alur minimal untuk membangun langkah.
export type ReviewerParticipant = { id: string; name: string; role: Role; unit?: string | null; bidang?: string | null };

function participantLabel(p: ReviewerParticipant): string {
  const roleTxt = ROLE_LABEL[p.role] ?? p.role;
  const unitTxt = p.unit && p.unit !== 'KP' ? ` ${uname(p.unit)}` : '';
  return `${p.name} — ${roleTxt}${unitTxt}`;
}

// Bangun template langkah dari pilihan submitter:
//   [0] submitter (penyusun) → [1..n] checker (berurutan) → [n+1..m] approver (berurutan).
// Approver diperlakukan persis seperti checker (satu Step per orang, berurutan) sehingga
// "semua approver harus menyetujui (AND)" terwujud otomatis lewat mesin chain sequential
// yang sudah ada — dokumen baru 'ready' setelah approver TERAKHIR menyetujui.
export function buildReviewerSteps(
  submitter: ReviewerParticipant,
  checkers: ReviewerParticipant[],
  approvers: ReviewerParticipant[],
): Step[] {
  const steps: Step[] = [
    { role: submitter.role, userId: submitter.id, userName: submitter.name, kind: 'submitter', label: `Penyusun — ${submitter.name}` },
  ];
  checkers.forEach((c, i) => {
    steps.push({ role: c.role, userId: c.id, userName: c.name, kind: 'checker', label: `Checker ${i + 1}: ${participantLabel(c)}` });
  });
  approvers.forEach((a, i) => {
    const label = approvers.length > 1 ? `Approver ${i + 1}: ${participantLabel(a)}` : `Approver: ${participantLabel(a)}`;
    steps.push({ role: a.role, userId: a.id, userName: a.name, kind: 'approver', label });
  });
  return steps;
}

// Validasi pilihan reviewer terhadap aturan role & keunikan. Melempar pesan bila tidak valid.
// srmanajerAvailableForBidang: bidang dokumen ini punya Senior Manajer aktif → GM tak boleh
// dipilih sebagai approver individual (GM tetap sign-off final di tahap Bundle). Bidang tanpa
// Senior Manajer sama sekali (mis. K3L, MRO) tetap boleh memilih GM.
export function validateReviewerSelection(
  submitterId: string,
  checkers: ReviewerParticipant[],
  approvers: ReviewerParticipant[] | undefined,
  srmanajerAvailableForBidang: boolean,
): string | null {
  if (!checkers || checkers.length === 0) return 'Pilih minimal satu Checker';
  if (!approvers || approvers.length === 0) return 'Pilih minimal satu Approver';
  const ids = new Set<string>();
  for (const c of checkers) {
    if (!CHECKER_ROLES.includes(c.role)) return `Checker "${c.name}" harus ASMAN atau Manajer`;
    if (c.id === submitterId) return 'Checker tidak boleh sama dengan penyusun';
    if (ids.has(c.id)) return `Checker "${c.name}" terpilih ganda`;
    ids.add(c.id);
  }
  for (const a of approvers) {
    if (!APPROVER_ROLES.includes(a.role)) return 'Approver harus Senior Manajer atau General Manager';
    if (a.id === submitterId) return 'Approver tidak boleh sama dengan penyusun';
    if (ids.has(a.id)) return `Approver "${a.name}" tidak boleh merangkap sebagai Checker atau terpilih ganda`;
    if (a.role === Role.GM && srmanajerAvailableForBidang) {
      return 'General Manager hanya dapat dipilih sebagai Approver untuk bidang tanpa Senior Manajer (mis. K3L, MRO) — persetujuan GM final tetap di tahap Bundle.';
    }
    ids.add(a.id);
  }
  return null;
}

// Rantai sub-jabatan dalam-bidang (sesudah Staff PIC, sebelum konsolidasi RPC).
const KI_CHAIN: Record<string, Step[]> = {
  [OMP_BIDANG]: [
    { role: Role.ASMAN, variant: 'asman_elektromekanik', label: 'ASMAN Elektromekanik' },
    { role: Role.ASMAN, variant: 'asman_jaringan', label: 'ASMAN Jaringan' },
    { role: Role.MANAJER, variant: 'man_operasi_pembangkit', label: 'Manajer Operasi Proyek Pembangkit' },
    { role: Role.MANAJER, variant: 'man_operasi_jaringan', label: 'Manajer Operasi Proyek Jaringan' },
    { role: Role.SRMANAJER, variant: 'sm_omp', label: 'SM Operasi Manajemen Proyek' },
  ],
  [QAQC_BIDANG]: [
    { role: Role.MANAJER, variant: 'man_qaqc_pembangkit', label: 'Manajer QA/QC Pembangkit' },
    { role: Role.MANAJER, variant: 'man_qaqc_jaringan', label: 'Manajer QA/QC Jaringan' },
    { role: Role.SRMANAJER, variant: 'sm_qaqc', label: 'SM QA/QC' },
  ],
  [RPC_BIDANG]: [
    { role: Role.MANAJER, variant: 'man_project_control', label: 'Manajer Project Control' },
    { role: Role.MANAJER, variant: 'man_perencanaan', label: 'Manajer Perencanaan' },
    { role: Role.SRMANAJER, variant: 'sm_pc', label: 'SM Perencanaan & Project Control' },
  ],
  [KKU_BIDANG]: [
    { role: Role.MANAJER, variant: 'man_keuangan', label: 'Manajer Keuangan' },
    { role: Role.MANAJER, variant: 'man_akuntansi', label: 'Manajer Akuntansi' },
    { role: Role.MANAJER, variant: 'man_aset_properti', label: 'Manajer Aset & Properti' },
    { role: Role.SRMANAJER, variant: 'sm_kku', label: 'SM Keuangan, Komunikasi & Umum' },
  ],
  [K3L_BIDANG]: [
    { role: Role.ASMAN, variant: 'asman_k3l', label: 'ASMAN K3L' },
  ],
  [MRO_BIDANG]: [
    { role: Role.ASMAN, variant: 'asman_risiko', label: 'ASMAN Manajemen Risiko & Kepatuhan' },
  ],
};

// Konsolidasi RPC (ringkas) untuk dokumen bidang LAIN: Staff RPC → MAN Perencanaan → SM RPC.
const RPC_TAIL: Step[] = [
  { role: Role.STAFF, bidang: RPC_BIDANG, unit: 'KP', label: 'Staff Kinerja Perencanaan (RPC)' },
  { role: Role.MANAJER, variant: 'man_perencanaan', bidang: RPC_BIDANG, unit: 'KP', label: 'Manajer Perencanaan (RPC)' },
  { role: Role.SRMANAJER, variant: 'sm_pc', bidang: RPC_BIDANG, unit: 'KP', label: 'SM Perencanaan & Project Control' },
];

// Mesin alur. Indeks 0 = PIC/Staff penyusun; 1..n = jenjang review hingga SM RPC.
//   mode 'realisasi': UPMK punya segmen internal (Staff/ASMAN/MUP) → rantai bidang KI penuh → RPC.
//   mode 'km': KM disusun Kantor Induk → selalu rantai bidang KI.
export function buildSteps(unitCode: string, bidang: string, mode: 'realisasi' | 'km' = 'realisasi'): Step[] {
  const isUPMK = mode === 'realisasi' && unitCode !== 'KP';
  const isUpmkKm = mode === 'km' && unitCode !== 'KP';
  let chain = (KI_CHAIN[bidang] ?? []).map((s) => ({ ...s, bidang, unit: 'KP' }));
  // Dokumen UPMK ber-bidang RPC: cukup Manajer Perencanaan (lewati Manajer Project Control).
  if (bidang === RPC_BIDANG && unitCode !== 'KP') {
    chain = chain.filter((s) => s.variant !== 'man_project_control');
  }
  const steps: Step[] = [];

  if (isUPMK) {
    steps.push({ role: Role.STAFF, unit: unitCode, label: `Staff Kinerja ${uname(unitCode)}` });
    steps.push({ role: Role.ASMAN, unit: unitCode, label: `ASMAN ${uname(unitCode)}` });
    steps.push({ role: Role.MANAJER, unit: unitCode, label: `Manajer (MUP) ${uname(unitCode)}` });
    steps.push(...chain);
  } else if (isUpmkKm) {
    // KM UPMK dibuat & dikirim oleh Staff RPC (KP); step 0 = Staff RPC bukan Staff bidang yang dipilih.
    steps.push({ role: Role.STAFF, bidang: RPC_BIDANG, unit: 'KP', label: 'Staff Kinerja Perencanaan (RPC)' });
    steps.push(...chain);
  } else {
    steps.push({ role: Role.STAFF, bidang, unit: 'KP', label: `Staff Kinerja ${bidang}` });
    steps.push(...chain);
  }

  // Konsolidasi RPC — dilewati bila dokumen sudah bidang RPC (rantai sudah berakhir di SM RPC).
  if (bidang !== RPC_BIDANG) {
    if (isUpmkKm) {
      // Staff RPC sudah jadi step 0; cukup tambah Man Perencanaan + SM RPC (hindari duplikat).
      steps.push(RPC_TAIL[1], RPC_TAIL[2]);
    } else {
      steps.push(...RPC_TAIL);
    }
  }
  return steps;
}

export function stepMatches(step: Step | undefined, user: WorkflowUser): boolean {
  if (!step) return false;
  if (step.userId) return user.id === step.userId;             // pencocokan by orang spesifik
  if (step.variant) return user.roleVariant?.code === step.variant; // pencocokan by jabatan
  if (user.role !== step.role) return false;
  if (step.bidang && user.bidang !== step.bidang) return false;
  if (step.unit && user.unit !== step.unit) return false;
  return true;
}

// Klausa Prisma untuk mencari penerima notifikasi langkah.
export function stepRecipientWhere(step: Step): Prisma.UserWhereInput {
  if (step.userId) return { id: step.userId, isActive: true };
  if (step.variant) return { isActive: true, roleVariant: { code: step.variant } };
  return {
    role: step.role, isActive: true,
    ...(step.bidang ? { bidang: step.bidang } : {}),
    ...(step.unit ? { unit: step.unit } : {}),
  };
}

const SLA_DAYS_PER_STEP = 2;
export function slaRemainingDays(r: { submittedAt: Date }): number {
  const deadline = new Date(r.submittedAt).getTime() + SLA_DAYS_PER_STEP * 86400000;
  return Math.ceil((deadline - Date.now()) / 86400000);
}
