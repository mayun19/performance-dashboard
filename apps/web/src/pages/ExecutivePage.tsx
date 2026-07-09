import {
  useEffect,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from "react";
import { executive, kinerja, operational } from "../lib/api";
import { usePeriod } from "../context/PeriodContext";
import {
  BarChart3,
  LineChart,
  Trophy,
  Layers,
  TrendingUp,
  ShieldCheck,
  Compass,
  Cpu,
  Leaf,
  Users,
  GitBranch,
  ClipboardList,
  HardHat,
  CheckCircle2,
  ChevronDown,
  Target,
  ShieldAlert,
  ClipboardCheck,
} from "lucide-react";
import { UnitTrendChart } from "../components/UnitTrendChart";
import {
  SkeletonKpiCards,
  SkeletonChart,
  SkeletonTable,
  EmptyState,
  ErrorState,
} from "../components/LoadState";
import type { ExecutiveData } from "../lib/types";

const PILLARS: Array<{
  id: "growth" | "digital" | "nze" | "enabler";
  name: string;
  tag: string;
  icon: ComponentType<{ size?: number }>;
  value: number;
  target: string;
}> = [
  {
    id: "growth",
    name: "Growth",
    tag: "Pertumbuhan Layanan",
    icon: TrendingUp,
    value: 78,
    target: "Target 2026 · 100%",
  },
  {
    id: "digital",
    name: "Digital",
    tag: "BIM & Digitalisasi",
    icon: Cpu,
    value: 92,
    target: "Target 2026 · 100%",
  },
  {
    id: "nze",
    name: "Net Zero Emission",
    tag: "Proyek Hijau & ESG",
    icon: Leaf,
    value: 64,
    target: "Roadmap NZE 2060",
  },
  {
    id: "enabler",
    name: "Enabler",
    tag: "SDM, GCG & K3L",
    icon: Users,
    value: 85,
    target: "Target 2026 · 100%",
  },
];

const LIFECYCLE_ICON: Record<string, ComponentType<{ size?: number }>> = {
  "clipboard-list": ClipboardList,
  "hard-hat": HardHat,
  "check-circle-2": CheckCircle2,
  trophy: Trophy,
};

interface LifecycleStage {
  stage: string;
  code: string;
  count: number;
  icon: string;
  color: string;
  desc: string;
}

// Operational types (merged from OperationalPage)
type OpKpi = {
  id: string;
  no?: string;
  label?: string;
  name?: string;
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
  commentary?: string;
};
type OpSummary = {
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

function fmt(v: unknown, d = 2) {
  if (typeof v !== "number") return String(v ?? "—");
  return v.toLocaleString("id-ID", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
function fmtPct(v: number, d = 1) {
  return (v ?? 0).toFixed(d) + "%";
}
function opStatusPill(s: string) {
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

// FoldCard — kartu lipat (klik header untuk buka/tutup)
function FoldCard({
  title,
  icon,
  right,
  accent,
  defaultOpen = true,
  children,
  id,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      id={id}
      className="card p-0"
      style={{
        marginBottom: "var(--space-6)",
        ...(accent ? { borderTop: `3px solid ${accent}` } : {}),
      }}>
      <button
        type="button"
        className="card-header compact fold-card-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}>
        <div className="card-title">
          {icon}
          {title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
          }}>
          {right}
          <ChevronDown
            size={16}
            style={{
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform .2s",
              color: "var(--color-text-muted)",
            }}
          />
        </div>
      </button>
      {open && children}
    </div>
  );
}

function StatusPill({ status }: { status?: string }) {
  const cls =
    status === "Baik" || status === "on-track" || status === "completed"
      ? "completed"
      : status === "at-risk" || status === "Hati-hati"
        ? "at-risk"
        : status === "delayed" || status === "Tertinggal"
          ? "delayed"
          : "completed";
  return <span className={`status-pill ${cls}`}>{status}</span>;
}

interface RekapUnit {
  code: string;
  name: string;
  score: number;
  status: string;
}
interface Rekap {
  hasData: boolean;
  overall: number | null;
  units: RekapUnit[];
}

export function ExecutivePage() {
  const [data, setData] = useState<{
    period: unknown;
    data: ExecutiveData;
  } | null>(null);
  const [rekap, setRekap] = useState<Rekap | null>(null);
  const [opData, setOpData] = useState<{
    data: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState(0);

  const { periodId, mode } = usePeriod();

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      executive.summary(periodId || undefined),
      kinerja.rekap(periodId || undefined, mode),
      operational.get(periodId || undefined),
    ])
      .then(([sum, rk, op]) => {
        if (sum.status === "fulfilled") setData(sum.value);
        else setError((sum.reason as Error)?.message ?? "Gagal memuat data");
        if (rk.status === "fulfilled") setRekap(rk.value as Rekap);
        if (op.status === "fulfilled")
          setOpData(op.value as { data: Record<string, unknown> });
      })
      .finally(() => setLoading(false));
  }, [periodId, mode]);

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Executive Summary</h1>
            <p className="page-subtitle">Dashboard Kinerja PUSMANPRO</p>
          </div>
        </div>
        <SkeletonKpiCards count={4} />
        <div className="two-col-grid">
          <SkeletonChart />
          <SkeletonChart />
        </div>
        <SkeletonTable rows={5} cols={5} />
      </div>
    );
  }

  if (error)
    return (
      <ErrorState title="Gagal memuat Executive Summary" message={error} />
    );
  if (!data?.data)
    return (
      <EmptyState
        title="Data tidak tersedia"
        message="Tidak ada data untuk periode ini."
      />
    );

  const d = data.data;
  const hs = d.healthScore ?? {};
  const kpis = d.kpis ?? [];
  const selectedKpi = kpis[activeKpi];

  // Integrasi C: bila ada realisasi DISETUJUI, pakai data nyata (live); jika belum, fallback ke seed.
  const isLive = !!rekap?.hasData;
  const gaugeValue =
    isLive && rekap?.overall != null ? rekap.overall : (hs.value as number);
  const ranking: Array<{
    code?: string;
    name?: string;
    unit?: string;
    score: number;
    status: string;
    projects?: number;
    criticalKpi?: string;
  }> =
    isLive && rekap
      ? rekap.units.map((u) => ({
          code: u.code,
          name: u.name,
          score: u.score,
          status: u.status,
        }))
      : (d.unitRanking ?? []);

  const scoreColor =
    gaugeValue >= 100
      ? "var(--color-success)"
      : gaugeValue >= 90
        ? "var(--color-warning)"
        : "var(--color-danger)";
  const currentYear = new Date().getFullYear();

  // Operational data derivations
  const od = (opData?.data ?? {}) as Record<string, unknown>;
  const sm = (od.summary ?? {}) as OpSummary;
  const opKpis = (od.kpis ?? []) as OpKpi[];
  const opPis = (od.pis ?? od.pi ?? []) as OpKpi[];
  const kepatuhan = (od.kepatuhan ?? []) as Kepatuhan[];
  const kpiRows = opKpis.filter((k) => !k.id?.startsWith("pi"));
  const piRows =
    opPis.length > 0 ? opPis : opKpis.filter((k) => k.id?.startsWith("pi"));
  const allKpiRows = [...kpiRows, ...piRows];
  const kpiNilai = (sm.kpiNilai ?? 0) + (sm.piNilai ?? 0);
  const kpiBobot = (sm.kpiBobot ?? 0) + (sm.piBobot ?? 0);
  const penalty = sm.kepatuhanPenalty ?? 0;
  const totalNilai = kpiNilai + penalty;
  const totalBobot = kpiBobot;
  const totalStatus =
    totalNilai >= 100 ? "Baik" : totalNilai >= 95 ? "Hati-hati" : "Perhatian";
  const hasOpData = !!(opData?.data && allKpiRows.length > 0);

  function KpiTable({ rows }: { rows: OpKpi[] }) {
    if (!rows.length) return <EmptyState title="Tidak ada data" />;
    return (
      <div className="table-wrap">
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
                return (
                  <tr key={i}>
                    <td style={{ color: "var(--color-text-muted)" }}>
                      {k.no ?? k.id}
                    </td>
                    <td>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--text-base)",
                        }}>
                        {k.name ?? k.label}
                      </div>
                      {(k.formula ?? k.commentary) && (
                        <div
                          style={{
                            fontSize: "var(--text-sm)",
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
                      {fmtPct(ach)}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {fmt(k.nilai ?? 0, 2)}
                    </td>
                    <td>{opStatusPill(k.status)}</td>
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
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive Summary</h1>
          <p className="page-subtitle">
            Dashboard Kinerja PUSMANPRO — Februari 2026
          </p>
        </div>
        <div
          className="page-meta"
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}>
          {isLive && (
            <span
              className="meta-pill"
              style={{
                background: "var(--color-success-tint)",
                color: "var(--color-success)",
                fontWeight: 700,
              }}
              title="Sumber: Realisasi Kinerja yang sudah disetujui final GM">
              ● Data Realisasi Disetujui
            </span>
          )}
          <span className="meta-pill">Februari 2026</span>
        </div>
      </div>

      {/* Hero Health Score — compact, single row */}
      <div
        className="hero-health"
        style={{
          gridTemplateColumns: "320px 1fr",
          gap: "var(--space-6)",
          padding: "var(--space-5)",
        }}>
        <div
          className="hero-health-gauge"
          style={{ width: "100%", maxWidth: 320, height: 280 }}>
          <svg
            viewBox="0 0 320 200"
            preserveAspectRatio="xMidYMin meet"
            style={{ width: "100%", height: 200, display: "block" }}>
            <defs>
              <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--color-danger)" />
                <stop offset="50%" stopColor="var(--color-warning)" />
                <stop offset="100%" stopColor="var(--color-success)" />
              </linearGradient>
            </defs>
            <path
              d="M 40 170 A 120 120 0 0 1 280 170"
              fill="none"
              stroke="var(--color-surface-hover)"
              strokeWidth="24"
              strokeLinecap="round"
            />
            <path
              d="M 40 170 A 120 120 0 0 1 280 170"
              fill="none"
              stroke="url(#gaugeGrad)"
              strokeWidth="24"
              strokeLinecap="round"
              strokeDasharray="377"
              strokeDashoffset={377 - 377 * Math.min(gaugeValue / 120, 1)}
            />
            {[75, 90, 100].map((tick, i) => {
              const pct = tick / 120;
              const angle = -180 + pct * 180;
              const rad = (angle * Math.PI) / 180;
              return (
                <circle
                  key={i}
                  cx={160 + 120 * Math.cos(rad)}
                  cy={170 + 120 * Math.sin(rad)}
                  r={4}
                  fill="var(--color-surface)"
                />
              );
            })}
          </svg>
          <div className="hero-health-overlay">
            <div
              className="hero-health-value display-font"
              style={{ color: scoreColor, fontSize: "var(--display-md)" }}>
              {fmt(gaugeValue)}
            </div>
            <div className="hero-health-meta">/ {String(hs.target ?? 100)}</div>
            <StatusPill
              status={
                isLive
                  ? gaugeValue >= 100
                    ? "Baik"
                    : gaugeValue >= 90
                      ? "Hati-hati"
                      : "Tertinggal"
                  : String(hs.status ?? "Baik")
              }
            />
          </div>
        </div>

        <div
          className="hero-health-info"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            justifyContent: "center",
          }}>
          <div>
            <div
              className="hero-health-title"
              style={{ fontSize: "var(--text-lg)" }}>
              {String(hs.label ?? "Total Nilai Kinerja PUSMANPRO")}
            </div>
            <div
              className="hero-health-subtitle"
              style={{ marginTop: 4, fontSize: "var(--text-sm)" }}>
              Agregat 14 indikator RKM 2026 — Kantor Induk + 5 UPMK bulan
              Februari 2026
            </div>
          </div>

          <div
            className="hero-health-stats"
            style={{
              marginTop: 0,
              paddingTop: "var(--space-3)",
              gridTemplateColumns: "repeat(4, 1fr)",
            }}>
            <div className="hero-stat">
              <div className="hero-stat-label">Target</div>
              <div className="hero-stat-value">{String(hs.target ?? 100)}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Bulan Lalu</div>
              <div className="hero-stat-value">{fmt(hs.previous)}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Δ vs Sebelumnya</div>
              <div
                className={`hero-stat-value ${(hs.delta as number) >= 0 ? "delta-positive" : "delta-negative"}`}>
                {(hs.delta as number) > 0 ? "+" : ""}
                {fmt(hs.delta)}%
              </div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">KPI Aktif</div>
              <div className="hero-stat-value">{kpis.length} indikator</div>
            </div>
          </div>
        </div>
      </div>

      {/* Status banner */}
      <div className="status-banner success">
        <ShieldCheck
          size={18}
          style={{ color: "var(--color-success)", flexShrink: 0 }}
        />
        <div>
          <strong>Tidak ada pengurang aktif</strong> — Semua Pengurang
          (Keterlambatan COD, Temuan BPK, Fatality) dalam kondisi aman.
        </div>
      </div>

      {/* ── OPERATIONAL KPIs (merged) ── */}
      {hasOpData && (
        <FoldCard
          title="Operational KPIs — Rangkuman Kinerja"
          icon={<Target size={14} />}
          accent="var(--color-accent)"
          right={
            <span
              className="status-pill"
              style={{
                background: "var(--color-pill-bg)",
                color: "var(--color-pill)",
                fontWeight: 700,
              }}>
              Total {fmt(totalNilai)} · {totalStatus}
            </span>
          }>
          {rekap?.hasData && (
            <div style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  background: "var(--color-success-tint)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}>
                <ClipboardCheck
                  size={13}
                  style={{ color: "var(--color-success)" }}
                />
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: 700,
                    color: "var(--color-success)",
                  }}>
                  Capaian dari Realisasi Disetujui — {rekap.units.length} unit
                </span>
              </div>
            </div>
          )}
          <div
            className="three-col-grid"
            style={{ padding: "var(--space-4) var(--space-7)" }}>
            <div className="summary-hero-card kpi">
              <div className="summary-hero-label">
                Key Performance Indicator (KPI)
              </div>
              <div className="summary-hero-value">
                {fmt(kpiNilai)}
                <span className="of">/ {kpiBobot}</span>
              </div>
              <div className="summary-hero-meta delta-positive">
                {fmtPct((kpiNilai / (kpiBobot || 1)) * 100)} pencapaian
              </div>
            </div>
            <div className="summary-hero-card pen">
              <div className="summary-hero-label">Pengurang Kepatuhan</div>
              <div className="summary-hero-value">
                {penalty}
                <span className="of">(max -30)</span>
              </div>
              <div className="summary-hero-meta delta-positive">
                {penalty === 0 ? "Tidak ada pengurang" : `${penalty} poin`}
              </div>
            </div>
            <div className="summary-hero-card total">
              <div
                className="summary-hero-label"
                style={{ color: "var(--color-accent)" }}>
                TOTAL NILAI KINERJA
              </div>
              <div className="summary-hero-value">
                {fmt(totalNilai)}
                <span className="of">/ {totalBobot}</span>
              </div>
              <div className="summary-hero-meta">
                <span
                  className={`status-pill ${totalNilai >= 100 ? "completed" : totalNilai >= 95 ? "at-risk" : "delayed"}`}>
                  {totalStatus}
                </span>
              </div>
            </div>
          </div>
          <KpiTable rows={allKpiRows} />
          {kepatuhan.length > 0 && (
            <>
              <div
                style={{
                  padding: "0 var(--space-7)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                }}>
                <ShieldAlert
                  size={13}
                  style={{ color: "var(--color-danger)" }}
                />
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    fontWeight: 700,
                    color: "var(--color-danger)",
                  }}>
                  Pengurang Kepatuhan — Maks −30 poin
                </span>
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
                              {k.status === "success"
                                ? "✓ Aman"
                                : "⚠ Perhatian"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </FoldCard>
      )}

      {/* 4 Pilar Strategis */}
      <FoldCard
        title="4 Pilar Strategis — Next Chapter of Transformation"
        icon={<Compass size={14} />}
        right={
          <span className="card-meta">Sumber: Profil Organisasi PUSMANPRO</span>
        }>
        <div
          className="pillars-strip"
          style={{ padding: "var(--space-4) var(--space-7) var(--space-2)" }}>
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.id} className={`pillar-card ${p.id}`}>
                <div className="pillar-head">
                  <span className="pillar-icon">
                    <Icon size={16} />
                  </span>
                  <div>
                    <div className="pillar-name">{p.name}</div>
                    <div className="pillar-tag">{p.tag}</div>
                  </div>
                </div>
                <div className="pillar-progress-row">
                  <span className="pillar-progress-val">{p.value}%</span>
                  <span className="pillar-progress-target">{p.target}</span>
                </div>
                <div className="pillar-bar">
                  <span style={{ width: `${p.value}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </FoldCard>

      {/* Project Lifecycle Funnel */}
      {(() => {
        const lifecycle =
          (d as unknown as { projectLifecycle?: LifecycleStage[] })
            .projectLifecycle ?? [];
        const total = lifecycle.reduce((s, x) => s + (x.count ?? 0), 0);
        if (!lifecycle.length) return null;
        return (
          <FoldCard
            title={`Project Lifecycle — ${total} Proyek Aktif PUSMANPRO`}
            icon={<GitBranch size={14} />}
            right={
              <span className="card-meta">
                Pra-Pelaksanaan → Pelaksanaan → TOC → FAC
              </span>
            }>
            <div
              className="lifecycle-funnel"
              style={{ padding: "var(--space-4)" }}>
              {lifecycle.map((s) => {
                const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                const Icon = LIFECYCLE_ICON[s.icon] ?? ClipboardList;
                return (
                  <div
                    key={s.code}
                    className="lifecycle-stage"
                    style={
                      { ["--stage-color" as string]: s.color } as CSSProperties
                    }>
                    <div className="lifecycle-pct">{pct}%</div>
                    <div className="lifecycle-head">
                      <Icon size={14} />
                      {s.code.toUpperCase()}
                    </div>
                    <div>
                      <span className="lifecycle-count">{s.count}</span>
                      <span className="lifecycle-count-unit">proyek</span>
                    </div>
                    <div className="lifecycle-stage-name">{s.stage}</div>
                    <div className="lifecycle-stage-desc">{s.desc}</div>
                  </div>
                );
              })}
            </div>
          </FoldCard>
        );
      })()}

      {/* KPI Master-Detail */}
      <FoldCard
        title={`Indikator Kinerja PUSMANPRO — ${kpis.length} KPI RKM ${currentYear}`}
        icon={<BarChart3 size={14} />}
        right={<span className="card-meta">Klik KPI untuk lihat detail</span>}>
        <div
          className="kpi-md-section"
          style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 0 }}>
          <div className="kpi-md-list" style={{ maxHeight: 480 }}>
            {kpis.map((kpi, i) => {
              const st = String(kpi.status ?? "")
                .toLowerCase()
                .replace(/\s+/g, "-");
              const dotCls =
                kpi.status === "Baik" || st === "on-track"
                  ? "success"
                  : kpi.status === "Hati-hati" || st === "at-risk"
                    ? "warning"
                    : "danger";
              return (
                <div
                  key={kpi.id ?? i}
                  className={`kpi-md-item${activeKpi === i ? " active" : ""}`}
                  onClick={() => setActiveKpi(i)}>
                  <div className="kpi-md-item-no">{i + 1}</div>
                  <div className="kpi-md-item-body">
                    <div className="kpi-md-item-name">
                      {kpi.label ?? kpi.name}
                    </div>
                    <div className="kpi-md-item-meta">
                      {String(kpi.bidang ?? kpi.category ?? "").toUpperCase()}
                    </div>
                  </div>
                  <div className={`kpi-md-item-dot ${dotCls}`} />
                </div>
              );
            })}
          </div>
          {selectedKpi && (
            <div className="kpi-md-detail">
              <div className="kpi-md-detail-header">
                <div>
                  <div className="kpi-md-detail-title">
                    {selectedKpi.label ?? selectedKpi.name}
                  </div>
                  <div className="kpi-md-detail-cat">
                    {String(
                      selectedKpi.bidang ?? selectedKpi.category ?? "",
                    ).toUpperCase()}{" "}
                    · {String(selectedKpi.satuan ?? selectedKpi.unit ?? "")}
                  </div>
                </div>
                <StatusPill status={String(selectedKpi.status ?? "")} />
              </div>
              <div
                className="kpi-md-grid"
                style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                <div>
                  <div className="kpi-md-cell-label">Target</div>
                  <div className="kpi-md-cell-value">
                    {fmt(selectedKpi.target)}
                  </div>
                </div>
                <div>
                  <div className="kpi-md-cell-label">Realisasi</div>
                  <div className="kpi-md-cell-value">
                    {fmt(selectedKpi.actual ?? selectedKpi.value)}
                  </div>
                </div>
                <div>
                  <div className="kpi-md-cell-label">Bobot</div>
                  <div className="kpi-md-cell-value">
                    {fmt(selectedKpi.bobot)}
                  </div>
                </div>
                <div>
                  <div className="kpi-md-cell-label">Nilai</div>
                  <div className="kpi-md-cell-value">
                    {fmt(selectedKpi.nilai)}
                  </div>
                </div>
              </div>
              <div>
                <div className="kpi-md-cell-label" style={{ marginBottom: 8 }}>
                  Pencapaian
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                  }}>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      background: "var(--color-surface-hover)",
                      borderRadius: "var(--radius-full)",
                      overflow: "hidden",
                    }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min((selectedKpi.achievement as number) ?? 0, 100)}%`,
                        background:
                          (selectedKpi.achievement as number) >= 100
                            ? "var(--color-success)"
                            : (selectedKpi.achievement as number) >= 90
                              ? "var(--color-warning)"
                              : "var(--color-danger)",
                        borderRadius: "var(--radius-full)",
                        transition: "width 0.5s",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: "var(--text-md)",
                      fontWeight: 800,
                      color: "var(--color-text)",
                    }}>
                    {fmt(selectedKpi.achievement, 1)}%
                  </span>
                </div>
              </div>
              <div className="kpi-md-meta-row">
                <div>
                  <span className="label">Polarity</span>{" "}
                  <span>
                    {String(selectedKpi.polarity ?? "higher-is-better")}
                  </span>
                </div>
                <div>
                  <span className="label">ID</span>{" "}
                  <code>{String(selectedKpi.id ?? "")}</code>
                </div>
              </div>
            </div>
          )}
        </div>
      </FoldCard>

      {/* Trend Nilai Kinerja — full width single card */}
      <FoldCard
        title="Trend Nilai Kinerja vs Target"
        icon={<LineChart size={14} />}
        right={<span className="card-meta">12 bulan terakhir</span>}>
        <div
          className="chart-container"
          style={{ height: 280, padding: "var(--space-4) var(--space-7) var(--space-7)" }}>
          <UnitTrendChart trend={d.unitTrend as Record<string, unknown>} />
        </div>
      </FoldCard>

      {/* Pencapaian Kinerja Per Unit — tabel dengan kolom Target */}
      {ranking && ranking.length > 0 && (
        <FoldCard
          title="Pencapaian Kinerja Per Unit"
          icon={<Trophy size={14} />}
          right={
            <span className="card-meta">
              {isLive ? "Dari realisasi disetujui" : "Kantor Induk + 5 UPMK"}
            </span>
          }>
          <div
            className="table-wrap"
            style={{ padding: "var(--space-4) var(--space-7) var(--space-7)" }}>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>No</th>
                    <th>Unit</th>
                    <th className="num">Semester I {currentYear}</th>
                    <th className="num">Target {currentYear}</th>
                    <th>Status</th>
                    <th>KPI Kritis</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => {
                    const score = r.score ?? 0;
                    const target = (r as { target?: number }).target ?? 100;
                    const stCls =
                      score >= 100
                        ? "completed"
                        : score >= 90
                          ? "at-risk"
                          : "delayed";
                    return (
                      <tr key={i}>
                        <td
                          style={{
                            color: "var(--color-text-muted)",
                            fontWeight: 800,
                            textAlign: "center",
                          }}>
                          {i + 1}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {r.name ?? r.unit ?? r.code}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 800,
                            color: "var(--color-brand)",
                          }}>
                          {fmt(score)}
                        </td>
                        <td
                          className="num"
                          style={{ color: "var(--color-text-muted)" }}>
                          {fmt(target)}
                        </td>
                        <td>
                          <span className={`status-pill ${stCls}`}>
                            {r.status}
                          </span>
                        </td>
                        <td
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--color-text-muted)",
                          }}>
                          {r.criticalKpi ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </FoldCard>
      )}

      {/* Strategic Initiatives */}
      {d.initiatives && d.initiatives.length > 0 && (
        <FoldCard
          title={`Strategic Initiatives (${d.initiatives.length})`}
          icon={<Layers size={14} />}
          right={<span className="card-meta">RKM {currentYear}</span>}>
          <div
            className="table-wrap "
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Inisiatif</th>
                    <th>PIC</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.initiatives.map((ini) => {
                    const pct = (ini.progress as number) ?? 0;
                    const barCls =
                      pct >= 100 ? "" : pct >= 80 ? "warning" : "danger";
                    return (
                      <tr key={ini.id}>
                        <td style={{ fontWeight: 600, maxWidth: 200 }}>
                          {ini.name}
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {ini.owner}
                        </td>
                        <td style={{ width: 120 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--space-2)",
                            }}>
                            <div className="progress-mini" style={{ flex: 1 }}>
                              <div
                                className={`progress-mini-fill ${barCls}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                fontWeight: 700,
                                minWidth: 32,
                              }}>
                              {pct}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${ini.status === "on-track" ? "on-track" : ini.status === "at-risk" ? "at-risk" : "delayed"}`}>
                            {ini.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </FoldCard>
      )}
    </div>
  );
}
