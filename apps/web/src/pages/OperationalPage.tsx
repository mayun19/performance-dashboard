import { useEffect, useState } from "react";
import { operational, kinerja } from "../lib/api";
import { usePeriod } from "../context/PeriodContext";
import { Target, ShieldAlert, ClipboardCheck } from "lucide-react";
import { SkeletonTable, EmptyState, ErrorState } from "../components/LoadState";

interface RekapKpi {
  indikator: string;
  satuan: string;
  bobot: number;
  target: number;
  realisasi: number;
  capaian: number;
  nilai: number;
}
interface RekapUnit {
  code: string;
  name: string;
  score: number;
  status: string;
  kpis: RekapKpi[];
}
interface Rekap {
  hasData: boolean;
  overall: number | null;
  units: RekapUnit[];
}

type Kpi = {
  id: string;
  no?: string;
  label?: string;
  name?: string;
  indikator?: string;
  formula?: string;
  target: number;
  actual?: number;
  realisasi?: number;
  bobot: number;
  achievement?: number;
  nilai?: number;
  status: string;
  satuan?: string;
  unit?: string;
  polarity?: string;
  polaritas?: string;
  ytd?: boolean;
  note?: string;
  commentary?: string;
};

type Summary = {
  kpiNilai: number;
  kpiBobot: number;
  piNilai: number;
  piBobot: number;
  kepatuhanPenalty: number;
  totalNilai: number;
  totalBobot: number;
  status: string;
};

type Kepatuhan = {
  name: string;
  maxPenalty: number;
  applied: number;
  target: string;
  status: string;
};

function fmt(v: number, d = 2) {
  return (
    v?.toLocaleString("id-ID", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }) ?? "—"
  );
}

function pct(v: number, d = 1) {
  return (v ?? 0).toFixed(d) + "%";
}

function statusPill(s: string) {
  const cls =
    s === "on-track" || s === "completed"
      ? "completed"
      : s === "at-risk"
        ? "at-risk"
        : s === "delayed"
          ? "delayed"
          : "needs-revision";
  return (
    <span className={`status-pill ${cls}`}>
      {s === "on-track"
        ? "On Track"
        : s === "at-risk"
          ? "At Risk"
          : s === "delayed"
            ? "Tertinggal"
            : s === "completed"
              ? "Tercapai"
              : s}
    </span>
  );
}

