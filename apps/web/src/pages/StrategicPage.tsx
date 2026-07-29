import { useEffect, useState } from 'react';
import { strategic } from '../lib/api';
import { GitFork, Target, TrendingUp, Users, DollarSign, Cog } from 'lucide-react';
import { EmptyState, ErrorState } from '../components/LoadState';

type Objective = {
  id: string; name: string; status: string; progress?: number; owner?: string;
  krs?: Array<{ id: string; text: string; target: string; current: string; progress: number; unit: string }>;
};

type Perspective = {
  id: string; name: string; color: string; icon?: string;
  objectives: Objective[];
};

const PERSPECTIVE_ICONS: Record<string, React.ReactNode> = {
  financial: <DollarSign size={16} />,
  customer: <Users size={16} />,
  internal: <Cog size={16} />,
  learning: <TrendingUp size={16} />,
};

const STATUS_LABEL: Record<string, string> = {
  'on-track': 'On Track', 'at-risk': 'At Risk', 'delayed': 'Tertinggal', 'completed': 'Tercapai',
};

export function StrategicPage() {
  const [data, setData] = useState<{ data: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    strategic.get()
      .then((r) => setData(r as { data: Record<string, unknown> }))
      .catch((e) => setError(e?.message ?? 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header"><h1 className="page-title">Strategic Targets</h1></div>
        <div className="four-col-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="summary-hero-card" style={{ minHeight: 100 }}>
              <div className="skeleton-line skeleton" style={{ width: '60%', height: 12 }} />
              <div className="skeleton-line skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) return <ErrorState title="Gagal memuat Strategic Targets" message={error} />;

  const d = (data?.data ?? {}) as Record<string, unknown>;
  const perspectives = d.perspectives ? Object.values(d.perspectives as Record<string, Perspective>) : [];
  const bsc = d.BSC as Record<string, Objective[]> | undefined;
  const okr = (d.OKR ?? []) as Array<Record<string, unknown>>;

  const allObjectives: Array<{ obj: Objective; perspective: string; color?: string }> = [];
  if (perspectives.length > 0) {
    perspectives.forEach(p => p.objectives?.forEach(o => allObjectives.push({ obj: o, perspective: p.name, color: p.color })));
  } else if (bsc) {
    Object.entries(bsc).forEach(([key, items]) => {
      (items as Objective[]).forEach(o => allObjectives.push({ obj: o, perspective: key }));
    });
  }

  if (!data?.data || (perspectives.length === 0 && !bsc && okr.length === 0)) {
    return <EmptyState title="Data Strategic Targets tidak tersedia" />;
  }

  return (
    <div className="page strategic-page">
      {/* BSC Perspective Cards */}
      {perspectives.length > 0 && (
        <div className="four-col-grid">
          {perspectives.map((p, i) => {
            const onTrack = p.objectives?.filter(o => o.status === 'on-track').length ?? 0;
            const atRisk = p.objectives?.filter(o => o.status === 'at-risk').length ?? 0;
            const iconEl = PERSPECTIVE_ICONS[p.id] ?? <Target size={16} />;
            return (
              <div key={i} className="summary-hero-card" style={{ borderTop: `3px solid var(--color-${p.color ?? 'accent'})` }}>
                <div className="summary-hero-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: `var(--color-${p.color ?? 'accent'})` }}>
                  {iconEl}{p.name}
                </div>
                <div className="summary-hero-value">{p.objectives?.length ?? 0}<span className="of">Objektif</span></div>
                <div className="summary-hero-meta" style={{ color: 'var(--color-text-subtle)' }}>
                  <span style={{ color: 'var(--color-success)' }}>{onTrack} on-track</span> ·{' '}
                  <span style={{ color: 'var(--color-warning)' }}>{atRisk} at-risk</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="two-col-grid" style={{ alignItems: 'start' }}>
        {/* Strategy Map */}
        <div className="card">
          <div className="card-header compact">
            <div className="card-title"><GitFork size={14} />Strategy Map</div>
            <span className="card-meta">Objektif per perspektif BSC</span>
          </div>
          <div className="card-body" style={{ padding: 'var(--space-4)' }}>
            {allObjectives.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {allObjectives.map(({ obj, perspective, color }, i) => {
                  const progress = obj.progress ?? 0;
                  const statusColor = obj.status === 'on-track' || obj.status === 'completed' ? 'var(--color-success)'
                    : obj.status === 'at-risk' ? 'var(--color-warning)' : 'var(--color-danger)';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, marginTop: 5 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.4 }}>
                          {obj.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{perspective}</div>
                      </div>
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <div style={{ height: 6, background: 'var(--color-surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, progress)}%`, background: statusColor, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: 12, textAlign: 'right', color: 'var(--color-text-muted)', marginTop: 2 }}>{progress}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Data strategy map tidak tersedia" />
            )}
          </div>
        </div>

        {/* OKR Table */}
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title"><Target size={14} />Objectives &amp; Key Results (OKR)</div>
          </div>
          <div className="table-wrap">
            {okr.length > 0 ? (
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Objective / Key Result</th>
                    <th style={{ width: 100 }}>Progress</th>
                    <th style={{ width: 80 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {okr.map((row, i) => {
                    const isObj = row.type === 'objective' || !row.type;
                    const progress = Number(row.progress ?? 0);
                    const status = String(row.status ?? '');
                    const statusColor = status === 'on-track' || status === 'completed' ? 'var(--color-success)'
                      : status === 'at-risk' ? 'var(--color-warning)' : 'var(--color-danger)';
                    return (
                      <tr key={i} style={{ background: isObj ? 'var(--color-surface-2)' : 'transparent' }}>
                        <td style={{ fontWeight: isObj ? 700 : 400, paddingLeft: isObj ? 'var(--space-3)' : 'var(--space-6)' }}>
                          {String(row.name ?? row.text ?? '')}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 6, background: 'var(--color-surface-hover)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, progress)}%`, background: statusColor, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'right' }}>{progress}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill ${status}`} style={{ fontSize: 12, padding: '2px 8px' }}>
                            {STATUS_LABEL[status] ?? status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="Data OKR tidak tersedia" />
            )}
          </div>
        </div>
      </div>

      {/* BSC Objectives Detail (legacy format) */}
      {bsc && !perspectives.length && (
        <div className="two-col-grid" style={{ marginTop: 'var(--space-6)', alignItems: 'start' }}>
          {Object.entries(bsc).map(([perspectiveName, items], pi) => (
            <div key={pi} className="card p-0">
              <div className="card-header compact">
                <div className="card-title">{perspectiveName}</div>
              </div>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Objektif</th>
                      <th style={{ width: 80 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(items as Objective[]).map((item, ii) => (
                      <tr key={ii}>
                        <td>{item.name}</td>
                        <td>
                          <span className={`status-pill ${item.status}`} style={{ fontSize: 12 }}>{STATUS_LABEL[item.status] ?? item.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
