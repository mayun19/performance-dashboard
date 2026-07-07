import { useEffect, useState, Fragment, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  approvals as approvalsApi,
  inputKontrak,
  inputRealisasi,
  meta as metaApi,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { usePeriod } from "../context/PeriodContext";
import { useNotif } from "../context/NotifContext";
import type { Report, KontrakManajemen, RealisasiKinerja } from "../lib/types";
import {
  CheckCircle,
  XCircle,
  Clock,
  CalendarClock,
  FileText,
  UsersRound,
  FileSignature,
  ChevronDown,
  ClipboardCheck,
  Timer,
  MessageSquare,
  Pencil,
  Layers,
  Printer,
} from "lucide-react";
import { SkeletonTable, EmptyState, ErrorState } from "../components/LoadState";

// Badge SLA approval (Task 6): hari tersisa hingga deadline tahap berjalan.
function SlaBadge({ days }: { days?: number | null }) {
  if (days === undefined || days === null)
    return <span style={{ color: "var(--color-text-subtle)" }}>—</span>;
  const overdue = days < 0;
  const urgent = days <= 1;
  const color = overdue
    ? "var(--color-danger)"
    : urgent
      ? "var(--color-warning)"
      : "var(--color-success)";
  const bg = overdue
    ? "var(--color-danger-tint)"
    : urgent
      ? "var(--color-warning-tint)"
      : "var(--color-success-tint)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: bg,
        padding: "2px 8px",
        borderRadius: 8,
        whiteSpace: "nowrap",
      }}>
      <Timer size={11} />
      {overdue
        ? `Telat ${Math.abs(days)} hari`
        : days === 0
          ? "Jatuh tempo hari ini"
          : `${days} hari lagi`}
    </span>
  );
}

// Timeline komentar/persetujuan dari history JSON (Task 4 — traceability).
type HistEntry = {
  stage?: number;
  actor?: string;
  role?: string;
  action?: string;
  note?: string;
  ts?: string;
  toStage?: number;
};
type RaciColKey = "pic_staff" | "upmk_internal" | "ki_chain" | "rpc" | "gm";
const RACI_COLS: { key: RaciColKey; label: string; sublabel: string }[] = [
  {
    key: "pic_staff",
    label: "PIC / Staff",
    sublabel: "Penyusun & Submitter (semua unit)",
  },
  {
    key: "upmk_internal",
    label: "ASMAN / MUP",
    sublabel: "Review internal UPMK I–V",
  },
  {
    key: "ki_chain",
    label: "ASMAN / Manajer / SM Bidang",
    sublabel: "ASMAN Elektromekanik & Jaringan (OMP) + Manajer + SM Bidang KI",
  },
  {
    key: "rpc",
    label: "Konsolidator RPC",
    sublabel: "Staff / Man. / SM Perencanaan & PC",
  },
  { key: "gm", label: "General Manager", sublabel: "Approval bundle final" },
];

const RACI_COL_LABEL: Record<RaciColKey, string> = {
  pic_staff: "PIC / Staff Kinerja — semua unit",
  upmk_internal: "ASMAN & Manajer (MUP) UPMK — review internal",
  ki_chain:
    "ASMAN / Manajer / SM Bidang — Kantor Induk (incl. ASMAN Elektromekanik & Jaringan untuk OMP)",
  rpc: "Staff / Man. Perencanaan / SM RPC — konsolidator lintas-unit",
  gm: "General Manager — approval bundle final",
};
const RACI_COL_TANGGUNG: Record<RaciColKey, string> = {
  pic_staff:
    "Menyusun, mengisi nilai realisasi, dan men-submit dokumen ke jenjang review.",
  upmk_internal:
    "ASMAN UPMK memverifikasi kelengkapan data; Manajer MUP UPMK menyetujui atau mengembalikan sebelum naik ke rantai Kantor Induk.",
  ki_chain:
    "Untuk bidang OMP: ASMAN Elektromekanik → ASMAN Jaringan → Manajer Operasi Pembangkit → Manajer Operasi Jaringan → SM OMP. Bidang lain (QA/QC, KKU): langsung Manajer → SM Bidang. Semua berakhir di SM Bidang sebelum konsolidasi RPC.",
  rpc: "Staff RPC merekap lintas-bidang & UPMK; Manajer Perencanaan memvalidasi; SM RPC memberikan final sign-off sebelum bundle GM.",
  gm: "GM menyahkan seluruh bundle (all-or-nothing). Satu keputusan berlaku untuk seluruh komponen periode / KM tahunan.",
};

const RACI_ROWS: {
  activity: string;
  scope: string;
  values: Record<RaciColKey, string>;
}[] = [
  {
    activity: "Input & Submit Dokumen (Realisasi / KM)",
    scope: "Semua unit",
    values: {
      pic_staff: "R",
      upmk_internal: "I",
      ki_chain: "I",
      rpc: "I",
      gm: "I",
    },
  },
  {
    activity: "Review Internal UPMK (ASMAN + MUP)",
    scope: "UPMK I–V",
    values: {
      pic_staff: "C",
      upmk_internal: "R/A",
      ki_chain: "—",
      rpc: "I",
      gm: "I",
    },
  },
  {
    activity: "Review Rantai Bidang (Kantor Induk)",
    scope: "KI Chain",
    values: {
      pic_staff: "I",
      upmk_internal: "C",
      ki_chain: "R/A",
      rpc: "I",
      gm: "I",
    },
  },
  {
    activity: "Konsolidasi & Review RPC",
    scope: "Bidang non-RPC",
    values: {
      pic_staff: "I",
      upmk_internal: "I",
      ki_chain: "C",
      rpc: "R/A",
      gm: "I",
    },
  },
  {
    activity: "Approval Bundle Final (KM Tahunan / Realisasi Bulanan)",
    scope: "Semua unit",
    values: {
      pic_staff: "I",
      upmk_internal: "I",
      ki_chain: "C",
      rpc: "C",
      gm: "R/A",
    },
  },
  {
    activity: "Monitoring & Audit Lintas Unit",
    scope: "Konsolidator & GM",
    values: {
      pic_staff: "—",
      upmk_internal: "—",
      ki_chain: "I",
      rpc: "R",
      gm: "A",
    },
  },
];

function getUserRaciCol(
  u: {
    role: string;
    unit?: string | null;
    bidang?: string | null;
    roleVariant?: { code: string } | null;
  } | null,
): RaciColKey | null {
  if (!u) return null;
  if (u.role === "GM") return "gm";
  const vc = u.roleVariant?.code;
  const isRpc = vc === "sm_pc" || vc === "man_perencanaan";
  if (isRpc) return "rpc";
  const isUpmk = u.unit && u.unit !== "KP";
  if (u.role === "STAFF") return "pic_staff";
  if (isUpmk && (u.role === "ASMAN" || u.role === "MANAJER"))
    return "upmk_internal";
  return "ki_chain";
}

const RACI_VALUE_STYLE = (v: string): React.CSSProperties => {
  if (v === "—")
    return {
      background: "var(--color-surface-2)",
      color: "var(--color-text-subtle)",
    };
  if (v.startsWith("R"))
    return {
      background: "var(--color-accent-tint)",
      color: "var(--color-accent)",
    };
  if (v === "A")
    return {
      background: "rgba(16,185,129,0.12)",
      color: "var(--color-success)",
    };
  if (v === "C")
    return { background: "rgba(59,130,246,0.12)", color: "var(--color-info)" };
  return {
    background: "var(--color-surface-2)",
    color: "var(--color-text-subtle)",
  };
};

