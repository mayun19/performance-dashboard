import { useEffect, useState, Fragment } from 'react';
import { operational, kinerja } from '../lib/api';
import { usePeriod } from '../context/PeriodContext';
import { Target, ShieldAlert, ClipboardCheck, GitCompare } from 'lucide-react';
import { SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';
import { PhaseControls, type SnapshotPhase } from '../components/PhaseControls';

interface RekapKpi { indikator: string; satuan: string; bobot: number; target: number; realisasi: number; capaian: number; nilai: number; }
interface RekapUnit { code: string; name: string; score: number; status: string; kpis: RekapKpi[]; }
interface Rekap { hasData: boolean; overall: number | null; units: RekapUnit[]; }

// Sub-indikator KPI komposit (opt-in, generik) — lihat common/capaian.ts breakdownComposite.
type SubBreakdownItem = { nama: string; satuan: string; bobot: number; target: number; actual: number; capaian: number; nilai: number; formula?: string };

type Kpi = {
  id: string; no?: string; label?: string; name?: string; indikator?: string; formula?: string;
  target: number; actual?: number; realisasi?: number; bobot: number;
  achievement?: number; nilai?: number; status: string; satuan?: string; unit?: string;
  polarity?: string; polaritas?: string; ytd?: boolean; note?: string; commentary?: string;
  subBreakdown?: SubBreakdownItem[]; // non-kosong = KPI ini komposit (bobot/nilai turunan dari sub)
};

type Summary = {
  kpiNilai: number; kpiBobot: number;
  piNilai: number; piBobot: number;
  kepatuhanPenalty: number;
  totalNilai: number; totalBobot: number;
  status: string;
};

type Kepatuhan = { name: string; maxPenalty: number; applied: number; target: string; status: string };
type SelfAssessmentGap = {
  code: string; unit: string; selfScore: number; evaluatedScore: number; gap: number; gapPct: number; status: string;
};

function fmt(v: number, d = 2) {
  return v?.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }) ?? '—';
}

function pct(v: number, d = 1) {
  return (v ?? 0).toFixed(d) + '%';
}

function statusPill(s: string) {
  const cls = s === 'on-track' || s === 'completed' ? 'completed'
    : s === 'at-risk' ? 'at-risk'
    : s === 'delayed' ? 'delayed'
    : 'needs-revision';
  return <span className={`status-pill ${cls}`}>{s === 'on-track' ? 'On Track' : s === 'at-risk' ? 'At Risk' : s === 'delayed' ? 'Tertinggal' : s === 'completed' ? 'Tercapai' : s}</span>;
}

