import { useEffect, useState, Fragment } from 'react';
import { kpiMaster, inputKontrak } from '../lib/api';
import type { ReviewerSlot, ReviewerSlots, SubIndicatorInput, SubIndicatorTargetOverride } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePeriod } from '../context/PeriodContext';
import {
  Layers, Plus, Trash2, Edit2, X, ChevronDown, AlertCircle, CheckCircle, PieChart,
  Check, FileText, Send, FileCheck2, Boxes,
} from 'lucide-react';
import { SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';
import ReviewerPickerModal from '../components/ReviewerPickerModal';
import type { ReviewerCandidate } from '../components/ReviewerPickerModal';
import type { KontrakManajemen } from '../lib/types';

const UNIT_OPTIONS = [
  { code: 'KP', name: 'Kantor Induk' },
  { code: 'UPMK1', name: 'UPMK I' }, { code: 'UPMK2', name: 'UPMK II' },
  { code: 'UPMK3', name: 'UPMK III' }, { code: 'UPMK4', name: 'UPMK IV' }, { code: 'UPMK5', name: 'UPMK V' },
];
const UNIT_NAMES: Record<string, string> = Object.fromEntries(UNIT_OPTIONS.map((u) => [u.code, u.name]));
// 6 bidang Kantor Induk (unit KP) — TIDAK sama dengan bagian internal UPMK di bawah.
const BIDANG_OPTIONS = [
  'Operasi Manajemen Proyek', 'QA/QC', 'Keuangan, Komunikasi & Umum',
  'Perencanaan & Project Control', 'K3L', 'MRO',
];
// Tiap UPMK punya 4 bagian internal (Staff PIC + ASMAN sendiri per bagian) — taksonomi terpisah
// dari bidang Kantor Induk, jangan dicampur.
const UPMK_BIDANG_OPTIONS = ['Bagian Pembangkit', 'Bagian Jaringan', 'Bagian KKU', 'Bagian K3L'];
const bidangOptionsFor = (unitCode: string) => (unitCode === 'KP' ? BIDANG_OPTIONS : UPMK_BIDANG_OPTIONS);
// Daftar tertutup — mencakup seluruh nilai yang benar-benar dipakai KPI existing (dicek via
// query DB), plus "-" utk sub-indikator penalti yang memang tanpa satuan bermakna (mis.
// "Implementasi Maturity Level"). Dipakai baik utk Satuan indikator induk maupun sub-indikator.
const SATUAN_OPTIONS = ['%', 'Rp Miliar', 'Hari kerja', 'kms', 'MVA', 'MW', 'Waktu', 'Milestone', 'Dokumen legal', '-'];
const CURRENT_YEAR = new Date().getFullYear();
// KPI Master (definisi lintas-bidang/unit) dipersempit ke RPC — lihat kpi-master.service.ts save().
const RPC_BIDANG = 'Perencanaan & Project Control';

// ============================ Shell: Manajemen KPI (3 tab) ============================
export function KpiMasterPage() {
  const { user } = useAuth();
  // Definisi KPI (penyusunan & fan-out) hanya untuk Staff RPC — role lain hanya melihat Dokumen KM.
  const isRpcStaff = user?.role === 'STAFF' && user?.unit === 'KP' && user?.bidang === RPC_BIDANG;
  const [tab, setTab] = useState<'definisi' | 'dokumen' | 'review'>(isRpcStaff ? 'definisi' : 'dokumen');
  // View "Review per-KPI" (lensa konsolidasi lintas-dokumen) — untuk Kantor Induk & GM.
  const canConsolidate = user?.unit === 'KP' || user?.role === 'GM';

  return (
    <div className="page kpi-master-page">
      <div className="card" style={{ marginBottom: 'var(--space-4)', borderLeft: '4px solid var(--color-accent)' }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-lg)', background: 'var(--color-accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Layers size={24} color="var(--color-accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Manajemen KPI — Tahun {CURRENT_YEAR}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
              Definisikan KPI &amp; assign ke banyak Unit/Bidang; kirim dokumen KM hasil fan-out untuk direview. Satu pintu untuk penyusunan &amp; pengajuan Kontrak Manajemen.
            </div>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {isRpcStaff && (
          <button className={`btn ${tab === 'definisi' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('definisi')}>
            <Layers size={15} /> Definisi KPI
          </button>
        )}
        <button className={`btn ${tab === 'dokumen' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('dokumen')}>
          <FileText size={15} /> Dokumen KM
        </button>
        {canConsolidate && (
          <button className={`btn ${tab === 'review' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('review')}>
            <PieChart size={15} /> Review per-KPI
          </button>
        )}
      </div>

      {tab === 'definisi' && isRpcStaff && <DefinisiKpiTab onGoToDokumen={() => setTab('dokumen')} />}
      {tab === 'dokumen' && <DokumenKmTab />}
      {tab === 'review' && canConsolidate && <ReviewPerKpiTab />}
    </div>
  );
}

// ============================ Tab 1: Definisi KPI ============================
// Bidang bertipe array — 1 baris form bisa punya banyak bidang sekaligus (kenyamanan entri data,
// bukan mengubah model backend). Di-"expand" jadi entri tunggal-bidang saat disimpan — lihat
// expandAssignmentsForSave().
type Assignment = {
  unitCode: string; bidang: string[]; holder: string; target: string; target2: string;
  persenAgregasi: number;
  reviewerSlots: ReviewerSlots | null; // legacy — tak lagi diedit di UI, sekadar pass-through
  // Override target sub-indikator (KPI Komposit), index sejajar dgn subIndicators master.
  // null/kosong per elemen = warisi target template global. Lihat kpi-master.service.ts fanOut().
  subIndicatorTargets: SubIndicatorTargetOverride[] | null;
};
// Bentuk assignment APA ADANYA dari backend (satu bidang per baris, model DB tak berubah).
type AssignmentRow = Omit<Assignment, 'bidang'> & { id: string; bidang: string };
type KpiMasterRow = {
  id: string; year: string; kmType: 'draft' | 'final'; indikator: string; formula: string; satuan: string;
  bobotKm: string; targetParent: string; createdBy: string; createdAt: string;
  assignments: AssignmentRow[];
  defaultCheckerIds: string[]; defaultApproverId: string | null;
  effectiveMonth: string; version: number; status: string; previousVersionId: string | null;
  isPending: boolean; isCurrent: boolean;
  aggregationMethod: 'weighted' | 'sum';
  subIndicators: SubIndicatorInput[] | null;
};
const emptySubIndicator = (): SubIndicatorInput => ({ nama: '', satuan: '', bobot: '', target: '', target2: '', formula: '' });
const ROLE_LABEL: Record<string, string> = { ASMAN: 'ASMAN', MANAJER: 'Manajer', SRMANAJER: 'Senior Manajer', GM: 'General Manager' };
const candDesc = (c: ReviewerCandidate) => `${ROLE_LABEL[c.role] ?? c.role}${c.unit && c.unit !== 'KP' ? ' · ' + (UNIT_NAMES[c.unit] ?? c.unit) : ''}`;
type RollupBreakdown = { unitCode: string; bidang: string; persenAgregasi: number; realisasi: number | null; kontribusi: number; hasData: boolean };
type Rollup = {
  masterId: string; indikator: string; targetParent: string; periodId: string; periodLabel: string;
  aggregationMethod: 'weighted' | 'sum';
  totalPersen: number; nilaiParent: number; isFullyConfigured: boolean; breakdown: RollupBreakdown[];
};

const emptyAssignment = (): Assignment => ({ unitCode: 'UPMK1', bidang: [UPMK_BIDANG_OPTIONS[0]], holder: '', target: '', target2: '', persenAgregasi: 0, reviewerSlots: null, subIndicatorTargets: null });
// Pecah 1 baris multi-bidang jadi entri tunggal-bidang (format yg diterima backend) — Bobot
// Agregasi baris dibagi rata ke tiap bidang (kompensasi pembulatan di bidang terakhir), field
// lain (target/target2/holder/subIndicatorTargets) disalin identik ke semua bidang baris itu.
const expandAssignmentsForSave = (rows: Assignment[]) => rows.flatMap((a) => {
  const n = a.bidang.length;
  const share = Math.round((a.persenAgregasi / n) * 100) / 100;
  return a.bidang.map((bidang, idx) => ({
    ...a, bidang,
    persenAgregasi: idx === n - 1 ? Math.round((a.persenAgregasi - share * (n - 1)) * 100) / 100 : share,
  }));
});

// Beda dgn num() longgar di common/capaian.ts (backend, strip huruf shg "Tanggal 5" jadi 5) —
// di sini SELURUH string harus berupa angka valid, else null. Dipakai gating fitur auto-hitung
// Bobot Agregasi supaya tak salah aktif utk target non-numerik (tanggal/milestone).
const strictNum = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function DefinisiKpiTab({ onGoToDokumen }: { onGoToDokumen: () => void }) {
  const { user } = useAuth();
  const { periodId } = usePeriod();
  const canAuthor = user?.role === 'GM' || user?.role === 'SUPERADMIN' || user?.role === 'DEVELOPER'
    || (user?.unit === 'KP' && user?.bidang === RPC_BIDANG);

  const [masters, setMasters] = useState<KpiMasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [continuePrompt, setContinuePrompt] = useState(false);
  // Modal blocking — target belum diisi (assignment biasa ATAU sub-indikator komposit). Diisi
  // dengan daftar item yang bermasalah; null = modal tertutup.
  const [missingTargetItems, setMissingTargetItems] = useState<string[] | null>(null);
  const [rollups, setRollups] = useState<Record<string, Rollup>>({});
  const [rollupLoading, setRollupLoading] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingIsPending, setEditingIsPending] = useState(false);
  const [kmType, setKmType] = useState<'draft' | 'final'>('draft');
  const [aggregationMethod, setAggregationMethod] = useState<'weighted' | 'sum'>('weighted');
  const [indikator, setIndikator] = useState('');
  const [formula, setFormula] = useState('');
  const [satuan, setSatuan] = useState('');
  const [bobotKm, setBobotKm] = useState('');
  const [targetParent, setTargetParent] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([emptyAssignment()]);
  // Auto-hitung Bobot Agregasi dari Target Tahun — default OFF (baik buat baru maupun edit)
  // supaya tak pernah diam-diam menimpa nilai yang sudah ada/sengaja diisi manual.
  const [autoCalcPersen, setAutoCalcPersen] = useState(false);
  // Baris assignment yang sedang expand utk edit target sub-indikator (KPI Komposit).
  const [expandedAssignment, setExpandedAssignment] = useState<number | null>(null);
  // Baris assignment yang sedang expand utk pilih bidang (multi-select checkbox).
  const [expandedBidangRow, setExpandedBidangRow] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sub-indikator (opt-in, generik) — KPI apa pun boleh ditandai "komposit" & diisi sub-indikator
  // di sini; tidak dibatasi ke nama indikator tertentu. Non-kosong → bobotKm assignment jadi
  // turunan (Σ bobot sub), realisasi diisi per-sub belakangan di Input Realisasi.
  const [isComposite, setIsComposite] = useState(false);
  const [subIndicators, setSubIndicators] = useState<SubIndicatorInput[]>([]);
  const addSubIndicator = () => setSubIndicators((prev) => [...prev, emptySubIndicator()]);
  const removeSubIndicator = (i: number) => setSubIndicators((prev) => prev.filter((_, idx) => idx !== i));
  const updateSubIndicator = (i: number, field: keyof SubIndicatorInput, value: string) =>
    setSubIndicators((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  const totalSubBobot = subIndicators.reduce((s, si) => s + (Number(String(si.bobot).replace(',', '.')) || 0), 0);

  const load = () => {
    setLoading(true);
    kpiMaster.list()
      .then((d) => setMasters(d as KpiMasterRow[]))
      .catch((e) => setError((e as Error)?.message ?? 'Gagal memuat data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setEditingId(null); setEditingIsPending(false); setKmType('draft'); setAggregationMethod('weighted');
    setIndikator(''); setFormula(''); setSatuan(''); setBobotKm('');
    setTargetParent(''); setAssignments([emptyAssignment()]); setFormError(null); setShowForm(false);
    setIsComposite(false); setSubIndicators([]); setAutoCalcPersen(false); setExpandedAssignment(null); setExpandedBidangRow(null);
  };

  const handleEdit = (m: KpiMasterRow) => {
    setEditingId(m.id); setKmType(m.kmType); setAggregationMethod(m.aggregationMethod ?? 'weighted');
    setIndikator(m.indikator); setFormula(m.formula);
    setSatuan(m.satuan); setBobotKm(m.bobotKm ?? ''); setTargetParent(m.targetParent);
    setAssignments(m.assignments.map((a) => ({
      unitCode: a.unitCode, bidang: [a.bidang], holder: a.holder, target: a.target, target2: a.target2,
      persenAgregasi: a.persenAgregasi ?? 0,
      reviewerSlots: a.reviewerSlots ?? null,
      subIndicatorTargets: a.subIndicatorTargets ?? null,
    })));
    setEditingIsPending(m.isPending);
    setIsComposite(!!(m.subIndicators && m.subIndicators.length > 0));
    setSubIndicators(m.subIndicators ? m.subIndicators.map((s) => ({ ...s })) : []);
    setAutoCalcPersen(false);
    setShowForm(true); setFormError(null);
  };

  const addAssignment = () => setAssignments((prev) => {
    const next = [...prev, emptyAssignment()];
    // Dari 1 bidang total (Bobot Agregasi otomatis 100%) ke 2+ — reset ke kosong, wajib diisi
    // manual (hindari asumsi split yang mungkin salah, mis. bila baris lama masih bernilai 100).
    const totalBefore = prev.reduce((s, a) => s + a.bidang.length, 0);
    return totalBefore === 1 ? next.map((a) => ({ ...a, persenAgregasi: 0 })) : next;
  });
  const removeAssignment = (i: number) => setAssignments((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  const updateAssignment = (i: number, field: Exclude<keyof Assignment, 'persenAgregasi' | 'reviewerSlots' | 'bidang' | 'subIndicatorTargets'>, value: string) =>
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  // Unit KP dan UPMK punya taksonomi Bidang berbeda (6 bidang KI vs 3 bagian UPMK) —
  // ganti unit harus mereset Bidang ke opsi valid pada taksonomi barunya.
  const updateAssignmentUnit = (i: number, unitCode: string) =>
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, unitCode, bidang: [bidangOptionsFor(unitCode)[0]] } : a)));
  // Tambah/hapus 1 bidang dari baris — minimal 1 bidang per baris (tak boleh dikosongkan lewat sini).
  const toggleRowBidang = (rowIdx: number, b: string) =>
    setAssignments((prev) => prev.map((a, idx) => {
      if (idx !== rowIdx) return a;
      const has = a.bidang.includes(b);
      if (has && a.bidang.length <= 1) return a;
      return { ...a, bidang: has ? a.bidang.filter((x) => x !== b) : [...a.bidang, b] };
    }));
  // Bidang yang dipakai baris LAIN pada unit yang sama — dicegah dipilih ganda di baris ini.
  const bidangUsedElsewhere = (rowIdx: number, unitCode: string) =>
    new Set(assignments.flatMap((a, idx) => (idx !== rowIdx && a.unitCode === unitCode ? a.bidang : [])));
  const updatePersen = (i: number, value: string) => {
    const n = value === '' ? 0 : Number(value);
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, persenAgregasi: Number.isFinite(n) ? n : a.persenAgregasi } : a)));
  };
  // Override target sub-indikator (KPI Komposit) — kosong di suatu index = warisi target
  // template global (subIndicators[subIdx]) saat fan-out (lihat kpi-master.service.ts).
  const updateAssignmentSubTarget = (assignmentIdx: number, subIdx: number, field: 'target' | 'target2', value: string) =>
    setAssignments((prev) => prev.map((a, idx) => {
      if (idx !== assignmentIdx) return a;
      const next = [...(a.subIndicatorTargets ?? subIndicators.map(() => ({ target: '', target2: '' })))];
      next[subIdx] = { ...next[subIdx], [field]: value };
      return { ...a, subIndicatorTargets: next };
    }));
  // 1 bidang total saja (lintas semua baris) → tak ada yang perlu dibagi, Bobot Agregasi otomatis
  // 100% (tak diminta diisi manual). Baru relevan & wajib diisi manual saat totalnya lebih dari
  // satu — dihitung dari total bidang, bukan jumlah baris, krn 1 baris bisa punya banyak bidang.
  const totalBidangCount = assignments.reduce((s, a) => s + a.bidang.length, 0);
  const isSingleAssignment = totalBidangCount === 1;
  const totalPersenForm = isSingleAssignment ? 100 : assignments.reduce((s, a) => s + (a.persenAgregasi || 0), 0);
  const anyPersenSet = isSingleAssignment || assignments.some((a) => (a.persenAgregasi || 0) > 0);

  // Auto-hitung Bobot Agregasi dari Target Tahun (target2) — hanya berlaku non-komposit (target
  // di-assignment level dipakai apa adanya, bukan turunan sub) & seluruh baris numerik murni.
  const target2Nums = assignments.map((a) => strictNum(a.target2));
  const allTarget2Numeric = !isSingleAssignment && !isComposite && target2Nums.every((n) => n !== null);
  const target1Nums = assignments.map((a) => strictNum(a.target));
  const allTarget1Numeric = !isComposite && target1Nums.every((n) => n !== null);
  const target2Key = assignments.map((a) => a.target2).join('|');

  // Satuan non-aditif — target tiap unit adalah rate/tenggat independen, bukan potongan dari
  // suatu total, jadi Σ/auto-calc-proporsional (dua-duanya berbasis penjumlahan) tak bermakna.
  // Kata kunci dicek via .includes() pada satuan.trim().toLowerCase() — case-insensitive,
  // substring match (jadi "Hari kerja" & "waktu proses" dst ikut tertangkap).
  const RATE_LIKE_KEYWORDS = ['hari', 'waktu', 'jam', 'minggu', 'bulan'];
  const DATE_LIKE_KEYWORDS = ['tanggal', 'tgl', 'deadline'];
  const isPercentSatuan = satuan.trim() === '%';
  const isRateLikeSatuan = !isPercentSatuan && RATE_LIKE_KEYWORDS.some((k) => satuan.trim().toLowerCase().includes(k));
  const isDateLikeSatuan = DATE_LIKE_KEYWORDS.some((k) => satuan.trim().toLowerCase().includes(k));
  // Kategori "rata-rata": % atau durasi/rate non-persen — sama-sama ditampilkan sbg average.
  const isAverageSatuan = isPercentSatuan || isRateLikeSatuan;
  const isNonAdditiveSatuan = isAverageSatuan || isDateLikeSatuan;

  useEffect(() => {
    if (isNonAdditiveSatuan && autoCalcPersen) setAutoCalcPersen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNonAdditiveSatuan]);

  useEffect(() => {
    if (aggregationMethod !== 'weighted' || isSingleAssignment || !autoCalcPersen || !allTarget2Numeric || isNonAdditiveSatuan) return;
    const nums = target2Nums as number[];
    const total = nums.reduce((s, n) => s + n, 0);
    if (total <= 0) return;
    const raw = nums.map((n) => Math.round((n / total) * 10000) / 100); // 2 desimal
    const sumExceptLast = raw.slice(0, -1).reduce((s, n) => s + n, 0);
    const computed = [...raw.slice(0, -1), Math.round((100 - sumExceptLast) * 100) / 100];
    const changed = assignments.some((a, i) => (a.persenAgregasi || 0) !== computed[i]);
    if (changed) setAssignments((prev) => prev.map((a, i) => ({ ...a, persenAgregasi: computed[i] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCalcPersen, aggregationMethod, isSingleAssignment, allTarget2Numeric, isNonAdditiveSatuan, target2Key]);

  const weightedOrPlainAvg = (nums: (number | null)[]) => {
    const valid = nums.filter((n): n is number => n !== null);
    if (valid.length === 0) return null;
    if (anyPersenSet) {
      const weighted = assignments.reduce((s, a, i) => s + (nums[i] ?? 0) * ((a.persenAgregasi || 0) / 100), 0);
      return Math.round(weighted * 100) / 100;
    }
    return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 100) / 100;
  };
  const target1Avg = isAverageSatuan ? weightedOrPlainAvg(target1Nums) : null;
  const target2Avg = isAverageSatuan ? weightedOrPlainAvg(target2Nums) : null;

  const fetchRollup = async (masterId: string) => {
    setRollupLoading(masterId);
    try {
      const d = await kpiMaster.rollup(masterId, periodId || undefined);
      setRollups((prev) => ({ ...prev, [masterId]: d as Rollup }));
    } catch { /* abaikan — tampil tanpa rollup */ }
    finally { setRollupLoading(null); }
  };

  const handleSave = async () => {
    if (!indikator.trim()) { setFormError('Nama indikator wajib diisi.'); return; }
    const keys = new Set<string>();
    for (const a of assignments) {
      for (const b of a.bidang) {
        const k = `${a.unitCode}||${b}`;
        if (keys.has(k)) { setFormError(`Assignment ganda: ${UNIT_NAMES[a.unitCode]} — ${b}`); return; }
        keys.add(k);
      }
    }
    if (aggregationMethod === 'weighted' && anyPersenSet && Math.abs(totalPersenForm - 100) > 0.01) {
      setFormError(`Total bobot agregasi harus 100%, saat ini ${totalPersenForm}%.`);
      return;
    }
    // Target wajib diisi — KPI tanpa target diam-diam dilewati dari penilaian tanpa peringatan
    // (lihat catatan sama di kpi-master.service.ts save()). Blocking modal (bukan banner biasa)
    // karena mudah terlewat & user diminta lengkapi dulu sebelum bisa disimpan sama sekali.
    const missingTargets = isComposite
      ? subIndicators.filter((s) => !s.target.trim()).map((s) => `Sub-indikator "${s.nama.trim() || '(tanpa nama)'}"`)
      : assignments.filter((a) => !a.target.trim()).map((a) => `${UNIT_NAMES[a.unitCode] ?? a.unitCode} — ${a.bidang.join(', ')}`);
    if (missingTargets.length > 0) { setMissingTargetItems(missingTargets); return; }
    if (isComposite) {
      if (subIndicators.length === 0) { setFormError('Tambahkan minimal satu sub-indikator, atau matikan mode Komposit.'); return; }
      const subNames = new Set<string>();
      for (const s of subIndicators) {
        if (!s.nama.trim()) { setFormError('Nama setiap sub-indikator wajib diisi.'); return; }
        if (subNames.has(s.nama.trim())) { setFormError(`Sub-indikator "${s.nama}" terpilih ganda.`); return; }
        subNames.add(s.nama.trim());
        const bobotNum = Number(String(s.bobot).replace(',', '.'));
        if (aggregationMethod === 'sum') {
          if (!s.bobot.trim() || !Number.isFinite(bobotNum) || bobotNum >= 0) { setFormError(`Max penalti sub-indikator "${s.nama}" harus angka negatif (mis. -3).`); return; }
        } else if (!s.bobot.trim() || !Number.isFinite(bobotNum) || bobotNum <= 0) {
          setFormError(`Bobot sub-indikator "${s.nama}" harus angka > 0.`); return;
        }
      }
    }
    setFormError(null); setBusy(true);
    try {
      const expanded = expandAssignmentsForSave(assignments);
      const assignmentsToSave = isSingleAssignment && aggregationMethod === 'weighted'
        ? expanded.map((a) => ({ ...a, persenAgregasi: 100 }))
        : expanded;
      await kpiMaster.save({
        id: editingId ?? undefined, kmType, aggregationMethod, indikator: indikator.trim(), formula, satuan, bobotKm, targetParent, assignments: assignmentsToSave,
        subIndicators: isComposite ? subIndicators : undefined,
      });
      resetForm();
      load();
      setContinuePrompt(true);
    } catch (e) {
      setFormError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus KPI Master ini? Item yang sudah disebar ke dokumen KM draft akan ikut dibersihkan.')) return;
    try { await kpiMaster.delete(id); load(); }
    catch (e) { setError((e as Error)?.message ?? 'Gagal menghapus'); }
  };

  if (loading) return <SkeletonTable rows={4} cols={5} />;
  if (error && masters.length === 0 && !showForm) return <ErrorState title="Gagal memuat data" message={error} />;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        {canAuthor && (
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }} disabled={showForm}>
            <Plus size={16} /> KPI Master Baru
          </button>
        )}
      </div>

      {continuePrompt && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--space-4)' }}
          onClick={() => setContinuePrompt(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 420, width: '100%', margin: 0 }}
          >
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success)' }}>
                <CheckCircle size={20} /> <strong>KM Sementara tersimpan</strong>
              </div>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Lanjutkan proses di tab <b>&quot;Dokumen KM&quot;</b> untuk mengirimnya ke alur reviewer.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                <button className="btn btn-ghost" onClick={() => setContinuePrompt(false)}>Tetap di sini</button>
                <button className="btn btn-primary" onClick={() => { setContinuePrompt(false); onGoToDokumen(); }}>
                  <FileText size={15} /> Ke Dokumen KM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {missingTargetItems && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--space-4)' }}
          onClick={() => setMissingTargetItems(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 440, width: '100%', margin: 0 }}
          >
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-warning)' }}>
                <AlertCircle size={20} /> <strong>Target belum diisi</strong>
              </div>
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Target wajib diisi sebelum bisa disimpan. Lengkapi dulu: <b>{missingTargetItems.join(' & ')}</b>
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                <button className="btn btn-primary" onClick={() => setMissingTargetItems(null)}>Mengerti, saya lengkapi</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!canAuthor && (
        <div className="status-banner" style={{ marginBottom: 'var(--space-4)', background: 'var(--color-surface-2)' }}>
          <AlertCircle size={16} /> KPI Master disusun oleh Kantor Induk. Anda dapat melihat, tetapi tidak mengubah.
        </div>
      )}

      {/* Form */}
      {canAuthor && showForm && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', borderLeft: '4px solid var(--color-warning)' }}>
          <div className="card-header compact">
            <div className="card-title"><Edit2 size={14} />{editingId ? 'Edit KPI Master' : 'KPI Master Baru'}</div>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}><X size={14} /></button>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {formError && (<div className="status-banner danger" style={{ margin: 0 }}><AlertCircle size={16} /> {formError}</div>)}
            {editingId && !editingIsPending && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', background: 'var(--color-warning-tint)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                <AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                KPI ini sedang <b>berlaku pada periode berjalan</b>. Perubahan tidak akan mengubah data periode ini —
                sistem akan membuat <b>versi baru</b> yang berlaku mulai bulan berikutnya.
              </div>
            )}
            {editingId && editingIsPending && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', background: 'var(--color-accent-tint)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                KPI ini <b>belum berlaku</b> (menunggu periode mendatang) — perubahan langsung memperbarui versi ini di tempat.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label className="form-label">Indikator KPI <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                <input className="form-input" value={indikator} onChange={(e) => setIndikator(e.target.value)} placeholder="Nama indikator kinerja" />
              </div>
              <div>
                <label className="form-label">Tipe KM</label>
                <select className="form-input" value={kmType} onChange={(e) => setKmType(e.target.value as 'draft' | 'final')}>
                  <option value="draft">KM Draft</option>
                  <option value="final">KM Final</option>
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Formula / Metode Perhitungan</label>
              <input className="form-input" value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="Rumus / cara pengukuran KPI" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label className="form-label">Satuan</label>
                <select className="form-input" value={satuan} onChange={(e) => setSatuan(e.target.value)}>
                  <option value="">— Pilih satuan —</option>
                  {(satuan && !SATUAN_OPTIONS.includes(satuan) ? [satuan, ...SATUAN_OPTIONS] : SATUAN_OPTIONS).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Bobot KM (poin)</label>
                {isComposite ? (
                  <input className="form-input" value={totalSubBobot || 0} disabled title="Turunan — Σ bobot sub-indikator" />
                ) : (
                  <input className="form-input" value={bobotKm} onChange={(e) => setBobotKm(e.target.value)} placeholder="poin" />
                )}
              </div>
              <div>
                <label className="form-label">Target Gabungan (Parent)</label>
                <input className="form-input" value={targetParent} onChange={(e) => setTargetParent(e.target.value)} placeholder="Target keseluruhan" />
                {assignments.length > 1 && !isDateLikeSatuan && (allTarget1Numeric || allTarget2Numeric) && (
                  <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
                    {isAverageSatuan ? (
                      <>
                        {allTarget1Numeric && <>Rata-rata Target Sem I: <b>{target1Avg} {satuan}</b></>}
                        {allTarget1Numeric && allTarget2Numeric && ' · '}
                        {allTarget2Numeric && <>Rata-rata Target {CURRENT_YEAR}: <b>{target2Avg} {satuan}</b></>}
                        {anyPersenSet && <> (tertimbang Bobot Agregasi)</>}
                      </>
                    ) : (
                      <>
                        {allTarget1Numeric && <>Σ Target Sem I: <b>{target1Nums.reduce((s, n) => s + (n ?? 0), 0)}</b></>}
                        {allTarget1Numeric && allTarget2Numeric && ' · '}
                        {allTarget2Numeric && <>Σ Target {CURRENT_YEAR}: <b>{target2Nums.reduce((s, n) => s + (n ?? 0), 0)}</b></>}
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="form-label">Metode Agregasi</label>
              <select className="form-input" value={aggregationMethod} onChange={(e) => setAggregationMethod(e.target.value as 'weighted' | 'sum')}>
                <option value="weighted">Rata-rata Tertimbang (KPI positif — pakai Bobot Agregasi %, total 100%)</option>
                <option value="sum">Jumlah / SUM (KPI penalti-pengurang — tanpa syarat 100%)</option>
              </select>
            </div>

            {/* Sub-indikator (opt-in, generik) */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                <input
                  type="checkbox" checked={isComposite}
                  onChange={(e) => { setIsComposite(e.target.checked); if (e.target.checked && subIndicators.length === 0) addSubIndicator(); }}
                />
                <Boxes size={14} /> KPI Komposit (punya sub-indikator)
              </label>
              <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
                Aktifkan bila indikator ini terdiri dari beberapa sub-indikator bernama (mis. "Pengendalian
                Anggaran" = OPEX + Investasi; "Kepatuhan, Maturity Level & Tata Kelola" = SMAP + ESG + GCG).
                Bisa dipakai untuk KPI apa pun — nilai induk = jumlah nilai tiap sub, bobot KM tiap assignment
                jadi otomatis (Σ bobot sub).
                {aggregationMethod === 'sum' && (
                  <> Metode <b>SUM</b> aktif (KPI penalti/pengurang) — isi tiap sub dengan <b>max penalti negatif</b> (mis. -3), bukan poin positif.</>
                )}
              </p>
              {isComposite && (
                <div className="table-wrap" style={{ marginTop: 'var(--space-2)' }}>
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Nama Sub-Indikator</th><th>Formula / Cara Pengukuran</th><th>Satuan</th>
                        <th className="num">{aggregationMethod === 'sum' ? 'Max Penalti (poin)' : 'Bobot (poin)'}</th><th>Target Sem I</th><th>Target {CURRENT_YEAR}</th>
                        <th style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {subIndicators.map((s, i) => (
                        <tr key={i}>
                          <td><input className="form-input form-input-sm" value={s.nama} onChange={(e) => updateSubIndicator(i, 'nama', e.target.value)} placeholder="mis. OPEX vs RKAP" /></td>
                          <td><input className="form-input form-input-sm" value={s.formula ?? ''} onChange={(e) => updateSubIndicator(i, 'formula', e.target.value)} placeholder="Rumus / cara pengukuran sub ini" /></td>
                          <td>
                            <select className="form-input form-input-sm" value={s.satuan ?? ''} onChange={(e) => updateSubIndicator(i, 'satuan', e.target.value)}>
                              <option value="">—</option>
                              {(s.satuan && !SATUAN_OPTIONS.includes(s.satuan) ? [s.satuan, ...SATUAN_OPTIONS] : SATUAN_OPTIONS).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </td>
                          <td><input className="form-input form-input-sm" style={{ textAlign: 'center' }} value={s.bobot} onChange={(e) => updateSubIndicator(i, 'bobot', e.target.value)} placeholder={aggregationMethod === 'sum' ? '-3' : 'poin'} /></td>
                          <td><input className="form-input form-input-sm" value={s.target} onChange={(e) => updateSubIndicator(i, 'target', e.target.value)} placeholder="Target Sem I" /></td>
                          <td><input className="form-input form-input-sm" value={s.target2 ?? ''} onChange={(e) => updateSubIndicator(i, 'target2', e.target.value)} placeholder="Target tahun" /></td>
                          <td>
                            <button className="btn btn-ghost btn-sm" disabled={subIndicators.length <= 1} onClick={() => removeSubIndicator(i)} style={{ color: 'var(--color-danger)' }}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-xs)' }}>{aggregationMethod === 'sum' ? 'Total Max Penalti (= Bobot KM assignment):' : 'Total Bobot (= Bobot KM assignment):'}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{totalSubBobot || 0}</td>
                        <td colSpan={3} />
                      </tr>
                    </tbody>
                  </table>
                  <button className="btn btn-ghost btn-sm" onClick={addSubIndicator} style={{ marginTop: 4 }}><Plus size={12} /> Tambah Sub-Indikator</button>
                </div>
              )}
            </div>

            {/* Assignments */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Assign ke Unit / Bidang ({totalBidangCount})</label>
                <button className="btn btn-ghost btn-sm" onClick={addAssignment}><Plus size={14} /> Tambah Assignment</button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 var(--space-2)' }}>
                Satu baris bisa punya lebih dari 1 Bidang sekaligus (klik &quot;+ Bidang&quot; di kolom Bidang) —
                Target/PJ/Bobot Agregasi baris itu berlaku sama ke semua bidang terpilih; saat disimpan tiap
                bidang tetap jadi dokumen KM & alur realisasi sendiri-sendiri seperti biasa.
              </p>
              <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-2)' }}>
                {aggregationMethod === 'weighted' ? (
                  isSingleAssignment ? (
                    <>Hanya 1 assignment — <b>Bobot Agregasi</b> otomatis 100%, tak perlu diisi manual.</>
                  ) : (
                    <><b>Bobot Agregasi</b>: persentase kontribusi realisasi tiap unit/bidang ke nilai KPI parent (rollup). Kosongkan semua bila belum dikonfigurasi, atau isi hingga total tepat 100%.</>
                  )
                ) : (
                  <>Metode <b>SUM</b>: nilai parent = jumlah polos realisasi tiap unit/bidang (cocok untuk KPI penalti/pengurang lintas bidang). Tidak perlu Bobot Agregasi.</>
                )}
              </p>
              {aggregationMethod === 'weighted' && !isSingleAssignment && !isComposite && isNonAdditiveSatuan && (
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 var(--space-2)' }}>
                  {isDateLikeSatuan
                    ? 'Satuan bertipe tanggal/deadline — Bobot Agregasi tidak dihitung otomatis dari nilai target (angka tanggal bukan indikator besar-kecil kontribusi). Isi manual sesuai proporsi kontribusi riil tiap unit.'
                    : `Satuan ${satuan || '—'} — Bobot Agregasi tidak dihitung otomatis dari nilai target (target rate/durasi tiap unit independen, bukan kontribusi aditif). Isi manual sesuai proporsi kontribusi riil tiap unit.`}
                </p>
              )}
              {aggregationMethod === 'weighted' && !isSingleAssignment && !isComposite && !isNonAdditiveSatuan && (
                <div style={{ marginBottom: 'var(--space-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', cursor: allTarget2Numeric ? 'pointer' : 'not-allowed' }}>
                    <input
                      type="checkbox" checked={autoCalcPersen} disabled={!allTarget2Numeric}
                      onChange={(e) => setAutoCalcPersen(e.target.checked)}
                    />
                    Hitung otomatis dari Target {CURRENT_YEAR} (%)
                  </label>
                  {!allTarget2Numeric && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 2 }}>
                      Nonaktif — semua baris &quot;Target {CURRENT_YEAR}&quot; harus berupa angka murni.
                    </span>
                  )}
                </div>
              )}
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Unit</th><th>Bidang</th><th>Penanggung Jawab</th>
                      <th>Target Sem I</th><th>Target {CURRENT_YEAR}</th>
                      {aggregationMethod === 'weighted' && !isSingleAssignment && <th className="num">Bobot Agregasi (%)</th>}
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a, i) => (
                      <Fragment key={i}>
                      <tr>
                        <td>
                          <select className="form-input form-input-sm" value={a.unitCode} onChange={(e) => updateAssignmentUnit(i, e.target.value)}>
                            {UNIT_OPTIONS.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}
                          </select>
                        </td>
                        <td>
                          {a.unitCode === 'KP' ? (
                            // Kantor Induk: tetap single-select seperti semula — target/PJ tiap bidang KP
                            // biasanya beda-beda & tak sesederhana UPMK, jadi multi-bidang-per-baris
                            // sengaja TIDAK diaktifkan di sini (khusus diminta hanya utk UPMK).
                            <select
                              className="form-input form-input-sm" value={a.bidang[0] ?? ''}
                              onChange={(e) => setAssignments((prev) => prev.map((row, idx) => (idx === i ? { ...row, bidang: [e.target.value] } : row)))}
                            >
                              {bidangOptionsFor(a.unitCode).map((b) => <option key={b} value={b}>{b}</option>)}
                            </select>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                              {a.bidang.map((b) => (
                                <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px' }}>
                                  {b}
                                  <button
                                    onClick={() => toggleRowBidang(i, b)} disabled={a.bidang.length <= 1}
                                    style={{ border: 'none', background: 'none', cursor: a.bidang.length <= 1 ? 'not-allowed' : 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
                                    title="Hapus bidang ini dari baris"
                                  >×</button>
                                </span>
                              ))}
                              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedBidangRow(expandedBidangRow === i ? null : i)}>
                                <Plus size={11} /> Bidang
                              </button>
                            </div>
                          )}
                        </td>
                        <td><input className="form-input form-input-sm" value={a.holder} onChange={(e) => updateAssignment(i, 'holder', e.target.value)} placeholder="Nama PJ" /></td>
                        {isComposite ? (
                          <td colSpan={2}>
                            <button
                              className="btn btn-ghost btn-sm" onClick={() => setExpandedAssignment(expandedAssignment === i ? null : i)}
                              title="Atur target tiap sub-indikator utk unit ini — kosong = warisi target template"
                            >
                              {subIndicators.length} sub · atur target <ChevronDown size={12} style={{ transform: expandedAssignment === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                            </button>
                          </td>
                        ) : (
                          <>
                            <td><input className="form-input form-input-sm" value={a.target} onChange={(e) => updateAssignment(i, 'target', e.target.value)} placeholder="Target Sem I" /></td>
                            <td><input className="form-input form-input-sm" value={a.target2} onChange={(e) => updateAssignment(i, 'target2', e.target.value)} placeholder="Target tahun" /></td>
                          </>
                        )}
                        {aggregationMethod === 'weighted' && !isSingleAssignment && (
                          <td>
                            <input
                              type="number" min={0} max={100} step={0.01}
                              className="form-input form-input-sm" style={{ textAlign: 'center' }}
                              value={a.persenAgregasi || ''} disabled={autoCalcPersen && allTarget2Numeric}
                              onChange={(e) => updatePersen(i, e.target.value)} placeholder="0"
                            />
                          </td>
                        )}
                        <td>
                          <button className="btn btn-ghost btn-sm" disabled={assignments.length <= 1} onClick={() => removeAssignment(i)} style={{ color: 'var(--color-danger)' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                      {a.unitCode !== 'KP' && expandedBidangRow === i && (
                        <tr style={{ background: 'var(--color-surface-2)' }}>
                          <td colSpan={5 + (aggregationMethod === 'weighted' && !isSingleAssignment ? 1 : 0) + 1} style={{ padding: 'var(--space-2) var(--space-4)' }}>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              {bidangOptionsFor(a.unitCode).map((b) => {
                                const usedElsewhere = bidangUsedElsewhere(i, a.unitCode).has(b);
                                return (
                                  <label key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', opacity: usedElsewhere ? 0.5 : 1, cursor: usedElsewhere ? 'not-allowed' : 'pointer' }}>
                                    <input type="checkbox" disabled={usedElsewhere} checked={a.bidang.includes(b)} onChange={() => toggleRowBidang(i, b)} />
                                    {b}{usedElsewhere && ' (dipakai baris lain)'}
                                  </label>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                      {isComposite && expandedAssignment === i && (
                        <tr style={{ background: 'var(--color-surface-2)' }}>
                          <td colSpan={5 + (aggregationMethod === 'weighted' && !isSingleAssignment ? 1 : 0) + 1} style={{ padding: 0 }}>
                            <table className="data-table compact" style={{ margin: 0 }}>
                              <thead>
                                <tr><th>Sub-Indikator</th><th>Target Sem I</th><th>Target {CURRENT_YEAR}</th></tr>
                              </thead>
                              <tbody>
                                {subIndicators.map((si, j) => (
                                  <tr key={j}>
                                    <td style={{ color: 'var(--color-text-muted)' }}>↳ {si.nama || `Sub ${j + 1}`}</td>
                                    <td>
                                      <input
                                        className="form-input form-input-sm" placeholder={si.target || '—'}
                                        value={a.subIndicatorTargets?.[j]?.target ?? ''}
                                        onChange={(e) => updateAssignmentSubTarget(i, j, 'target', e.target.value)}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        className="form-input form-input-sm" placeholder={si.target2 || '—'}
                                        value={a.subIndicatorTargets?.[j]?.target2 ?? ''}
                                        onChange={(e) => updateAssignmentSubTarget(i, j, 'target2', e.target.value)}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 'var(--space-2)' }}>
                              Kosongkan agar unit ini mewarisi target template di atas (placeholder = nilai yang dipakai).
                            </p>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                    {aggregationMethod === 'weighted' && !isSingleAssignment && anyPersenSet && (
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-xs)' }}>Total Bobot Agregasi:</td>
                        <td className="num" style={{ fontWeight: 700, color: Math.abs(totalPersenForm - 100) < 0.01 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {totalPersenForm}%
                        </td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button className="btn btn-ghost" onClick={resetForm} disabled={busy}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? 'Menyimpan…' : editingId ? 'Update Draft KM' : 'Simpan Draft KM'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card p-0">
        <div className="card-header compact">
          <div className="card-title"><Layers size={14} /> Daftar KPI Master</div>
          <span className="card-meta">{masters.length} KPI</span>
        </div>
        {masters.length === 0 ? (
          <EmptyState title="Belum ada KPI Master" message="Klik 'KPI Master Baru' untuk mendefinisikan KPI dan meng-assign-nya ke banyak unit/bidang." />
        ) : (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Indikator</th><th>Tipe</th><th>Versi</th><th>Satuan</th><th className="num">Bobot KM</th><th className="num">Assignment</th><th>Dibuat oleh</th><th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {masters.map((m) => (
                  <Fragment key={m.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>
                        {m.indikator}
                        {m.aggregationMethod === 'sum' && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px' }} title="Metode agregasi: SUM (jumlah polos)">
                            Σ SUM
                          </span>
                        )}
                        {m.subIndicators && m.subIndicators.length > 0 && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '1px 4px' }} title={`Komposit — ${m.subIndicators.length} sub-indikator`}>
                            Komposit ({m.subIndicators.length})
                          </span>
                        )}
                      </td>
                      <td><span className={`status-pill ${m.kmType === 'final' ? 'completed' : 'at-risk'}`} style={{ fontSize: 12 }}>{m.kmType === 'final' ? 'Final' : 'Draft'}</span></td>
                      <td>
                        <span className={`status-pill ${m.isPending ? 'in-review' : 'completed'}`} style={{ fontSize: 12 }} title={`Berlaku mulai ${m.effectiveMonth}`}>
                          v{m.version} · {m.isPending ? `mulai ${m.effectiveMonth}` : 'berlaku'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{m.satuan || '—'}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{m.bobotKm || '—'}</td>
                      <td className="num">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const willOpen = expanded !== m.id;
                            setExpanded(willOpen ? m.id : null);
                            if (willOpen && !rollups[m.id]) fetchRollup(m.id);
                          }}
                        >
                          {m.assignments.length} unit <ChevronDown size={12} style={{ transform: expanded === m.id ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                        </button>
                      </td>
                      <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{m.createdBy}</td>
                      <td>
                        {canAuthor && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(m)} title="Edit"><Edit2 size={13} /></button>
                            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(m.id)} title="Hapus" style={{ color: 'var(--color-danger)' }}><Trash2 size={13} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expanded === m.id && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--color-surface-2)', padding: 0 }}>
                          <table className="data-table compact" style={{ margin: 0 }}>
                            <thead>
                              <tr><th>Unit</th><th>Bidang</th><th>PJ</th><th>Target Sem I</th><th>Target {CURRENT_YEAR}</th><th className="num">{m.aggregationMethod === 'sum' ? 'Metode' : 'Bobot Agregasi'}</th></tr>
                            </thead>
                            <tbody>
                              {m.assignments.map((a) => (
                                <tr key={a.id}>
                                  <td style={{ fontWeight: 600 }}>{UNIT_NAMES[a.unitCode] ?? a.unitCode}</td>
                                  <td style={{ fontSize: 13 }}>{a.bidang}</td>
                                  <td style={{ color: 'var(--color-text-muted)' }}>{a.holder || '—'}</td>
                                  <td>{a.target || '—'}</td>
                                  <td>{a.target2 || '—'}</td>
                                  <td className="num">{m.aggregationMethod === 'sum' ? 'SUM' : (a.persenAgregasi ? `${a.persenAgregasi}%` : '—')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Rollup: nilai parent hasil agregasi realisasi children */}
                          <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <PieChart size={13} /> Rollup Nilai Parent
                            </div>
                            {rollupLoading === m.id ? (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Menghitung…</div>
                            ) : rollups[m.id] ? (
                              <>
                                <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline', marginBottom: 8 }}>
                                  <span style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-accent)' }}>{rollups[m.id].nilaiParent}</span>
                                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                                    Target parent: {rollups[m.id].targetParent || '—'} · Periode: {rollups[m.id].periodLabel} · Total bobot: {rollups[m.id].totalPersen}%
                                    {!rollups[m.id].isFullyConfigured && <span style={{ color: 'var(--color-warning)' }}> (belum 100%)</span>}
                                  </span>
                                </div>
                                <table className="data-table compact" style={{ margin: 0 }}>
                                  <thead>
                                    <tr><th>Unit</th><th>Bidang</th><th className="num">Bobot</th><th className="num">Realisasi</th><th className="num">Kontribusi</th></tr>
                                  </thead>
                                  <tbody>
                                    {rollups[m.id].breakdown.map((b, i) => (
                                      <tr key={i}>
                                        <td style={{ fontWeight: 600 }}>{UNIT_NAMES[b.unitCode] ?? b.unitCode}</td>
                                        <td style={{ fontSize: 13 }}>{b.bidang}</td>
                                        <td className="num">{b.persenAgregasi}%</td>
                                        <td className="num">{b.hasData ? b.realisasi : <span style={{ color: 'var(--color-text-subtle)' }}>belum ada</span>}</td>
                                        <td className="num" style={{ fontWeight: 700 }}>{b.kontribusi}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            ) : (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Rollup tidak tersedia.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ============================ Tab 2: Dokumen KM ============================
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Menunggu Review', ready: 'Siap Konsolidasi', approved: 'Disetujui', rejected: 'Dikembalikan',
};
const STATUS_PILL: Record<string, string> = {
  draft: 'in-review', submitted: 'needs-revision', ready: 'at-risk', approved: 'completed', rejected: 'delayed',
};

function DokumenKmTab() {
  const { user } = useAuth();
  const [kmTypeFilter, setKmTypeFilter] = useState<'draft' | 'final'>('draft');
  const [kontrakList, setKontrakList] = useState<KontrakManajemen[]>([]);
  const [approvedList, setApprovedList] = useState<KontrakManajemen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [approvedExpanded, setApprovedExpanded] = useState<string | null>(null);
  const [draftExpanded, setDraftExpanded] = useState<string | null>(null);

  const [selectedUnit, setSelectedUnit] = useState('KP');
  const [submitTargetId, setSubmitTargetId] = useState<string | null>(null);
  const [defaultReviewers, setDefaultReviewers] = useState<{ checkerIds: string[]; approverId: string | null }>({ checkerIds: [], approverId: null });
  // Default reviewer per-dokumen (dari KPI Master Fase C) — dipakai borongan "Submit Semua yang Siap".
  const [docDefaults, setDocDefaults] = useState<Record<string, { checkerIds: string[]; approverId: string | null }>>({});

  useEffect(() => { if (user?.unit) setSelectedUnit(user.unit); }, [user?.unit]);
  const canSelectUnit = user?.role === 'GM';
  const lockedUnit = user?.unit ?? 'KP';

  const loadData = async () => {
    try {
      const unitFilter = user?.role === 'GM' ? selectedUnit : undefined;
      const data = await inputKontrak.list(unitFilter, undefined, kmTypeFilter);
      setKontrakList(data as KontrakManajemen[]);
    } catch (e) {
      setError((e as Error)?.message ?? 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit, kmTypeFilter]);
  useEffect(() => {
    inputKontrak.approved(undefined, undefined, kmTypeFilter).then((d) => setApprovedList(d as KontrakManajemen[])).catch(() => {});
  }, [submitted, kmTypeFilter]);

  const myBidang = user?.bidang ?? null;
  const myUnit = user?.unit ?? null;
  // RPC (pemilik definisi KPI Master lintas-bidang) & Admin bisa MELIHAT semua dokumen KM —
  // meniru pola yang sudah otomatis benar utk UPMK (fan-out RPC selalu terlihat submitter-nya
  // sendiri). Ini hanya visibility; tombol aksi/submit tetap dijaga terpisah oleh canActOnRow().
  const canSeeAllKm = user?.role === 'GM' || user?.role === 'SUPERADMIN' || user?.role === 'DEVELOPER'
    || (user?.unit === 'KP' && user?.bidang === RPC_BIDANG);
  // Kirim dokumen KM hanya wewenang PIC Kinerja (Staff RPC) — penyusun dokumen hasil fan-out
  // (via Definisi KPI, juga RPC-only), berlaku lintas semua bidang. PIC bidang/bagian terkait
  // hanya melihat status dokumennya, tidak dapat mengirim.
  const isRpcStaff = user?.role === 'STAFF' && user?.unit === 'KP' && user?.bidang === RPC_BIDANG;
  const canActOnRow = (k: KontrakManajemen) => isRpcStaff || k.submitterId === user?.id;

  const filterKm = (list: KontrakManajemen[]) => {
    if (canSeeAllKm) return list;
    return list.filter((k) => {
      if (k.submitterId === user?.id) return true;
      if (myUnit && k.unitCode !== myUnit) return false;
      if (myUnit === 'KP' && myBidang) return k.bidang === myBidang;
      return true;
    });
  };
  const visibleKontrak = filterKm(kontrakList);
  const visibleApproved = filterKm(approvedList);
  const draftCount = visibleKontrak.filter((k) => k.status === 'draft').length;
  const submittedCount = visibleKontrak.filter((k) => k.status === 'submitted').length;

  // Dokumen yang siap dikirim (draft/rejected & user berwenang).
  const submittableDocs = visibleKontrak.filter((k) => (k.status === 'draft' || k.status === 'rejected') && canActOnRow(k));

  // Ambil default reviewer tiap dokumen submittable (untuk borongan & indikator kesiapan).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        submittableDocs.map(async (k) => {
          try { return [k.id, await kpiMaster.defaultsForKm(k.id)] as const; }
          catch { return [k.id, { checkerIds: [], approverId: null }] as const; }
        }),
      );
      if (!cancelled) setDocDefaults(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kontrakList]);

  const isDocReady = (id: string) => {
    const d = docDefaults[id];
    return !!d && d.checkerIds.length > 0 && !!d.approverId;
  };
  const readyDocs = submittableDocs.filter((k) => isDocReady(k.id));

  // Submit per-dokumen: buka picker dgn pre-fill default.
  const handleSubmit = async (id: string) => {
    setSubmitTargetId(id);
    try {
      const d = docDefaults[id] ?? (await kpiMaster.defaultsForKm(id));
      setDefaultReviewers(d);
    } catch {
      setDefaultReviewers({ checkerIds: [], approverId: null });
    }
  };
  const handleConfirmSubmit = async (checkerIds: string[], approverIds: string[]) => {
    if (!submitTargetId) return;
    setSubmitting(true);
    try {
      await inputKontrak.submit(submitTargetId, checkerIds, approverIds);
      setSubmitTargetId(null);
      setSubmitted(true);
      await loadData();
      setTimeout(() => setSubmitted(false), 3000);
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal mengirim');
    } finally {
      setSubmitting(false);
    }
  };

  // Hapus dokumen KM draft/rejected — backend menolak status submitted/approved. Sama seperti
  // fan-out otomatis, dokumen ini bisa muncul lagi kalau Definisi KPI-nya masih ada; hapus di
  // sini murni membuang dokumen kosong/keliru, bukan alternatif menghapus KPI Master-nya.
  const handleDeleteKm = async (k: KontrakManajemen) => {
    if (!confirm(`Hapus dokumen KM ${UNIT_NAMES[k.unitCode] ?? k.unitCode} — ${k.bidang}? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await inputKontrak.delete(k.id);
      await loadData();
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal menghapus dokumen');
    }
  };

  // Borongan: kirim semua dokumen yang punya default reviewer lengkap.
  const handleBulkSubmit = async () => {
    if (readyDocs.length === 0) return;
    if (!confirm(`Kirim ${readyDocs.length} dokumen KM sekaligus menggunakan alur reviewer default masing-masing?`)) return;
    setSubmitting(true);
    let ok = 0; let fail = 0;
    for (const k of readyDocs) {
      const d = docDefaults[k.id];
      if (!d || d.checkerIds.length === 0 || !d.approverId) { fail++; continue; }
      try { await inputKontrak.submit(k.id, d.checkerIds, [d.approverId]); ok++; }
      catch { fail++; }
    }
    await loadData();
    setSubmitting(false);
    setNotice(`Borongan selesai: ${ok} dokumen terkirim${fail > 0 ? `, ${fail} gagal/terlewati` : ''}.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const canCreateKm = user?.unit === 'KP';

  if (loading) return <SkeletonTable rows={4} cols={6} />;
  if (error && kontrakList.length === 0) return <ErrorState title="Gagal memuat data" message={error} />;

  return (
    <>
      {/* Tab KM Draft / Final */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`btn ${kmTypeFilter === 'draft' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKmTypeFilter('draft')}>KM Draft</button>
        <button className={`btn ${kmTypeFilter === 'final' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKmTypeFilter('final')}>KM Final</button>
        <span style={{ alignSelf: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          {kmTypeFilter === 'draft' ? 'Acuan target awal tahun, sebelum disahkan Direksi.' : 'Acuan resmi setelah disahkan Direksi (di luar sistem).'}
        </span>
        <div style={{ flex: 1 }} />
        {canSelectUnit && (
          <select className="form-input form-input-sm" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} style={{ width: 'auto', minWidth: 140, fontWeight: 700 }}>
            {UNIT_OPTIONS.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
          </select>
        )}
        {canCreateKm && readyDocs.length > 0 && (
          <button className="btn btn-primary" onClick={handleBulkSubmit} disabled={submitting}>
            <Boxes size={15} /> Submit Semua yang Siap ({readyDocs.length})
          </button>
        )}
      </div>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
        Unit: <b style={{ color: 'var(--color-accent)' }}>{canSelectUnit ? (UNIT_NAMES[selectedUnit] ?? selectedUnit) : (UNIT_NAMES[lockedUnit] ?? lockedUnit)}</b>
        {' · '}{visibleKontrak.length} dokumen · Draft: {draftCount} · Terkirim: {submittedCount}
      </div>

      {submitted && (
        <div className="status-banner success" style={{ marginBottom: 'var(--space-4)' }}>
          <CheckCircle size={18} /> <strong>Dokumen KM berhasil dikirim untuk direview.</strong>
        </div>
      )}
      {notice && (
        <div className="status-banner success" style={{ marginBottom: 'var(--space-4)' }}>
          <CheckCircle size={18} /> {notice}
        </div>
      )}
      {error && (
        <div className="status-banner danger" style={{ marginBottom: 'var(--space-4)' }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {!canCreateKm && (
        <div className="status-banner" style={{ marginBottom: 'var(--space-4)', background: 'var(--color-surface-2)' }}>
          <AlertCircle size={16} /> Dokumen KM disusun oleh Kantor Induk (via Definisi KPI). Unit Anda cukup mengisi <strong>Input Realisasi Bulanan</strong> terhadap KM yang sudah disahkan.
        </div>
      )}

      {/* Info: dokumen dirakit otomatis dari Definisi KPI */}
      {canCreateKm && (
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={13} /> Dokumen KM di bawah dirakit otomatis dari <b>Definisi KPI</b> (fan-out). Kirim per-dokumen atau borongan; alur reviewer terisi default dari KPI Master.
        </div>
      )}

      {/* Dokumen list */}
      {visibleKontrak.length === 0 ? (
        <EmptyState title="Belum ada dokumen KM" message="Definisikan KPI di tab 'Definisi KPI' — dokumen KM per unit/bidang akan otomatis muncul di sini." />
      ) : (
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title"><FileText size={14} />Daftar Dokumen KM</div>
            <span className="card-meta">{visibleKontrak.length} dokumen</span>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Unit</th><th>Bidang</th><th>Penanggung Jawab</th><th>Jumlah KPI</th><th>Status</th><th>Tanggal</th><th style={{ width: 180 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {visibleKontrak.map((k) => (
                  <Fragment key={k.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{UNIT_NAMES[k.unitCode] ?? k.unitCode}</td>
                      <td>{k.bidang}</td>
                      <td>{k.holder}</td>
                      <td className="num">
                        <button className="btn btn-ghost btn-sm" onClick={() => setDraftExpanded(draftExpanded === k.id ? null : k.id)}>
                          {k.kpiItems.length} indikator <ChevronDown size={12} style={{ transform: draftExpanded === k.id ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                        </button>
                      </td>
                      <td>
                        <span className={`status-pill ${STATUS_PILL[k.status] ?? 'in-review'}`}>{STATUS_LABEL[k.status] ?? k.status}</span>
                        {k.status === 'submitted' && (() => {
                          const kk = k as KontrakManajemen & { steps?: { label: string }[]; currentStepIndex?: number };
                          const lbl = (kk.steps ?? [])[kk.currentStepIndex ?? 0]?.label ?? 'tahap review';
                          return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>di {lbl}</div>;
                        })()}
                        {k.status === 'ready' && <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 2 }}>lolos rantai → menunggu bundle GM</div>}
                        {k.status === 'rejected' && k.reviewNote && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 2, maxWidth: 220 }}>{k.reviewNote}</div>}
                      </td>
                      <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(k.submittedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                          {(k.status === 'draft' || k.status === 'rejected') ? (
                            canActOnRow(k) ? (
                              <>
                                <button className="btn btn-primary btn-sm" onClick={() => handleSubmit(k.id)} disabled={submitting} title={isDocReady(k.id) ? 'Alur reviewer default siap' : 'Belum ada default reviewer — pilih manual'}>
                                  <Send size={14} /> Kirim
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteKm(k)} disabled={submitting} title="Hapus dokumen KM" style={{ color: 'var(--color-danger)' }}>
                                  <Trash2 size={14} />
                                </button>
                              </>
                            ) : (
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>Hanya PIC Kinerja (RPC) — lihat saja</span>
                            )
                          ) : k.status === 'submitted' ? (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Menunggu review</span>
                          ) : k.status === 'approved' ? (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>✓ Disetujui {k.reviewer ? `· ${k.reviewer}` : ''}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {draftExpanded === k.id && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--color-surface-2)', padding: 0 }}>
                          <table className="data-table compact" style={{ margin: 0 }}>
                            <thead>
                              <tr><th>No</th><th>Indikator Kinerja</th><th>Formula</th><th>Satuan</th><th className="num">Bobot</th><th>Target Sem I</th><th>Target Tahun {CURRENT_YEAR}</th></tr>
                            </thead>
                            <tbody>
                              {(k.kpiItems as Record<string, string>[]).map((it, idx) => (
                                <tr key={idx}>
                                  <td>{idx + 1}</td><td>{it.indikator}</td><td>{it.formula}</td><td>{it.satuan}</td>
                                  <td className="num">{it.bobot}</td><td>{it.target}</td><td>{it.target2}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Registri KM disahkan */}
      <div className="card p-0" style={{ marginTop: 'var(--space-6)' }}>
        <div className="card-header compact">
          <div className="card-title"><FileCheck2 size={14} />Kontrak Manajemen Disetujui (Sah)</div>
          <span className="card-meta">{visibleApproved.length} kontrak · disahkan GM · read-only</span>
        </div>
        {visibleApproved.length === 0 ? (
          <div className="card-body">
            <EmptyState title="Belum ada KM disetujui" message="Belum ada Kontrak Manajemen yang disahkan penuh hingga General Manager." />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr><th>Unit</th><th>Bidang</th><th>Penanggung Jawab</th><th>KPI</th><th>Disahkan oleh</th><th>Tanggal</th></tr>
              </thead>
              <tbody>
                {visibleApproved.map((k) => (
                  <Fragment key={k.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{UNIT_NAMES[k.unitCode] ?? k.unitCode}</td>
                      <td>{k.bidang}</td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{k.holder}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => setApprovedExpanded(approvedExpanded === k.id ? null : k.id)}>
                          {k.kpiItems.length} indikator <ChevronDown size={12} style={{ transform: approvedExpanded === k.id ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                        </button>
                      </td>
                      <td><span className="status-pill completed" style={{ fontSize: 12 }}>{k.reviewer ?? 'GM'}</span></td>
                      <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {k.reviewedAt ? new Date(k.reviewedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                    {approvedExpanded === k.id && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--color-surface-2)', padding: 0 }}>
                          <table className="data-table compact" style={{ margin: 0 }}>
                            <thead>
                              <tr><th>No</th><th>Indikator Kinerja</th><th>Formula</th><th>Satuan</th><th className="num">Bobot</th><th>Target Sem I</th><th>Target Tahun {CURRENT_YEAR}</th></tr>
                            </thead>
                            <tbody>
                              {(k.kpiItems as Record<string, string>[]).map((it, idx) => (
                                <tr key={idx}>
                                  <td>{idx + 1}</td><td>{it.indikator}</td><td>{it.formula}</td><td>{it.satuan}</td>
                                  <td className="num">{it.bobot}</td><td>{it.target}</td><td>{it.target2}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReviewerPickerModal
        open={submitTargetId !== null}
        title="Alur Reviewer Kontrak Manajemen"
        busy={submitting}
        fetchCandidates={inputKontrak.reviewerCandidates}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setSubmitTargetId(null)}
        initialCheckerIds={defaultReviewers.checkerIds}
        initialApproverIds={defaultReviewers.approverId ? [defaultReviewers.approverId] : undefined}
        bidang={kontrakList.find((k) => k.id === submitTargetId)?.bidang}
      />
    </>
  );
}

// ============================ Tab 3: Review per-KPI (read-only) ============================
type PerKpiSlice = {
  unitCode: string; bidang: string; holder: string; persenAgregasi: number;
  realisasi: number | null; status: string; reviewer: string | null;
  isApproved: boolean; kontribusi: number; hasData: boolean;
};
type Consolidation = {
  status: 'pending' | 'approved' | 'rejected'; reviewer: string | null;
  reviewNote: string | null; nilaiParent: number | null; reviewedAt: string | null;
};
type PerKpiItem = {
  masterId: string; indikator: string; targetParent: string;
  aggregationMethod: 'weighted' | 'sum'; kmType: 'draft' | 'final';
  version: number; effectiveMonth: string; isPending: boolean;
  totalAssignments: number; approvedCount: number; allApproved: boolean;
  totalPersen: number; nilaiParent: number; isFullyConfigured: boolean;
  readyForConsolidation: boolean; consolidation: Consolidation | null;
  slices: PerKpiSlice[];
};
type PerKpiResponse = { periodId: string; periodLabel: string; viewerCanConsolidate: boolean; items: PerKpiItem[] };

const REAL_STATUS_LABEL: Record<string, string> = {
  none: 'Belum diisi', draft: 'Draft', submitted: 'Menunggu Review', ready: 'Siap', approved: 'Disetujui', rejected: 'Dikembalikan',
};
const REAL_STATUS_PILL: Record<string, string> = {
  none: 'in-review', draft: 'in-review', submitted: 'needs-revision', ready: 'at-risk', approved: 'completed', rejected: 'delayed',
};

export function ReviewPerKpiTab() {
  const { periodId } = usePeriod();
  const [data, setData] = useState<PerKpiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    kpiMaster.reviewPerKpi(periodId || undefined)
      .then((d) => setData(d as PerKpiResponse))
      .catch((e) => setError((e as Error)?.message ?? 'Gagal memuat data'))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  const handleConsolidation = async (item: PerKpiItem, action: 'approve' | 'reject') => {
    let note: string | undefined;
    if (action === 'reject') {
      const input = window.prompt(`Alasan menolak konsolidasi "${item.indikator}"? (wajib)`);
      if (input == null) return; // batal
      if (!input.trim()) { setError('Catatan penolakan wajib diisi.'); return; }
      note = input.trim();
    } else {
      if (!window.confirm(`Setujui konsolidasi "${item.indikator}"? Nilai parent ${item.nilaiParent} akan dikunci sebagai final.`)) return;
    }
    setBusyId(item.masterId);
    setError(null);
    try {
      await kpiMaster.reviewConsolidation(item.masterId, action, note, data?.periodId);
      setNotice(action === 'approve'
        ? `Konsolidasi "${item.indikator}" disetujui — nilai parent final ${item.nilaiParent}.`
        : `Konsolidasi "${item.indikator}" ditolak; notifikasi dikirim ke bidang kontributor.`);
      load();
      setTimeout(() => setNotice(null), 5000);
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal memproses konsolidasi');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <SkeletonTable rows={3} cols={6} />;
  if (error) return <ErrorState title="Gagal memuat data" message={error} />;
  if (!data || data.items.length === 0) {
    return (
      <div className="card p-0">
        <EmptyState
          title="Belum ada KPI bersama"
          message="Lensa ini menampilkan KPI yang dimiliki lebih dari satu bidang. Definisikan KPI dengan >1 assignment untuk melihat konsolidasi lintas-dokumen di sini."
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <PieChart size={14} /> Lensa konsolidasi — periode <b>{data.periodLabel}</b>. Nilai parent dihitung dari slice yang realisasinya sudah <b>disetujui</b>; slice lain ditampilkan sebagai progres.
        {data.viewerCanConsolidate && <span style={{ color: 'var(--color-accent)' }}> · Anda dapat menyetujui/menolak konsolidasi (RPC Perencanaan).</span>}
      </div>

      {notice && (
        <div className="status-banner success" style={{ marginBottom: 'var(--space-4)' }}>
          <CheckCircle size={18} /> {notice}
        </div>
      )}

      {data.items.map((it) => {
        const cs = it.consolidation;
        return (
        <div key={it.masterId} className="card p-0" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="card-header compact" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Layers size={14} /> {it.indikator}
              {it.aggregationMethod === 'sum' && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px' }} title="Metode agregasi: SUM (jumlah polos)">Σ SUM</span>
              )}
              <span className={`status-pill ${it.kmType === 'final' ? 'completed' : 'at-risk'}`} style={{ fontSize: 12 }}>{it.kmType === 'final' ? 'Final' : 'Draft'}</span>
              {it.isPending && <span className="status-pill in-review" style={{ fontSize: 12 }} title={`Berlaku mulai ${it.effectiveMonth}`}>v{it.version} · mulai {it.effectiveMonth}</span>}
              {cs?.status === 'approved' && <span className="status-pill completed" style={{ fontSize: 12 }} title={`Disetujui ${cs.reviewer ?? ''}`}>✓ Konsolidasi Final</span>}
              {cs?.status === 'rejected' && <span className="status-pill delayed" style={{ fontSize: 12 }}>Konsolidasi Ditolak</span>}
              {!cs && it.readyForConsolidation && <span className="status-pill at-risk" style={{ fontSize: 12 }}>Siap Konsolidasi</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span className={`status-pill ${it.allApproved ? 'completed' : 'at-risk'}`} style={{ fontSize: 12 }}>
                {it.approvedCount}/{it.totalAssignments} bidang disetujui
              </span>
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
                {cs?.status === 'approved' ? 'Nilai parent FINAL: ' : 'Nilai parent: '}
                <b style={{ color: 'var(--color-accent)', fontSize: 'var(--text-md)' }}>{cs?.status === 'approved' ? cs.nilaiParent : it.nilaiParent}</b>
                {it.targetParent ? ` / target ${it.targetParent}` : ''}
                {it.aggregationMethod === 'weighted' && !it.isFullyConfigured && <span style={{ color: 'var(--color-warning)' }}> · bobot belum 100%</span>}
              </span>
              {data.viewerCanConsolidate && cs?.status !== 'approved' && (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busyId === it.masterId || !it.allApproved}
                    title={it.allApproved ? 'Setujui nilai agregat sebagai final' : 'Belum semua bidang menyetujui realisasinya'}
                    onClick={() => handleConsolidation(it, 'approve')}
                  >
                    <Check size={13} /> Setujui
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busyId === it.masterId}
                    style={{ color: 'var(--color-danger)' }}
                    onClick={() => handleConsolidation(it, 'reject')}
                  >
                    <X size={13} /> Tolak
                  </button>
                </div>
              )}
            </div>
          </div>
          {cs?.status === 'rejected' && cs.reviewNote && (
            <div style={{ padding: '6px 12px', fontSize: 'var(--text-2xs)', color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderBottom: '1px solid var(--color-border)' }}>
              <AlertCircle size={12} style={{ verticalAlign: -2, marginRight: 4 }} /> Ditolak {cs.reviewer ? `oleh ${cs.reviewer}` : ''}: {cs.reviewNote}
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table compact" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Unit</th><th>Bidang</th><th>PJ</th>
                  {it.aggregationMethod === 'weighted' && <th className="num">Bobot</th>}
                  <th className="num">Realisasi</th><th>Status</th><th>Reviewer</th><th className="num">Kontribusi</th>
                </tr>
              </thead>
              <tbody>
                {it.slices.map((s, i) => (
                  <tr key={i} style={{ opacity: s.isApproved ? 1 : 0.72 }}>
                    <td style={{ fontWeight: 600 }}>{UNIT_NAMES[s.unitCode] ?? s.unitCode}</td>
                    <td style={{ fontSize: 13 }}>{s.bidang}</td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{s.holder || '—'}</td>
                    {it.aggregationMethod === 'weighted' && <td className="num">{s.persenAgregasi ? `${s.persenAgregasi}%` : '—'}</td>}
                    <td className="num">{s.hasData ? s.realisasi : <span style={{ color: 'var(--color-text-subtle)' }}>belum ada</span>}</td>
                    <td><span className={`status-pill ${REAL_STATUS_PILL[s.status] ?? 'in-review'}`} style={{ fontSize: 12 }}>{REAL_STATUS_LABEL[s.status] ?? s.status}</span></td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{s.reviewer || '—'}</td>
                    <td className="num" style={{ fontWeight: 700, color: s.isApproved ? 'var(--color-text)' : 'var(--color-text-subtle)' }}>
                      {s.isApproved ? s.kontribusi : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })}
    </>
  );
}
