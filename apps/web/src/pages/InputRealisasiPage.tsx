import { useEffect, useRef, useState, Fragment } from "react";
import {
  inputRealisasi,
  inputKontrak,
  meta,
  periodTarget,
  type PeriodTarget,
  type RevisionLogEntry,
} from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  ClipboardEdit,
  CheckCircle,
  Clock,
  Trash2,
  Paperclip,
  Upload,
  X,
  History,
} from "lucide-react";
import { SkeletonTable, EmptyState, ErrorState } from "../components/LoadState";
import ReviewerPickerModal from "../components/ReviewerPickerModal";
import type { KontrakManajemen, Period } from "../lib/types";

const CURRENT_YEAR = new Date().getFullYear();
const RPC_BIDANG = "Perencanaan & Project Control";
const BIDANG_SORT: Record<string, number> = {
  "Operasi Manajemen Proyek": 0,
  "QA/QC": 1,
  "Keuangan, Komunikasi & Umum": 2,
  "Perencanaan & Project Control": 3,
  MRO: 4,
  K3L: 5,
  // Bagian internal UPMK (taksonomi terpisah dari bidang Kantor Induk di atas)
  "Bagian Pembangkit": 0,
  "Bagian Jaringan": 1,
  "Bagian KKU": 2,
  "Bagian K3L": 3,
};

// Sub-indikator KPI komposit (opt-in, generik) — lihat kpi-master.service.ts SubIndicatorInput.
// Definisi target/bobot dari dokumen KM; `realisasi` diisi di sini saat submit.
type SubIndicatorItem = {
  nama: string;
  satuan?: string;
  bobot: string;
  target: string;
  target2?: string;
  realisasi?: number | string;
  formula?: string;
  polaritas?: "positive" | "negative";
};

type KpiItem = {
  no?: number;
  indikator?: string;
  formula?: string;
  satuan?: string;
  bobot?: number | string;
  target?: number | string;
  target2?: number | string;
  bidang?: string;
  realisasi?: number | string;
  masterKpiId?: string; // tautan ke KpiAssignment untuk resolusi living target (KM Sementara)
  subIndicators?: SubIndicatorItem[]; // non-kosong = item ini "komposit" — realisasi diisi per-sub
  polaritas?: "positive" | "negative";
};

// Saran Pencapaian (%) murni tampilan — mirror ringkas resolvePolarity+computeCapaian backend
// (common/capaian.ts), TAK perlu presisi identik krn nilainya cuma saran (capaianSaran), tak
// pernah dibaca skoring. Target2 (target tahun) dipakai bila ada, else target Sem I.
const suggestCapaian = (
  targetRaw: unknown,
  target2Raw: unknown,
  actualRaw: unknown,
  satuan: string,
  polaritas?: string,
): string => {
  const clean = (v: unknown) =>
    parseFloat(
      String(v ?? "")
        .replace(",", ".")
        .replace(/[^0-9.-]/g, ""),
    );
  const t = clean(target2Raw) || clean(targetRaw);
  const a = clean(actualRaw);
  if (!Number.isFinite(t) || !Number.isFinite(a) || t <= 0 || a <= 0) return "";
  const isInverse =
    polaritas === "negative"
      ? true
      : polaritas === "positive"
        ? false
        : satuan.trim().toLowerCase() === "hari kerja";
  const pct = isInverse ? (t / a) * 100 : (a / t) * 100;
  return String(Math.round(Math.min(pct, 110) * 100) / 100);
};