export function OperationalPage() {
  const [data, setData] = useState<{ data: Record<string, unknown> } | null>(
    null,
  );
  const [rekap, setRekap] = useState<Rekap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { periodId, mode } = usePeriod();

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      operational.get(periodId || undefined),
      kinerja.rekap(periodId || undefined, mode),
    ])
      .then(([op, rk]) => {
        if (op.status === "fulfilled") setData(op.value);
        else setError((op.reason as Error)?.message ?? "Gagal memuat data");
        if (rk.status === "fulfilled") setRekap(rk.value as Rekap);
      })
      .finally(() => setLoading(false));
  }, [periodId, mode]);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Operational KPIs</h1>
        </div>
        <div className="four-col-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="summary-hero-card"
              style={{ minHeight: 120 }}>
              <div
                className="skeleton-line skeleton"
                style={{ width: "70%", height: 12 }}
              />
              <div
                className="skeleton-line skeleton"
                style={{ width: "50%", height: 32, marginTop: 8 }}
              />
              <div
                className="skeleton-line skeleton"
                style={{ width: "40%", height: 12, marginTop: 8 }}
              />
            </div>
          ))}
        </div>
        <SkeletonTable rows={6} cols={9} />
      </div>
    );
  }

  if (error)
    return <ErrorState title="Gagal memuat Operational KPIs" message={error} />;

  const d = (data?.data ?? {}) as Record<string, unknown>;
  const sm = (d.summary ?? {}) as Summary;
  const kpis = (d.kpis ?? []) as Kpi[];
  const pis = (d.pis ?? d.pi ?? []) as Kpi[];
  const kepatuhan = (d.kepatuhan ?? []) as Kepatuhan[];

  if (!data?.data || (kpis.length === 0 && pis.length === 0)) {
    return <EmptyState title="Data Operational KPI tidak tersedia" />;
  }

  const kpiRows = kpis.filter((k) => !k.id?.startsWith("pi"));
  const piRows =
    pis.length > 0 ? pis : kpis.filter((k) => k.id?.startsWith("pi"));
  // KPI digabung jadi satu (sebelumnya KPI bobot 40 + KPI bobot 60).
  const allKpiRows = [...kpiRows, ...piRows];
  const totalMaxPenalty = kepatuhan.reduce(
    (sum, item) => sum + item.maxPenalty,
    0,
  );
  const kpiNilai = (sm.kpiNilai ?? 0) + (sm.piNilai ?? 0);
  const kpiBobot = (sm.kpiBobot ?? 0) + (sm.piBobot ?? 0);
  const penalty = sm.kepatuhanPenalty ?? 0;
  // Total Nilai Kinerja = Σ nilai KPI + pengurang kepatuhan (penalty ≤ 0) — sinkron dgn kartu di atas.
  const totalNilai = kpiNilai + penalty;
  const totalBobot = kpiBobot;
  const totalStatus =
    totalNilai >= 100 ? "Baik" : totalNilai >= 95 ? "Hati-hati" : "Perhatian";

  function KpiTable({ rows }: { rows: Kpi[] }) {
    if (!rows.length) return <EmptyState title="Tidak ada data" />;
    return (
      <div className="table-wrap" style={{ paddingBottom: "var(--space-7)" }}>
        <div className="table-scroll">
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
                const ach =
                  k.achievement ?? (k.target ? (actual / k.target) * 100 : 0);
                const nilai = k.nilai ?? 0;
                return (
                  <tr key={i}>
                    <td style={{ color: "var(--color-text-muted)" }}>
                      {i + 1}
                    </td>
                    <td>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--color-text)",
                        }}>
                        {k.name ?? k.label}
                      </div>
                      {(k.formula ?? k.commentary) && (
                        <div
                          style={{
                            fontSize: 14,
                            color: "var(--color-text-subtle)",
                            marginTop: 2,
                          }}>
                          {k.formula ?? k.commentary}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        color: "var(--color-text-muted)",
                        whiteSpace: "nowrap",
                      }}>
                      {k.satuan ?? k.unit ?? "—"}
                    </td>
                    <td className="num">{fmt(k.target, 1)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {fmt(actual, 2)}
                    </td>
                    <td className="num">{k.bobot}</td>
                    <td
                      className={`num ${ach >= 100 ? "delta-positive" : ach >= 90 ? "" : "delta-negative"}`}
                      style={{ fontWeight: 700 }}>
                      {fmt(ach, 1)}%
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {fmt(nilai, 2)}
                    </td>
                    <td>{statusPill(k.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="page operational-page">
      {/* Capaian LIVE dari Realisasi Kinerja yang sudah disetujui final (Integrasi C) */}
      {rekap?.hasData && (
        <div
          className="card p-0"
          style={{
            marginBottom: "var(--space-6)",
            borderTop: "3px solid var(--color-success)",
          }}>
          <div className="card-header compact">
            <div className="card-title">
              <ClipboardCheck size={14} />
              Capaian Kinerja dari Realisasi Disetujui
            </div>
            <span className="status-pill completed" style={{ fontWeight: 700 }}>
              Total Nilai {fmt(rekap.overall ?? 0)} · {rekap.units.length} unit
            </span>
          </div>
          {rekap.units.map((u) => (
            <div key={u.code}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "var(--space-2) var(--space-7)",
                  fontWeight: 700,
                  fontSize: "var(--text-base)",
                }}>
                <span>{u.name}</span>
                <span
                  style={{
                    display: "flex",
                    gap: "var(--space-3)",
                    alignItems: "center",
                  }}>
                  <span
                    style={{
                      color: "var(--color-brand)",
                      fontSize: "var(--text-sm)",
                    }}>
                    Nilai {fmt(u.score)}
                  </span>
                  <span
                    className={`status-pill ${u.score >= 100 ? "completed" : u.score >= 90 ? "at-risk" : "delayed"}`}>
                    {u.status}
                  </span>
                </span>
              </div>
              <div
                className="table-wrap"
                style={{ paddingBottom: "var(--space-7)" }}>
                <div className="table-scroll">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>No</th>
                        <th>Indikator</th>
                        <th>Satuan</th>
                        <th className="num">Target</th>
                        <th className="num">Realisasi</th>
                        <th className="num">Bobot</th>
                        <th className="num">Capaian</th>
                        <th className="num">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {u.kpis.map((k, i) => (
                        <tr key={i}>
                          <td style={{ color: "var(--color-text-muted)" }}>
                            {i + 1}
                          </td>
                          <td style={{ fontWeight: 500 }}>{k.indikator}</td>
                          <td style={{ color: "var(--color-text-muted)" }}>
                            {k.satuan || "—"}
                          </td>
                          <td className="num">{fmt(k.target)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {fmt(k.realisasi)}
                          </td>
                          <td className="num">{fmt(k.bobot)}</td>
                          <td
                            className={`num ${k.capaian >= 100 ? "delta-positive" : k.capaian >= 90 ? "" : "delta-negative"}`}
                            style={{ fontWeight: 700 }}>
                            {pct(k.capaian)}
                          </td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {fmt(k.nilai)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3 Hero Cards — KPI digabung jadi satu */}
      <div className="three-col-grid">
        <div className="summary-hero-card kpi">
          <div className="summary-hero-label">
            Key Performance Indicator (KPI)
          </div>
          <div className="summary-hero-value">
            {fmt(kpiNilai)}
            <span className="of">/ {kpiBobot}</span>
          </div>
          <div className="summary-hero-meta delta-positive">
            {pct((kpiNilai / (kpiBobot || 1)) * 100)} pencapaian
          </div>
        </div>
        <div className="summary-hero-card pen">
          <div className="summary-hero-label">Pengurang Kepatuhan</div>
          <div className="summary-hero-value">
            {penalty}
            <span className="of">(max  {totalMaxPenalty})</span>
          </div>
          <div className="summary-hero-meta delta-positive">
            {penalty === 0 ? "Tidak ada pengurang" : `${penalty} poin`}
          </div>
        </div>
      </div>

      {/* KPI — satu kartu gabungan (sebelumnya 2 kartu KPI) */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <div className="card p-0">
          <div
            className="card-header compact"
            style={{ borderBottom: "3px solid var(--color-accent)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flex: 1,
              }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-accent-tint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                <Target size={16} color="var(--color-accent)" />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                <div
                  className="card-title"
                  style={{
                    color: "var(--color-accent)",
                    fontSize: "var(--text-lg)",
                  }}>
                  Key Performance Indicator (KPI)
                </div>
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-text-muted)",
                  }}>
                  {allKpiRows.length} indikator · Bobot {kpiBobot}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: 800,
                  color: "var(--color-accent)",
                }}>
                {fmt(kpiNilai)}
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 400,
                    color: "var(--color-text-muted)",
                  }}>
                  {" "}
                  / {kpiBobot}
                </span>
              </div>
            </div>
          </div>
          <KpiTable rows={allKpiRows} />
        </div>
      </div>

      {/* Pengurang Kepatuhan */}
      {kepatuhan.length > 0 && (
        <div className="card p-0">
          <div
            className="card-header compact"
            style={{ borderBottom: "3px solid var(--color-danger)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flex: 1,
              }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-danger-tint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                <ShieldAlert size={16} color="var(--color-danger)" />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                <div
                  className="card-title"
                  style={{
                    color: "var(--color-danger)",
                    fontSize: "var(--text-lg)",
                  }}>
                  Pengurang Kepatuhan
                </div>
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-text-muted)",
                  }}>
                  Maks {totalMaxPenalty} poin
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: 800,
                  color:
                    (sm.kepatuhanPenalty ?? 0) < 0
                      ? "var(--color-danger)"
                      : "var(--color-success)",
                }}>
                {(sm.kepatuhanPenalty ?? 0) < 0 ? sm.kepatuhanPenalty : "0 ✓"}
              </div>
            </div>
          </div>
          <div
            className="table-wrap"
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
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
                      <td
                        className="num"
                        style={{
                          color: "var(--color-danger)",
                          fontWeight: 700,
                        }}>
                        {k.maxPenalty}
                      </td>
                      <td
                        className="num"
                        style={{
                          fontWeight: 700,
                          color:
                            k.applied < 0
                              ? "var(--color-danger)"
                              : "var(--color-success)",
                        }}>
                        {k.applied < 0 ? k.applied : "—"}
                      </td>
                      <td style={{ color: "var(--color-text-muted)" }}>
                        {k.target}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${k.status === "success" ? "completed" : "needs-revision"}`}>
                          {k.status === "success" ? "✓ Aman" : "⚠ Perhatian"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr
                    style={{
                      background: "var(--color-surface-2)",
                      fontWeight: 700,
                    }}>
                    <td>TOTAL</td>
                    <td
                      className="num"
                      style={{ color: "var(--color-danger)" }}>
                      {totalMaxPenalty}
                    </td>
                    <td
                      className="num"
                      style={{
                        fontWeight: 800,
                        color:
                          (sm.kepatuhanPenalty ?? 0) < 0
                            ? "var(--color-danger)"
                            : "var(--color-success)",
                      }}>
                      {(sm.kepatuhanPenalty ?? 0) < 0
                        ? sm.kepatuhanPenalty
                        : "0 ✓"}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
