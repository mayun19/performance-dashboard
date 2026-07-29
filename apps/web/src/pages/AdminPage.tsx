import { Fragment, useEffect, useState } from 'react';
import { ShieldAlert, Trash2, CheckCircle, AlertCircle, Database, MessageCircle, PlayCircle, Eye, GitMerge, Sprout } from 'lucide-react';
import { admin } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { usePeriod } from '../context/PeriodContext';
import { Navigate } from 'react-router-dom';

type WhatsappLog = {
  id: string; periodId: string; recipientName: string; phone: string | null;
  templateType: string; message: string; pendingCount: number; forced: boolean; createdAt: string;
};
type WhatsappPreviewItem = {
  recipientId: string; recipientName: string; phone: string | null;
  items: Array<{ unitCode: string; bidang: string }>; message: string;
};
type BackfillPreview = {
  groupCount: number; mastersToCreate: number; assignmentsTotal: number; docsToTag: number;
  details: Array<{ kmType: string; indikator: string; assignmentCount: number; docCount: number }>;
};
type BackfillResult = { mastersCreated: number; assignmentsCreated: number; docsTagged: number };
type PtBackfillPreview = { periodId: string; periodLabel: string; totalAssignments: number; alreadySeeded: number; toSeed: number };
type PtBackfillResult = { created: number; carried: number; fresh: number };