// Fase 5: RevisionLog field='values' menyimpan seluruh blob values lama/baru — tampilkan
// hanya baris realisasi yang benar-benar berubah (bukan seluruh objek mentah).
function RealisasiDiff({
  oldValue,
  newValue,
}: {
  oldValue: unknown;
  newValue: unknown;
}) {
  const oldItems = (oldValue ?? {}) as Record<
    string,
    { indikator?: string; realisasi?: unknown }
  >;
  const newItems = (newValue ?? {}) as Record<
    string,
    { indikator?: string; realisasi?: unknown }
  >;
  const changed = Object.keys(newItems).filter(
    (k) =>
      String(oldItems[k]?.realisasi ?? "") !==
      String(newItems[k]?.realisasi ?? ""),
  );
  if (changed.length === 0)
    return (
      <span style={{ color: "var(--color-text-muted)" }}>
        Nilai realisasi diperbarui.
      </span>
    );
  return (
    <div>
      {changed.map((k) => (
        <div key={k}>
          {newItems[k]?.indikator ?? k}:{" "}
          <b>{String(oldItems[k]?.realisasi ?? "—")}</b> →{" "}
          <b>{String(newItems[k]?.realisasi ?? "—")}</b>
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Menunggu Review",
  ready: "Siap Konsolidasi (GM)",
  approved: "Disetujui",
  rejected: "Dikembalikan",
  target_fix: "Menunggu Koreksi Target (PIC REN)",
};
const STATUS_PILL: Record<string, string> = {
  draft: "in-review",
  submitted: "needs-revision",
  ready: "at-risk",
  approved: "completed",
  rejected: "delayed",
  target_fix: "needs-revision",
};
// Status yang berarti package sudah terkirim & sedang berjalan di alur — PIC tidak perlu
// (dan tidak boleh) input ulang sampai package kembali ke dirinya (status 'rejected').
const IN_FLIGHT_STATUSES = ["submitted", "ready", "approved", "target_fix"];

// Riwayat Keputusan Saya — dokumen yang pernah diberi keputusan oleh reviewer yang sedang login
// (lihat InputRealisasiService.getMyDecisions di backend).
type MyDecision = {
  id: string;
  unitCode: string;
  bidang: string;
  periodLabel: string;
  status: string;
  myActions: Array<{
    action: string;
    note?: string;
    ts: string;
    stepIndex: number;
  }>;
};
const DECISION_ACTION_LABEL: Record<string, string> = {
  approved: "Disetujui",
  returned: "Ditolak (ke konseptor)",
  returned_step: "Ditolak (ke langkah sebelumnya)",
  flagged_target: "Ditandai koreksi target",
};
const DECISION_ACTION_PILL: Record<string, string> = {
  approved: "completed",
  returned: "delayed",
  returned_step: "delayed",
  flagged_target: "needs-revision",
};

// Unit yang bisa mengisi realisasi: Kantor Induk + 5 UPMK
const UNIT_OPTIONS = [
  { code: "KP", name: "Kantor Induk" },
  { code: "UPMK1", name: "UPMK I" },
  { code: "UPMK2", name: "UPMK II" },
  { code: "UPMK3", name: "UPMK III" },
  { code: "UPMK4", name: "UPMK IV" },
  { code: "UPMK5", name: "UPMK V" },
];

export function InputRealisasiPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "STAFF";
  // Checker (ASMAN/Manajer) & Approver (SRManajer/GM) hanya memeriksa & menyetujui — input
  // realisasi murni tugas PIC Bidang (Staff). Halaman ini jadi tampilan referensi/riwayat
  // baginya, wording berubah jadi "Tinjauan Realisasi Bulanan" (aksi sungguhan di Persetujuan).
  const isReviewerRole =
    user?.role === "ASMAN" ||
    user?.role === "MANAJER" ||
    user?.role === "SRMANAJER" ||
    user?.role === "GM";
  const canInput = !isReviewerRole;
  // Hanya GM yang boleh pilih unit bebas untuk monitoring
  const canSelectUnit = user?.role === "GM";
  const lockedUnit = user?.unit ?? "KP";
  const [selectedUnit, setSelectedUnit] = useState<string>(lockedUnit);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [history, setHistory] = useState<unknown[]>([]);
  const [kpiList, setKpiList] = useState<KpiItem[]>([]);
  const [periodTargets, setPeriodTargets] = useState<PeriodTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // Saran Pencapaian (%) — diisi otomatis (suggestCapaian) saat Realisasi diketik, boleh ditimpa
  // manual staff. Murni informasional (capaianSaran), tidak pernah jadi skor resmi.
  const [capaianValues, setCapaianValues] = useState<Record<string, string>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Evidence (lampiran)
  const [evidOpen, setEvidOpen] = useState<string | null>(null);
  const [evidBusy, setEvidBusy] = useState(false);
  const evidInputRef = useRef<HTMLInputElement>(null);
  // Fase 5: timeline riwayat revisi (target + nilai realisasi) per package
  const [revOpen, setRevOpen] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<RevisionLogEntry[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  // Riwayat Keputusan Saya (reviewer): dokumen yang PERNAH diberi keputusan oleh user ini,
  // periode terpilih — sengaja tak dibatasi user.bidang (lihat catatan di getMyDecisions()
  // backend: reviewer seperti SM RPC memutuskan dokumen lintas-bidang lewat rantai konsolidasi).
  const [myDecisions, setMyDecisions] = useState<MyDecision[]>([]);

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
      alert(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Gagal mengunggah evidence",
      );
    } finally {
      setEvidBusy(false);
      if (evidInputRef.current) evidInputRef.current.value = "";
    }
  };
  const handleDeleteEvid = async (id: string, fileId: string) => {
    if (!confirm("Hapus berkas evidence ini?")) return;
    try {
      await inputRealisasi.deleteEvidence(id, fileId);
      await reloadHistory();
    } catch (e) {
      alert((e as Error)?.message ?? "Gagal menghapus");
    }
  };

  // Fase 5: buka/tutup timeline riwayat revisi (target + nilai realisasi) untuk satu package.
  const toggleRevisions = async (id: string) => {
    if (revOpen === id) {
      setRevOpen(null);
      return;
    }
    setRevOpen(id);
    setRevLoading(true);
    try {
      setRevisions(await inputRealisasi.revisions(id));
    } catch {
      setRevisions([]);
    } finally {
      setRevLoading(false);
    }
  };
  const fmtSize = (b: number) =>
    b > 1048576
      ? (b / 1048576).toFixed(1) + " MB"
      : Math.max(1, Math.round(b / 1024)) + " KB";

  // Default unit mengikuti unit user (bila ada). Bila tidak bisa pilih bebas, unit dikunci.
  useEffect(() => {
    if (user?.unit) setSelectedUnit(user.unit);
  }, [user?.unit]);

  // Muat daftar periode (Jan–Des) sekali; default ke periode aktif.
  useEffect(() => {
    meta
      .periods()
      .then((res) => {
        const list = (res as Period[]) ?? [];
        setPeriods(list);
        const active = list.find((p) => p.isActive) ?? list[0];
        if (active) setSelectedPeriodId(active.id);
        else setLoading(false); // tak ada periode → jangan nyangkut di skeleton
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedPeriodId) return;
    const loadData = async () => {
      try {
        // KM bersifat tahunan → acuan realisasi ditarik per TAHUN dari periode terpilih.
        // kmReference periode menentukan apakah KPI ditarik dari KM Draft atau KM Final.
        const periodObj = periods.find((p) => p.id === selectedPeriodId);
        const selectedYear = periodObj?.yearMonth?.slice(0, 4);
        const kmType = periodObj?.kmReference ?? "draft";
        const [histRes, kmRes, ptRes] = await Promise.allSettled([
          inputRealisasi.history(selectedUnit, selectedPeriodId),
          inputKontrak.forRealisasi(selectedUnit, selectedYear, kmType),
          periodTarget.list(selectedPeriodId),
        ]);
        if (histRes.status === "fulfilled")
          setHistory(histRes.value as unknown[]);
        // Living-target: KM Sementara per assignment periode ini (untuk package view).
        setPeriodTargets(ptRes.status === "fulfilled" ? ptRes.value : []);
        if (kmRes.status === "fulfilled") {
          // Acuan realisasi = KPI dari KM yang sudah DISUBMIT Staff RPC (KM Sementara berjalan
          // paralel dengan alur review-nya sendiri — bukan menunggu approval penuh).
          const kontrak = kmRes.value as KontrakManajemen[];
          let merged: KpiItem[] = kontrak.flatMap((k) =>
            (k.kpiItems as KpiItem[]).map((it) => ({
              ...it,
              bidang: k.bidang,
            })),
          );
          // Semua role kecuali GM hanya melihat KPI bidangnya sendiri.
          if (user?.bidang && user?.role !== "GM") {
            merged = merged.filter((it) => it.bidang === user.bidang);
          }
          merged = merged.sort(
            (a, b) =>
              (BIDANG_SORT[a.bidang ?? ""] ?? 99) -
              (BIDANG_SORT[b.bidang ?? ""] ?? 99),
          );
          setKpiList(merged);
          setValues({});
          setCapaianValues({});
        }
      } catch (e) {
        setError((e as Error)?.message ?? "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedUnit, selectedPeriodId, isStaff, user?.bidang]);

  // Riwayat Keputusan Saya — hanya reviewer, periode terpilih, TAK terikat selectedUnit/bidang
  // (lihat catatan di getMyDecisions() backend).
  useEffect(() => {
    if (!isReviewerRole || !selectedPeriodId) {
      setMyDecisions([]);
      return;
    }
    inputRealisasi
      .myDecisions(selectedPeriodId)
      .then((res) => setMyDecisions((res as MyDecision[]) ?? []))
      .catch(() => setMyDecisions([]));
  }, [isReviewerRole, selectedPeriodId]);

  // Submit membuka picker reviewer; pengiriman sebenarnya di handleConfirmSubmit.
  const handleSubmit = () => {
    if (!user) return;
    setPickerOpen(true);
  };

  const handleConfirmSubmit = async (
    checkerIds: string[],
    approverIds: string[],
  ) => {
    if (!user) return;
    setSubmitting(true);
    try {
      // Realisasi dipecah per bidang: kelompokkan baris KPI per bidang, kirim satu submit per bidang
      // dengan alur reviewer yang sama.
      const byBidang = new Map<string, Record<string, unknown>>();
      kpiList.forEach((kpi, i) => {
        const b = kpi.bidang ?? "";
        if (!byBidang.has(b)) byBidang.set(b, {});
        const bucket = byBidang.get(b)!;
        // Item komposit: realisasi diisi PER SUB-INDIKATOR (bukan satu angka induk) — nilai
        // induk digulung server-side dari sub (lihat common/capaian.ts scoreCompositeItem).
        if (kpi.subIndicators && kpi.subIndicators.length > 0) {
          bucket[`kpi_${i}`] = {
            ...kpi,
            subIndicators: kpi.subIndicators.map((si, j) => ({
              ...si,
              realisasi: values[`${i}.${j}`] ?? "",
              capaianSaran: capaianValues[`${i}.${j}`] ?? "",
            })),
          };
        } else {
          bucket[`kpi_${i}`] = {
            ...kpi,
            realisasi: values[String(i)] ?? "",
            capaianSaran: capaianValues[String(i)] ?? "",
          };
        }
      });
      for (const [bidang, payload] of byBidang) {
        await inputRealisasi.submit(
          selectedUnit,
          bidang,
          payload,
          checkerIds,
          approverIds,
          selectedPeriodId,
        );
      }
      setPickerOpen(false);
      setSubmitted(true);
      setValues({});
      setCapaianValues({});
      const hist = await inputRealisasi.history(selectedUnit, selectedPeriodId);
      setHistory(hist as unknown[]);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (e as Error)?.message ??
        "Gagal mengirim";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus realisasi ini? Tindakan ini tidak dapat dibatalkan."))
      return;
    try {
      await inputRealisasi.delete(id);
      const hist = await inputRealisasi.history(selectedUnit, selectedPeriodId);
      setHistory(hist as unknown[]);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (e as Error)?.message ??
        "Gagal menghapus";
      alert(msg);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Input Realisasi Bulanan</h1>
        </div>
        <SkeletonTable rows={6} cols={7} />
      </div>
    );
  }

  if (error && kpiList.length === 0)
    return <ErrorState title="Gagal memuat data" message={error} />;

  // Item komposit terisi bila SETIDAKNYA satu sub-indikatornya sudah diisi (konsisten dgn
  // longgarnya cek item biasa — belum wajib semua sub terisi untuk terhitung "disentuh").
  const isItemFilled = (kpi: KpiItem, i: number): boolean =>
    kpi.subIndicators && kpi.subIndicators.length > 0
      ? kpi.subIndicators.some(
          (_, j) => (values[`${i}.${j}`] ?? "").trim() !== "",
        )
      : (values[String(i)] ?? "").trim() !== "";
  const filledCount = kpiList.reduce(
    (n, kpi, i) => n + (isItemFilled(kpi, i) ? 1 : 0),
    0,
  );
  const completionPct =
    kpiList.length > 0 ? Math.round((filledCount / kpiList.length) * 100) : 0;
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);
  const selectedPeriodLabel = selectedPeriod?.label ?? "Tahun Berjalan";
  const fillWindow = selectedPeriod?.fillWindow;
  const windowOpen = fillWindow ? fillWindow.isOpen : true; // belum ada data window → jangan blokir UI
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  // Package bidang PIC sendiri yang sudah terkirim & sedang berjalan (bukan draft/rejected) —
  // form input ditutup selama ini berlangsung, cegah kirim ulang/menimpa yang sedang direview.
  const myActivePackage =
    isStaff && user?.bidang
      ? (history as Record<string, unknown>[]).find(
          (h) =>
            h.bidang === user.bidang &&
            IN_FLIGHT_STATUSES.includes(String(h.status ?? "")),
        )
      : undefined;
  const myActiveStatus = myActivePackage
    ? String(myActivePackage.status ?? "")
    : null;
  const formOpen = canInput && !myActivePackage;

  // Living-target: KM Sementara yang berlaku untuk satu KPI row (cocokkan masterKpiId + unit + bidang).
  const livingTargetFor = (kpi: KpiItem): PeriodTarget | undefined =>
    kpi.masterKpiId
      ? periodTargets.find(
          (pt) =>
            pt.assignment &&
            pt.assignment.kpiMasterId === kpi.masterKpiId &&
            pt.assignment.unitCode === selectedUnit &&
            pt.assignment.bidang === (kpi.bidang ?? ""),
        )
      : undefined;
  const anyLivingTarget = kpiList.some((k) => livingTargetFor(k));

  return (
    <div className="page input-realisasi-page">
      {/* Header Card */}
      <div
        className="card"
        style={{
          marginBottom: "var(--space-6)",
          borderLeft: "4px solid var(--color-accent)",
        }}>
        <div
          className="card-body"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "var(--radius-lg)",
              background: "var(--color-accent-tint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
            <ClipboardEdit size={24} color="var(--color-accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>
              {isReviewerRole
                ? "Tinjauan Realisasi Bulanan"
                : "Input Realisasi Bulanan"}{" "}
              — {selectedPeriodLabel}
            </div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text-muted)",
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                flexWrap: "wrap",
              }}>
              <span>Periode:</span>
              <select
                className="form-input form-input-sm"
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                style={{ width: "auto", minWidth: 130, fontWeight: 700 }}>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span>·</span>
              <span>Unit:</span>
              {canSelectUnit ? (
                <select
                  className="form-input form-input-sm"
                  value={selectedUnit}
                  onChange={(e) => setSelectedUnit(e.target.value)}
                  style={{ width: "auto", minWidth: 140, fontWeight: 700 }}>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.name} ({u.code})
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontWeight: 700, color: "var(--color-accent)" }}>
                  {UNIT_OPTIONS.find((u) => u.code === lockedUnit)?.name ??
                    lockedUnit}
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-subtle)",
                      marginLeft: 4,
                    }}>
                    (dikunci ke unit Anda)
                  </span>
                </span>
              )}
              <span>
                · {kpiList.length} indikator KM
                {isStaff && user?.bidang ? ` · Bidang: ${user.bidang}` : ""}
              </span>
              {fillWindow &&
                (windowOpen ? (
                  <span
                    className="status-pill at-risk"
                    style={{ fontSize: 12 }}>
                    {fillWindow.overrideActive
                      ? "Window dibuka manual oleh Admin/GM"
                      : `Window terbuka · tutup ${fmtDate(fillWindow.end)} (${fillWindow.daysUntilClose} hari lagi)`}
                  </span>
                ) : (
                  <span
                    className="status-pill delayed"
                    style={{ fontSize: 12 }}>
                    {fillWindow.daysUntilOpen > 0
                      ? `Window belum dibuka · mulai ${fmtDate(fillWindow.start)}`
                      : `Window pengisian telah ditutup ${fmtDate(fillWindow.end)}`}
                  </span>
                ))}
            </div>
          </div>
          {formOpen && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}>
                Progress Isi
              </div>
              <div
                style={{
                  fontSize: "var(--text-xl)",
                  fontWeight: 800,
                  color:
                    completionPct === 100
                      ? "var(--color-success)"
                      : "var(--color-accent)",
                }}>
                {completionPct}%
              </div>
              <div style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
                {filledCount}/{kpiList.length} terisi
              </div>
            </div>
          )}
        </div>
        {formOpen && (
          <div
            style={{
              height: 4,
              background: "var(--color-surface-2)",
              borderRadius: "0 0 var(--radius-lg) var(--radius-lg)",
              overflow: "hidden",
            }}>
            <div
              style={{
                height: "100%",
                width: `${completionPct}%`,
                background:
                  completionPct === 100
                    ? "var(--color-success)"
                    : "var(--color-accent)",
                transition: "width 0.3s",
              }}
            />
          </div>
        )}
      </div>

      {fillWindow && !windowOpen && (
        <div
          className="status-banner danger"
          style={{ marginBottom: "var(--space-4)" }}>
          <Clock size={18} />
          <strong>
            {fillWindow.daysUntilOpen > 0
              ? `Pengisian realisasi ${selectedPeriodLabel} belum dibuka. Window: ${fmtDate(fillWindow.start)} s.d. ${fmtDate(fillWindow.end)}.`
              : `Window pengisian realisasi ${selectedPeriodLabel} telah berakhir (${fmtDate(fillWindow.end)}). Kirim tidak dapat dilakukan.`}
          </strong>
        </div>
      )}

      {submitted && (
        <div
          className="status-banner success"
          style={{ marginBottom: "var(--space-4)" }}>
          <CheckCircle size={18} />
          <strong>Realisasi berhasil dikirim!</strong>
        </div>
      )}

      {canInput && myActivePackage && (
        <div
          className="status-banner"
          style={{
            marginBottom: "var(--space-4)",
            background: "var(--color-accent-tint)",
          }}>
          <CheckCircle size={18} color="var(--color-accent)" />
          <strong>
            Realisasi bidang Anda untuk {selectedPeriodLabel} sudah dikirim —
            status:{" "}
            <span
              className={`status-pill ${STATUS_PILL[myActiveStatus ?? ""] ?? "in-review"}`}
              style={{ fontSize: 12 }}>
              {STATUS_LABEL[myActiveStatus ?? ""] ?? myActiveStatus}
            </span>
            . Form input ditutup sampai package ini selesai direview atau
            dikembalikan.
          </strong>
        </div>
      )}

      {/* KPI Input Table */}
      <div className="card p-0" style={{ marginBottom: "var(--space-6)" }}>
        <div className="card-header compact">
          <div className="card-title">
            <ClipboardEdit size={14} />
            KPI Realisasi —{" "}
            {UNIT_OPTIONS.find((u) => u.code === selectedUnit)?.name ??
              selectedUnit}
          </div>
          <span className="card-meta">
            {!canInput ? (
              <>
                Referensi KPI {selectedPeriodLabel} — input hanya oleh PIC
                Bidang
              </>
            ) : myActivePackage ? (
              <>
                Realisasi {selectedPeriodLabel} sudah terkirim — menunggu proses
              </>
            ) : (
              <>Isi nilai realisasi {selectedPeriodLabel}</>
            )}{" "}
            · Acuan:{" "}
            <b>
              {selectedPeriod?.kmReference === "final"
                ? "KM Final"
                : "KM Draft"}
            </b>
          </span>
        </div>
        <div className="table-wrap">
          {kpiList.length === 0 ? (
            <EmptyState
              title="Belum ada KPI acuan"
              message="Belum ada KM Sementara yang disubmit Staff RPC untuk unit Anda. Setelah KPI di-assign & dokumen KM dikirim dari menu Manajemen KPI → Dokumen KM, KPI akan muncul di sini."
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
                  {anyLivingTarget && (
                    <th
                      className="num"
                      title="KM Sementara — target hidup bulan ini (bisa dikoreksi PIC REN sampai KM Final tiba)">
                      KM Sementara
                    </th>
                  )}
                  <th>Realisasi</th>
                  <th title="Dihitung otomatis dari target vs realisasi, boleh ditimpa — hanya saran, evaluasi resmi tetap di reviewer">
                    Pencapaian (saran)
                  </th>
                </tr>
              </thead>
              <tbody>
                {kpiList.map((kpi, i) => {
                  const isComposite =
                    !!kpi.subIndicators && kpi.subIndicators.length > 0;
                  const hasVal = isItemFilled(kpi, i);
                  const lt = livingTargetFor(kpi);
                  return (
                    <Fragment key={i}>
                      <tr
                        style={{
                          background: hasVal
                            ? "rgba(34,197,94,0.03)"
                            : "transparent",
                        }}>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {kpi.no ?? i + 1}
                        </td>
                        <td
                          style={{
                            fontSize: 13,
                            color: "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                          }}>
                          {kpi.bidang ?? "—"}
                        </td>
                        <td style={{ maxWidth: 220, fontWeight: 500 }}>
                          {kpi.indikator ?? "—"}
                          {isComposite && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                color: "var(--color-accent)",
                                border: "1px solid var(--color-accent)",
                                borderRadius: 4,
                                padding: "1px 4px",
                              }}
                              title="Komposit — isi realisasi per sub-indikator di bawah">
                              Komposit
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            fontSize: 12,
                            color: "var(--color-text-muted)",
                            maxWidth: 200,
                          }}>
                          {kpi.formula ?? "—"}
                        </td>
                        <td
                          style={{
                            color: "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                          }}>
                          {kpi.satuan ?? "—"}
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color: "var(--color-accent)",
                          }}>
                          {kpi.bobot ?? "—"}
                        </td>
                        <td className="num">
                          {isComposite ? "— (per sub)" : (kpi.target ?? "—")}
                        </td>
                        <td className="num">
                          {isComposite ? "— (per sub)" : (kpi.target2 ?? "—")}
                        </td>
                        {anyLivingTarget && (
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            {lt ? (
                              <>
                                <span style={{ fontWeight: 700 }}>
                                  {lt.frozen
                                    ? (lt.frozenTarget ?? lt.target)
                                    : lt.target}
                                </span>
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: "var(--color-accent)",
                                    border: "1px solid var(--color-accent)",
                                    borderRadius: 4,
                                    padding: "1px 4px",
                                  }}
                                  title="Komposit — isi realisasi per sub-indikator di bawah">
                                  Komposit
                                </span>
                              </>
                            ) : (
                              <span
                                style={{ color: "var(--color-text-subtle)" }}>
                                —
                              </span>
                            )}
                          </td>
                        )}
                        <td style={{ minWidth: 140 }}>
                          {formOpen ? (
                            isComposite ? (
                              <span
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                }}>
                                Isi di bawah ↓
                              </span>
                            ) : (
                              <input
                                type="text"
                                className="form-input form-input-sm"
                                style={{
                                  borderColor: hasVal
                                    ? "rgba(34,197,94,0.5)"
                                    : undefined,
                                }}
                                value={values[String(i)] ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setValues((v) => ({
                                    ...v,
                                    [String(i)]: val,
                                  }));
                                  setCapaianValues((c) => ({
                                    ...c,
                                    [String(i)]: suggestCapaian(
                                      kpi.target,
                                      kpi.target2,
                                      val,
                                      kpi.satuan ?? "",
                                      kpi.polaritas,
                                    ),
                                  }));
                                }}
                                placeholder={`Target: ${kpi.target ?? "—"}`}
                              />
                            )
                          ) : (
                            <span style={{ color: "var(--color-text-subtle)" }}>
                              —
                            </span>
                          )}
                        </td>
                        <td style={{ minWidth: 100 }}>
                          {formOpen ? (
                            isComposite ? (
                              <span
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                }}>
                                —
                              </span>
                            ) : (
                              <input
                                type="text"
                                className="form-input form-input-sm"
                                value={capaianValues[String(i)] ?? ""}
                                onChange={(e) =>
                                  setCapaianValues((c) => ({
                                    ...c,
                                    [String(i)]: e.target.value,
                                  }))
                                }
                                placeholder="%"
                              />
                            )
                          ) : (
                            <span style={{ color: "var(--color-text-subtle)" }}>
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                      {isComposite &&
                        kpi.subIndicators!.map((si, j) => {
                          const subVal = values[`${i}.${j}`] ?? "";
                          const subHasVal = subVal.trim() !== "";
                          return (
                            <tr
                              key={`${i}.${j}`}
                              style={{
                                background: subHasVal
                                  ? "rgba(34,197,94,0.03)"
                                  : "var(--color-surface-2)",
                              }}>
                              <td />
                              <td />
                              <td
                                style={{
                                  paddingLeft: "var(--space-4)",
                                  fontSize: 14,
                                  color: "var(--color-text-muted)",
                                }}>
                                ↳ {si.nama}
                              </td>
                              <td
                                style={{
                                  fontSize: 12,
                                  color: "var(--color-text-muted)",
                                  maxWidth: 200,
                                }}>
                                {si.formula ?? "—"}
                              </td>
                              <td
                                style={{
                                  color: "var(--color-text-muted)",
                                  whiteSpace: "nowrap",
                                }}>
                                {si.satuan ?? "—"}
                              </td>
                              <td className="num">{si.bobot}</td>
                              <td className="num">{si.target}</td>
                              <td className="num">{si.target2 ?? "—"}</td>
                              {anyLivingTarget && <td />}
                              <td style={{ minWidth: 140 }}>
                                {formOpen ? (
                                  <input
                                    type="text"
                                    className="form-input form-input-sm"
                                    style={{
                                      borderColor: subHasVal
                                        ? "rgba(34,197,94,0.5)"
                                        : undefined,
                                    }}
                                    value={subVal}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setValues((v) => ({
                                        ...v,
                                        [`${i}.${j}`]: val,
                                      }));
                                      setCapaianValues((c) => ({
                                        ...c,
                                        [`${i}.${j}`]: suggestCapaian(
                                          si.target,
                                          si.target2,
                                          val,
                                          si.satuan ?? "",
                                          si.polaritas,
                                        ),
                                      }));
                                    }}
                                    placeholder={`Target: ${si.target ?? "—"}`}
                                  />
                                ) : (
                                  <span
                                    style={{
                                      color: "var(--color-text-subtle)",
                                    }}>
                                    {subVal || "—"}
                                  </span>
                                )}
                              </td>
                              <td style={{ minWidth: 100 }}>
                                {formOpen ? (
                                  <input
                                    type="text"
                                    className="form-input form-input-sm"
                                    value={capaianValues[`${i}.${j}`] ?? ""}
                                    onChange={(e) =>
                                      setCapaianValues((c) => ({
                                        ...c,
                                        [`${i}.${j}`]: e.target.value,
                                      }))
                                    }
                                    placeholder="%"
                                  />
                                ) : (
                                  <span
                                    style={{
                                      color: "var(--color-text-subtle)",
                                    }}>
                                    {capaianValues[`${i}.${j}`] || "—"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {formOpen && kpiList.length > 0 && (
          <div
            className="card-footer"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--space-3)",
              alignItems: "center",
            }}>
            <span
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text-muted)",
              }}>
              {filledCount} dari {kpiList.length} indikator terisi
            </span>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || filledCount === 0 || !windowOpen}
              title={
                !windowOpen
                  ? "Window pengisian periode ini sedang tertutup"
                  : undefined
              }>
              {submitting ? "Mengirim…" : "Kirim Realisasi"}
            </button>
          </div>
        )}
      </div>

      {/* Submission History */}
      {history.length > 0 && (
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title">
              <Clock size={14} />
              Riwayat Submisi
            </div>
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
                  const status = String(item.status ?? "");
                  const itemSteps =
                    (item.steps as { label?: string }[] | undefined) ?? [];
                  const stepLabel =
                    itemSteps[Number(item.currentStepIndex ?? 0)]?.label;
                  const canDelete =
                    status !== "approved" &&
                    (item.submitterId === user?.id || user?.role === "GM");
                  const atts =
                    (item.attachments as
                      | Array<{ id: string; name: string; size: number }>
                      | undefined) ?? [];
                  const rid = item.id as string;
                  return (
                    <Fragment key={i}>
                      <tr>
                        <td style={{ fontWeight: 600 }}>
                          {(item.unitCode as string) ?? "—"}
                        </td>
                        <td
                          style={{
                            color: "var(--color-text-muted)",
                          }}>
                          {(item.bidang as string) ?? "—"}
                        </td>
                        <td>{(item.submitter as string) ?? "—"}</td>
                        <td>
                          <span
                            className={`status-pill ${STATUS_PILL[status] ?? "in-review"}`}
                            style={{ fontSize: 12 }}>
                            {STATUS_LABEL[status] ?? status}
                          </span>
                          {status === "submitted" && stepLabel && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                                marginTop: 2,
                              }}>
                              di {stepLabel}
                            </div>
                          )}
                          {status === "rejected" && item.reviewNote ? (
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--color-danger)",
                                marginTop: 2,
                                maxWidth: 240,
                              }}>
                              {item.reviewNote as string}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {item.submittedAt
                            ? new Date(
                                item.submittedAt as string,
                              ).toLocaleDateString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "center",
                            }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setEvidOpen(evidOpen === rid ? null : rid)
                              }
                              title="Lampiran evidence">
                              <Paperclip size={14} /> {atts.length}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => toggleRevisions(rid)}
                              title="Riwayat revisi (target & nilai realisasi)">
                              <History size={14} />
                            </button>
                            {canDelete && (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleDelete(rid)}
                                title="Hapus realisasi"
                                style={{ color: "var(--color-danger)" }}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {evidOpen === rid && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              background: "var(--color-surface-2)",
                              padding: "var(--space-3)",
                            }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                marginBottom: 6,
                              }}>
                              Evidence Realisasi
                            </div>
                            {atts.length === 0 ? (
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                  marginBottom: 6,
                                }}>
                                Belum ada berkas.
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 4,
                                  marginBottom: 8,
                                }}>
                                {atts.map((a) => (
                                  <div
                                    key={a.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      fontSize: 13,
                                    }}>
                                    <Paperclip
                                      size={12}
                                      style={{
                                        color: "var(--color-text-muted)",
                                      }}
                                    />
                                    <a
                                      href={inputRealisasi.evidenceUrl(
                                        rid,
                                        a.id,
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: "var(--color-accent)" }}>
                                      {a.name}
                                    </a>
                                    <span
                                      style={{
                                        color: "var(--color-text-subtle)",
                                      }}>
                                      ({fmtSize(a.size)})
                                    </span>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() =>
                                        handleDeleteEvid(rid, a.id)
                                      }
                                      title="Hapus berkas"
                                      style={{
                                        color: "var(--color-danger)",
                                        padding: "0 4px",
                                      }}>
                                      <X size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <input
                              ref={evidInputRef}
                              type="file"
                              multiple
                              accept=".pdf,.xls,.xlsx,.doc,.docx,.jpg,.jpeg,.png"
                              style={{ display: "none" }}
                              onChange={(e) =>
                                handleUploadEvid(rid, e.target.files)
                              }
                            />
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={evidBusy || atts.length >= 5}
                              onClick={() => evidInputRef.current?.click()}>
                              <Upload size={12} />{" "}
                              {evidBusy ? "Mengunggah…" : "Unggah Evidence"}
                            </button>
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                                marginLeft: 8,
                              }}>
                              Maks 5 berkas · ≤ 10 MB/berkas · PDF, Excel, Word,
                              JPG/PNG{" "}
                              {atts.length >= 5 ? "· (batas tercapai)" : ""}
                            </span>
                          </td>
                        </tr>
                      )}
                      {revOpen === rid && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              background: "var(--color-surface-2)",
                              padding: "var(--space-3)",
                            }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                marginBottom: 6,
                              }}>
                              Riwayat Revisi (Target & Nilai Realisasi)
                            </div>
                            {revLoading ? (
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                }}>
                                Memuat…
                              </div>
                            ) : revisions.length === 0 ? (
                              <div
                                style={{
                                  fontSize: 13,
                                  color: "var(--color-text-muted)",
                                }}>
                                Belum ada revisi tercatat untuk package ini.
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}>
                                {revisions.map((rv) => (
                                  <div
                                    key={rv.id}
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      fontSize: 13,
                                      alignItems: "flex-start",
                                      borderLeft: `2px solid ${rv.entity === "period_target" ? "var(--color-accent)" : "var(--color-warning)"}`,
                                      paddingLeft: 8,
                                    }}>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: "1px 5px",
                                        borderRadius: 4,
                                        whiteSpace: "nowrap",
                                        background:
                                          rv.entity === "period_target"
                                            ? "var(--color-accent-tint)"
                                            : "var(--color-warning-tint)",
                                        color:
                                          rv.entity === "period_target"
                                            ? "var(--color-accent)"
                                            : "var(--color-warning)",
                                      }}>
                                      {rv.entity === "period_target"
                                        ? "TARGET (PIC REN)"
                                        : "REALISASI (KI)"}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                      {rv.field === "target" ? (
                                        <span>
                                          Target:{" "}
                                          <b>{String(rv.oldValue ?? "—")}</b> →{" "}
                                          <b>{String(rv.newValue ?? "—")}</b>
                                        </span>
                                      ) : (
                                        <RealisasiDiff
                                          oldValue={rv.oldValue}
                                          newValue={rv.newValue}
                                        />
                                      )}
                                      <div
                                        style={{
                                          color: "var(--color-text-muted)",
                                          fontSize: 12,
                                          marginTop: 2,
                                        }}>
                                        {rv.actor} ·{" "}
                                        {new Date(rv.createdAt).toLocaleString(
                                          "id-ID",
                                          {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          },
                                        )}
                                        {rv.note && ` · "${rv.note}"`}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
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

      {/* Riwayat Keputusan Saya (reviewer) */}
      {isReviewerRole && (
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title">
              <History size={14} />
              Riwayat Keputusan Saya
            </div>
            <span className="card-meta">{myDecisions.length} dokumen</span>
          </div>
          {myDecisions.length === 0 ? (
            <div
              style={{
                padding: "var(--space-4)",
                color: "var(--color-text-muted)",
                textAlign: "center",
                fontSize: 14,
              }}>
              Belum ada keputusan Anda pada periode ini.
            </div>
          ) : (
            <div
              className="table-wrap"
              style={{ paddingBottom: "var(--space-7)" }}>
              <div className="table-scroll">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Bidang</th>
                      <th>Status Saat Ini</th>
                      <th>Aksi Anda</th>
                      <th>Catatan</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myDecisions.map((d) => (
                      <Fragment key={d.id}>
                        {d.myActions.map((a, i) => (
                          <tr key={`${d.id}-${i}`}>
                            {i === 0 && (
                              <>
                                <td
                                  style={{ fontWeight: 600 }}
                                  rowSpan={d.myActions.length}>
                                  {d.unitCode}
                                </td>
                                <td
                                  style={{
                                    color: "var(--color-text-muted)",
                                  }}
                                  rowSpan={d.myActions.length}>
                                  {d.bidang}
                                </td>
                                <td rowSpan={d.myActions.length}>
                                  <span
                                    className={`status-pill ${STATUS_PILL[d.status] ?? "in-review"}`}>
                                    {STATUS_LABEL[d.status] ?? d.status}
                                  </span>
                                </td>
                              </>
                            )}
                            <td>
                              <span
                                className={`status-pill ${DECISION_ACTION_PILL[a.action] ?? "in-review"}`}>
                                {DECISION_ACTION_LABEL[a.action] ?? a.action}
                              </span>
                            </td>
                            <td
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                                maxWidth: 260,
                              }}>
                              {a.note || "—"}
                            </td>
                            <td
                              style={{
                                fontSize: 12,
                                color: "var(--color-text-muted)",
                                whiteSpace: "nowrap",
                              }}>
                              {a.ts
                                ? new Date(a.ts).toLocaleDateString("id-ID", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <ReviewerPickerModal
        open={pickerOpen}
        title="Alur Reviewer Realisasi"
        busy={submitting}
        fetchCandidates={() =>
          inputRealisasi.reviewerCandidates(selectedUnit, kpiList[0]?.bidang)
        }
        onConfirm={handleConfirmSubmit}
        onCancel={() => setPickerOpen(false)}
        bidang={user?.bidang ?? undefined}
      />
    </div>
  );
}
