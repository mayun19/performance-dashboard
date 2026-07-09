import { useEffect, useRef, useState, Fragment } from 'react';
import { inputRealisasi, inputKontrak, meta } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { ClipboardEdit, CheckCircle, Clock, Trash2, Paperclip, Upload, X } from 'lucide-react';
import { SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';
import type { KontrakManajemen, Period } from '../lib/types';

const CURRENT_YEAR = new Date().getFullYear();
const RPC_BIDANG = 'Perencanaan & Project Control';
const BIDANG_SORT: Record<string, number> = {
  'Operasi Manajemen Proyek': 0, 'QA/QC': 1,
  'Keuangan, Komunikasi & Umum': 2, 'Perencanaan & Project Control': 3,
  'MRO': 4, 'K3L': 5,
};

type KpiItem = {
  no?: number; indikator?: string; formula?: string; satuan?: string;
  bobot?: number | string; target?: number | string; target2?: number | string;
  bidang?: string; realisasi?: number | string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Menunggu Review', ready: 'Siap Konsolidasi (GM)', approved: 'Disetujui', rejected: 'Dikembalikan',
};
const STATUS_PILL: Record<string, string> = {
  draft: 'in-review', submitted: 'needs-revision', ready: 'at-risk', approved: 'completed', rejected: 'delayed',
};

// Unit yang bisa mengisi realisasi: Kantor Induk + 5 UPMK
const UNIT_OPTIONS = [
  { code: 'KP', name: 'Kantor Induk' },
  { code: 'UPMK1', name: 'UPMK I' },
  { code: 'UPMK2', name: 'UPMK II' },
  { code: 'UPMK3', name: 'UPMK III' },
  { code: 'UPMK4', name: 'UPMK IV' },
  { code: 'UPMK5', name: 'UPMK V' },
];

export function InputRealisasiPage() {
  const { user } = useAuth();
  const isStaff = user?.role === 'STAFF';
  // Hanya GM yang boleh pilih unit bebas untuk monitoring
  const canSelectUnit = user?.role === 'GM';
  const lockedUnit = user?.unit ?? 'KP';
  const [selectedUnit, setSelectedUnit] = useState<string>(lockedUnit);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [history, setHistory] = useState<unknown[]>([]);
  const [kpiList, setKpiList] = useState<KpiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Evidence (lampiran)
  const [evidOpen, setEvidOpen] = useState<string | null>(null);
  const [evidBusy, setEvidBusy] = useState(false);
  const evidInputRef = useRef<HTMLInputElement>(null);

  const reloadHistory = async () => {
    const hist = await inputRealisasi.history(selectedUnit, selectedPeriodId);
    setHistory(hist as unknown[]);
  };
  const handleUploadEvid = async (id: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setEvidBusy(true);
    try {
      await inputRealisasi.uploadEvidence(id, Array.from(files));
      await reloadHistory();
    } catch (e) {
      alert((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Gagal mengunggah evidence');
    } finally {
      setEvidBusy(false);
      if (evidInputRef.current) evidInputRef.current.value = '';
    }
  };
  const handleDeleteEvid = async (id: string, fileId: string) => {
    if (!confirm('Hapus berkas evidence ini?')) return;
    try { await inputRealisasi.deleteEvidence(id, fileId); await reloadHistory(); }
    catch (e) { alert((e as Error)?.message ?? 'Gagal menghapus'); }
  };
  const fmtSize = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  // Default unit mengikuti unit user (bila ada). Bila tidak bisa pilih bebas, unit dikunci.
  useEffect(() => {
    if (user?.unit) setSelectedUnit(user.unit);
  }, [user?.unit]);

  // Muat daftar periode (Jan–Des) sekali; default ke periode aktif.
  useEffect(() => {
    meta.periods().then((res) => {
      const list = (res as Period[]) ?? [];
      setPeriods(list);
      const active = list.find((p) => p.isActive) ?? list[0];
      if (active) setSelectedPeriodId(active.id);
      else setLoading(false); // tak ada periode → jangan nyangkut di skeleton
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedPeriodId) return;
    const loadData = async () => {
      try {
        // KM bersifat tahunan → acuan realisasi ditarik per TAHUN dari periode terpilih.
        const selectedYear = periods.find((p) => p.id === selectedPeriodId)?.yearMonth?.slice(0, 4);
        const [histRes, approvedRes] = await Promise.allSettled([
          inputRealisasi.history(selectedUnit, selectedPeriodId),
          inputKontrak.approved(selectedUnit, selectedYear),
        ]);
        if (histRes.status === 'fulfilled') setHistory(histRes.value as unknown[]);
        if (approvedRes.status === 'fulfilled') {
          // Acuan realisasi = KPI dari Kontrak Manajemen yang sudah DISETUJUI (final GM) untuk unit terpilih.
          const kontrak = approvedRes.value as KontrakManajemen[];
          let merged: KpiItem[] = kontrak.flatMap((k) =>
            (k.kpiItems as KpiItem[]).map((it) => ({ ...it, bidang: k.bidang })),
          );
          // Semua role kecuali GM hanya melihat KPI bidangnya sendiri.
          if (user?.bidang && user?.role !== 'GM') {
            merged = merged.filter((it) => it.bidang === user.bidang);
          }
          merged = merged.sort((a, b) => (BIDANG_SORT[a.bidang ?? ''] ?? 99) - (BIDANG_SORT[b.bidang ?? ''] ?? 99));
          setKpiList(merged);
          setValues({});
        }
      } catch (e) {
        setError((e as Error)?.message ?? 'Gagal memuat data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedUnit, selectedPeriodId, isStaff, user?.bidang]);

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      // Realisasi dipecah per bidang: kelompokkan baris KPI per bidang, kirim satu submit per bidang.
      const byBidang = new Map<string, Record<string, unknown>>();
      kpiList.forEach((kpi, i) => {
        const b = kpi.bidang ?? '';
        if (!byBidang.has(b)) byBidang.set(b, {});
        const bucket = byBidang.get(b)!;
        bucket[`kpi_${i}`] = { ...kpi, realisasi: values[String(i)] ?? '' };
      });
      for (const [bidang, payload] of byBidang) {
        await inputRealisasi.submit(selectedUnit, bidang, payload, selectedPeriodId);
      }
      setSubmitted(true);
      setValues({});
      const hist = await inputRealisasi.history(selectedUnit, selectedPeriodId);
      setHistory(hist as unknown[]);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal mengirim';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus realisasi ini? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      await inputRealisasi.delete(id);
      const hist = await inputRealisasi.history(selectedUnit, selectedPeriodId);
      setHistory(hist as unknown[]);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal menghapus';
      alert(msg);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Input Realisasi Bulanan</h1></div>
        <SkeletonTable rows={6} cols={7} />
      </div>
    );
  }

  if (error && kpiList.length === 0) return <ErrorState title="Gagal memuat data" message={error} />;

  const filledCount = Object.values(values).filter(v => v.trim() !== '').length;
  const completionPct = kpiList.length > 0 ? Math.round((filledCount / kpiList.length) * 100) : 0;
  const selectedPeriodLabel = periods.find((p) => p.id === selectedPeriodId)?.label ?? 'Tahun Berjalan';

  return (
    <div className="page input-realisasi-page">
      {/* Header Card */}
      <div className="card" style={{ marginBottom: 'var(--space-6)', borderLeft: '4px solid var(--color-accent)' }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-lg)', background: 'var(--color-accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ClipboardEdit size={24} color="var(--color-accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Input Realisasi Bulanan — {selectedPeriodLabel}</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span>Periode:</span>
              <select
                className="form-input form-input-sm"
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                style={{ width: 'auto', minWidth: 130, fontWeight: 700 }}
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <span>·</span>
              <span>Unit:</span>
              {canSelectUnit ? (
                <select
                  className="form-input form-input-sm"
                  value={selectedUnit}
                  onChange={(e) => setSelectedUnit(e.target.value)}
                  style={{ width: 'auto', minWidth: 140, fontWeight: 700 }}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.code} value={u.code}>{u.name} ({u.code})</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontWeight: 700, color: 'var(--color-accent)' }}>
                  {UNIT_OPTIONS.find((u) => u.code === lockedUnit)?.name ?? lockedUnit}
                  <span style={{ fontSize: 12, color: 'var(--color-text-subtle)', marginLeft: 4 }}>(dikunci ke unit Anda)</span>
                </span>
              )}
              <span>· {kpiList.length} indikator KM{isStaff && user?.bidang ? ` · Bidang: ${user.bidang}` : ''} · Deadline: Tanggal 3 setiap bulan</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Progress Isi</div>
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: completionPct === 100 ? 'var(--color-success)' : 'var(--color-accent)' }}>{completionPct}%</div>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{filledCount}/{kpiList.length} terisi</div>
          </div>
        </div>
        <div style={{ height: 4, background: 'var(--color-surface-2)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${completionPct}%`, background: completionPct === 100 ? 'var(--color-success)' : 'var(--color-accent)', transition: 'width 0.3s' }} />
        </div>
      </div>

      {submitted && (
        <div className="status-banner success" style={{ marginBottom: 'var(--space-4)' }}>
          <CheckCircle size={18} />
          <strong>Realisasi berhasil dikirim!</strong>
        </div>
      )}

      {/* KPI Input Table */}
      <div className="card p-0" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card-header compact">
          <div className="card-title"><ClipboardEdit size={14} />KPI Realisasi — {UNIT_OPTIONS.find((u) => u.code === selectedUnit)?.name ?? selectedUnit}</div>
          <span className="card-meta">Isi nilai realisasi {selectedPeriodLabel}</span>
        </div>
        <div className="table-wrap">
          {kpiList.length === 0 ? (
            <EmptyState
              title="Belum ada KPI acuan"
              message="Belum ada Kontrak Manajemen yang disetujui (final GM) untuk unit Anda. Selesaikan persetujuan KM terlebih dahulu di menu Input Kontrak Manajemen → Persetujuan."
            />
          ) : (
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Bidang</th>
                  <th>Indikator</th>
                  <th>Formula</th>
                  <th>Satuan</th>
                  <th className="num">Bobot</th>
                  <th className="num">Target Sem I</th>
                  <th className="num">Target {CURRENT_YEAR}</th>
                  <th>Realisasi</th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi, i) => {
                  const val = values[String(i)] ?? '';
                  const hasVal = val.trim() !== '';
                  return (
                    <tr key={i} style={{ background: hasVal ? 'rgba(34,197,94,0.03)' : 'transparent' }}>
                      <td style={{ color: 'var(--color-text-muted)' }}>{kpi.no ?? i + 1}</td>
                      <td style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{kpi.bidang ?? '—'}</td>
                      <td style={{ maxWidth: 220, fontWeight: 500 }}>{kpi.indikator ?? '—'}</td>
                      <td style={{ fontSize: 10, color: 'var(--color-text-muted)', maxWidth: 200 }}>{kpi.formula ?? '—'}</td>
                      <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{kpi.satuan ?? '—'}</td>
                      <td className="num" style={{ fontWeight: 700, color: 'var(--color-accent)' }}>{kpi.bobot ?? '—'}</td>
                      <td className="num">{kpi.target ?? '—'}</td>
                      <td className="num">{kpi.target2 ?? '—'}</td>
                      <td style={{ minWidth: 140 }}>
                        <input
                          type="text"
                          className="form-input form-input-sm"
                          style={{ borderColor: hasVal ? 'rgba(34,197,94,0.5)' : undefined }}
                          value={val}
                          onChange={e => setValues(v => ({ ...v, [String(i)]: e.target.value }))}
                          placeholder={`Target: ${kpi.target ?? '—'}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {kpiList.length > 0 && (
          <div className="card-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{filledCount} dari {kpiList.length} indikator terisi</span>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || filledCount === 0}>
              {submitting ? 'Mengirim…' : 'Kirim Realisasi'}
            </button>
          </div>
        )}
      </div>

      {/* Submission History */}
      {history.length > 0 && (
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title"><Clock size={14} />Riwayat Submisi</div>
            <span className="card-meta">{history.length} entri</span>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Bidang</th>
                  <th>Submitter</th>
                  <th>Status</th>
                  <th>Tanggal Submit</th>
                  <th style={{ width: 90 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const item = h as Record<string, unknown>;
                  const status = String(item.status ?? '');
                  const itemSteps = (item.steps as { label?: string }[] | undefined) ?? [];
                  const stepLabel = itemSteps[Number(item.currentStepIndex ?? 0)]?.label;
                  const canDelete = status !== 'approved'
                    && (item.submitterId === user?.id || user?.role === 'GM');
                  const atts = (item.attachments as Array<{ id: string; name: string; size: number }> | undefined) ?? [];
                  const rid = item.id as string;
                  return (
                    <Fragment key={i}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{item.unitCode as string ?? '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.bidang as string ?? '—'}</td>
                      <td>{item.submitter as string ?? '—'}</td>
                      <td>
                        <span className={`status-pill ${STATUS_PILL[status] ?? 'in-review'}`} style={{ fontSize: 10 }}>
                          {STATUS_LABEL[status] ?? status}
                        </span>
                        {status === 'submitted' && stepLabel && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>di {stepLabel}</div>
                        )}
                        {status === 'rejected' && item.reviewNote ? (
                          <div style={{ fontSize: 10, color: 'var(--color-danger)', marginTop: 2, maxWidth: 240 }}>{item.reviewNote as string}</div>
                        ) : null}
                      </td>
                      <td style={{ color: 'var(--color-text-muted)' }}>
                        {item.submittedAt ? new Date(item.submittedAt as string).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEvidOpen(evidOpen === rid ? null : rid)} title="Lampiran evidence">
                            <Paperclip size={14} /> {atts.length}
                          </button>
                          {canDelete && (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(rid)} title="Hapus realisasi" style={{ color: 'var(--color-danger)' }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {evidOpen === rid && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--color-surface-2)', padding: 'var(--space-3)' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Evidence Realisasi</div>
                          {atts.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>Belum ada berkas.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                              {atts.map((a) => (
                                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                                  <Paperclip size={12} style={{ color: 'var(--color-text-muted)' }} />
                                  <a href={inputRealisasi.evidenceUrl(rid, a.id)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>{a.name}</a>
                                  <span style={{ color: 'var(--color-text-subtle)' }}>({fmtSize(a.size)})</span>
                                  <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteEvid(rid, a.id)} title="Hapus berkas" style={{ color: 'var(--color-danger)', padding: '0 4px' }}><X size={12} /></button>
                                </div>
                              ))}
                            </div>
                          )}
                          <input ref={evidInputRef} type="file" multiple accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={(e) => handleUploadEvid(rid, e.target.files)} />
                          <button className="btn btn-secondary btn-sm" disabled={evidBusy || atts.length >= 5} onClick={() => evidInputRef.current?.click()}>
                            <Upload size={12} /> {evidBusy ? 'Mengunggah…' : 'Unggah Evidence'}
                          </button>
                          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                            Maks 5 berkas · ≤ 10 MB/berkas · PDF, Excel, Word, JPG/PNG {atts.length >= 5 ? '· (batas tercapai)' : ''}
                          </span>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
