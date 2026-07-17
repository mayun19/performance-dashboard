import { useEffect, useState, Fragment } from 'react';
import { kpiMaster, inputKontrak } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePeriod } from '../context/PeriodContext';
import {
  Layers, Plus, Trash2, Edit2, X, ChevronDown, AlertCircle, CheckCircle, PieChart,
  UserCheck, ShieldCheck, ArrowUp, ArrowDown, Check, FileText, Send, FileCheck2, Boxes,
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
const BIDANG_OPTIONS = [
  'Operasi Manajemen Proyek', 'QA/QC', 'Keuangan, Komunikasi & Umum',
  'Perencanaan & Project Control', 'K3L', 'MRO',
];
const CURRENT_YEAR = new Date().getFullYear();

// ============================ Shell: Manajemen KPI (3 tab) ============================
export function KpiMasterPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'definisi' | 'dokumen' | 'review'>('definisi');
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
        <button className={`btn ${tab === 'definisi' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('definisi')}>
          <Layers size={15} /> Definisi KPI
        </button>
        <button className={`btn ${tab === 'dokumen' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('dokumen')}>
          <FileText size={15} /> Dokumen KM
        </button>
        {canConsolidate && (
          <button className={`btn ${tab === 'review' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('review')}>
            <PieChart size={15} /> Review per-KPI
          </button>
        )}
      </div>

      {tab === 'definisi' && <DefinisiKpiTab />}
      {tab === 'dokumen' && <DokumenKmTab />}
      {tab === 'review' && canConsolidate && <ReviewPerKpiTab />}
    </div>
  );
}

// ============================ Tab 1: Definisi KPI ============================
type Assignment = {
  unitCode: string; bidang: string; holder: string; bobotKm: string; target: string; target2: string;
  persenAgregasi: number;
};
type KpiMasterRow = {
  id: string; year: string; kmType: 'draft' | 'final'; indikator: string; formula: string; satuan: string;
  targetParent: string; createdBy: string; createdAt: string;
  assignments: Array<Assignment & { id: string }>;
  defaultCheckerIds: string[]; defaultApproverId: string | null;
  effectiveMonth: string; version: number; status: string; previousVersionId: string | null;
  isPending: boolean; isCurrent: boolean;
  aggregationMethod: 'weighted' | 'sum';
};
const ROLE_LABEL: Record<string, string> = { ASMAN: 'ASMAN', MANAJER: 'Manajer', SRMANAJER: 'Senior Manajer', GM: 'General Manager' };
type RollupBreakdown = { unitCode: string; bidang: string; persenAgregasi: number; realisasi: number | null; kontribusi: number; hasData: boolean };
type Rollup = {
  masterId: string; indikator: string; targetParent: string; periodId: string; periodLabel: string;
  aggregationMethod: 'weighted' | 'sum';
  totalPersen: number; nilaiParent: number; isFullyConfigured: boolean; breakdown: RollupBreakdown[];
};

const emptyAssignment = (): Assignment => ({ unitCode: 'UPMK1', bidang: 'Operasi Manajemen Proyek', holder: '', bobotKm: '', target: '', target2: '', persenAgregasi: 0 });

function DefinisiKpiTab() {
  const { user } = useAuth();
  const { periodId } = usePeriod();
  const canAuthor = user?.unit === 'KP';

  const [masters, setMasters] = useState<KpiMasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
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
  const [targetParent, setTargetParent] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([emptyAssignment()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default alur reviewer (Fase C) — diwariskan ke picker submit dokumen hasil fan-out.
  const [reviewerCandidates, setReviewerCandidates] = useState<{ checkers: ReviewerCandidate[]; approvers: ReviewerCandidate[] }>({ checkers: [], approvers: [] });
  const [defaultCheckerOrder, setDefaultCheckerOrder] = useState<string[]>([]);
  const [defaultApproverId, setDefaultApproverId] = useState('');

  useEffect(() => {
    inputKontrak.reviewerCandidates()
      .then((d) => setReviewerCandidates(d as { checkers: ReviewerCandidate[]; approvers: ReviewerCandidate[] }))
      .catch(() => {});
  }, []);
  const toggleDefaultChecker = (id: string) =>
    setDefaultCheckerOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const moveDefaultChecker = (id: string, dir: -1 | 1) =>
    setDefaultCheckerOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const candDesc = (c: ReviewerCandidate) => `${ROLE_LABEL[c.role] ?? c.role}${c.unit && c.unit !== 'KP' ? ' · ' + (UNIT_NAMES[c.unit] ?? c.unit) : ''}`;

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
    setIndikator(''); setFormula(''); setSatuan('');
    setTargetParent(''); setAssignments([emptyAssignment()]); setFormError(null); setShowForm(false);
    setDefaultCheckerOrder([]); setDefaultApproverId('');
  };

  const handleEdit = (m: KpiMasterRow) => {
    setEditingId(m.id); setKmType(m.kmType); setAggregationMethod(m.aggregationMethod ?? 'weighted');
    setIndikator(m.indikator); setFormula(m.formula);
    setSatuan(m.satuan); setTargetParent(m.targetParent);
    setDefaultCheckerOrder(m.defaultCheckerIds ?? []); setDefaultApproverId(m.defaultApproverId ?? '');
    setAssignments(m.assignments.map((a) => ({
      unitCode: a.unitCode, bidang: a.bidang, holder: a.holder, bobotKm: a.bobotKm, target: a.target, target2: a.target2,
      persenAgregasi: a.persenAgregasi ?? 0,
    })));
    setEditingIsPending(m.isPending);
    setShowForm(true); setFormError(null);
  };

  const addAssignment = () => setAssignments((prev) => [...prev, emptyAssignment()]);
  const removeAssignment = (i: number) => setAssignments((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  const updateAssignment = (i: number, field: Exclude<keyof Assignment, 'persenAgregasi'>, value: string) =>
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  const updatePersen = (i: number, value: string) => {
    const n = value === '' ? 0 : Number(value);
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, persenAgregasi: Number.isFinite(n) ? n : a.persenAgregasi } : a)));
  };
  const totalPersenForm = assignments.reduce((s, a) => s + (a.persenAgregasi || 0), 0);
  const anyPersenSet = assignments.some((a) => (a.persenAgregasi || 0) > 0);

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
      const k = `${a.unitCode}||${a.bidang}`;
      if (keys.has(k)) { setFormError(`Assignment ganda: ${UNIT_NAMES[a.unitCode]} — ${a.bidang}`); return; }
      keys.add(k);
    }
    if (aggregationMethod === 'weighted' && anyPersenSet && Math.abs(totalPersenForm - 100) > 0.01) {
      setFormError(`Total bobot agregasi harus 100%, saat ini ${totalPersenForm}%.`);
      return;
    }
    setFormError(null); setBusy(true);
    try {
      await kpiMaster.save({
        id: editingId ?? undefined, kmType, aggregationMethod, indikator: indikator.trim(), formula, satuan, targetParent, assignments,
        defaultCheckerIds: defaultCheckerOrder, defaultApproverId: defaultApproverId || undefined,
      });
      setSubmitted(true);
      resetForm();
      load();
      setTimeout(() => setSubmitted(false), 3000);
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

      {submitted && (
        <div className="status-banner success" style={{ marginBottom: 'var(--space-4)' }}>
          <CheckCircle size={18} /> <strong>KPI Master tersimpan & disebar ke dokumen KM.</strong>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <label className="form-label">Satuan</label>
                <input className="form-input" value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder="mis. %, MW, Hari kerja" />
              </div>
              <div>
                <label className="form-label">Target Gabungan (Parent)</label>
                <input className="form-input" value={targetParent} onChange={(e) => setTargetParent(e.target.value)} placeholder="Target keseluruhan" />
              </div>
            </div>
            <div>
              <label className="form-label">Metode Agregasi</label>
              <select className="form-input" value={aggregationMethod} onChange={(e) => setAggregationMethod(e.target.value as 'weighted' | 'sum')}>
                <option value="weighted">Rata-rata Tertimbang (KPI positif — pakai Bobot Agregasi %, total 100%)</option>
                <option value="sum">Jumlah / SUM (KPI penalti-pengurang — tanpa syarat 100%)</option>
              </select>
            </div>

            {/* Assignments */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Assign ke Unit / Bidang ({assignments.length})</label>
                <button className="btn btn-ghost btn-sm" onClick={addAssignment}><Plus size={14} /> Tambah Assignment</button>
              </div>
              <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-2)' }}>
                {aggregationMethod === 'weighted' ? (
                  <><b>Bobot Agregasi</b>: persentase kontribusi realisasi tiap unit/bidang ke nilai KPI parent (rollup). Kosongkan semua bila belum dikonfigurasi, atau isi hingga total tepat 100%.</>
                ) : (
                  <>Metode <b>SUM</b>: nilai parent = jumlah polos realisasi tiap unit/bidang (cocok untuk KPI penalti/pengurang lintas bidang). Tidak perlu Bobot Agregasi.</>
                )}
              </p>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Unit</th><th>Bidang</th><th>Penanggung Jawab</th>
                      <th className="num">Bobot KM</th><th>Target Sem I</th><th>Target {CURRENT_YEAR}</th>
                      {aggregationMethod === 'weighted' && <th className="num">Bobot Agregasi (%)</th>}
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <select className="form-input form-input-sm" value={a.unitCode} onChange={(e) => updateAssignment(i, 'unitCode', e.target.value)}>
                            {UNIT_OPTIONS.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="form-input form-input-sm" value={a.bidang} onChange={(e) => updateAssignment(i, 'bidang', e.target.value)}>
                            {BIDANG_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </td>
                        <td><input className="form-input form-input-sm" value={a.holder} onChange={(e) => updateAssignment(i, 'holder', e.target.value)} placeholder="Nama PJ" /></td>
                        <td><input className="form-input form-input-sm" style={{ textAlign: 'center' }} value={a.bobotKm} onChange={(e) => updateAssignment(i, 'bobotKm', e.target.value)} placeholder="poin" /></td>
                        <td><input className="form-input form-input-sm" value={a.target} onChange={(e) => updateAssignment(i, 'target', e.target.value)} placeholder="Target Sem I" /></td>
                        <td><input className="form-input form-input-sm" value={a.target2} onChange={(e) => updateAssignment(i, 'target2', e.target.value)} placeholder="Target tahun" /></td>
                        {aggregationMethod === 'weighted' && (
                          <td>
                            <input
                              type="number" min={0} max={100} step={1}
                              className="form-input form-input-sm" style={{ textAlign: 'center' }}
                              value={a.persenAgregasi || ''} onChange={(e) => updatePersen(i, e.target.value)} placeholder="0"
                            />
                          </td>
                        )}
                        <td>
                          <button className="btn btn-ghost btn-sm" disabled={assignments.length <= 1} onClick={() => removeAssignment(i)} style={{ color: 'var(--color-danger)' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                    {aggregationMethod === 'weighted' && anyPersenSet && (
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700, fontSize: 'var(--text-xs)' }}>Total Bobot Agregasi:</td>
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

            {/* Default Alur Reviewer (Fase C) — diwariskan ke picker submit dokumen hasil fan-out */}
            <div>
              <label className="form-label" style={{ marginBottom: 4 }}>Default Alur Reviewer (opsional)</label>
              <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)', margin: '0 0 var(--space-2)' }}>
                Mengisi otomatis picker reviewer saat submitter mengirim dokumen hasil fan-out KPI ini. Submitter tetap bisa mengubahnya.
              </p>

              {defaultCheckerOrder.length > 0 && (
                <div style={{ marginBottom: 'var(--space-2)' }}>
                  {defaultCheckerOrder.map((id, i) => {
                    const c = reviewerCandidates.checkers.find((x) => x.id === id);
                    if (!c) return null;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--color-surface-2)', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                        <span style={{ fontWeight: 700, minWidth: 16 }}>{i + 1}.</span>
                        <span style={{ flex: 1 }}>{c.name} <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>· {candDesc(c)}</span></span>
                        <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveDefaultChecker(id, -1)}><ArrowUp size={12} /></button>
                        <button className="btn btn-ghost btn-sm" disabled={i === defaultCheckerOrder.length - 1} onClick={() => moveDefaultChecker(id, 1)}><ArrowDown size={12} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleDefaultChecker(id)}><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck size={12} /> Default Checker</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                    {reviewerCandidates.checkers.map((c) => {
                      const picked = defaultCheckerOrder.includes(c.id);
                      return (
                        <button
                          key={c.id} type="button" onClick={() => toggleDefaultChecker(c.id)}
                          style={{ textAlign: 'left', padding: '5px 8px', borderRadius: 6, border: `1px solid ${picked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: picked ? 'var(--color-accent-tint)' : 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                        >
                          <span style={{ width: 14 }}>{picked && <Check size={12} />}</span>
                          <span>{c.name} <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>· {candDesc(c)}</span></span>
                        </button>
                      );
                    })}
                    {reviewerCandidates.checkers.length === 0 && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Tidak ada kandidat.</span>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={12} /> Default Approver</div>
                  <select className="form-input form-input-sm" value={defaultApproverId} onChange={(e) => setDefaultApproverId(e.target.value)}>
                    <option value="">— Tidak ada default —</option>
                    {reviewerCandidates.approvers.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — {candDesc(a)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button className="btn btn-ghost" onClick={resetForm} disabled={busy}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? 'Menyimpan…' : editingId ? 'Update & Sebar' : 'Simpan & Sebar ke KM'}
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
                  <th>Indikator</th><th>Tipe</th><th>Versi</th><th>Satuan</th><th className="num">Assignment</th><th>Dibuat oleh</th><th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {masters.map((m) => (
                  <Fragment key={m.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>
                        {m.indikator}
                        {m.aggregationMethod === 'sum' && (
                          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px' }} title="Metode agregasi: SUM (jumlah polos)">
                            Σ SUM
                          </span>
                        )}
                      </td>
                      <td><span className={`status-pill ${m.kmType === 'final' ? 'completed' : 'at-risk'}`} style={{ fontSize: 10 }}>{m.kmType === 'final' ? 'Final' : 'Draft'}</span></td>
                      <td>
                        <span className={`status-pill ${m.isPending ? 'in-review' : 'completed'}`} style={{ fontSize: 10 }} title={`Berlaku mulai ${m.effectiveMonth}`}>
                          v{m.version} · {m.isPending ? `mulai ${m.effectiveMonth}` : 'berlaku'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--color-text-muted)' }}>{m.satuan || '—'}</td>
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
                      <td style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{m.createdBy}</td>
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
                        <td colSpan={7} style={{ background: 'var(--color-surface-2)', padding: 0 }}>
                          <table className="data-table compact" style={{ margin: 0 }}>
                            <thead>
                              <tr><th>Unit</th><th>Bidang</th><th>PJ</th><th className="num">Bobot KM</th><th>Target Sem I</th><th>Target {CURRENT_YEAR}</th><th className="num">{m.aggregationMethod === 'sum' ? 'Metode' : 'Bobot Agregasi'}</th></tr>
                            </thead>
                            <tbody>
                              {m.assignments.map((a) => (
                                <tr key={a.id}>
                                  <td style={{ fontWeight: 600 }}>{UNIT_NAMES[a.unitCode] ?? a.unitCode}</td>
                                  <td style={{ fontSize: 11 }}>{a.bidang}</td>
                                  <td style={{ color: 'var(--color-text-muted)' }}>{a.holder || '—'}</td>
                                  <td className="num">{a.bobotKm || '—'}</td>
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
                                        <td style={{ fontSize: 11 }}>{b.bidang}</td>
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
  const canSeeAllKm = user?.role === 'GM';
  const canActOnRow = (k: KontrakManajemen) =>
    user?.role === 'STAFF' && user?.unit === 'KP' &&
    ((user?.bidang ?? null) === k.bidang || k.submitterId === user?.id);

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
  const handleConfirmSubmit = async (checkerIds: string[], approverId: string) => {
    if (!submitTargetId) return;
    setSubmitting(true);
    try {
      await inputKontrak.submit(submitTargetId, checkerIds, approverId);
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

  // Borongan: kirim semua dokumen yang punya default reviewer lengkap.
  const handleBulkSubmit = async () => {
    if (readyDocs.length === 0) return;
    if (!confirm(`Kirim ${readyDocs.length} dokumen KM sekaligus menggunakan alur reviewer default masing-masing?`)) return;
    setSubmitting(true);
    let ok = 0; let fail = 0;
    for (const k of readyDocs) {
      const d = docDefaults[k.id];
      if (!d || d.checkerIds.length === 0 || !d.approverId) { fail++; continue; }
      try { await inputKontrak.submit(k.id, d.checkerIds, d.approverId); ok++; }
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
                  <th>Unit</th><th>Bidang</th><th>Penanggung Jawab</th><th>Jumlah KPI</th><th>Status</th><th>Tanggal</th><th style={{ width: 140 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {visibleKontrak.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}>{UNIT_NAMES[k.unitCode] ?? k.unitCode}</td>
                    <td>{k.bidang}</td>
                    <td>{k.holder}</td>
                    <td className="num">{k.kpiItems.length} indikator</td>
                    <td>
                      <span className={`status-pill ${STATUS_PILL[k.status] ?? 'in-review'}`}>{STATUS_LABEL[k.status] ?? k.status}</span>
                      {k.status === 'submitted' && (() => {
                        const kk = k as KontrakManajemen & { steps?: { label: string }[]; currentStepIndex?: number };
                        const lbl = (kk.steps ?? [])[kk.currentStepIndex ?? 0]?.label ?? 'tahap review';
                        return <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>di {lbl}</div>;
                      })()}
                      {k.status === 'ready' && <div style={{ fontSize: 10, color: 'var(--color-warning)', marginTop: 2 }}>lolos rantai → menunggu bundle GM</div>}
                      {k.status === 'rejected' && k.reviewNote && <div style={{ fontSize: 10, color: 'var(--color-danger)', marginTop: 2, maxWidth: 220 }}>{k.reviewNote}</div>}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(k.submittedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        {(k.status === 'draft' || k.status === 'rejected') ? (
                          canActOnRow(k) ? (
                            <button className="btn btn-primary btn-sm" onClick={() => handleSubmit(k.id)} disabled={submitting} title={isDocReady(k.id) ? 'Alur reviewer default siap' : 'Belum ada default reviewer — pilih manual'}>
                              <Send size={14} /> Kirim
                            </button>
                          ) : (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>Bidang lain — lihat saja</span>
                          )
                        ) : k.status === 'submitted' ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Menunggu review</span>
                        ) : k.status === 'approved' ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>✓ Disetujui {k.reviewer ? `· ${k.reviewer}` : ''}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
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
                      <td><span className="status-pill completed" style={{ fontSize: 10 }}>{k.reviewer ?? 'GM'}</span></td>
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
        initialApproverId={defaultReviewers.approverId ?? undefined}
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

function ReviewPerKpiTab() {
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
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 4px' }} title="Metode agregasi: SUM (jumlah polos)">Σ SUM</span>
              )}
              <span className={`status-pill ${it.kmType === 'final' ? 'completed' : 'at-risk'}`} style={{ fontSize: 10 }}>{it.kmType === 'final' ? 'Final' : 'Draft'}</span>
              {it.isPending && <span className="status-pill in-review" style={{ fontSize: 10 }} title={`Berlaku mulai ${it.effectiveMonth}`}>v{it.version} · mulai {it.effectiveMonth}</span>}
              {cs?.status === 'approved' && <span className="status-pill completed" style={{ fontSize: 10 }} title={`Disetujui ${cs.reviewer ?? ''}`}>✓ Konsolidasi Final</span>}
              {cs?.status === 'rejected' && <span className="status-pill delayed" style={{ fontSize: 10 }}>Konsolidasi Ditolak</span>}
              {!cs && it.readyForConsolidation && <span className="status-pill at-risk" style={{ fontSize: 10 }}>Siap Konsolidasi</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span className={`status-pill ${it.allApproved ? 'completed' : 'at-risk'}`} style={{ fontSize: 10 }}>
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
                    <td style={{ fontSize: 11 }}>{s.bidang}</td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{s.holder || '—'}</td>
                    {it.aggregationMethod === 'weighted' && <td className="num">{s.persenAgregasi ? `${s.persenAgregasi}%` : '—'}</td>}
                    <td className="num">{s.hasData ? s.realisasi : <span style={{ color: 'var(--color-text-subtle)' }}>belum ada</span>}</td>
                    <td><span className={`status-pill ${REAL_STATUS_PILL[s.status] ?? 'in-review'}`} style={{ fontSize: 10 }}>{REAL_STATUS_LABEL[s.status] ?? s.status}</span></td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{s.reviewer || '—'}</td>
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