const ACTION_LABEL: Record<string, string> = {
  submitted: "Diajukan",
  approved: "Disetujui",
  returned: "Dikembalikan ke konseptor",
  returned_step: "Dikembalikan 1 tahap",
};
function ApprovalTimeline({ history }: { history: unknown }) {
  const entries = Array.isArray(history) ? (history as HistEntry[]) : [];
  if (entries.length === 0)
    return (
      <div
        style={{
          fontSize: 14,
          color: "var(--color-text-muted)",
          padding: "var(--space-3)",
        }}>
        Belum ada riwayat persetujuan.
      </div>
    );
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}>
      {entries.map((e, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "var(--space-3)",
            fontSize: 14,
            alignItems: "flex-start",
          }}>
          <MessageSquare
            size={14}
            style={{
              marginTop: 4,
              color: "var(--color-text-muted)",
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontWeight: 600 }}>
              {ACTION_LABEL[e.action ?? ""] ?? e.action ?? "—"} ·{" "}
              {e.actor ?? "—"}
              {e.role ? (
                <span
                  style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
                  {" "}
                  ({e.role})
                </span>
              ) : null}
              {e.ts ? (
                <span
                  style={{
                    color: "var(--color-text-subtle)",
                    fontWeight: 500,
                    fontSize: 12,
                  }}>
                  {" "}
                  ·{" "}
                  {new Date(e.ts).toLocaleString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : null}
            </div>
            {e.note ? (
              <div style={{ color: "var(--color-text-muted)", marginTop: 1 }}>
                “{e.note}”
              </div>
            ) : (
              <div
                style={{
                  color: "var(--color-text-subtle)",
                  fontStyle: "italic",
                  marginTop: 1,
                }}>
                (tanpa komentar)
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Kartu yang bisa dilipat (fold-up): klik header untuk buka/tutup isi.
function FoldCard({
  title,
  icon,
  right,
  accent,
  defaultOpen = true,
  children,
  id,
  highlight = false,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  id?: string;
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      id={id}
      className={`card p-0${highlight ? " notif-highlight" : ""}`}
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

const STAGES = ["", "Staff", "Asman", "Manajer", "Sr. Manajer", "GM"];
// Jenjang persetujuan usulan Kontrak Manajemen: Staff → Asman → Manajer → Sr. Manajer → GM (final)

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Menunggu Review",
  ready: "Siap Konsolidasi",
  approved: "Disetujui",
  rejected: "Dikembalikan",
};
const DOC_STATUS_PILL: Record<string, string> = {
  draft: "in-review",
  submitted: "needs-revision",
  ready: "at-risk",
  approved: "completed",
  rejected: "delayed",
};
const UNIT_NAMES: Record<string, string> = {
  KP: "Kantor Induk",
  UPMK1: "UPMK I",
  UPMK2: "UPMK II",
  UPMK3: "UPMK III",
  UPMK4: "UPMK IV",
  UPMK5: "UPMK V",
};
const BIDANG_ORDER: Record<string, number> = {
  "Operasi Manajemen Proyek": 0,
  "QA/QC": 1,
  "Keuangan, Komunikasi & Umum": 2,
  "Perencanaan & Project Control": 3,
  MRO: 4,
  K3L: 5,
};
const sortByBidang = <T extends { bidang: string }>(arr: T[]): T[] =>
  [...arr].sort(
    (a, b) => (BIDANG_ORDER[a.bidang] ?? 99) - (BIDANG_ORDER[b.bidang] ?? 99),
  );

const FASE_ACCENT = [
  "var(--color-accent)",
  "var(--color-info)",
  "#8b5cf6",
  "var(--color-warning)",
  "#f59e0b",
  "var(--color-success)",
  "var(--color-text-muted)",
];

const WORKFLOW_STATIC = [
  {
    stage: 1,
    fase: "Input Data",
    deadline: "Tgl 1–3",
    slaHours: 48,
    action: "Staff/PIC input realisasi KPI bulanan ke sistem",
    checklist: [
      "Staff UPMK: isi realisasi unit, submit ke ASMAN UPMK",
      "Staff KI: isi realisasi bidang, submit ke rantai KI",
      "Lampirkan dokumen pendukung / evidence",
      "Submit sebelum deadline Tgl 3",
    ],
  },
  {
    stage: 2,
    fase: "Review Internal UPMK",
    deadline: "Tgl 4",
    slaHours: 24,
    action: "ASMAN UPMK & Manajer (MUP) UPMK verifikasi data internal",
    checklist: [
      "ASMAN UPMK: cek kelengkapan & keakuratan data",
      "Manajer MUP UPMK: approve atau kembalikan ke staff",
      "Dokumen dari Kantor Induk: melewati fase ini",
      "Setelah MUP approve → masuk rantai bidang KI",
    ],
  },
  {
    stage: 3,
    fase: "ASMAN Bidang KI",
    deadline: "Tgl 5",
    slaHours: 24,
    action: "ASMAN Elektromekanik & ASMAN Jaringan review (bidang OMP)",
    checklist: [
      "ASMAN Elektromekanik review komponen pembangkit",
      "ASMAN Jaringan review komponen jaringan transmisi",
      "Berlaku khusus untuk bidang OMP",
      "Bidang lain (QA/QC, KKU, RPC) langsung ke Manajer",
    ],
  },
  {
    stage: 4,
    fase: "Manajer Bidang KI",
    deadline: "Tgl 6",
    slaHours: 24,
    action: "Manajer Bidang Kantor Induk review & validasi per sub-bidang",
    checklist: [
      "Man. Operasi Pembangkit & Man. Operasi Jaringan (OMP)",
      "Man. QA/QC Pembangkit & Man. QA/QC Jaringan (QA/QC)",
      "Man. Keuangan, Akuntansi & Aset (KKU)",
      "Review analisis vs target; approve atau kembalikan",
    ],
  },
  {
    stage: 5,
    fase: "SM Bidang KI",
    deadline: "Tgl 7",
    slaHours: 12,
    action: "Senior Manajer Bidang: final approval rantai internal",
    checklist: [
      "SM OMP / SM QA/QC / SM KKU sesuai bidangnya",
      "Evaluasi kinerja lintas sub-bidang",
      "Approve → dokumen masuk konsolidasi RPC",
      "Kembalikan → kembali ke langkah sebelumnya",
    ],
  },
  {
    stage: 6,
    fase: "Konsolidasi RPC",
    deadline: "Tgl 8",
    slaHours: 24,
    action: "Staff RPC → Manajer Perencanaan → SM Perencanaan & PC",
    checklist: [
      "Staff Kinerja Perencanaan: rekap lintas bidang & UPMK",
      "Manajer Perencanaan: validasi konsolidasi",
      "SM Perencanaan & PC: final sign-off sebelum GM",
      "Lolos SM RPC → status “siap bundle”",
    ],
  },
  {
    stage: 7,
    fase: "Approval GM",
    deadline: "Tgl 9",
    slaHours: 12,
    action: "General Manager sahkan bundle realisasi periode / KM tahunan",
    checklist: [
      "GM review bundle semua komponen (all-or-nothing)",
      "Approve → seluruh realisasi periode berstatus “disetujui”",
      "Tolak → seluruh komponen kembali ke Manajer Perencanaan",
      "Satu keputusan berlaku untuk seluruh bundle",
    ],
  },
];

export function ApprovalsPage() {
  const { user } = useAuth();
  const { refresh: refreshNotif } = useNotif();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review usulan Kontrak Manajemen (untuk Asman ke atas)
  // Reviewer = bukan Staff penyusun. PENGECUALIAN: Staff Kinerja Perencanaan (RPC) adalah
  // konsolidator pada workflow (langkah Staff RPC), sehingga butuh fungsi review/teruskan.
  const canReview =
    !!user &&
    (user.role !== "STAFF" || user.bidang === "Perencanaan & Project Control");
  const [kmList, setKmList] = useState<KontrakManajemen[]>([]);
  const [kmNote, setKmNote] = useState("");
  const [kmTarget, setKmTarget] = useState<string | null>(null);
  const [kmExpanded, setKmExpanded] = useState<string | null>(null);
  const [kmBusy, setKmBusy] = useState(false);
  const [kmEditId, setKmEditId] = useState<string | null>(null);
  const [kmEditItems, setKmEditItems] = useState<Record<string, unknown>[]>([]);

  // Review Realisasi Kinerja Bulanan (untuk Asman ke atas)
  const [realList, setRealList] = useState<RealisasiKinerja[]>([]);
  const [realNote, setRealNote] = useState("");
  const [realTarget, setRealTarget] = useState<string | null>(null);
  const [realExpanded, setRealExpanded] = useState<string | null>(null);
  const [realBusy, setRealBusy] = useState(false);
  // B2-5: edit nilai realisasi saat review (per layer)
  const [realEditId, setRealEditId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // Semua dokumen yang diinput manual (KM + Realisasi) — untuk kartu ringkasan & registri
  const [allKm, setAllKm] = useState<KontrakManajemen[]>([]);
  const [allReal, setAllReal] = useState<RealisasiKinerja[]>([]);
  const [periodMap, setPeriodMap] = useState<Record<string, string>>({});

  // Task 10: highlight kartu sesuai notifikasi yang diklik (realisasi = prioritas utama).
  const [searchParams] = useSearchParams();
  const focusType = searchParams.get("type");
  const focusId = searchParams.get("focus");
  const [highlight, setHighlight] = useState<
    "real" | "km" | "kmbundle" | "realbundle" | null
  >(null);
  // Task 4: ekspansi riwayat komentar pada kartu "Semua Dokumen Persetujuan".
  const [docExpanded, setDocExpanded] = useState<string | null>(null);

  // B4: Bundle konsolidasi realisasi periode (persetujuan GM sekali).
  const { periodId } = usePeriod();
  type BundleData = {
    period?: { label?: string } | null;
    status: string;
    total: number;
    readyCount: number;
    canApprove: boolean;
    components: Array<{
      id: string;
      unitCode: string;
      bidang: string;
      status: string;
      submitter: string;
      values?: unknown;
    }>;
  };
  const [bundle, setBundle] = useState<BundleData | null>(null);
  const [bundleNote, setBundleNote] = useState("");
  const [bundleBusy, setBundleBusy] = useState(false);
  const loadBundle = () => {
    inputRealisasi
      .bundle(periodId || undefined)
      .then((d) => setBundle(d as BundleData))
      .catch(() => {});
  };
  // Bundle KM tahunan (GM)
  type KmBundleComp = {
    id: string;
    unitCode: string;
    bidang: string;
    status: string;
    submitter: string;
    holder?: string;
    kpiItems?: Record<string, string>[];
    history?: unknown;
  };
  type KmBundleData = {
    year?: string;
    status: string;
    total: number;
    readyCount: number;
    canApprove: boolean;
    components: KmBundleComp[];
  };
  const [kmBundleKP, setKmBundleKP] = useState<KmBundleData | null>(null);
  const [kmBundleUPMK, setKmBundleUPMK] = useState<KmBundleData | null>(null);
  const [kmBundleKPNote, setKmBundleKPNote] = useState("");
  const [kmBundleUPMKNote, setKmBundleUPMKNote] = useState("");
  const [kmBundleKPBusy, setKmBundleKPBusy] = useState(false);
  const [kmBundleUPMKBusy, setKmBundleUPMKBusy] = useState(false);
  const [kmBundleExpanded, setKmBundleExpanded] = useState<string | null>(null);
  const [upmkGroupExpanded, setUpmkGroupExpanded] = useState<string | null>(
    null,
  );
  const [upmkRealGroupExpanded, setUpmkRealGroupExpanded] = useState<
    string | null
  >(null);
  const loadKmBundle = () => {
    inputKontrak
      .bundle("KP")
      .then((d) => setKmBundleKP(d as KmBundleData))
      .catch(() => {});
    inputKontrak
      .bundle("UPMK")
      .then((d) => setKmBundleUPMK(d as KmBundleData))
      .catch(() => {});
  };

  const load = () => {
    approvalsApi
      .reports()
      .then(setReports)
      .catch((e) => setError(e?.message ?? "Gagal memuat data"))
      .finally(() => setLoading(false));
  };

  const loadKm = () => {
    if (!canReview) return;
    inputKontrak
      .reviewList()
      .then((d) => setKmList(d as KontrakManajemen[]))
      .catch(() => {});
  };

  const loadReal = () => {
    if (!canReview) return;
    inputRealisasi
      .reviewList()
      .then((d) => setRealList(d as RealisasiKinerja[]))
      .catch(() => {});
  };

  // Semua dokumen KM + Realisasi (lintas unit) untuk kartu ringkasan & registri
  const loadDocs = () => {
    inputKontrak
      .list()
      .then((d) => setAllKm(d as KontrakManajemen[]))
      .catch(() => {});
    inputRealisasi
      .history()
      .then((d) => setAllReal(d as RealisasiKinerja[]))
      .catch(() => {});
    metaApi
      .periods()
      .then((ps) => {
        const map: Record<string, string> = {};
        (ps as Array<{ id: string; label: string }>).forEach((p) => {
          map[p.id] = p.label;
        });
        setPeriodMap(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    loadKm();
    loadReal();
    loadDocs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadBundle();
    loadKmBundle();
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKmBundleKPReview = async (action: "approve" | "reject") => {
    if (!kmBundleKPNote.trim()) {
      alert("Catatan/komentar wajib diisi");
      return;
    }
    setKmBundleKPBusy(true);
    try {
      await inputKontrak.reviewBundle("KP", action, kmBundleKPNote);
      setKmBundleKPNote("");
      loadKmBundle();
      loadKm();
      refreshNotif();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal memproses bundle KM Kantor Induk",
      );
    } finally {
      setKmBundleKPBusy(false);
    }
  };
  const handleKmBundleUPMKReview = async (action: "approve" | "reject") => {
    if (!kmBundleUPMKNote.trim()) {
      alert("Catatan/komentar wajib diisi");
      return;
    }
    setKmBundleUPMKBusy(true);
    try {
      await inputKontrak.reviewBundle("UPMK", action, kmBundleUPMKNote);
      setKmBundleUPMKNote("");
      loadKmBundle();
      loadKm();
      refreshNotif();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal memproses bundle KM UPMK",
      );
    } finally {
      setKmBundleUPMKBusy(false);
    }
  };

  const handleBundleReview = async (action: "approve" | "reject") => {
    if (!bundleNote.trim()) {
      alert("Catatan/komentar wajib diisi");
      return;
    }
    setBundleBusy(true);
    try {
      await inputRealisasi.reviewBundle(
        action,
        bundleNote,
        periodId || undefined,
      );
      setBundleNote("");
      loadBundle();
      loadReal();
      refreshNotif();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal memproses bundle",
      );
    } finally {
      setBundleBusy(false);
    }
  };

  const handlePrintRealBundle = () => {
    if (!bundle) return;
    const periodLabel = bundle.period?.label ?? "Periode Aktif";
    const printDate = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const css =
      "@page{size:A4 landscape;margin:12mm}" +
      "body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#000;margin:0}" +
      ".hdr{text-align:center;margin-bottom:6pt;padding-bottom:6pt;border-bottom:2pt solid #000}" +
      ".t1{font-size:12pt;font-weight:700;margin:0 0 2pt;text-transform:uppercase;letter-spacing:0.5px}" +
      ".t2{font-size:10pt;font-weight:700;margin:0 0 2pt}" +
      ".t3{font-size:9pt;margin:0 0 2pt}" +
      ".meta{font-size:7.5pt;color:#444;margin:2pt 0}" +
      "table{width:100%;border-collapse:collapse;font-size:7.5pt;table-layout:fixed}" +
      "th{background:#1f3c6b;color:#fff;padding:5pt 3pt;border:1pt solid #000;text-align:center;word-break:break-word;font-weight:700;font-size:8pt}" +
      "td{padding:3pt 3pt;border:0.5pt solid #777;vertical-align:top;word-break:break-word}" +
      "tr.cat td{background:#1f3c6b;color:#fff;font-weight:700;font-size:8pt;padding:4pt 6pt;border:1pt solid #000}" +
      "tr.sec td{background:#d6e4f7;font-weight:700;color:#1f3c6b;font-size:8pt;padding:3.5pt 6pt;border:0.5pt solid #999}" +
      ".num{text-align:center}.rt{text-align:right}.rw{text-align:right;font-weight:700}" +
      ".ok{color:#15803d;font-weight:700}.nd{color:#d97706}" +
      ".summ{margin:6pt 0;padding:4pt 8pt;background:#f5f5f5;border:0.5pt solid #aaa;font-size:7.5pt}" +
      ".sign{margin-top:24pt;display:flex;justify-content:flex-end}" +
      ".sb{text-align:center;width:170pt}.sl{margin-top:46pt;border-top:0.5pt solid #333;padding-top:3pt;font-size:7.5pt}";
    let n = 1;
    const buildSection = (c: (typeof bundle.components)[number]): string => {
      const items =
        c.values && typeof c.values === "object"
          ? Object.values(c.values as Record<string, Record<string, unknown>>)
          : [];
      let rows = "";
      if (items.length === 0) {
        rows += `<tr><td class="num">—</td><td colspan="7" style="color:#999;font-style:italic">Tidak ada data KPI</td></tr>`;
      } else {
        items.forEach((it) => {
          rows +=
            `<tr>` +
            `<td class="num">${n++}</td>` +
            `<td>${it["indikator"] ?? "—"}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td>` +
            `<td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td>` +
            `<td class="rw">${it["realisasi"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${c.bidang}</td>` +
            `</tr>`;
        });
      }
      return rows;
    };
    const kpComps = bundle.components.filter((c) => c.unitCode === "KP");
    const upmkGroups = Object.entries(
      bundle.components
        .filter((c) => c.unitCode !== "KP")
        .reduce<Record<string, typeof bundle.components>>((acc, c) => {
          (acc[c.unitCode] ??= []).push(c);
          return acc;
        }, {}),
    ).sort(([a], [b]) => a.localeCompare(b));
    const catRow = (label: string) =>
      `<tr class="cat"><td colspan="8">${label}</td></tr>`;
    const kpAllFlat = kpComps.flatMap((c) => {
      const items2 =
        c.values && typeof c.values === "object"
          ? Object.values(c.values as Record<string, Record<string, unknown>>)
          : [];
      return items2.map((it) => ({ it, bidang: c.bidang }));
    });
    const getKpOrder = (ind: string): number => {
      const s = ind.toLowerCase();
      if (s.includes("inspection quality") || s.includes("iqc")) return 10;
      if (s.includes("kajian supervisi")) return 20;
      if (s.includes("evaluasi, analisa") || s.includes("evaluasi analisa"))
        return 30;
      if (s.includes("persentase pelaksanaan")) return 40;
      if (s.includes("kapasitas pembangkit")) return 50;
      if (s.includes("kapasitas transmisi")) return 60;
      if (s.includes("kapasitas gardu induk")) return 70;
      if (
        s.includes("pengendalian") &&
        (s.includes("anggaran investasi") || s.includes("penggunaan anggaran"))
      )
        return 81;
      if (s.includes("pengendalian nac") || s.includes("non allowable"))
        return 82;
      if (s.includes("evaluasi akurasi data")) return 90;
      if (s.includes("pemenuhan pdn") || s.includes("pdn korporat")) return 100;
      if (
        s.includes("dokumen legal aset tanah") ||
        s.includes("penyelesaian dokumen legal")
      )
        return 110;
      if (s.includes("maturity level")) return 121;
      if (s.includes("pengurang") && s.includes("kepatuhan")) return 122;
      if (s.includes("tata kelola")) return 123;
      return 999;
    };
    const kpSorted = [...kpAllFlat].sort(
      (a, b) =>
        getKpOrder(String(a.it["indikator"] ?? "")) -
        getKpOrder(String(b.it["indikator"] ?? "")),
    );
    n = 1;
    let grpR8 = false,
      grpR12 = false,
      subR8 = 0,
      subR12 = 0;
    const subLtrR = (i: number) => String.fromCharCode(97 + i);
    let kpBody = "";
    for (const { it, bidang } of kpSorted) {
      const ord = getKpOrder(String(it["indikator"] ?? ""));
      const isG8 = ord === 81 || ord === 82;
      const isG12 = ord === 121 || ord === 122 || ord === 123;
      if (isG8 && !grpR8) {
        kpBody += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Pengendalian Anggaran</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        grpR8 = true;
        subR8 = 0;
      }
      if (isG12 && !grpR12) {
        kpBody += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Kepatuhan, Maturity Level dan Tata Kelola Perusahaan</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        grpR12 = true;
        subR12 = 0;
      }
      if (isG8) {
        const subInd = String(it["indikator"] ?? "").replace(
          /^Pengendalian Anggaran\s*[-–]\s*/i,
          "",
        );
        kpBody +=
          `<tr><td class="num" style="font-size:7pt">${subLtrR(subR8++)}.</td>` +
          `<td style="padding-left:10pt">${subInd}</td>` +
          `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
          `<td class="num">${it["satuan"] ?? "—"}</td>` +
          `<td class="num">${it["bobot"] ?? "—"}</td>` +
          `<td class="rt">${it["target"] ?? "—"}</td>` +
          `<td class="rw">${it["realisasi"] ?? "—"}</td>` +
          `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
      } else if (isG12) {
        const subInd = String(it["indikator"] ?? "").replace(
          /^Pengurang\s*[-–]\s*/i,
          "",
        );
        kpBody +=
          `<tr><td class="num" style="font-size:7pt">${subLtrR(subR12++)}.</td>` +
          `<td style="padding-left:10pt">${subInd}</td>` +
          `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
          `<td class="num">${it["satuan"] ?? "—"}</td>` +
          `<td class="num">${it["bobot"] ?? "—"}</td>` +
          `<td class="rt">${it["target"] ?? "—"}</td>` +
          `<td class="rw">${it["realisasi"] ?? "—"}</td>` +
          `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
      } else {
        kpBody +=
          `<tr><td class="num">${n++}</td>` +
          `<td>${it["indikator"] ?? "—"}</td>` +
          `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
          `<td class="num">${it["satuan"] ?? "—"}</td>` +
          `<td class="num">${it["bobot"] ?? "—"}</td>` +
          `<td class="rt">${it["target"] ?? "—"}</td>` +
          `<td class="rw">${it["realisasi"] ?? "—"}</td>` +
          `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
      }
    }
    let body = catRow("A. KANTOR INDUK") + kpBody;
    const getUpmkOrdR = (ind: string): number => {
      const s = ind.toLowerCase();
      if (s.includes("kajian supervisi")) return 10;
      if (s.includes("persentase pelaksanaan")) return 20;
      if (s.includes("kapasitas pembangkit")) return 30;
      if (s.includes("kapasitas transmisi")) return 40;
      if (s.includes("kapasitas gardu induk")) return 50;
      if (s.includes("pengendalian nac") || s.includes("non allowable"))
        return 61;
      if (s.includes("pengendalian") && s.includes("penggunaan anggaran"))
        return 62;
      if (s.includes("pemenuhan pdn") || s.includes("pdn korporat")) return 70;
      if (
        s.includes("evaluasi penyelesaian") ||
        s.includes("penyelesaian proyek supervisi")
      )
        return 80;
      if (s.includes("maturity level")) return 91;
      if (s.includes("pengurang") && s.includes("kepatuhan")) return 92;
      if (s.includes("tata kelola")) return 93;
      return 999;
    };
    upmkGroups.forEach(([unitCode, comps], i) => {
      n = 1;
      body += catRow(
        `${String.fromCharCode(66 + i)}. ${(UNIT_NAMES[unitCode] ?? unitCode).toUpperCase()}`,
      );
      const uFlat = comps.flatMap((c) => {
        const vals =
          c.values && typeof c.values === "object"
            ? Object.values(c.values as Record<string, Record<string, unknown>>)
            : [];
        return vals.map((it) => ({ it, bidang: c.bidang }));
      });
      const uSorted = [...uFlat].sort(
        (a, b) =>
          getUpmkOrdR(String(a.it["indikator"] ?? "")) -
          getUpmkOrdR(String(b.it["indikator"] ?? "")),
      );
      let uG6 = false,
        uG9 = false,
        uS6 = 0,
        uS9 = 0;
      const slU = (j: number) => String.fromCharCode(97 + j);
      for (const { it, bidang } of uSorted) {
        const ord = getUpmkOrdR(String(it["indikator"] ?? ""));
        const iG6 = ord === 61 || ord === 62;
        const iG9 = ord === 91 || ord === 92 || ord === 93;
        if (iG6 && !uG6) {
          body += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Pengendalian Anggaran</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          uG6 = true;
          uS6 = 0;
        }
        if (iG9 && !uG9) {
          body += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Kepatuhan, Maturity Level dan Tata Kelola Perusahaan</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          uG9 = true;
          uS9 = 0;
        }
        if (iG6) {
          const si = String(it["indikator"] ?? "").replace(
            /^Pengendalian Anggaran\s*[-–]\s*/i,
            "",
          );
          body +=
            `<tr><td class="num" style="font-size:7pt">${slU(uS6++)}.</td>` +
            `<td style="padding-left:10pt">${si}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["realisasi"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        } else if (iG9) {
          const si = String(it["indikator"] ?? "").replace(
            /^Pengurang\s*[-–]\s*/i,
            "",
          );
          body +=
            `<tr><td class="num" style="font-size:7pt">${slU(uS9++)}.</td>` +
            `<td style="padding-left:10pt">${si}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["realisasi"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        } else {
          body +=
            `<tr><td class="num">${n++}</td><td>${it["indikator"] ?? "—"}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["realisasi"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        }
      }
      if (uSorted.length === 0) {
        body += `<tr><td class="num">—</td><td colspan="7" style="color:#999;font-style:italic">Tidak ada data KPI</td></tr>`;
      }
    });
    const html =
      `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">` +
      `<title>Laporan Kinerja Bulanan — ${periodLabel}</title><style>${css}</style></head><body>` +
      `<div class="hdr">` +
      `<p class="t1">Laporan Kinerja Bulanan</p>` +
      `<p class="t2">PT PLN (Persero) Pusat Manajemen Proyek</p>` +
      `<p class="t3">Periode ${periodLabel}</p>` +
      `<p class="meta">Dicetak: ${printDate}</p></div>` +
      `<table><colgroup>` +
      `<col style="width:3%"><col style="width:22%"><col style="width:18%">` +
      `<col style="width:6%"><col style="width:5%"><col style="width:12%"><col style="width:12%"><col style="width:12%">` +
      `</colgroup>` +
      `<thead><tr>` +
      `<th>No</th><th>INDIKATOR KINERJA KUNCI</th><th>FORMULA</th>` +
      `<th>SATUAN</th><th>BOBOT</th><th>TARGET</th><th>REALISASI</th><th>PIC</th>` +
      `</tr></thead>` +
      `<tbody>${body}</tbody></table>` +
      `<div class="summ">Total komponen: <b>${bundle.total}</b> &nbsp;|&nbsp; ` +
      `Siap: <b>${bundle.readyCount}</b> &nbsp;|&nbsp; ` +
      `Status bundle: <b>${bundle.status === "approved" ? "Disetujui GM" : "Menunggu Persetujuan GM"}</b></div>` +
      `<div class="sign"><div class="sb"><p style="margin:0">General Manager,</p>` +
      `<div class="sl">(__________________)<br/>General Manager PUSMANPRO</div></div></div></body></html>`;
    const w = window.open("", "_blank", "width=1050,height=750");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => {
      w.focus();
      w.print();
    };
  };

  const handlePrintKmBundle = (scope: "KP" | "UPMK") => {
    const km = scope === "KP" ? kmBundleKP : kmBundleUPMK;
    if (!km) return;
    const year = km.year ?? String(new Date().getFullYear());
    const printDate = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    let html: string;

    if (scope === "KP") {
      // ── Landscape, susunan KM flat per item (tanpa grouping bidang) ──
      const css =
        "@page{size:A4 landscape;margin:12mm}" +
        "body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#000;margin:0}" +
        ".hdr{text-align:center;margin-bottom:6pt;padding-bottom:6pt;border-bottom:2pt solid #000}" +
        ".t1{font-size:12pt;font-weight:700;margin:0 0 2pt;text-transform:uppercase}" +
        ".t2{font-size:10pt;font-weight:700;margin:0 0 2pt}.t3{font-size:9pt;margin:0 0 2pt}" +
        ".meta{font-size:7.5pt;color:#444;margin:2pt 0}" +
        "table{width:100%;border-collapse:collapse;font-size:7.5pt;table-layout:fixed}" +
        "th{background:#1f3c6b;color:#fff;padding:5pt 3pt;border:1pt solid #000;text-align:center;word-break:break-word;font-weight:700;font-size:8pt}" +
        "td{padding:3pt 3pt;border:0.5pt solid #777;vertical-align:top;word-break:break-word}" +
        "tr.tot td{font-weight:700;background:#e8e8e8;border:0.5pt solid #777}" +
        ".num{text-align:center}.rt{text-align:right}.rw{text-align:right;font-weight:700}" +
        ".summ{margin:6pt 0;padding:4pt 8pt;background:#f5f5f5;border:0.5pt solid #aaa;font-size:7.5pt}" +
        ".sign{margin-top:24pt;display:flex;justify-content:flex-end}" +
        ".sb{text-align:center;width:170pt}.sl{margin-top:46pt;border-top:0.5pt solid #333;padding-top:3pt;font-size:7.5pt}";
      const allFlat = km.components.flatMap((c) =>
        (c.kpiItems ?? []).map((it) => ({ it, bidang: c.bidang })),
      );
      const getItemOrder = (ind: string): number => {
        const s = ind.toLowerCase();
        if (s.includes("inspection quality") || s.includes("iqc")) return 10;
        if (s.includes("kajian supervisi")) return 20;
        if (s.includes("evaluasi, analisa") || s.includes("evaluasi analisa"))
          return 30;
        if (s.includes("persentase pelaksanaan")) return 40;
        if (s.includes("kapasitas pembangkit")) return 50;
        if (s.includes("kapasitas transmisi")) return 60;
        if (s.includes("kapasitas gardu induk")) return 70;
        if (
          s.includes("pengendalian") &&
          (s.includes("anggaran investasi") ||
            s.includes("penggunaan anggaran"))
        )
          return 81;
        if (s.includes("pengendalian nac") || s.includes("non allowable"))
          return 82;
        if (s.includes("evaluasi akurasi data")) return 90;
        if (s.includes("pemenuhan pdn") || s.includes("pdn korporat"))
          return 100;
        if (
          s.includes("dokumen legal aset tanah") ||
          s.includes("penyelesaian dokumen legal")
        )
          return 110;
        if (s.includes("maturity level")) return 121;
        if (s.includes("pengurang") && s.includes("kepatuhan")) return 122;
        if (s.includes("tata kelola")) return 123;
        return 999;
      };
      const sortedFlat = [...allFlat].sort(
        (a, b) =>
          getItemOrder(String(a.it["indikator"] ?? "")) -
          getItemOrder(String(b.it["indikator"] ?? "")),
      );
      const totalBobot = allFlat.reduce(
        (s, { it }) => s + (Number(it["bobot"]) || 0),
        0,
      );
      let n = 1;
      let grp8Emitted = false;
      let grp12Emitted = false;
      let sub8 = 0;
      let sub12 = 0;
      const subLtr = (i: number) => String.fromCharCode(97 + i);
      let body = "";
      for (const { it, bidang } of sortedFlat) {
        const ord = getItemOrder(String(it["indikator"] ?? ""));
        const isGrp8 = ord === 81 || ord === 82;
        const isGrp12 = ord === 121 || ord === 122 || ord === 123;
        if (isGrp8 && !grp8Emitted) {
          body +=
            `<tr><td class="num">${n++}</td>` +
            `<td colspan="6" style="font-weight:700">Pengendalian Anggaran</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          grp8Emitted = true;
          sub8 = 0;
        }
        if (isGrp12 && !grp12Emitted) {
          body +=
            `<tr><td class="num">${n++}</td>` +
            `<td colspan="6" style="font-weight:700">Kepatuhan, Maturity Level dan Tata Kelola Perusahaan</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          grp12Emitted = true;
          sub12 = 0;
        }
        if (isGrp8) {
          const subInd = String(it["indikator"] ?? "").replace(
            /^Pengendalian Anggaran\s*[-–]\s*/i,
            "",
          );
          body +=
            `<tr><td class="num" style="font-size:7pt">${subLtr(sub8++)}.</td>` +
            `<td style="padding-left:10pt">${subInd}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td>` +
            `<td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td>` +
            `<td class="rw">${it["target2"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        } else if (isGrp12) {
          const subInd = String(it["indikator"] ?? "").replace(
            /^Pengurang\s*[-–]\s*/i,
            "",
          );
          body +=
            `<tr><td class="num" style="font-size:7pt">${subLtr(sub12++)}.</td>` +
            `<td style="padding-left:10pt">${subInd}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td>` +
            `<td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td>` +
            `<td class="rw">${it["target2"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        } else {
          body +=
            `<tr><td class="num">${n++}</td>` +
            `<td>${it["indikator"] ?? "—"}</td>` +
            `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
            `<td class="num">${it["satuan"] ?? "—"}</td>` +
            `<td class="num">${it["bobot"] ?? "—"}</td>` +
            `<td class="rt">${it["target"] ?? "—"}</td>` +
            `<td class="rw">${it["target2"] ?? "—"}</td>` +
            `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
        }
      }
      body +=
        `<tr class="tot">` +
        `<td colspan="4" style="text-align:right;padding-right:8pt">TOTAL</td>` +
        `<td class="num">${totalBobot || "—"}</td><td colspan="3"></td></tr>`;
      html =
        `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">` +
        `<title>Kontrak Manajemen Tahunan — Kantor Induk ${year}</title><style>${css}</style></head><body>` +
        `<div class="hdr"><p class="t1">Kontrak Manajemen Tahunan</p>` +
        `<p class="t2">PT PLN (Persero) Pusat Manajemen Proyek</p>` +
        `<p class="t3">Kantor Induk &mdash; Tahun ${year}</p>` +
        `<p class="meta">Dicetak: ${printDate}</p></div>` +
        `<table><colgroup>` +
        `<col style="width:3%"><col style="width:20%"><col style="width:18%">` +
        `<col style="width:6%"><col style="width:5%"><col style="width:13%"><col style="width:13%"><col style="width:12%">` +
        `</colgroup><thead><tr>` +
        `<th>No</th><th>INDIKATOR KINERJA</th><th>FORMULA</th>` +
        `<th>SATUAN</th><th>BOBOT</th><th>TARGET SEM I</th><th>TARGET ${year}</th><th>PIC</th>` +
        `</tr></thead><tbody>${body}</tbody></table>` +
        `<div class="summ">Total KM: <b>${km.total}</b> &nbsp;|&nbsp; ` +
        `Siap: <b>${km.readyCount}</b> &nbsp;|&nbsp; ` +
        `Status: <b>${km.status === "approved" ? "Disahkan GM" : "Menunggu Pengesahan GM"}</b></div>` +
        `<div class="sign"><div class="sb"><p style="margin:0">General Manager,</p>` +
        `<div class="sl">(__________________)<br/>General Manager PUSMANPRO</div></div></div></body></html>`;
    } else {
      // ── Landscape, format ringkas UPMK ──
      const css =
        "@page{size:A4 landscape;margin:12mm}" +
        "body{font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#000;margin:0}" +
        ".hdr{text-align:center;margin-bottom:6pt;padding-bottom:6pt;border-bottom:2pt solid #000}" +
        ".t1{font-size:12pt;font-weight:700;margin:0 0 2pt;text-transform:uppercase}" +
        ".t2{font-size:10pt;font-weight:700;margin:0 0 2pt}.t3{font-size:9pt;margin:0 0 2pt}" +
        ".meta{font-size:7.5pt;color:#444;margin:2pt 0}" +
        "table{width:100%;border-collapse:collapse;font-size:7.5pt;table-layout:fixed}" +
        "th{background:#1f3c6b;color:#fff;padding:5pt 3pt;border:1pt solid #000;text-align:center;word-break:break-word;font-weight:700;font-size:8pt}" +
        "td{padding:3pt 3pt;border:0.5pt solid #777;vertical-align:top;word-break:break-word}" +
        "tr.cat td{background:#1f3c6b;color:#fff;font-weight:700;font-size:8pt;padding:4pt 6pt;border:1pt solid #000}" +
        ".num{text-align:center}.rt{text-align:right}.rw{text-align:right;font-weight:700}" +
        ".summ{margin:6pt 0;padding:4pt 8pt;background:#f5f5f5;border:0.5pt solid #aaa;font-size:7.5pt}" +
        ".sign{margin-top:24pt;display:flex;justify-content:flex-end}" +
        ".sb{text-align:center;width:170pt}.sl{margin-top:46pt;border-top:0.5pt solid #333;padding-top:3pt;font-size:7.5pt}";
      let n = 1;
      const getUpmkOrd = (ind: string): number => {
        const s = ind.toLowerCase();
        if (s.includes("kajian supervisi")) return 10;
        if (s.includes("persentase pelaksanaan")) return 20;
        if (s.includes("kapasitas pembangkit")) return 30;
        if (s.includes("kapasitas transmisi")) return 40;
        if (s.includes("kapasitas gardu induk")) return 50;
        if (s.includes("pengendalian nac") || s.includes("non allowable"))
          return 61;
        if (s.includes("pengendalian") && s.includes("penggunaan anggaran"))
          return 62;
        if (s.includes("pemenuhan pdn") || s.includes("pdn korporat"))
          return 70;
        if (
          s.includes("evaluasi penyelesaian") ||
          s.includes("penyelesaian proyek supervisi")
        )
          return 80;
        if (s.includes("maturity level")) return 91;
        if (s.includes("pengurang") && s.includes("kepatuhan")) return 92;
        if (s.includes("tata kelola")) return 93;
        return 999;
      };
      const buildUpmkGroupRows = (comps: KmBundleComp[]): string => {
        const flat = comps.flatMap((c) =>
          (c.kpiItems ?? []).map((it) => ({ it, bidang: c.bidang })),
        );
        const sorted = [...flat].sort(
          (a, b) =>
            getUpmkOrd(String(a.it["indikator"] ?? "")) -
            getUpmkOrd(String(b.it["indikator"] ?? "")),
        );
        let g6 = false,
          g9 = false,
          s6 = 0,
          s9 = 0;
        const sl = (i: number) => String.fromCharCode(97 + i);
        let rows = "";
        for (const { it, bidang } of sorted) {
          const ord = getUpmkOrd(String(it["indikator"] ?? ""));
          const iG6 = ord === 61 || ord === 62;
          const iG9 = ord === 91 || ord === 92 || ord === 93;
          if (iG6 && !g6) {
            rows += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Pengendalian Anggaran</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
            g6 = true;
            s6 = 0;
          }
          if (iG9 && !g9) {
            rows += `<tr><td class="num">${n++}</td><td colspan="6" style="font-weight:700">Kepatuhan, Maturity Level dan Tata Kelola Perusahaan</td><td class="num" style="font-size:7pt">${bidang}</td></tr>`;
            g9 = true;
            s9 = 0;
          }
          if (iG6) {
            const si = String(it["indikator"] ?? "").replace(
              /^Pengendalian Anggaran\s*[-–]\s*/i,
              "",
            );
            rows +=
              `<tr><td class="num" style="font-size:7pt">${sl(s6++)}.</td>` +
              `<td style="padding-left:10pt">${si}</td>` +
              `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
              `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
              `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["target2"] ?? "—"}</td>` +
              `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          } else if (iG9) {
            const si = String(it["indikator"] ?? "").replace(
              /^Pengurang\s*[-–]\s*/i,
              "",
            );
            rows +=
              `<tr><td class="num" style="font-size:7pt">${sl(s9++)}.</td>` +
              `<td style="padding-left:10pt">${si}</td>` +
              `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
              `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
              `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["target2"] ?? "—"}</td>` +
              `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          } else {
            rows +=
              `<tr><td class="num">${n++}</td><td>${it["indikator"] ?? "—"}</td>` +
              `<td style="font-size:7pt;color:#444">${it["formula"] ?? "—"}</td>` +
              `<td class="num">${it["satuan"] ?? "—"}</td><td class="num">${it["bobot"] ?? "—"}</td>` +
              `<td class="rt">${it["target"] ?? "—"}</td><td class="rw">${it["target2"] ?? "—"}</td>` +
              `<td class="num" style="font-size:7pt">${bidang}</td></tr>`;
          }
        }
        if (rows === "")
          rows = `<tr><td class="num">—</td><td colspan="7" style="color:#999;font-style:italic">Tidak ada data KPI</td></tr>`;
        return rows;
      };
      const groups = Object.entries(
        km.components.reduce<Record<string, KmBundleComp[]>>((acc, c) => {
          (acc[c.unitCode] ??= []).push(c);
          return acc;
        }, {}),
      ).sort(([a], [b]) => a.localeCompare(b));
      const body = groups
        .map(([unitCode, comps], gi) => {
          n = 1;
          return (
            `<tr class="cat"><td colspan="8">${String.fromCharCode(65 + gi)}. ${(UNIT_NAMES[unitCode] ?? unitCode).toUpperCase()}</td></tr>` +
            buildUpmkGroupRows(comps)
          );
        })
        .join("");
      const colgroup =
        `<colgroup>` +
        `<col style="width:3%"><col style="width:22%"><col style="width:18%">` +
        `<col style="width:6%"><col style="width:5%"><col style="width:12%"><col style="width:12%"><col style="width:12%">` +
        `</colgroup>`;
      html =
        `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">` +
        `<title>Kontrak Manajemen Tahunan — UPMK ${year}</title><style>${css}</style></head><body>` +
        `<div class="hdr"><p class="t1">Kontrak Manajemen Tahunan</p>` +
        `<p class="t2">PT PLN (Persero) Pusat Manajemen Proyek</p>` +
        `<p class="t3">UPMK (Gabungan) &mdash; Tahun ${year}</p>` +
        `<p class="meta">Dicetak: ${printDate}</p></div>` +
        `<table>${colgroup}<thead><tr>` +
        `<th>No</th><th>INDIKATOR KINERJA</th><th>FORMULA</th>` +
        `<th>SATUAN</th><th>BOBOT</th><th>TARGET SEM I</th><th>TARGET ${year}</th><th>PIC</th>` +
        `</tr></thead><tbody>${body}</tbody></table>` +
        `<div class="summ">Total KM: <b>${km.total}</b> &nbsp;|&nbsp; ` +
        `Siap: <b>${km.readyCount}</b> &nbsp;|&nbsp; ` +
        `Status: <b>${km.status === "approved" ? "Disahkan GM" : "Menunggu Pengesahan GM"}</b></div>` +
        `<div class="sign"><div class="sb"><p style="margin:0">General Manager,</p>` +
        `<div class="sl">(__________________)<br/>General Manager PUSMANPRO</div></div></div></body></html>`;
    }

    const w = window.open(
      "",
      "_blank",
      scope === "KP" ? "width=850,height=1100" : "width=1050,height=750",
    );
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => {
      w.focus();
      w.print();
    };
  };

  // Saat tiba dari notifikasi: tentukan kartu yang di-highlight & scroll ke sana.
  // Prioritas: Realisasi Kinerja Bulanan; fallback ke Usulan KM yang menunggu.
  useEffect(() => {
    if (loading || (!focusType && !focusId)) return;
    // Notifikasi GM "siap bundle" mengarah langsung ke kartu konsolidasi.
    const target: "real" | "km" | "kmbundle" | "realbundle" | null =
      focusType === "km-bundle"
        ? "kmbundle"
        : focusType === "realisasi-bundle"
          ? "realbundle"
          : focusType === "realisasi" || realList.some((r) => r.id === focusId)
            ? "real"
            : focusType === "km" || kmList.some((k) => k.id === focusId)
              ? "km"
              : realList.length > 0
                ? "real"
                : kmList.length > 0
                  ? "km"
                  : null;
    if (!target) return;
    setHighlight(target);
    const idMap = {
      real: "card-realisasi",
      km: "card-km",
      kmbundle: "card-km-bundle",
      realbundle: "card-real-bundle",
    } as const;
    const el = document.getElementById(idMap[target]);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(t);
  }, [loading, focusType, focusId, realList, kmList]);

  const handleRealReview = async (
    id: string,
    action: "approve" | "reject",
    returnTo?: "konseptor" | "previous",
  ) => {
    // Task 3: komentar wajib untuk setiap keputusan (setujui maupun kembalikan).
    if (!realNote.trim()) {
      alert(
        "Catatan/komentar wajib diisi saat menyetujui atau mengembalikan realisasi",
      );
      return;
    }
    setRealBusy(true);
    try {
      await inputRealisasi.review(id, action, realNote, returnTo);
      setRealTarget(null);
      setRealNote("");
      loadReal();
      refreshNotif();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal memproses review",
      );
    } finally {
      setRealBusy(false);
    }
  };

  const startEditReal = (rl: RealisasiKinerja) => {
    const ev: Record<string, string> = {};
    Object.entries(rl.values ?? {}).forEach(([key, v]) => {
      ev[key] = String((v as { realisasi?: unknown })?.realisasi ?? "");
    });
    setEditValues(ev);
    setRealEditId(rl.id);
    setRealExpanded(rl.id);
  };

  const saveEditReal = async (rl: RealisasiKinerja) => {
    const merged: Record<string, unknown> = {};
    Object.entries(rl.values ?? {}).forEach(([key, v]) => {
      merged[key] = {
        ...(v as object),
        realisasi: editValues[key] ?? (v as { realisasi?: unknown })?.realisasi,
      };
    });
    setRealBusy(true);
    try {
      await inputRealisasi.updateValues(rl.id, merged);
      setRealEditId(null);
      loadReal();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal menyimpan perubahan",
      );
    } finally {
      setRealBusy(false);
    }
  };

  const startEditKm = (k: KontrakManajemen) => {
    setKmEditItems(
      (k.kpiItems as Record<string, unknown>[]).map((item) => ({
        ...(item as object),
      })),
    );
    setKmEditId(k.id);
    setKmExpanded(k.id);
  };

  const saveEditKm = async (k: KontrakManajemen) => {
    setKmBusy(true);
    try {
      await inputKontrak.updateValues(k.id, kmEditItems);
      setKmEditId(null);
      loadKm();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal menyimpan perubahan",
      );
    } finally {
      setKmBusy(false);
    }
  };

  const handleKmReview = async (
    id: string,
    action: "approve" | "reject",
    returnTo?: "konseptor" | "previous",
  ) => {
    // Task 3: komentar wajib untuk setiap keputusan (setujui maupun kembalikan).
    if (!kmNote.trim()) {
      alert(
        "Catatan/komentar wajib diisi saat menyetujui atau mengembalikan usulan",
      );
      return;
    }
    setKmBusy(true);
    try {
      await inputKontrak.review(id, action, kmNote, returnTo);
      setKmTarget(null);
      setKmNote("");
      loadKm();
      refreshNotif();
    } catch (e) {
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal memproses review",
      );
    } finally {
      setKmBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Persetujuan</h1>
        </div>
        <div className="kpi-strip-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="metric-card" style={{ minHeight: 80 }}>
              <div
                className="skeleton-line skeleton"
                style={{ width: "60%", height: 12 }}
              />
              <div
                className="skeleton-line skeleton"
                style={{ width: "30%", height: 28, marginTop: 8 }}
              />
            </div>
          ))}
        </div>
        <SkeletonTable rows={5} cols={5} />
      </div>
    );
  }

  if (error) return <ErrorState title="Gagal memuat laporan" message={error} />;

  // B2-4: dokumen di-scope ke bidang user (GM / tanpa bidang = lintas-bidang).
  // Role konsolidasi RPC (SO RPC, Manajer Perencanaan, SM RPC) boleh melihat lintas bidang & UPMK.
  const isGM = user?.role === "GM";
  const myBidang = user?.bidang ?? null;
  const vc = user?.roleVariant?.code;
  const isRpcKonsolidasi =
    vc === "man_perencanaan" ||
    vc === "sm_pc" ||
    (user?.role === "STAFF" && myBidang === "Perencanaan & Project Control");
  const scopeByBidang = isGM || isRpcKonsolidasi || !myBidang;
  const scopeKm = scopeByBidang
    ? allKm
    : allKm.filter((k) => k.bidang === myBidang);
  const scopeReal = scopeByBidang
    ? allReal
    : allReal.filter(
        (r) =>
          (r as RealisasiKinerja & { bidang?: string }).bidang === myBidang,
      );

  // Ringkasan dari dokumen yang DIINPUT manual ke sistem (Kontrak Manajemen + Realisasi Kinerja)
  const docs: Array<{ status: string }> = [...scopeKm, ...scopeReal];
  const totalDoc = docs.length;
  const approvedDoc = docs.filter((d) => d.status === "approved").length;
  const pendingDoc = docs.filter((d) => d.status === "submitted").length;
  const myTasks = kmList.length + realList.length;

  // Registri semua dokumen persetujuan nyata (KM + Realisasi) lintas unit
  const stepInfo = (rec: { steps?: unknown; currentStepIndex?: number }) => {
    const steps = (rec.steps as { label: string }[] | undefined) ?? [];
    const idx = rec.currentStepIndex ?? 0;
    return {
      stepLabel: steps[idx]?.label ?? "—",
      stepIndex: idx,
      stepCount: steps.length,
    };
  };
  const docRows = [
    ...scopeKm.map((k) => ({
      id: k.id,
      jenis: "Kontrak Manajemen",
      detail: k.bidang,
      unitCode: k.unitCode,
      periodId: k.periodId,
      status: k.status,
      reviewer: k.reviewer,
      history: (k as KontrakManajemen & { history?: unknown }).history,
      ...stepInfo(
        k as KontrakManajemen & { steps?: unknown; currentStepIndex?: number },
      ),
    })),
    ...scopeReal.map((r) => ({
      id: r.id,
      jenis: "Realisasi Kinerja",
      detail: (r as RealisasiKinerja & { bidang?: string }).bidang ?? "",
      unitCode: r.unitCode,
      periodId: r.periodId,
      status: r.status,
      reviewer: r.reviewer,
      history: (r as RealisasiKinerja & { history?: unknown }).history,
      ...stepInfo(
        r as RealisasiKinerja & { steps?: unknown; currentStepIndex?: number },
      ),
    })),
  ];
  const nextApproverLabel = (status: string, stepLabel: string): string => {
    if (status === "approved") return "✓ Disahkan GM";
    if (status === "ready") return "Menunggu konsolidasi & GM";
    if (status === "rejected") return "Dikembalikan ke konseptor";
    if (status === "submitted") return stepLabel || "—";
    return "—";
  };

  return (
    <div className="page approvals-page">
      <div className="kpi-strip-grid">
        {[
          {
            label: "Total Dokumen",
            value: totalDoc,
            color: "var(--color-accent)",
          },
          {
            label: "Sudah Disetujui",
            value: approvedDoc,
            color: "var(--color-success)",
          },
          {
            label: "Menunggu Review",
            value: pendingDoc,
            color: "var(--color-warning)",
          },
          { label: "Tugas Saya", value: myTasks, color: "var(--color-info)" },
        ].map((k, i) => (
          <div
            key={i}
            className="metric-card"
            style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="metric-label">{k.label}</div>
            <div className="metric-value" style={{ color: k.color }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Review Usulan Kontrak Manajemen — hanya untuk Asman ke atas */}
      {canReview && (
        <FoldCard
          id="card-km"
          highlight={highlight === "km"}
          accent="var(--color-accent)"
          icon={<FileSignature size={16} />}
          title="Usulan Kontrak Manajemen Menunggu Review"
          right={
            <span
              className="status-pill"
              style={{
                background: "var(--color-accent-tint)",
                color: "var(--color-accent)",
                fontWeight: "bold",
              }}>
              {kmList.length} Usulan
            </span>
          }>
          {kmList.length === 0 ? (
            <div className="card-body">
              <EmptyState
                title="Tidak ada usulan"
                message="Belum ada usulan kontrak manajemen yang menunggu review."
              />
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Bidang</th>
                      <th>Pengirim</th>
                      <th>KPI</th>
                      <th>Jenjang Persetujuan</th>
                      <th>SLA</th>
                      <th>Tanggal</th>
                      <th style={{ width: 260 }}>Tindakan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kmList.map((k) => {
                      const kk = k as KontrakManajemen & {
                        steps?: { label: string }[];
                        currentStepIndex?: number;
                        stepLabel?: string;
                      };
                      const ksteps = kk.steps ?? [];
                      const kci = kk.currentStepIndex ?? 0;
                      const kIsLast = kci >= ksteps.length - 1;
                      const kPrev = ksteps[kci - 1]?.label;
                      return (
                        <Fragment key={k.id}>
                          <tr>
                            <td style={{ fontWeight: 600 }}>
                              {UNIT_NAMES[k.unitCode] ?? k.unitCode}
                            </td>
                            <td>{k.bidang}</td>
                            <td style={{ color: "var(--color-text-muted)" }}>
                              {k.submitter}
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-md"
                                onClick={() =>
                                  setKmExpanded(
                                    kmExpanded === k.id ? null : k.id,
                                  )
                                }>
                                {k.kpiItems.length} indikator{" "}
                                <ChevronDown
                                  size={12}
                                  style={{
                                    transform:
                                      kmExpanded === k.id
                                        ? "rotate(180deg)"
                                        : "none",
                                    transition: "transform .2s",
                                  }}
                                />
                              </button>
                            </td>
                            <td style={{ minWidth: 200 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  marginBottom: 3,
                                }}>
                                {ksteps.map((_, idx) => (
                                  <div
                                    key={idx}
                                    title={ksteps[idx]?.label}
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      fontSize: 8,
                                      fontWeight: 700,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      background:
                                        idx < kci
                                          ? "var(--color-success)"
                                          : idx === kci
                                            ? "var(--color-accent)"
                                            : "var(--color-surface-2)",
                                      color:
                                        idx <= kci
                                          ? "#fff"
                                          : "var(--color-text-muted)",
                                    }}>
                                    {idx < kci ? "✓" : idx + 1}
                                  </div>
                                ))}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--color-accent)",
                                  fontWeight: 600,
                                }}>
                                Langkah {kci}/{ksteps.length - 1}:{" "}
                                {kk.stepLabel ?? ksteps[kci]?.label ?? "—"}
                              </div>
                            </td>
                            <td>
                              <SlaBadge
                                days={
                                  (
                                    k as KontrakManajemen & {
                                      slaRemainingDays?: number;
                                    }
                                  ).slaRemainingDays
                                }
                              />
                            </td>
                            <td
                              style={{
                                color: "var(--color-text-muted)",
                                whiteSpace: "nowrap",
                              }}>
                              {new Date(k.submittedAt).toLocaleDateString(
                                "id-ID",
                                { day: "2-digit", month: "short" },
                              )}
                            </td>
                            <td>
                              {kmTarget === k.id ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "var(--space-2)",
                                  }}>
                                  <textarea
                                    className="form-textarea"
                                    style={{
                                      fontSize: "var(--text-xs)",
                                      minHeight: 48,
                                    }}
                                    placeholder="Catatan/komentar (wajib untuk setiap keputusan)"
                                    value={kmNote}
                                    onChange={(e) => setKmNote(e.target.value)}
                                  />
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "var(--space-2)",
                                      flexWrap: "wrap",
                                    }}>
                                    <button
                                      className="btn btn-md"
                                      style={{
                                        background: "var(--color-success)",
                                        color: "#fff",
                                      }}
                                      disabled={kmBusy}
                                      onClick={() =>
                                        handleKmReview(k.id, "approve")
                                      }>
                                      <CheckCircle size={12} />{" "}
                                      {kIsLast
                                        ? "Setujui (Selesai → Bundle)"
                                        : "Setujui & Teruskan"}
                                    </button>
                                    <button
                                      className="btn btn-md"
                                      style={{
                                        background: "var(--color-danger)",
                                        color: "#fff",
                                      }}
                                      disabled={kmBusy}
                                      onClick={() =>
                                        handleKmReview(
                                          k.id,
                                          "reject",
                                          "konseptor",
                                        )
                                      }
                                      title="Kembalikan ke konseptor untuk revisi">
                                      <XCircle size={12} /> Kembalikan ke
                                      Konseptor
                                    </button>
                                    {kci >= 2 && (
                                      <button
                                        className="btn btn-md"
                                        style={{
                                          background: "var(--color-warning)",
                                          color: "#fff",
                                        }}
                                        disabled={kmBusy}
                                        onClick={() =>
                                          handleKmReview(
                                            k.id,
                                            "reject",
                                            "previous",
                                          )
                                        }>
                                        <XCircle size={12} /> Kembalikan ke{" "}
                                        {kPrev ?? "langkah sebelumnya"}
                                      </button>
                                    )}
                                    <button
                                      className="btn btn-ghost btn-md"
                                      onClick={() => {
                                        setKmTarget(null);
                                        setKmNote("");
                                      }}>
                                      Batal
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "var(--space-2)",
                                    flexWrap: "wrap",
                                  }}>
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      setKmTarget(k.id);
                                      setKmNote("");
                                    }}>
                                    <Clock size={12} /> Tinjau
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-md"
                                    onClick={() => startEditKm(k)}
                                    title="Edit KPI items pada tahap Anda">
                                    <Pencil size={12} /> Edit
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {kmExpanded === k.id && (
                            <tr>
                              <td
                                colSpan={8}
                                style={{
                                  background: "var(--color-surface-2)",
                                  padding: 0,
                                }}>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                    gap: "var(--space-2)",
                                    padding: "var(--space-2) var(--space-3)",
                                  }}>
                                  {kmEditId === k.id ? (
                                    <>
                                      <button
                                        className="btn btn-md"
                                        style={{
                                          background: "var(--color-success)",
                                          color: "#fff",
                                        }}
                                        disabled={kmBusy}
                                        onClick={() => saveEditKm(k)}>
                                        <CheckCircle size={12} /> Simpan KPI
                                      </button>
                                      <button
                                        className="btn btn-ghost btn-md"
                                        onClick={() => setKmEditId(null)}>
                                        Batal Edit
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-secondary btn-md"
                                      onClick={() => startEditKm(k)}>
                                      <Pencil size={12} /> Edit
                                    </button>
                                  )}
                                </div>
                                <table
                                  className="data-table compact"
                                  style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>No</th>
                                      <th>Indikator Kinerja</th>
                                      <th>Formula</th>
                                      <th>Satuan</th>
                                      <th className="num">Bobot</th>
                                      <th>Target Sem I</th>
                                      <th>{`Target Tahun ${new Date().getFullYear()}`}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(kmEditId === k.id
                                      ? kmEditItems
                                      : (k.kpiItems as Record<
                                          string,
                                          unknown
                                        >[])
                                    ).map((it, idx) => {
                                      const editing = kmEditId === k.id;
                                      const itStr = it as Record<
                                        string,
                                        string
                                      >;
                                      return (
                                        <tr key={idx}>
                                          <td>{idx + 1}</td>
                                          <td>{itStr.indikator}</td>
                                          <td>{itStr.formula}</td>
                                          <td>{itStr.satuan}</td>
                                          <td className="num">{itStr.bobot}</td>
                                          <td
                                            style={{
                                              fontWeight: editing
                                                ? 700
                                                : undefined,
                                            }}>
                                            {editing ? (
                                              <input
                                                type="text"
                                                className="form-input form-input-sm"
                                                style={{ width: 90 }}
                                                value={String(
                                                  kmEditItems[idx]?.target ??
                                                    "",
                                                )}
                                                onChange={(e) =>
                                                  setKmEditItems((items) =>
                                                    items.map((item, i) =>
                                                      i === idx
                                                        ? {
                                                            ...item,
                                                            target:
                                                              e.target.value,
                                                          }
                                                        : item,
                                                    ),
                                                  )
                                                }
                                              />
                                            ) : (
                                              itStr.target
                                            )}
                                          </td>
                                          <td
                                            style={{
                                              fontWeight: editing
                                                ? 700
                                                : undefined,
                                            }}>
                                            {editing ? (
                                              <input
                                                type="text"
                                                className="form-input form-input-sm"
                                                style={{ width: 90 }}
                                                value={String(
                                                  kmEditItems[idx]?.target2 ??
                                                    "",
                                                )}
                                                onChange={(e) =>
                                                  setKmEditItems((items) =>
                                                    items.map((item, i) =>
                                                      i === idx
                                                        ? {
                                                            ...item,
                                                            target2:
                                                              e.target.value,
                                                          }
                                                        : item,
                                                    ),
                                                  )
                                                }
                                              />
                                            ) : (
                                              itStr.target2
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
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
        </FoldCard>
      )}

      {/* Bundle Konsolidasi KM Tahunan — persetujuan akhir GM */}
      {/* === Card 1: Bundle KM Kantor Induk === */}
      {canReview && kmBundleKP && (
        <FoldCard
          id="card-km-bundle-kp"
          highlight={highlight === "kmbundle"}
          accent="var(--color-accent)"
          icon={<Layers size={16} />}
          title={`Konsolidasi KM Tahunan — Kantor Induk${kmBundleKP.year ? " " + kmBundleKP.year : ""}`}
          right={
            kmBundleKP.status === "approved" ? (
              <span
                className="status-pill completed"
                style={{ fontWeight: 700 }}>
                Disahkan GM
              </span>
            ) : (
              <span className="status-pill" style={{ fontWeight: 700 }}>
                {kmBundleKP.readyCount}/{kmBundleKP.total} siap
              </span>
            )
          }>
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Bidang</th>
                    <th>Penyusun</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {kmBundleKP.components.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState
                          title="Belum ada KM"
                          message="Belum ada KM Kantor Induk yang masuk konsolidasi tahun ini."
                        />
                      </td>
                    </tr>
                  )}
                  {kmBundleKP.components.map((c) => (
                    <Fragment key={c.id}>
                      <tr>
                        <td>{c.bidang}</td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {c.submitter}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${c.status === "approved" ? "completed" : c.status === "ready" ? "at-risk" : "in-review"}`}>
                            {c.status === "ready"
                              ? "Siap (lolos SM RPC)"
                              : c.status === "approved"
                                ? "Disahkan GM"
                                : c.status === "submitted"
                                  ? "Dalam proses review"
                                  : c.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-md"
                            onClick={() =>
                              setKmBundleExpanded(
                                kmBundleExpanded === c.id ? null : c.id,
                              )
                            }
                            title="Tinjau detail KPI & riwayat">
                            <ClipboardCheck size={12} />{" "}
                            {c.kpiItems?.length ?? 0} KPI
                            <ChevronDown
                              size={12}
                              style={{
                                transform:
                                  kmBundleExpanded === c.id
                                    ? "rotate(180deg)"
                                    : "none",
                                transition: "transform .2s",
                              }}
                            />
                          </button>
                        </td>
                      </tr>
                      {kmBundleExpanded === c.id && (
                        <tr>
                          <td
                            colSpan={4}
                            style={{
                              background: "var(--color-surface-2)",
                              padding: 0,
                            }}>
                            <div
                              style={{
                                padding: "var(--space-2) var(--space-3)",
                                fontSize: 14,
                                color: "var(--color-text-muted)",
                              }}>
                              Penanggung Jawab:{" "}
                              <strong style={{ color: "var(--color-text)" }}>
                                {c.holder ?? "—"}
                              </strong>
                            </div>
                            <table
                              className="data-table compact"
                              style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>No</th>
                                  <th>Indikator Kinerja</th>
                                  <th>Formula</th>
                                  <th>Satuan</th>
                                  <th className="num">Bobot</th>
                                  <th>Target Sem I</th>
                                  <th>{`Target ${new Date().getFullYear()}`}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(c.kpiItems ?? []).map((it, idx) => (
                                  <tr key={idx}>
                                    <td>{idx + 1}</td>
                                    <td>{it.indikator}</td>
                                    <td>{it.formula}</td>
                                    <td>{it.satuan}</td>
                                    <td className="num">{it.bobot}</td>
                                    <td>{it.target}</td>
                                    <td>{it.target2}</td>
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
          {user?.role === "GM" && kmBundleKP.components.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "var(--space-1) var(--space-3)",
              }}>
              <button
                className="btn btn-ghost btn-md"
                onClick={() => handlePrintKmBundle("KP")}
                title="Cetak / Print Preview KM Kantor Induk">
                <Printer size={12} /> Cetak Preview
              </button>
            </div>
          )}
          {user?.role === "GM" && kmBundleKP.status !== "approved" && (
            <div
              className="card-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}>
              {kmBundleKP.components.some((c) => c.status === "submitted") && (
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-warning)",
                  }}>
                  Belum semua KM Kantor Induk "siap" — GM dapat mengesahkan
                  setelah seluruh KM lolos hingga SM Perencanaan & PC.
                </div>
              )}
              <textarea
                className="form-textarea"
                style={{ fontSize: "var(--text-sm)", minHeight: 48 }}
                placeholder="Catatan pengesahan/penolakan bundle KM Kantor Induk (wajib)"
                value={kmBundleKPNote}
                onChange={(e) => setKmBundleKPNote(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-success)", color: "#fff" }}
                  disabled={kmBundleKPBusy || !kmBundleKP.canApprove}
                  onClick={() => handleKmBundleKPReview("approve")}>
                  <CheckCircle size={12} /> Sahkan KM Kantor Induk (Final)
                </button>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                  disabled={kmBundleKPBusy || kmBundleKP.total === 0}
                  onClick={() => handleKmBundleKPReview("reject")}>
                  <XCircle size={12} /> Kembalikan Bundle KI
                </button>
              </div>
            </div>
          )}
          {kmBundleKP.status === "approved" && (
            <div
              className="card-body"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-success)",
                padding: "0 var(--space-7) var(--space-4)",
              }}>
              ✓ Bundle KM Kantor Induk tahun ini telah disahkan oleh General
              Manager.
            </div>
          )}
        </FoldCard>
      )}

      {/* === Card 2: Bundle KM UPMK (gabungan UPMK I–V) === */}
      {canReview && kmBundleUPMK && (
        <FoldCard
          id="card-km-bundle-upmk"
          accent="var(--color-accent)"
          icon={<Layers size={16} />}
          title={`Konsolidasi KM Tahunan — UPMK${kmBundleUPMK.year ? " " + kmBundleUPMK.year : ""}`}
          right={
            kmBundleUPMK.status === "approved" ? (
              <span
                className="status-pill completed"
                style={{ fontWeight: 700 }}>
                Disahkan GM
              </span>
            ) : (
              <span className="status-pill" style={{ fontWeight: 700 }}>
                {kmBundleUPMK.readyCount}/{kmBundleUPMK.total} siap
              </span>
            )
          }>
          <div
            className="table-wrap"
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Bidang / Penyusun</th>
                    <th>Status</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {kmBundleUPMK.components.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState
                          title="Belum ada KM UPMK"
                          message="Belum ada KM UPMK yang masuk konsolidasi tahun ini."
                        />
                      </td>
                    </tr>
                  )}
                  {Object.entries(
                    kmBundleUPMK.components.reduce<
                      Record<string, KmBundleComp[]>
                    >((acc, c) => {
                      (acc[c.unitCode] ??= []).push(c);
                      return acc;
                    }, {}),
                  )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([unitCode, items]) => {
                      const allApproved = items.every(
                        (c) => c.status === "approved",
                      );
                      const allReady = items.every(
                        (c) => c.status === "ready" || c.status === "approved",
                      );
                      const anySubmitted = items.some(
                        (c) => c.status === "submitted",
                      );
                      const readyCount = items.filter(
                        (c) => c.status === "ready" || c.status === "approved",
                      ).length;
                      const isOpen = upmkGroupExpanded === unitCode;
                      const aggregateLabel = allApproved
                        ? "Disahkan GM"
                        : allReady
                          ? "Siap"
                          : anySubmitted
                            ? "Dalam review"
                            : `${readyCount}/${items.length} siap`;
                      const aggregateCls = allApproved
                        ? "completed"
                        : allReady
                          ? "at-risk"
                          : anySubmitted
                            ? "in-review"
                            : "";
                      return (
                        <Fragment key={unitCode}>
                          <tr style={{ background: "var(--color-surface-1)" }}>
                            <td colSpan={2} style={{ fontWeight: 700 }}>
                              <button
                                className="btn btn-ghost btn-md"
                                style={{ gap: "var(--space-1)" }}
                                onClick={() =>
                                  setUpmkGroupExpanded(isOpen ? null : unitCode)
                                }>
                                <ChevronDown
                                  size={12}
                                  style={{
                                    transform: isOpen
                                      ? "rotate(180deg)"
                                      : "none",
                                    transition: "transform .2s",
                                    flexShrink: 0,
                                  }}
                                />
                                {UNIT_NAMES[unitCode] ?? unitCode}
                              </button>
                            </td>
                            <td>
                              <span className={`status-pill ${aggregateCls}`}>
                                {aggregateLabel}
                              </span>
                            </td>
                            <td
                              style={{
                                color: "var(--color-text-muted)",
                                fontSize: 11,
                              }}>
                              {items.length} bidang
                            </td>
                          </tr>
                          {isOpen &&
                            sortByBidang(items).map((c) => (
                              <Fragment key={c.id}>
                                <tr
                                  style={{
                                    background: "var(--color-surface-2)",
                                  }}>
                                  <td
                                    style={{ paddingLeft: "var(--space-5)" }}
                                  />
                                  <td
                                    style={{
                                      fontSize: 11,
                                      color: "var(--color-text-muted)",
                                    }}>
                                    {c.bidang} · {c.submitter}
                                  </td>
                                  <td>
                                    <span
                                      className={`status-pill ${c.status === "approved" ? "completed" : c.status === "ready" ? "at-risk" : "in-review"}`}>
                                      {c.status === "ready"
                                        ? "Siap"
                                        : c.status === "approved"
                                          ? "Disahkan GM"
                                          : "Dalam review"}
                                    </span>
                                  </td>
                                  <td>
                                    <button
                                      className="btn btn-ghost btn-md"
                                      onClick={() =>
                                        setKmBundleExpanded(
                                          kmBundleExpanded === c.id
                                            ? null
                                            : c.id,
                                        )
                                      }
                                      title="Tinjau detail KPI">
                                      <ClipboardCheck size={12} />{" "}
                                      {c.kpiItems?.length ?? 0} KPI
                                      <ChevronDown
                                        size={12}
                                        style={{
                                          transform:
                                            kmBundleExpanded === c.id
                                              ? "rotate(180deg)"
                                              : "none",
                                          transition: "transform .2s",
                                        }}
                                      />
                                    </button>
                                  </td>
                                </tr>
                                {kmBundleExpanded === c.id && (
                                  <tr>
                                    <td
                                      colSpan={4}
                                      style={{
                                        background: "var(--color-surface-2)",
                                        padding: 0,
                                      }}>
                                      <div
                                        style={{
                                          padding:
                                            "var(--space-2) var(--space-3)",
                                          fontSize: 11,
                                          color: "var(--color-text-muted)",
                                        }}>
                                        Penanggung Jawab:{" "}
                                        <strong
                                          style={{
                                            color: "var(--color-text)",
                                          }}>
                                          {c.holder ?? "—"}
                                        </strong>
                                      </div>
                                      <table
                                        className="data-table compact"
                                        style={{ margin: 0 }}>
                                        <thead>
                                          <tr>
                                            <th>No</th>
                                            <th>Indikator Kinerja</th>
                                            <th>Formula</th>
                                            <th>Satuan</th>
                                            <th className="num">Bobot</th>
                                            <th>Target Sem I</th>
                                            <th>{`Target ${new Date().getFullYear()}`}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(c.kpiItems ?? []).map((it, idx) => (
                                            <tr key={idx}>
                                              <td>{idx + 1}</td>
                                              <td>{it.indikator}</td>
                                              <td>{it.formula}</td>
                                              <td>{it.satuan}</td>
                                              <td className="num">
                                                {it.bobot}
                                              </td>
                                              <td>{it.target}</td>
                                              <td>{it.target2}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            ))}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          {user?.role === "GM" && kmBundleUPMK.components.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "var(--space-1) var(--space-3)",
              }}>
              <button
                className="btn btn-ghost btn-md"
                onClick={() => handlePrintKmBundle("UPMK")}
                title="Cetak / Print Preview KM UPMK">
                <Printer size={12} /> Cetak Preview
              </button>
            </div>
          )}
          {user?.role === "GM" && kmBundleUPMK.status !== "approved" && (
            <div
              className="card-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                padding: "0 var(--space-7) var(--space-7)",
              }}>
              {kmBundleUPMK.components.some(
                (c) => c.status === "submitted",
              ) && (
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-warning)",
                  }}>
                  Belum semua KM UPMK "siap" — GM dapat mengesahkan setelah
                  seluruh KM UPMK lolos hingga SM Perencanaan & PC.
                </div>
              )}
              <textarea
                className="form-textarea"
                style={{ fontSize: "var(--text-sm)", minHeight: 48 }}
                placeholder="Catatan pengesahan/penolakan bundle KM UPMK (wajib)"
                value={kmBundleUPMKNote}
                onChange={(e) => setKmBundleUPMKNote(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-success)", color: "#fff" }}
                  disabled={kmBundleUPMKBusy || !kmBundleUPMK.canApprove}
                  onClick={() => handleKmBundleUPMKReview("approve")}>
                  <CheckCircle size={12} /> Sahkan KM UPMK (Final)
                </button>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                  disabled={kmBundleUPMKBusy || kmBundleUPMK.total === 0}
                  onClick={() => handleKmBundleUPMKReview("reject")}>
                  <XCircle size={12} /> Kembalikan Bundle UPMK
                </button>
              </div>
            </div>
          )}
          {kmBundleUPMK.status === "approved" && (
            <div
              className="card-body"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-success)",
              }}>
              ✓ Bundle KM UPMK tahun ini telah disahkan oleh General Manager.
            </div>
          )}
        </FoldCard>
      )}

      {/* Review Realisasi Kinerja Bulanan — hanya untuk Asman ke atas */}
      {canReview && (
        <FoldCard
          id="card-realisasi"
          highlight={highlight === "real"}
          accent="var(--color-info)"
          icon={<ClipboardCheck size={16} />}
          title="Realisasi Kinerja Bulanan Menunggu Review"
          right={
            <span
              className="status-pill"
              style={{
                background: "var(--color-info-tint)",
                color: "var(--color-info)",
                fontWeight: "bold",
              }}>
              {realList.length} Realisasi
            </span>
          }>
          {realList.length === 0 ? (
            <div className="card-body">
              <EmptyState
                title="Tidak ada realisasi"
                message="Belum ada realisasi kinerja yang menunggu review Anda."
              />
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Bidang</th>
                      <th>Pengirim</th>
                      <th>Indikator</th>
                      <th>Jenjang Persetujuan</th>
                      <th>SLA</th>
                      <th>Tanggal</th>
                      <th style={{ width: 260 }}>Tindakan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realList.map((rl) => {
                      const entries = Object.values(rl.values ?? {});
                      const rr = rl as RealisasiKinerja & {
                        steps?: { label: string }[];
                        currentStepIndex?: number;
                        stepLabel?: string;
                      };
                      const steps = rr.steps ?? [];
                      const ci = rr.currentStepIndex ?? 0;
                      const stepCount = steps.length;
                      const isLastStep = ci >= stepCount - 1;
                      const prevLabel = steps[ci - 1]?.label;
                      return (
                        <Fragment key={rl.id}>
                          <tr>
                            <td style={{ fontWeight: 600 }}>
                              {UNIT_NAMES[rl.unitCode] ?? rl.unitCode}
                            </td>
                            <td
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-muted)",
                              }}>
                              {(rl as RealisasiKinerja & { bidang?: string })
                                .bidang ?? "—"}
                            </td>
                            <td style={{ color: "var(--color-text-muted)" }}>
                              {rl.submitter}
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-md"
                                onClick={() =>
                                  setRealExpanded(
                                    realExpanded === rl.id ? null : rl.id,
                                  )
                                }>
                                {entries.length} indikator{" "}
                                <ChevronDown
                                  size={12}
                                  style={{
                                    transform:
                                      realExpanded === rl.id
                                        ? "rotate(180deg)"
                                        : "none",
                                    transition: "transform .2s",
                                  }}
                                />
                              </button>
                            </td>
                            <td style={{ minWidth: 200 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  marginBottom: 3,
                                }}>
                                {steps.map((_, idx) => (
                                  <div
                                    key={idx}
                                    title={steps[idx]?.label}
                                    style={{
                                      width: 16,
                                      height: 16,
                                      borderRadius: "50%",
                                      fontSize: 8,
                                      fontWeight: 700,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      background:
                                        idx < ci
                                          ? "var(--color-success)"
                                          : idx === ci
                                            ? "var(--color-info)"
                                            : "var(--color-surface-2)",
                                      color:
                                        idx <= ci
                                          ? "#fff"
                                          : "var(--color-text-muted)",
                                    }}>
                                    {idx < ci ? "✓" : idx + 1}
                                  </div>
                                ))}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--color-info)",
                                  fontWeight: 600,
                                }}>
                                Langkah {ci}/{stepCount - 1}:{" "}
                                {rr.stepLabel ?? steps[ci]?.label ?? "—"}
                              </div>
                            </td>
                            <td>
                              <SlaBadge
                                days={
                                  (
                                    rl as RealisasiKinerja & {
                                      slaRemainingDays?: number;
                                    }
                                  ).slaRemainingDays
                                }
                              />
                            </td>
                            <td
                              style={{
                                color: "var(--color-text-muted)",
                                whiteSpace: "nowrap",
                              }}>
                              {new Date(rl.submittedAt).toLocaleDateString(
                                "id-ID",
                                { day: "2-digit", month: "short" },
                              )}
                            </td>
                            <td>
                              {realTarget === rl.id ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "var(--space-2)",
                                  }}>
                                  <textarea
                                    className="form-textarea"
                                    style={{
                                      fontSize: "var(--text-xs)",
                                      minHeight: 48,
                                    }}
                                    placeholder="Catatan/komentar (wajib untuk setiap keputusan)"
                                    value={realNote}
                                    onChange={(e) =>
                                      setRealNote(e.target.value)
                                    }
                                  />
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "var(--space-2)",
                                      flexWrap: "wrap",
                                    }}>
                                    <button
                                      className="btn btn-md"
                                      style={{
                                        background: "var(--color-success)",
                                        color: "#fff",
                                      }}
                                      disabled={realBusy}
                                      onClick={() =>
                                        handleRealReview(rl.id, "approve")
                                      }>
                                      <CheckCircle size={12} />{" "}
                                      {isLastStep
                                        ? "Setujui (Selesai → Bundle)"
                                        : "Setujui & Teruskan"}
                                    </button>
                                    <button
                                      className="btn btn-md"
                                      style={{
                                        background: "var(--color-danger)",
                                        color: "#fff",
                                      }}
                                      disabled={realBusy}
                                      onClick={() =>
                                        handleRealReview(
                                          rl.id,
                                          "reject",
                                          "konseptor",
                                        )
                                      }>
                                      <XCircle size={12} /> Kembalikan ke
                                      Konseptor
                                    </button>
                                    {ci >= 2 && (
                                      <button
                                        className="btn btn-md"
                                        style={{
                                          background: "var(--color-warning)",
                                          color: "#fff",
                                        }}
                                        disabled={realBusy}
                                        onClick={() =>
                                          handleRealReview(
                                            rl.id,
                                            "reject",
                                            "previous",
                                          )
                                        }>
                                        <XCircle size={12} /> Kembalikan ke{" "}
                                        {prevLabel ?? "langkah sebelumnya"}
                                      </button>
                                    )}
                                    <button
                                      className="btn btn-ghost btn-md"
                                      onClick={() => {
                                        setRealTarget(null);
                                        setRealNote("");
                                      }}>
                                      Batal
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "var(--space-2)",
                                    flexWrap: "wrap",
                                  }}>
                                  <button
                                    className="btn btn-secondary btn-md"
                                    onClick={() => {
                                      setRealTarget(rl.id);
                                      setRealNote("");
                                    }}>
                                    <Clock size={12} /> Tinjau
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-md"
                                    onClick={() => startEditReal(rl)}
                                    title="Edit nilai realisasi pada tahap Anda">
                                    <Pencil size={12} /> Edit Nilai
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {realExpanded === rl.id && (
                            <tr>
                              <td
                                colSpan={8}
                                style={{
                                  background: "var(--color-surface-2)",
                                  padding: 0,
                                }}>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                    gap: "var(--space-2)",
                                    padding: "var(--space-2) var(--space-3)",
                                  }}>
                                  {realEditId === rl.id ? (
                                    <>
                                      <button
                                        className="btn btn-md"
                                        style={{
                                          background: "var(--color-success)",
                                          color: "#fff",
                                        }}
                                        disabled={realBusy}
                                        onClick={() => saveEditReal(rl)}>
                                        <CheckCircle size={12} /> Simpan Nilai
                                      </button>
                                      <button
                                        className="btn btn-ghost btn-md"
                                        onClick={() => setRealEditId(null)}>
                                        Batal Edit
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-secondary btn-md"
                                      onClick={() => startEditReal(rl)}
                                      title="Edit nilai realisasi pada tahap Anda">
                                      <Pencil size={12} /> Edit Nilai
                                    </button>
                                  )}
                                </div>
                                <table
                                  className="data-table compact"
                                  style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>No</th>
                                      <th>Indikator</th>
                                      <th>Satuan</th>
                                      <th className="num">Bobot</th>
                                      <th className="num">Target</th>
                                      <th className="num">Realisasi</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(rl.values ?? {}).map(
                                      ([key, vRaw], idx) => {
                                        const it = vRaw as {
                                          indikator?: string;
                                          satuan?: string;
                                          bobot?: unknown;
                                          target?: unknown;
                                          realisasi?: unknown;
                                        };
                                        const editing = realEditId === rl.id;
                                        return (
                                          <tr key={key}>
                                            <td>{idx + 1}</td>
                                            <td>{it.indikator ?? "—"}</td>
                                            <td>{it.satuan ?? "—"}</td>
                                            <td className="num">
                                              {String(it.bobot ?? "—")}
                                            </td>
                                            <td className="num">
                                              {String(it.target ?? "—")}
                                            </td>
                                            <td
                                              className="num"
                                              style={{ fontWeight: 700 }}>
                                              {editing ? (
                                                <input
                                                  type="text"
                                                  className="form-input form-input-sm"
                                                  style={{
                                                    width: 90,
                                                    textAlign: "right",
                                                  }}
                                                  value={editValues[key] ?? ""}
                                                  onChange={(e) =>
                                                    setEditValues((v) => ({
                                                      ...v,
                                                      [key]: e.target.value,
                                                    }))
                                                  }
                                                />
                                              ) : (
                                                String(it.realisasi ?? "—")
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      },
                                    )}
                                  </tbody>
                                </table>
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
        </FoldCard>
      )}

      {/* Bundle Konsolidasi Realisasi — persetujuan akhir GM (sekali untuk seluruh periode) */}
      {canReview && bundle && (
        <FoldCard
          id="card-real-bundle"
          highlight={highlight === "realbundle"}
          accent="var(--color-brand, #125D72)"
          icon={<Layers size={16} />}
          title={`Konsolidasi Realisasi Periode${bundle.period?.label ? " — " + bundle.period.label : ""}`}
          right={
            <span className="status-pill" style={{ fontWeight: 700 }}>
              {bundle.readyCount}/{bundle.total} siap
            </span>
          }>
          <div
            className="table-wrap"
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Bidang</th>
                    <th>Penyusun</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.components.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState
                          title="Belum ada realisasi"
                          message="Belum ada realisasi yang masuk konsolidasi periode ini."
                        />
                      </td>
                    </tr>
                  )}
                  {/* KP — flat per bidang */}
                  {bundle.components
                    .filter((c) => c.unitCode === "KP")
                    .map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>
                          {UNIT_NAMES[c.unitCode] ?? c.unitCode}
                        </td>
                        <td
                          style={{
                            fontSize: 11,
                            color: "var(--color-text-muted)",
                          }}>
                          {c.bidang}
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {c.submitter}
                        </td>
                        <td>
                          <span
                            className={`status-pill ${c.status === "approved" ? "completed" : c.status === "ready" ? "at-risk" : "in-review"}`}
                            style={{ fontSize: 10 }}>
                            {c.status === "ready"
                              ? "Siap (lolos SM RPC)"
                              : c.status === "approved"
                                ? "Disetujui GM"
                                : c.status === "submitted"
                                  ? "Dalam proses review"
                                  : c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  {/* UPMK — satu baris grup per unit, expand ke sub-rows per bidang (urut BIDANG_ORDER) */}
                  {Object.entries(
                    bundle.components
                      .filter((c) => c.unitCode !== "KP")
                      .reduce<Record<string, typeof bundle.components>>(
                        (acc, c) => {
                          (acc[c.unitCode] ??= []).push(c);
                          return acc;
                        },
                        {},
                      ),
                  )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([unitCode, items]) => {
                      const allApproved = items.every(
                        (c) => c.status === "approved",
                      );
                      const allReady = items.every(
                        (c) => c.status === "ready" || c.status === "approved",
                      );
                      const anySubmitted = items.some(
                        (c) => c.status === "submitted",
                      );
                      const readyCount = items.filter(
                        (c) => c.status === "ready" || c.status === "approved",
                      ).length;
                      const isOpen = upmkRealGroupExpanded === unitCode;
                      const aggrLabel = allApproved
                        ? "Disetujui GM"
                        : allReady
                          ? "Siap"
                          : anySubmitted
                            ? "Dalam review"
                            : `${readyCount}/${items.length} siap`;
                      const aggrCls = allApproved
                        ? "completed"
                        : allReady
                          ? "at-risk"
                          : anySubmitted
                            ? "in-review"
                            : "";
                      return (
                        <Fragment key={unitCode}>
                          <tr style={{ background: "var(--color-surface-1)" }}>
                            <td colSpan={2} style={{ fontWeight: 700 }}>
                              <button
                                className="btn btn-ghost btn-md"
                                style={{ gap: "var(--space-1)" }}
                                onClick={() =>
                                  setUpmkRealGroupExpanded(
                                    isOpen ? null : unitCode,
                                  )
                                }>
                                <ChevronDown
                                  size={12}
                                  style={{
                                    transform: isOpen
                                      ? "rotate(180deg)"
                                      : "none",
                                    transition: "transform .2s",
                                    flexShrink: 0,
                                  }}
                                />
                                {UNIT_NAMES[unitCode] ?? unitCode}
                              </button>
                            </td>
                            <td
                              style={{
                                color: "var(--color-text-muted)",
                                fontSize: 11,
                              }}>
                              {items.length} bidang
                            </td>
                            <td>
                              <span
                                className={`status-pill ${aggrCls}`}
                                style={{ fontSize: 10 }}>
                                {aggrLabel}
                              </span>
                            </td>
                          </tr>
                          {isOpen &&
                            sortByBidang(items).map((c) => (
                              <tr
                                key={c.id}
                                style={{
                                  background: "var(--color-surface-2)",
                                }}>
                                <td style={{ paddingLeft: "var(--space-5)" }} />
                                <td
                                  style={{
                                    fontSize: 11,
                                    color: "var(--color-text-muted)",
                                  }}>
                                  {c.bidang}
                                </td>
                                <td
                                  style={{
                                    color: "var(--color-text-muted)",
                                    fontSize: 11,
                                  }}>
                                  {c.submitter}
                                </td>
                                <td>
                                  <span
                                    className={`status-pill ${c.status === "approved" ? "completed" : c.status === "ready" ? "at-risk" : "in-review"}`}
                                    style={{ fontSize: 10 }}>
                                    {c.status === "ready"
                                      ? "Siap"
                                      : c.status === "approved"
                                        ? "Disetujui GM"
                                        : "Dalam review"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          {user?.role === "GM" && bundle.components.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "var(--space-1) var(--space-3)",
              }}>
              <button
                className="btn btn-ghost btn-md"
                onClick={handlePrintRealBundle}
                title="Cetak / Print Preview Konsolidasi Realisasi">
                <Printer size={12} /> Cetak Preview
              </button>
            </div>
          )}
          {user?.role === "GM" && bundle.status !== "approved" && (
            <div
              className="card-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                padding: "0 var(--space-7) var(--space-7)",
              }}>
              {!bundle.canApprove && bundle.total > 0 && (
                <div
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--color-warning)",
                  }}>
                  Belum semua komponen "siap" — GM dapat menyetujui setelah
                  seluruh realisasi lolos hingga SM Perencanaan & PC.
                </div>
              )}
              <textarea
                className="form-textarea"
                style={{ fontSize: "var(--text-sm)", minHeight: 48 }}
                placeholder="Catatan persetujuan/penolakan bundle (wajib)"
                value={bundleNote}
                onChange={(e) => setBundleNote(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-success)", color: "#fff" }}
                  disabled={bundleBusy || !bundle.canApprove}
                  onClick={() => handleBundleReview("approve")}>
                  <CheckCircle size={12} /> Setujui Seluruh Bundle (Final)
                </button>
                <button
                  className="btn btn-md"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                  disabled={bundleBusy || bundle.total === 0}
                  onClick={() => handleBundleReview("reject")}>
                  <XCircle size={12} /> Kembalikan Seluruh Bundle
                </button>
              </div>
            </div>
          )}
          {bundle.status === "approved" && (
            <div
              className="card-body"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-success)",
              }}>
              ✓ Bundle periode ini telah disetujui penuh oleh General Manager.
            </div>
          )}
        </FoldCard>
      )}

      {/* Workflow Timeline Card */}
      <FoldCard
        icon={<CalendarClock size={16} />}
        title="Timeline Pelaporan Bulanan"
        right={<span className="card-meta">5 Fase siklus bulanan</span>}
        defaultOpen={false}>
        <div
          className="card-body"
          style={{ padding: "var(--space-4) var(--space-7) var(--space-7)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              marginBottom: "var(--space-5)",
              overflowX: "auto",
              paddingBottom: 4,
            }}>
            {WORKFLOW_STATIC.map((w, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flex: 1,
                  minWidth: 0,
                }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flex: 1,
                    minWidth: 80,
                  }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: FASE_ACCENT[i],
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 12,
                      flexShrink: 0,
                    }}>
                    {w.stage}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: FASE_ACCENT[i],
                      marginTop: 6,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}>
                    {w.fase}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}>
                    {w.deadline}
                  </div>
                </div>
                {i < WORKFLOW_STATIC.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: `linear-gradient(to right, ${FASE_ACCENT[i]}, ${FASE_ACCENT[i + 1]})`,
                      minWidth: 16,
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="three-col-grid" style={{ marginBottom: 0 }}>
            {WORKFLOW_STATIC.map((w, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--color-border)",
                  borderTop: `3px solid ${FASE_ACCENT[i]}`,
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-3) var(--space-4)",
                  background: "var(--color-surface)",
                }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "var(--space-2)",
                  }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: FASE_ACCENT[i],
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}>
                    {w.fase} · {w.deadline}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      background: "var(--color-surface-2)",
                      color: "var(--color-text-muted)",
                      padding: "1px 7px",
                      borderRadius: 8,
                    }}>
                    SLA {w.slaHours}j
                  </span>
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "var(--text-sm)",
                    marginBottom: "var(--space-1)",
                  }}>
                  {w.action}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-accent)",
                    marginBottom: "var(--space-2)",
                  }}>
                  {STAGES[w.stage]}
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 14,
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    lineHeight: 1.75,
                  }}>
                  {w.checklist.map((c, ci) => (
                    <li key={ci}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </FoldCard>

      {/* Semua Dokumen Persetujuan — data nyata dari dokumen yang diinput */}
      <FoldCard
        icon={<FileText size={16} />}
        title="Semua Dokumen Persetujuan"
        right={
          <span className="card-meta">
            {docRows.length} dokumen · KM + Realisasi
          </span>
        }>
        <div className="table-wrap" style={{ paddingBottom: "var(--space-7)" }}>
          <div className="table-scroll">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Jenis Dokumen</th>
                  <th>Periode</th>
                  <th>Jenjang</th>
                  <th>Status</th>
                  <th>Menunggu Review</th>
                  <th>Komentar</th>
                </tr>
              </thead>
              <tbody>
                {docRows.map((d) => (
                  <Fragment key={d.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>
                        {UNIT_NAMES[d.unitCode] ?? d.unitCode}
                      </td>
                      <td>
                        {d.jenis}
                        {d.detail ? (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            {" "}
                            · {d.detail}
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          color: "var(--color-text-muted)",
                          whiteSpace: "nowrap",
                        }}>
                        {periodMap[d.periodId] ?? "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {d.status === "approved" ? (
                          <span
                            style={{
                              fontSize: 14,
                              color: "var(--color-success)",
                              fontWeight: 600,
                            }}>
                            ✓ Selesai ({d.stepCount}/{d.stepCount})
                          </span>
                        ) : d.status === "ready" ? (
                          <span
                            style={{
                              fontSize: 14,
                              color: "var(--color-warning)",
                              fontWeight: 600,
                            }}>
                            Lolos rantai → bundle
                          </span>
                        ) : d.status === "rejected" ? (
                          <span
                            style={{
                              fontSize: 14,
                              color: "var(--color-danger)",
                            }}>
                            Dikembalikan
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 14,
                              color: "var(--color-accent)",
                              fontWeight: 600,
                            }}>
                            Langkah {d.stepIndex}/{Math.max(0, d.stepCount - 1)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${DOC_STATUS_PILL[d.status] ?? "in-review"}`}
                         >
                          {DOC_STATUS_LABEL[d.status] ?? d.status}
                        </span>
                      </td>
                      <td
                        style={{
                          color:
                            d.status === "approved"
                              ? "var(--color-success)"
                              : "var(--color-text-muted)",
                          fontSize: 14,
                          fontWeight: 500,
                        }}>
                        {nextApproverLabel(d.status, d.stepLabel)}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-md"
                          onClick={() =>
                            setDocExpanded(docExpanded === d.id ? null : d.id)
                          }
                          title="Lihat riwayat persetujuan & komentar">
                          <MessageSquare size={12} />{" "}
                          {Array.isArray(d.history)
                            ? (d.history as unknown[]).length
                            : 0}
                          <ChevronDown
                            size={12}
                            style={{
                              transform:
                                docExpanded === d.id
                                  ? "rotate(180deg)"
                                  : "none",
                              transition: "transform .2s",
                            }}
                          />
                        </button>
                      </td>
                    </tr>
                    {docExpanded === d.id && (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            background: "var(--color-surface-2)",
                            padding: 0,
                          }}>
                          <ApprovalTimeline history={d.history} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {docRows.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        title="Belum ada dokumen"
                        message="Belum ada Kontrak Manajemen atau Realisasi yang diinput."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </FoldCard>

      {/* RACI Matrix — dinamis per role */}
      {(() => {
        const myCol = getUserRaciCol(user);
        return (
          <FoldCard
            icon={<UsersRound size={16} />}
            title="Matriks RACI"
            right={
              <span className="card-meta">
                R=Responsible · A=Accountable · C=Consulted · I=Informed
              </span>
            }
            defaultOpen={false}>
            {myCol && (
              <div
                style={{
                  margin: "var(--space-4) var(--space-4) 0",
                  padding: "var(--space-3) var(--space-4)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-accent-tint)",
                  borderLeft: "4px solid var(--color-accent)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--color-accent)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}>
                  Peran Anda dalam Workflow
                </div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
                  {RACI_COL_LABEL[myCol]}
                </div>
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-muted)",
                  }}>
                  {RACI_COL_TANGGUNG[myCol]}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--color-text-subtle)",
                    marginTop: 2,
                  }}>
                  Kolom yang disorot (🔵) pada tabel di bawah menunjukkan posisi
                  Anda dalam matriks.
                </div>
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: "var(--space-3)",
                flexWrap: "wrap",
                padding: "var(--space-3) var(--space-4)",
                fontSize: 10,
              }}>
              {[
                [
                  "R",
                  "var(--color-accent-tint)",
                  "var(--color-accent)",
                  "Responsible — pelaksana utama",
                ],
                [
                  "A",
                  "rgba(16,185,129,0.12)",
                  "var(--color-success)",
                  "Accountable — pemegang tanggung jawab akhir",
                ],
                [
                  "C",
                  "rgba(59,130,246,0.12)",
                  "var(--color-info)",
                  "Consulted — diminta masukan/persetujuan",
                ],
                [
                  "I",
                  "var(--color-surface-2)",
                  "var(--color-text-subtle)",
                  "Informed — diinformasikan",
                ],
                [
                  "—",
                  "var(--color-surface-2)",
                  "var(--color-text-subtle)",
                  "Tidak terlibat pada alur ini",
                ],
              ].map(([lbl, bg, clr, desc]) => (
                <div
                  key={lbl}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 22,
                      height: 18,
                      borderRadius: 3,
                      lineHeight: "18px",
                      textAlign: "center",
                      fontWeight: 700,
                      background: bg as string,
                      color: clr as string,
                      fontSize: 10,
                    }}>
                    {lbl}
                  </span>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="table-wrap"
              style={{ paddingBottom: "var(--space-2)" }}>
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220 }}>Aktivitas</th>
                      <th
                        style={{
                          fontSize: 9,
                          color: "var(--color-text-muted)",
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                          textAlign: "center",
                        }}>
                        Ruang Lingkup
                      </th>
                      {RACI_COLS.map((col) => (
                        <th
                          key={col.key}
                          style={{
                            textAlign: "center",
                            minWidth: 110,
                            background:
                              myCol === col.key
                                ? "var(--color-accent-tint)"
                                : undefined,
                            color:
                              myCol === col.key
                                ? "var(--color-accent)"
                                : undefined,
                            borderBottom:
                              myCol === col.key
                                ? "2px solid var(--color-accent)"
                                : undefined,
                          }}>
                          <div style={{ fontWeight: 700, fontSize: 11 }}>
                            {myCol === col.key ? "🔵 " : ""}
                            {col.label}
                          </div>
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 400,
                              color:
                                myCol === col.key
                                  ? "var(--color-accent)"
                                  : "var(--color-text-subtle)",
                              marginTop: 2,
                              whiteSpace: "normal",
                              lineHeight: 1.3,
                            }}>
                            {col.sublabel}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RACI_ROWS.map((row, i) => (
                      <tr key={i}>
                        <td
                          style={{
                            fontWeight: 500,
                            fontSize: "var(--text-xs)",
                          }}>
                          {row.activity}
                        </td>
                        <td
                          style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              fontSize: 9,
                              background: "var(--color-surface-2)",
                              color: "var(--color-text-muted)",
                              padding: "1px 6px",
                              borderRadius: 8,
                            }}>
                            {row.scope}
                          </span>
                        </td>
                        {RACI_COLS.map((col) => {
                          const v = row.values[col.key];
                          const isMyCol = myCol === col.key;
                          return (
                            <td
                              key={col.key}
                              style={{
                                textAlign: "center",
                                background: isMyCol
                                  ? "rgba(var(--color-accent-rgb, 14,116,144),0.04)"
                                  : undefined,
                              }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  minWidth: 32,
                                  height: 22,
                                  borderRadius: 4,
                                  fontSize: "var(--text-xs)",
                                  fontWeight: 700,
                                  outline:
                                    isMyCol && v !== "—"
                                      ? "2px solid var(--color-accent)"
                                      : undefined,
                                  outlineOffset: 1,
                                  ...RACI_VALUE_STYLE(v),
                                }}>
                                {v}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div
              style={{
                padding: "var(--space-3) var(--space-4)",
                fontSize: 10,
                color: "var(--color-text-subtle)",
                borderTop: "1px solid var(--color-border)",
                lineHeight: 1.7,
              }}>
              <strong style={{ color: "var(--color-text-muted)" }}>
                Catatan alur:
              </strong>{" "}
              Dokumen dari <strong>UPMK</strong> melewati review internal (ASMAN
              + MUP) sebelum masuk rantai Kantor Induk. Dokumen dari{" "}
              <strong>Kantor Induk</strong> langsung ke rantai bidang KI. Semua
              dokumen (kecuali bidang RPC sendiri) wajib melalui{" "}
              <strong>konsolidasi RPC</strong> sebelum masuk bundle GM. GM
              menyetujui <strong>sekali untuk seluruh dokumen</strong> dalam
              satu bundle (KM: tahunan; Realisasi: per periode).
            </div>
          </FoldCard>
        );
      })()}
    </div>
  );
}