export function OperationalPage() {
  const [data, setData] = useState<{ data: Record<string, unknown>; phase?: SnapshotPhase } | null>(null);
  const [rekap, setRekap] = useState<Rekap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseReq, setPhaseReq] = useState<SnapshotPhase | undefined>(undefined);

  const { periodId, mode } = usePeriod();

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([operational.get(periodId || undefined, phaseReq), kinerja.rekap(periodId || undefined, mode)])
      .then(([op, rk]) => {
        if (op.status === 'fulfilled') setData(op.value);
        else setError((op.reason as Error)?.message ?? 'Gagal memuat data');
        if (rk.status === 'fulfilled') setRekap(rk.value as Rekap);
      })
      .finally(() => setLoading(false));
  }, [periodId, mode, phaseReq]);

  const phaseControls = <PhaseControls requested={phaseReq} shown={data?.phase} onChange={setPhaseReq} />;

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Operational KPIs</h1></div>
        <div className="four-col-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="summary-hero-card" style={{ minHeight: 120 }}>
              <div className="skeleton-line skeleton" style={{ width: '70%', height: 12 }} />
              <div className="skeleton-line skeleton" style={{ width: '50%', height: 32, marginTop: 8 }} />
              <div className="skeleton-line skeleton" style={{ width: '40%', height: 12, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <SkeletonTable rows={6} cols={9} />
      </div>
    );
  }

  if (error) return <ErrorState title="Gagal memuat Operational KPIs" message={error} />;

  const d = (data?.data ?? {}) as Record<string, unknown>;
  const sm = (d.summary ?? {}) as Summary;
  const kpis = (d.kpis ?? []) as Kpi[];
  const pis = (d.pis ?? d.pi ?? []) as Kpi[];
  const kepatuhan = (d.kepatuhan ?? []) as Kepatuhan[];
  const selfAssessmentGap = (d.selfAssessmentGap ?? []) as SelfAssessmentGap[];

  if (!data?.data || (kpis.length === 0 && pis.length === 0)) {
    return (
      <div className="page operational-page">
        <div className="page-header">
          <h1 className="page-title">Operational KPIs</h1>
          <div className="page-meta">{phaseControls}</div>
        </div>
        <EmptyState
          title="Snapshot belum tersedia"
          message={phaseReq === 'final'
            ? 'Snapshot Final belum ada untuk periode ini (KM Final belum tiba / belum direstate). Beralih ke Sementara.'
            : 'Data Operational KPI tidak tersedia untuk periode & fase ini.'}
        />
      </div>
    );
  }

  // Backend (operational.service.ts) sudah mengirim `kpis` sebagai satu daftar penuh, terurut
  // sesuai dokumen spesimen — tak perlu dipecah KPI/PI lalu digabung lagi (pemecahan via
  // id?.startsWith('pi') memakai id legacy yang tak konsisten & merusak urutan spesimen).
  const allKpiRows = pis.length > 0 ? [...kpis, ...pis] : kpis;
  const kpiNilai = (sm.kpiNilai ?? 0) + (sm.piNilai ?? 0);
  const kpiBobot = (sm.kpiBobot ?? 0) + (sm.piBobot ?? 0);
  const penalty = sm.kepatuhanPenalty ?? 0;
  // Plafon maksimum pengurang = Σ maxPenalty seluruh sub-indikator pengurang live (bukan
  // angka statis) — mengikuti bobotKm KPI Master "Kepatuhan..." yang bisa berubah sewaktu-waktu.
  const maxPenaltyTotal = kepatuhan.reduce((s, k) => s + (k.maxPenalty ?? 0), 0);
  // Total Nilai Kinerja = Σ nilai KPI + pengurang kepatuhan (penalty ≤ 0) — sinkron dgn kartu di atas.
  const totalNilai = kpiNilai + penalty;
  const totalBobot = kpiBobot;
  const totalStatus = totalNilai >= 100 ? 'Baik' : totalNilai >= 95 ? 'Hati-hati' : 'Perhatian';

  function KpiTable({ rows }: { rows: Kpi[] }) {
    if (!rows.length) return <EmptyState title="Tidak ada data" />;
    return (
      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>No</th>
              <th>Indikator</th>
              <th>Satuan</th>
              <th className="num">Target</th>
              <th className="num">Realisasi</th>
              <th className="num">Bobot</th>
              <th className="num">Achv</th>
              <th className="num">Nilai</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k, i) => {
              const actual = k.actual ?? k.realisasi ?? 0;
              const ach = k.achievement ?? (k.target ? (actual / k.target) * 100 : 0);
              const nilai = k.nilai ?? 0;
              const isComposite = !!k.subBreakdown && k.subBreakdown.length > 0;
              return (
                <Fragment key={i}>
                <tr>
                  <td style={{ color: 'var(--color-text-muted)' }}>{k.no ?? k.id}</td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--text-xs)' }}>
                      {k.name ?? k.label}
                      {isComposite && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 4, padding: '1px 4px' }} title={`Komposit — ${k.subBreakdown!.length} sub-indikator`}>
                          Komposit
                        </span>
                      )}
                    </div>
                    {(k.formula ?? k.commentary) && <div style={{ fontSize: 12, color: 'var(--color-text-subtle)', marginTop: 2 }}>{k.formula ?? k.commentary}</div>}
                  </td>
                  <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{k.satuan ?? k.unit ?? '—'}</td>
                  <td className="num">{isComposite ? '—' : fmt(k.target, 1)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{isComposite ? '—' : fmt(actual, 2)}</td>
                  <td className="num">{k.bobot}</td>
                  <td className={`num ${ach >= 100 ? 'delta-positive' : ach >= 90 ? '' : 'delta-negative'}`} style={{ fontWeight: 700 }}>
                    {fmt(ach, 1)}%
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{fmt(nilai, 2)}</td>
                  <td>{statusPill(k.status)}</td>
                </tr>
                {isComposite && k.subBreakdown!.map((si, j) => (
                  <tr key={`${i}.${j}`} style={{ background: 'var(--color-surface-2)' }}>
                    <td />
                    <td style={{ paddingLeft: 'var(--space-4)' }}>
                      <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>↳ {si.nama}</span>
                      {si.formula && <div style={{ fontSize: 12, color: 'var(--color-text-subtle)', marginTop: 2, paddingLeft: 12 }}>{si.formula}</div>}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{si.satuan || '—'}</td>
                    <td className="num">{fmt(si.target, 1)}</td>
                    <td className="num">{fmt(si.actual, 2)}</td>
                    <td className="num">{si.bobot}</td>
                    <td className={`num ${si.capaian >= 100 ? 'delta-positive' : si.capaian >= 90 ? '' : 'delta-negative'}`}>{fmt(si.capaian, 1)}%</td>
                    <td className="num">{fmt(si.nilai, 2)}</td>
                    <td />
                  </tr>
                ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="page operational-page">
      <div className="page-header">
        <h1 className="page-title">Operational KPIs</h1>
        <div className="page-meta">{phaseControls}</div>
      </div>
      {/* Capaian LIVE dari Realisasi Kinerja yang sudah disetujui final (Integrasi C) */}
      {rekap?.hasData && (
        <div className="card p-0" style={{ marginBottom: 'var(--space-6)', borderTop: '3px solid var(--color-success)' }}>
          <div className="card-header compact">
            <div className="card-title"><ClipboardCheck size={14} />Capaian Kinerja dari Realisasi Disetujui</div>
            <span className="status-pill completed" style={{ fontWeight: 700 }}>
              Total Nilai {fmt(rekap.overall ?? 0)} · {rekap.units.length} unit
            </span>
          </div>
          {rekap.units.map((u) => (
            <div key={u.code}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-4)', background: 'var(--color-surface-2)', fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                <span>{u.name}</span>
                <span style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-brand)' }}>Nilai {fmt(u.score)}</span>
                  <span className={`status-pill ${u.score >= 100 ? 'completed' : u.score >= 90 ? 'at-risk' : 'delayed'}`}>{u.status}</span>
                </span>
              </div>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>No</th><th>Indikator</th><th>Satuan</th>
                      <th className="num">Target</th><th className="num">Realisasi</th>
                      <th className="num">Bobot</th><th className="num">Capaian</th><th className="num">Nilai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.kpis.map((k, i) => (
                      <tr key={i}>
                        <td style={{ color: 'var(--color-text-muted)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 500 }}>{k.indikator}</td>
                        <td style={{ color: 'var(--color-text-muted)' }}>{k.satuan || '—'}</td>
                        <td className="num">{fmt(k.target)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(k.realisasi)}</td>
                        <td className="num">{fmt(k.bobot)}</td>
                        <td className={`num ${k.capaian >= 100 ? 'delta-positive' : k.capaian >= 90 ? '' : 'delta-negative'}`} style={{ fontWeight: 700 }}>{pct(k.capaian)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(k.nilai)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3 Hero Cards — KPI digabung jadi satu */}
      <div className="three-col-grid">
        <div className="summary-hero-card kpi">
          <div className="summary-hero-label">Key Performance Indicator (KPI)</div>
          <div className="summary-hero-value">{fmt(kpiNilai)}<span className="of">/ {kpiBobot}</span></div>
          <div className="summary-hero-meta delta-positive">{pct((kpiNilai / (kpiBobot || 1)) * 100)} pencapaian</div>
        </div>
        <div className="summary-hero-card pen">
          <div className="summary-hero-label">Pengurang Kepatuhan</div>
          <div className="summary-hero-value">{penalty}<span className="of">(max {maxPenaltyTotal})</span></div>
          <div className="summary-hero-meta delta-positive">
            {penalty === 0 ? 'Tidak ada pengurang' : `${penalty} poin`}
          </div>
        </div>
        <div className="summary-hero-card total">
          <div className="summary-hero-label" style={{ color: 'var(--color-accent)' }}>TOTAL NILAI KINERJA</div>
          <div className="summary-hero-value">{fmt(totalNilai)}<span className="of">/ {totalBobot}</span></div>
          <div className="summary-hero-meta">
            <span className={`status-pill ${totalNilai >= 100 ? 'completed' : totalNilai >= 95 ? 'at-risk' : 'delayed'}`}>
              {totalStatus}
            </span>
          </div>
        </div>
      </div>

      {/* KPI — satu kartu gabungan (sebelumnya 2 kartu KPI) */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card p-0">
          <div className="card-header compact" style={{ borderBottom: '3px solid var(--color-accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Target size={16} color="var(--color-accent)" />
              </div>
              <div>
                <div className="card-title" style={{ color: 'var(--color-accent)', fontSize: 'var(--text-sm)' }}>Key Performance Indicator (KPI)</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>{allKpiRows.length} indikator · Bobot {kpiBobot}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-accent)' }}>{fmt(kpiNilai)}<span style={{ fontSize: 'var(--text-xs)', fontWeight: 400, color: 'var(--color-text-muted)' }}> / {kpiBobot}</span></div>
            </div>
          </div>
          <KpiTable rows={allKpiRows} />
        </div>
      </div>

      {/* Pengurang Kepatuhan */}
      {kepatuhan.length > 0 && (
        <div className="card p-0">
          <div className="card-header compact" style={{ borderBottom: '3px solid var(--color-danger)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--color-danger-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ShieldAlert size={16} color="var(--color-danger)" />
              </div>
              <div>
                <div className="card-title" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>Pengurang Kepatuhan</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>Maks {maxPenaltyTotal} poin</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: (sm.kepatuhanPenalty ?? 0) < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                {(sm.kepatuhanPenalty ?? 0) < 0 ? sm.kepatuhanPenalty : '0 ✓'}
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Sub-Indikator</th>
                  <th className="num">Maks</th>
                  <th className="num">Aktual</th>
                  <th>Target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {kepatuhan.map((k, i) => (
                  <tr key={i}>
                    <td>{k.name}</td>
                    <td className="num" style={{ color: 'var(--color-danger)', fontWeight: 700 }}>{k.maxPenalty}</td>
                    <td className="num" style={{ fontWeight: 700, color: k.applied < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                      {k.applied < 0 ? k.applied : '—'}
                    </td>
                    <td style={{ color: 'var(--color-text-muted)' }}>{k.target}</td>
                    <td>
                      <span className={`status-pill ${k.status === 'success' ? 'completed' : 'needs-revision'}`}>
                        {k.status === 'success' ? '✓ Aman' : '⚠ Perhatian'}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--color-surface-2)', fontWeight: 700 }}>
                  <td>TOTAL</td>
                  <td className="num" style={{ color: 'var(--color-danger)' }}>{maxPenaltyTotal}</td>
                  <td className="num" style={{ fontWeight: 800, color: (sm.kepatuhanPenalty ?? 0) < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                    {(sm.kepatuhanPenalty ?? 0) < 0 ? sm.kepatuhanPenalty : '0 ✓'}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Akurasi Self-Assessment UPMK vs Evaluasi RPC */}
      {selfAssessmentGap.length > 0 && (
        <div className="card p-0" style={{ marginTop: 'var(--space-6)' }}>
          <div className="card-header compact">
            <div className="card-title"><GitCompare size={14} />Akurasi Self-Assessment UPMK</div>
            <span className="card-meta">Self-assessment (dikunci saat submit) vs hasil evaluasi berjenjang s.d. SM RPC</span>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th className="num">Self-Assessment</th>
                  <th className="num">Hasil Evaluasi</th>
                  <th className="num">Selisih</th>
                  <th className="num">Selisih %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selfAssessmentGap.map((g) => (
                  <tr key={g.code}>
                    <td style={{ fontWeight: 600 }}>{g.unit}</td>
                    <td className="num">{fmt(g.selfScore)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmt(g.evaluatedScore)}</td>
                    <td className={`num ${g.gap > 0 ? 'delta-positive' : g.gap < 0 ? 'delta-negative' : ''}`} style={{ fontWeight: 700 }}>
                      {g.gap > 0 ? '+' : ''}{fmt(g.gap)}
                    </td>
                    <td className="num">{g.gap > 0 ? '+' : ''}{pct(g.gapPct)}</td>
                    <td>
                      <span className={`status-pill ${g.status === 'akurat' ? 'completed' : g.status === 'perlu-perhatian' ? 'at-risk' : 'delayed'}`}>
                        {g.status === 'akurat' ? '✓ Akurat' : g.status === 'perlu-perhatian' ? '⚠ Perlu Perhatian' : '✗ Signifikan'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