export function AdminPage() {
  const { user } = useAuth();
  const { periodId } = usePeriod();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [waLogs, setWaLogs] = useState<WhatsappLog[]>([]);
  const [waPreview, setWaPreview] = useState<WhatsappPreviewItem[]>([]);
  const [waBusy, setWaBusy] = useState(false);
  const [waPreviewOpen, setWaPreviewOpen] = useState<string | null>(null);
  const [waLogOpen, setWaLogOpen] = useState<string | null>(null);

  const [bfPreview, setBfPreview] = useState<BackfillPreview | null>(null);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfResult, setBfResult] = useState<BackfillResult | null>(null);
  const [bfError, setBfError] = useState<string | null>(null);

  // Fase 6: backfill KM Sementara (PeriodTarget) untuk periode terpilih di topbar.
  const [ptPreview, setPtPreview] = useState<PtBackfillPreview | null>(null);
  const [ptBusy, setPtBusy] = useState(false);
  const [ptResult, setPtResult] = useState<PtBackfillResult | null>(null);
  const [ptError, setPtError] = useState<string | null>(null);

  const loadWaLogs = () => admin.whatsappLogs().then((d) => setWaLogs(d as WhatsappLog[])).catch(() => {});
  const loadWaPreview = () => {
    if (!periodId) return;
    admin.whatsappPreview(periodId).then((d) => setWaPreview(d as WhatsappPreviewItem[])).catch(() => {});
  };

  useEffect(() => {
    if (user?.role !== 'SUPERADMIN' && user?.role !== 'DEVELOPER') return;
    loadWaLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'SUPERADMIN' && user?.role !== 'DEVELOPER') return;
    loadWaPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, user?.role]);

  const loadBackfillPreview = () => {
    setBfError(null);
    admin.backfillKpiMasterPreview()
      .then((d) => setBfPreview(d as BackfillPreview))
      .catch((e) => setBfError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Gagal memuat preview backfill'));
  };

  useEffect(() => {
    if (user?.role !== 'SUPERADMIN' && user?.role !== 'DEVELOPER') return;
    loadBackfillPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  const handleRunBackfill = async () => {
    if (!bfPreview || bfPreview.groupCount === 0) return;
    const confirmed = window.confirm(
      `Backfill akan membuat ${bfPreview.mastersToCreate} KPI Master baru (${bfPreview.assignmentsTotal} assignment) dan menandai ${bfPreview.docsToTag} dokumen KM legacy dengan tautan masterKpiId.\n\nNilai/status dokumen tidak berubah — hanya penautan. Lanjutkan?`
    );
    if (!confirmed) return;
    setBfBusy(true);
    setBfResult(null);
    setBfError(null);
    try {
      const res = await admin.backfillKpiMasterRun();
      setBfResult(res as BackfillResult);
      loadBackfillPreview();
    } catch (e) {
      setBfError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Backfill gagal');
    } finally {
      setBfBusy(false);
    }
  };

  const loadPtBackfillPreview = () => {
    if (!periodId) return;
    setPtError(null);
    admin.backfillPeriodTargetPreview(periodId)
      .then((d) => setPtPreview(d as PtBackfillPreview))
      .catch((e) => setPtError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Gagal memuat preview backfill'));
  };

  useEffect(() => {
    if (user?.role !== 'SUPERADMIN' && user?.role !== 'DEVELOPER') return;
    setPtResult(null);
    loadPtBackfillPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, user?.role]);

  const handleRunPtBackfill = async () => {
    if (!ptPreview || !periodId || ptPreview.toSeed === 0) return;
    const confirmed = window.confirm(
      `Backfill akan membuat ${ptPreview.toSeed} baris KM Sementara (PeriodTarget) untuk periode ${ptPreview.periodLabel} — carry-forward dari bulan sebelumnya bila sudah dibekukan, atau fresh dari target KPI Master. Diperlukan agar restatement KM Final nanti tidak melewati periode ini. Lanjutkan?`
    );
    if (!confirmed) return;
    setPtBusy(true);
    setPtResult(null);
    setPtError(null);
    try {
      const res = await admin.backfillPeriodTargetRun(periodId);
      setPtResult(res as PtBackfillResult);
      loadPtBackfillPreview();
    } catch (e) {
      setPtError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Backfill gagal');
    } finally {
      setPtBusy(false);
    }
  };

  const handleRunWhatsappSim = async () => {
    setWaBusy(true);
    try {
      const res = await admin.whatsappRun();
      setResult({ ok: true, msg: `Simulasi dijalankan: ${res.remindersSent} pesan dari ${res.periodsChecked} periode terbuka.` });
      loadWaLogs();
      loadWaPreview();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Gagal menjalankan simulasi';
      setResult({ ok: false, msg });
    } finally {
      setWaBusy(false);
    }
  };

  if (user?.role !== 'SUPERADMIN' && user?.role !== 'DEVELOPER') {
    return <Navigate to="/" replace />;
  }

  const handleReset = async () => {
    const confirmed = window.confirm(
      'PERHATIAN: Semua data KM, realisasi, notifikasi, dan audit log akan dihapus permanen.\n\nAkun pengguna dan data referensi (periode, jabatan, dll.) TIDAK dihapus.\n\nLanjutkan reset?'
    );
    if (!confirmed) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await admin.resetTestData();
      setResult({ ok: true, msg: res.message ?? 'Data berhasil direset.' });
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e as Error)?.message ?? 'Reset gagal.';
      setResult({ ok: false, msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <ShieldAlert size={22} color="var(--color-danger)" />
          <h1 className="page-title">Admin Tools</h1>
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Hanya dapat diakses oleh {user.role}
        </span>
      </div>

      {result && (
        <div
          className={`status-banner ${result.ok ? 'success' : 'danger'}`}
          style={{ marginBottom: 'var(--space-4)' }}
        >
          {result.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {result.msg}
        </div>
      )}

      <div className="card" style={{ borderLeft: '4px solid var(--color-danger)', maxWidth: 560 }}>
        <div className="card-header compact">
          <div className="card-title"><Database size={14} /> Reset Data Testing</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Hapus semua data transaksional agar testing dapat dimulai dari kondisi bersih.
          </p>

          <table style={{ width: '100%', fontSize: 'var(--text-xs)', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Tabel</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Kontrak Manajemen', 'kontrak_manajemen'],
                ['Bundle KM Tahunan', 'km_bundles'],
                ['Input Realisasi', 'input_realisasi'],
                ['Bundle Realisasi', 'realisasi_bundles'],
                ['Notifikasi', 'notifications'],
                ['Audit Log', 'audit_logs'],
              ].map(([label, table]) => (
                <tr key={table}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{label}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-danger)', fontWeight: 600, fontSize: 12 }}>AKAN DIHAPUS</td>
                </tr>
              ))}
              {[
                ['Akun Pengguna', 'users'],
                ['Periode', 'periods'],
                ['Data Referensi', 'role_variants, dll.'],
              ].map(([label, table]) => (
                <tr key={table}>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{label}</td>
                  <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-success)', fontWeight: 600, fontSize: 12 }}>AMAN</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            className="btn"
            onClick={handleReset}
            disabled={loading}
            style={{
              background: 'var(--color-danger)', color: '#fff', border: 'none',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              alignSelf: 'flex-start',
            }}
          >
            <Trash2 size={15} />
            {loading ? 'Mereset…' : 'Reset Semua Data Testing'}
          </button>
        </div>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--color-success, #16a34a)', maxWidth: 720, marginTop: 'var(--space-4)' }}>
        <div className="card-header compact">
          <div className="card-title"><MessageCircle size={14} /> Simulasi Notifikasi WhatsApp</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Pengingat otomatis ke <b>Checker</b> yang punya realisasi KPI menunggu tinjauan, dikirim setiap 3 hari
            selama window pengisian (tgl 25 – tgl 5) terbuka. Belum terhubung provider nyata — hanya mencatat
            pesan yang <i>akan</i> dikirim untuk validasi konten sebelum integrasi produksi (mis. Fonnte/WA Business API).
          </p>

          <div>
            <button className="btn btn-primary" onClick={handleRunWhatsappSim} disabled={waBusy}>
              <PlayCircle size={15} /> {waBusy ? 'Menjalankan…' : 'Jalankan Simulasi Sekarang'}
            </button>
          </div>

          {/* Preview: apa yang akan dikirim untuk periode yang sedang dipilih */}
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Eye size={13} /> Preview — Periode Terpilih ({waPreview.reduce((s, p) => s + p.items.length, 0)} dokumen pending)
            </div>
            {waPreview.length === 0 ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Tidak ada Checker dengan dokumen pending pada periode ini.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {waPreview.map((p) => (
                  <div key={p.recipientId} style={{ border: '1px solid var(--color-border, #e5e5e5)', borderRadius: 6 }}>
                    <button
                      onClick={() => setWaPreviewOpen(waPreviewOpen === p.recipientId ? null : p.recipientId)}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span><b>{p.recipientName}</b> {p.phone ? `· ${p.phone}` : '· (nomor belum diisi)'}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{p.items.length} dokumen</span>
                    </button>
                    {waPreviewOpen === p.recipientId && (
                      <pre style={{ margin: 0, padding: '8px 10px', borderTop: '1px solid var(--color-border)', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>
                        {p.message}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Log simulasi terkirim */}
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>Riwayat Simulasi ({waLogs.length})</div>
            {waLogs.length === 0 ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Belum ada simulasi yang tercatat.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 'var(--text-xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>Waktu</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>Penerima</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>Dokumen</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>Sumber</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {waLogs.map((l) => (
                    <Fragment key={l.id}>
                      <tr>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                          {new Date(l.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{l.recipientName}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{l.pendingCount}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{l.forced ? 'Manual' : 'Terjadwal'}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setWaLogOpen(waLogOpen === l.id ? null : l.id)}>
                            {waLogOpen === l.id ? 'Tutup' : 'Lihat pesan'}
                          </button>
                        </td>
                      </tr>
                      {waLogOpen === l.id && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, borderBottom: '1px solid var(--color-border)' }}>
                            <pre style={{ margin: 0, padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>
                              {l.message}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--color-accent)', maxWidth: 720, marginTop: 'var(--space-4)' }}>
        <div className="card-header compact">
          <div className="card-title"><GitMerge size={14} /> Backfill KPI Master (Fase F)</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Ubah dokumen KM lama (dibuat manual via Input KM, belum memiliki KPI Master parent)
            menjadi definisi <b>KPI Master</b> + assignment per unit/bidang. Indikator yang sama pada
            beberapa unit/bidang otomatis digabung jadi satu KPI dengan banyak assignment. Hanya
            menandai (tag) item existing — nilai, status, dan alur dokumen <b>tidak diubah</b>.
          </p>

          {bfError && (
            <div className="status-banner danger" style={{ fontSize: 'var(--text-xs)' }}>
              <AlertCircle size={14} /> {bfError}
            </div>
          )}

          {bfResult && (
            <div className="status-banner success" style={{ fontSize: 'var(--text-xs)' }}>
              <CheckCircle size={14} />
              Selesai: {bfResult.mastersCreated} KPI Master dibuat, {bfResult.assignmentsCreated} assignment, {bfResult.docsTagged} dokumen ditandai.
            </div>
          )}

          {!bfPreview ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Memuat preview…</div>
          ) : bfPreview.groupCount === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Tidak ada dokumen KM legacy yang perlu di-backfill — semua indikator sudah memiliki KPI Master parent.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                Preview (dry-run) — {bfPreview.mastersToCreate} KPI Master baru, {bfPreview.assignmentsTotal} assignment, {bfPreview.docsToTag} dokumen akan ditandai
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 'var(--text-xs)', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Indikator</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Tipe KM</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Assignment</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Dokumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bfPreview.details.map((d, i) => (
                      <tr key={i}>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.indikator}</td>
                        <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.kmType === 'final' ? 'Final' : 'Draft'}</td>
                        <td className="num" style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.assignmentCount}</td>
                        <td className="num" style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{d.docCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleRunBackfill}
                disabled={bfBusy}
                style={{ alignSelf: 'flex-start' }}
              >
                <GitMerge size={15} /> {bfBusy ? 'Menjalankan backfill…' : `Backfill ${bfPreview.mastersToCreate} KPI Master`}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--color-accent)', maxWidth: 720, marginTop: 'var(--space-4)' }}>
        <div className="card-header compact">
          <div className="card-title"><Sprout size={14} /> Backfill KM Sementara (Fase 6 — Living Target)</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
            Materialisasi baris <b>KM Sementara</b> (PeriodTarget) untuk periode yang sedang dipilih
            di topbar — carry-forward dari bulan sebelumnya bila sudah dibekukan, atau fresh dari
            target KPI Master. Periode tanpa baris PeriodTarget sama sekali akan <b>dilewati</b> saat
            restatement KM Final tiba — jalankan backfill ini dulu untuk bulan-bulan lama sebelum
            mengubah acuan KM ke Final.
          </p>

          {ptError && (
            <div className="status-banner danger" style={{ fontSize: 'var(--text-xs)' }}>
              <AlertCircle size={14} /> {ptError}
            </div>
          )}
          {ptResult && (
            <div className="status-banner success" style={{ fontSize: 'var(--text-xs)' }}>
              <CheckCircle size={14} />
              Selesai: {ptResult.created} baris dibuat ({ptResult.carried} carry-forward, {ptResult.fresh} fresh).
            </div>
          )}

          {!periodId ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Pilih periode di topbar terlebih dahulu.</div>
          ) : !ptPreview ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Memuat preview…</div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-xs)' }}>
                Periode <b>{ptPreview.periodLabel}</b>: {ptPreview.alreadySeeded} dari {ptPreview.totalAssignments} assignment sudah punya KM Sementara.{' '}
                {ptPreview.toSeed === 0 ? (
                  <span style={{ color: 'var(--color-success)' }}>Sudah lengkap — tidak perlu backfill.</span>
                ) : (
                  <span style={{ fontWeight: 700 }}>{ptPreview.toSeed} assignment akan dibuatkan baris baru.</span>
                )}
              </div>
              {ptPreview.toSeed > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleRunPtBackfill}
                  disabled={ptBusy}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Sprout size={15} /> {ptBusy ? 'Menjalankan backfill…' : `Backfill ${ptPreview.toSeed} KM Sementara`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
