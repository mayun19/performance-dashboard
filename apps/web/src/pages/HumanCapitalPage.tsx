import { useEffect, useState } from 'react';
import { humanCapital } from '../lib/api';
import { Bar, Doughnut } from 'react-chartjs-2';
import '../lib/charts';
import { LayoutGrid, Building2, Pyramid, BadgeCheck, BarChart3, GraduationCap } from 'lucide-react';
import { SkeletonChart, SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';

const TEAL = '#125D72';
const CHART_COLORS = ['#125D72', '#F97F18', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];

const chartOpts = {
  maintainAspectRatio: false,
  plugins: { legend: { display: false as const } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 } } },
  },
};

export function HumanCapitalPage() {
  const [data, setData] = useState<{ data: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    humanCapital.get()
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Human Capital</h1></div>
        <div className="kpi-strip-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="summary-hero-card" style={{ minHeight: 100 }}>
              <div className="skeleton-line skeleton" style={{ width: '60%', height: 12 }} />
              <div className="skeleton-line skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <div className="two-col-grid">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonTable rows={5} cols={7} />
      </div>
    );
  }

  if (error) return <ErrorState title="Gagal memuat Human Capital" message={error} />;

  const d = (data?.data ?? {}) as Record<string, unknown>;
  const kpis = (d.kpis ?? []) as Array<{ label: string; formatted: string; delta?: number; isInverse?: boolean }>;

  if (!data?.data) return <EmptyState title="Data Human Capital tidak tersedia" />;

  const bidangArr = (d.headcountByBidang ?? []) as Array<{ name: string; count: number }>;
  const unitArr = (d.headcountByBU ?? []) as Array<{ bu: string; count: number }>;
  const rawAge = (d.ageDistribution ?? {}) as Record<string, number> | Array<{ group?: string; range?: string; count: number }>;
  const ageArr: Array<{ group?: string; range?: string; count: number }> = Array.isArray(rawAge)
    ? rawAge
    : Object.entries(rawAge).map(([group, count]) => ({ group, count: count as number }));

  const sertKat = (d.sertifikasi as { kategori?: Array<{ name: string; tersertifikasi: number; target: number; lembaga?: string }>; total?: number } | undefined)?.kategori ?? [];
  const certByUnit = (d.certByUnit ?? {}) as Record<string, number>;
  const training = (d.training ?? d.trainingPipeline ?? []) as Array<{
    name: string; type?: string; participants?: number; status?: string; completion?: number; date?: string; trainer?: string;
  }>;

  const bidangChart = {
    labels: bidangArr.map(b => b.name),
    datasets: [{ data: bidangArr.map(b => b.count), backgroundColor: CHART_COLORS, borderRadius: 4 }],
  };
  const unitChart = {
    labels: unitArr.map(u => u.bu),
    datasets: [{ data: unitArr.map(u => u.count), backgroundColor: TEAL, borderRadius: 4 }],
  };
  const ageChart = {
    labels: ageArr.map(a => a.group ?? a.range ?? ''),
    datasets: [{ label: 'Pegawai', data: ageArr.map(a => a.count), backgroundColor: TEAL, borderRadius: 4 }],
  };
  const certUnitChart = {
    labels: Object.keys(certByUnit),
    datasets: [{ label: 'Sertifikat', data: Object.values(certByUnit), backgroundColor: CHART_COLORS, borderRadius: 4 }],
  };

  const STATUS_LABEL: Record<string, string> = {
    ongoing: 'Berlangsung', scheduled: 'Terjadwal', completed: 'Selesai', cancelled: 'Dibatalkan',
  };

  return (
    <div className="page human-capital-page">
      {/* KPI Hero Cards */}
      {kpis.length > 0 && (
        <div className="kpi-strip-grid">
          {kpis.map((k, i) => {
            const delta = k.delta ?? 0;
            const good = k.isInverse ? delta <= 0 : delta >= 0;
            return (
              <div key={i} className="summary-hero-card kpi">
                <div className="summary-hero-label">{k.label}</div>
                <div className="summary-hero-value">{k.formatted}</div>
                <div className={`summary-hero-meta ${good ? 'delta-positive' : 'delta-negative'}`}>
                  {delta > 0 ? '+' : ''}{delta} vs prev
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Headcount Charts */}
      <div className="two-col-grid">
        <div className="card">
          <div className="card-header compact"><div className="card-title"><LayoutGrid size={14} />Headcount per Bidang</div></div>
          <div className="card-body" style={{ height: 240 }}>
            {bidangArr.length > 0
              ? <Bar data={bidangChart} options={{ ...chartOpts, plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 10 } } } }} />
              : <EmptyState title="Tidak ada data" />
            }
          </div>
        </div>
        <div className="card">
          <div className="card-header compact"><div className="card-title"><Building2 size={14} />Headcount per UPMK</div></div>
          <div className="card-body" style={{ height: 240 }}>
            {unitArr.length > 0
              ? <Bar data={unitChart} options={chartOpts} />
              : <EmptyState title="Tidak ada data" />
            }
          </div>
        </div>
      </div>

      {/* Age Distribution + Certification — no stretch, natural height */}
      <div className="two-col-grid">
        <div className="card">
          <div className="card-header compact"><div className="card-title"><Pyramid size={14} />Age Distribution</div></div>
          <div className="card-body" style={{ height: 260 }}>
            {ageArr.length > 0
              ? <Bar data={ageChart} options={chartOpts} />
              : <EmptyState title="Tidak ada data" />
            }
          </div>
        </div>
        <div className="card">
          <div className="card-header compact">
            <div className="card-title"><BadgeCheck size={14} />Sertifikasi Keahlian &amp; Kompetensi</div>
            <span className="card-meta">Capaian vs Target</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {sertKat.length > 0 ? sertKat.map((k, i) => {
              const pct = Math.round((k.tersertifikasi / (k.target || 1)) * 100);
              const barW = Math.min(100, pct);
              const statusColor = pct >= 100 ? 'var(--color-success)' : pct >= 75 ? 'var(--color-accent)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
              const statusPill = pct >= 100 ? 'completed' : pct >= 75 ? 'in-review' : 'needs-revision';
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{k.tersertifikasi}/{k.target}</span>
                      <span className={`status-pill ${statusPill}`} style={{ fontSize: 12, padding: '1px 6px' }}>{pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 8, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${barW}%`, background: statusColor, borderRadius: 'var(--radius-full)', transition: 'width 0.8s' }} />
                  </div>
                  {k.lembaga && <div style={{ fontSize: 12, color: 'var(--color-text-subtle)' }}>{k.lembaga}</div>}
                </div>
              );
            }) : <EmptyState title="Tidak ada data" />}
            {sertKat.length > 0 && (
              <div style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Total Sertifikasi Aktif:</span>
                <strong style={{ color: 'var(--color-accent)', fontSize: 'var(--text-md)' }}>{(d.sertifikasi as { total?: number })?.total ?? '—'} sertifikat</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Certification by Unit + Training side by side */}
      <div className="two-col-grid" style={{ alignItems: 'start' }}>
        {Object.keys(certByUnit).length > 0 && (
          <div className="card">
            <div className="card-header compact">
              <div className="card-title"><BarChart3 size={14} />Sertifikasi per Unit Kerja</div>
              <span className="card-meta">Pegawai tersertifikasi</span>
            </div>
            <div className="card-body" style={{ height: 240 }}>
              <Bar data={certUnitChart} options={{ ...chartOpts, plugins: { legend: { display: false } } }} />
            </div>
          </div>
        )}

        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title"><GraduationCap size={14} />Training Pipeline</div>
          </div>
          <div className="table-wrap">
            {training.length > 0 ? (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Peserta</th>
                    <th>Penyelesaian</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {training.map((t, i) => {
                    const comp = t.completion ?? 0;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{t.name}</td>
                        <td className="num">{t.participants ?? '—'}</td>
                        <td style={{ minWidth: 80 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--color-surface-hover)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${comp}%`, background: comp >= 100 ? 'var(--color-success)' : TEAL, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 30 }}>{comp}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${t.status === 'completed' ? 'completed' : t.status === 'ongoing' ? 'at-risk' : 'in-review'}`} style={{ fontSize: 12, padding: '2px 8px' }}>
                            {STATUS_LABEL[t.status ?? ''] ?? t.status ?? '—'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="Tidak ada data training pipeline" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
