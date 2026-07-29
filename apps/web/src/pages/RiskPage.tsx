import { useEffect, useState } from 'react';
import { risk } from '../lib/api';
import type { RiskItem } from '../lib/types';
import { Doughnut, Line } from 'react-chartjs-2';
import '../lib/charts';
import { Grid3x3, Flame, PieChart, TrendingDown, Table2 } from 'lucide-react';
import { SkeletonChart, SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';

const CAT_COLORS = ['#125D72', '#F97F18', '#ef4444', '#8b5cf6', '#10b981', '#f59e0b'];

function heatColor(l: number, i: number) {
  const s = l * i;
  if (s >= 20) return { bg: 'rgba(220,38,38,0.30)', border: 'rgba(220,38,38,0.6)' };
  if (s >= 12) return { bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,.35)' };
  if (s >= 6)  return { bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,.35)' };
  return { bg: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,.35)' };
}

function riskScoreColor(score: number) {
  if (score >= 20) return 'var(--color-danger)';
  if (score >= 12) return '#f97316';
  if (score >= 6)  return 'var(--color-warning)';
  return 'var(--color-success)';
}

export function RiskPage() {
  const [data, setData] = useState<{ data: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heatFilter, setHeatFilter] = useState<{ l: number; i: number } | null>(null);

  useEffect(() => {
    risk.get()
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Manajemen Risiko</h1></div>
        <div className="kpi-strip-grid">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="metric-card" style={{ minHeight: 100 }}>
              <div className="skeleton-line skeleton" style={{ width: '60%', height: 12 }} />
              <div className="skeleton-line skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <div className="two-col-grid">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonTable rows={5} cols={6} />
      </div>
    );
  }

  if (error) return <ErrorState title="Gagal memuat data risiko" message={error} />;

  const d = (data?.data ?? {}) as Record<string, unknown>;
  const register = (d.register ?? []) as RiskItem[];
  const kpis = (d.kpis ?? []) as Array<{ label: string; value: number; formatted?: string; status?: string; delta?: number }>;
  const categories = (d.categories ?? {}) as Record<string, number>;
  const trend = (d.trend ?? { months: [], open: [], mitigated: [], critical: [] }) as {
    months: string[]; open: number[]; mitigated: number[]; critical: number[];
  };

  if (!data?.data || register.length === 0) {
    return <EmptyState title="Data risiko tidak tersedia" />;
  }

  const normalizeRisk = (r: RiskItem) => ({
    ...r,
    likelihood: r.likelihood ?? (r as unknown as Record<string, number>).l ?? 1,
    impact: r.impact ?? (r as unknown as Record<string, number>).i ?? 1,
    category: r.category ?? r.cat,
  });
  const normalizedRegister = register.map(normalizeRisk);
  const topRisks = [...normalizedRegister].sort((a, b) => (b.likelihood * b.impact) - (a.likelihood * a.impact)).slice(0, 5);
  const filteredRegister = heatFilter
    ? normalizedRegister.filter(r => r.likelihood === heatFilter.l && r.impact === heatFilter.i)
    : normalizedRegister;

  const catLabels = Object.keys(categories);
  const catValues = Object.values(categories);
  const catDonut = {
    labels: catLabels,
    datasets: [{ data: catValues, backgroundColor: CAT_COLORS, borderWidth: 0 }],
  };

  const trendLine = {
    labels: trend.months,
    datasets: [
      { label: 'Open', data: trend.open, borderColor: '#ef4444', backgroundColor: 'transparent', tension: 0.4, pointRadius: 2 },
      { label: 'Mitigated', data: trend.mitigated, borderColor: '#10b981', backgroundColor: 'transparent', tension: 0.4, pointRadius: 2 },
      { label: 'Critical', data: trend.critical, borderColor: '#f97316', backgroundColor: 'transparent', tension: 0.4, borderDash: [5, 5], pointRadius: 2 },
    ],
  };

  const chartOpts = {
    maintainAspectRatio: false,
    plugins: { legend: { display: true as const, labels: { font: { size: 10 }, boxWidth: 10 } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10 } } },
    },
  };

  return (
    <div className="page risk-page">
      {/* Risk KPI Strip */}
      {kpis.length > 0 && (
        <div className="kpi-strip-grid">
          {kpis.map((k, i) => (
            <div key={i} className="metric-card">
              <div className="metric-label">{k.label}</div>
              <div className="metric-value">{k.formatted ?? k.value}</div>
              {typeof k.delta === 'number' && (
                <div className={`metric-delta ${k.delta <= 0 ? 'delta-positive' : 'delta-negative'}`}>
                  {k.delta > 0 ? '+' : ''}{k.delta} vs prev
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Heat Map (narrow) + Top Risks (wide) */}
      <div className="two-col-grid wide-left" style={{ alignItems: 'start', marginBottom: 'var(--space-6)' }}>
        <div className="card">
          <div className="card-header compact">
            <div className="card-title"><Flame size={14} />Top 5 Risiko Kritis</div>
            <span className="card-meta">Skor tertinggi</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {topRisks.map((r, i) => {
              const score = r.likelihood * r.impact;
              const sc = riskScoreColor(score);
              return (
                <div key={i} style={{ border: '1px solid var(--color-border)', borderLeft: `3px solid ${sc}`, borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, lineHeight: 1.4 }}>{r.desc}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {r.category ?? r.cat} · {r.unit} · {r.owner}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: sc }}>{score}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>L{r.likelihood}×I{r.impact}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--color-surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${r.mitigationPct ?? 0}%`, background: 'var(--color-success)', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{r.mitigationPct ?? 0}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header compact">
            <div className="card-title"><Grid3x3 size={14} />Risk Heat Map (5×5)</div>
            <span className="card-meta">Klik sel untuk filter</span>
          </div>
          <div className="card-body" style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 340 }}>
              <thead>
                <tr>
                  <th style={{ width: 32, fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textAlign: 'center', padding: 4 }}>L↓ I→</th>
                  {[1, 2, 3, 4, 5].map(i => (
                    <th key={i} style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, textAlign: 'center', padding: 4 }}>{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[5, 4, 3, 2, 1].map(l => (
                  <tr key={l}>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', fontWeight: 600, padding: 4 }}>{l}</td>
                    {[1, 2, 3, 4, 5].map(i => {
                      const score = l * i;
                      const { bg, border } = heatColor(l, i);
                      const count = normalizedRegister.filter(r => r.likelihood === l && r.impact === i).length;
                      const isSelected = heatFilter?.l === l && heatFilter?.i === i;
                      return (
                        <td key={i}
                          onClick={() => setHeatFilter(isSelected ? null : { l, i })}
                          style={{
                            padding: '8px 4px', textAlign: 'center', cursor: 'pointer',
                            background: bg, border: `1px solid ${border}`,
                            outline: isSelected ? `2px solid ${border}` : 'none',
                            borderRadius: 4,
                          }}
                        >
                          <div style={{ fontSize: 15, fontWeight: 700 }}>{score}</div>
                          {count > 0 && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{count}R</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { label: 'Critical (20–25)', bg: 'rgba(220,38,38,0.30)', border: 'rgba(220,38,38,0.6)' },
                { label: 'High (12–19)', bg: 'rgba(239,68,68,0.18)', border: 'rgba(239,68,68,.35)' },
                { label: 'Medium (6–11)', bg: 'rgba(245,158,11,0.18)', border: 'rgba(245,158,11,.35)' },
                { label: 'Low (1–5)', bg: 'rgba(16,185,129,0.18)', border: 'rgba(16,185,129,.35)' },
              ].map(({ label, bg, border }) => (
                <span key={label} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: bg, border: `1px solid ${border}` }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="two-col-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="card">
          <div className="card-header compact"><div className="card-title"><PieChart size={14} />Risiko per Kategori</div></div>
          <div className="card-body" style={{ height: 260 }}>
            {catLabels.length > 0
              ? <Doughnut data={catDonut} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } } } }} />
              : <EmptyState title="Tidak ada data" />
            }
          </div>
        </div>
        <div className="card">
          <div className="card-header compact">
            <div className="card-title"><TrendingDown size={14} />Tren Risiko (6 Bulan)</div>
            <span className="card-meta">Open vs Mitigated vs Critical</span>
          </div>
          <div className="card-body" style={{ height: 260 }}>
            {trend.months.length > 0
              ? <Line data={trendLine} options={chartOpts} />
              : <EmptyState title="Tidak ada data" />
            }
          </div>
        </div>
      </div>

      {/* Risk Register */}
      <div className="card p-0">
        <div className="card-header compact">
          <div className="card-title"><Table2 size={14} />Risk Register</div>
          <span className="card-meta">
            {heatFilter ? `Filter: L${heatFilter.l}×I${heatFilter.i} (${filteredRegister.length} risiko)` : `${register.length} risiko`}
            {heatFilter && (
              <button
                onClick={() => setHeatFilter(null)}
                style={{ marginLeft: 8, fontSize: 12, background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              >
                ✕ Reset
              </button>
            )}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>Deskripsi</th>
                <th>Kategori</th>
                <th className="num">L</th>
                <th className="num">I</th>
                <th className="num">Skor</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Mitigasi</th>
              </tr>
            </thead>
            <tbody>
              {filteredRegister.map((r, i) => {
                const score = r.likelihood * r.impact;
                const sc = riskScoreColor(score);
                return (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 'var(--text-xs)', maxWidth: 300 }}>{r.desc}</div>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{r.category ?? r.cat}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{r.likelihood}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{r.impact}</td>
                    <td className="num">
                      <span style={{ fontWeight: 800, color: sc }}>{score}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${r.status === 'open' ? 'at-risk' : r.status === 'mitigated' ? 'completed' : 'in-review'}`} style={{ fontSize: 12, padding: '2px 8px' }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{r.owner}</td>
                    <td style={{ minWidth: 80 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ flex: 1, height: 4, background: 'var(--color-surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${r.mitigationPct ?? 0}%`, background: 'var(--color-success)', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{r.mitigationPct ?? 0}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRegister.length === 0 && (
                <tr><td colSpan={8}><EmptyState title="Tidak ada risiko ditemukan" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
