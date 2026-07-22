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
};
const STATUS_PILL: Record<string, string> = {
  draft: "in-review",
  submitted: "needs-revision",
  ready: "at-risk",
  approved: "completed",
  rejected: "delayed",
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
        const [histRes, approvedRes, ptRes] = await Promise.allSettled([
          inputRealisasi.history(selectedUnit, selectedPeriodId),
          inputKontrak.approved(selectedUnit, selectedYear, kmType),
          periodTarget.list(selectedPeriodId),
        ]);
        if (histRes.status === "fulfilled")
          setHistory(histRes.value as unknown[]);
        // Living-target: KM Sementara per assignment periode ini (untuk package view).
        setPeriodTargets(ptRes.status === "fulfilled" ? ptRes.value : []);
        if (approvedRes.status === "fulfilled") {
          // Acuan realisasi = KPI dari Kontrak Manajemen yang sudah DISETUJUI (final GM) untuk unit terpilih.
          const kontrak = approvedRes.value as KontrakManajemen[];
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
        }
      } catch (e) {
        setError((e as Error)?.message ?? "Gagal memuat data");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedUnit, selectedPeriodId, isStaff, user?.bidang]);

  // Submit membuka picker reviewer; pengiriman sebenarnya di handleConfirmSubmit.
  const handleSubmit = () => {
    if (!user) return;
    setPickerOpen(true);
  };

  const handleConfirmSubmit = async (
    checkerIds: string[],
    approverId: string,
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
        bucket[`kpi_${i}`] = { ...kpi, realisasi: values[String(i)] ?? "" };
      });
      for (const [bidang, payload] of byBidang) {
        await inputRealisasi.submit(
          selectedUnit,
          bidang,
          payload,
          checkerIds,
          approverId,
          selectedPeriodId,
        );
      }
      setPickerOpen(false);
      setSubmitted(true);
      setValues({});
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

  const filledCount = Object.values(values).filter(
    (v) => v.trim() !== "",
  ).length;
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
              Input Realisasi Bulanan — {selectedPeriodLabel}
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
        </div>
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
            Isi nilai realisasi {selectedPeriodLabel} · Acuan:{" "}
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
              message="Belum ada Kontrak Manajemen yang disetujui (final GM) untuk unit Anda. Selesaikan persetujuan KM terlebih dahulu di menu Input Kontrak Manajemen → Persetujuan."
            />
          ) : (
            <div className="table-scroll able-scroll">
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
                  </tr>
                </thead>
                <tbody>
                  {kpiList.map((kpi, i) => {
                    const val = values[String(i)] ?? "";
                    const hasVal = val.trim() !== "";
                    const lt = livingTargetFor(kpi);
                    return (
                      <tr
                        key={i}
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
                            color: "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                          }}>
                          {kpi.bidang ?? "—"}
                        </td>
                        <td style={{ maxWidth: 220, fontWeight: 500 }}>
                          {kpi.indikator ?? "—"}
                        </td>
                        <td
                          style={{
                            fontSize: 14,
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
                        <td className="num">{kpi.target ?? "—"}</td>
                        <td className="num">{kpi.target2 ?? "—"}</td>
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
                                  title={
                                    lt.frozen
                                      ? "Sudah dibekukan (bundle GM disetujui / deadline / restatement)"
                                      : lt.source === "carried"
                                        ? "Dibawa dari bulan lalu (belum diubah)"
                                        : "Diinput/diubah bulan ini"
                                  }
                                  style={{
                                    marginLeft: 4,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: "1px 4px",
                                    borderRadius: 4,
                                    border: "1px solid var(--color-border)",
                                    color: lt.frozen
                                      ? "var(--color-text-muted)"
                                      : lt.source === "carried"
                                        ? "var(--color-warning)"
                                        : "var(--color-accent)",
                                  }}>
                                  {lt.frozen
                                    ? "BEKU"
                                    : lt.source === "carried"
                                      ? "CARRY"
                                      : "HIDUP"}
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
                        <td style={{ minWidth: 340 }}>
                          <input
                            type="text"
                            className="form-input form-input-sm"
                            style={{
                              borderColor: hasVal
                                ? "rgba(34,197,94,0.5)"
                                : undefined,
                            }}
                            value={val}
                            onChange={(e) =>
                              setValues((v) => ({
                                ...v,
                                [String(i)]: e.target.value,
                              }))
                            }
                            placeholder={`Target: ${kpi.target ?? "—"}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {kpiList.length > 0 && (
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
          <div
            className="table-wrap"
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
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
                              className={`status-pill ${STATUS_PILL[status] ?? "in-review"}`}>
                              {STATUS_LABEL[status] ?? status}
                            </span>
                            {status === "submitted" && stepLabel && (
                              <div
                                style={{
                                  color: "var(--color-text-muted)",
                                  marginTop: 4,
                                  fontSize: 14,
                                  fontWeight: 500,
                                }}>
                                di {stepLabel}
                              </div>
                            )}
                            {status === "rejected" && item.reviewNote ? (
                              <div
                                style={{
                                  color: "var(--color-danger)",
                                  marginTop: 4,
                                  maxWidth: 240,
                                  fontSize: 14,
                                  fontWeight: 500,
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
                                width: "100%",
                              }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{
                                  fontSize: 14,
                                  textAlign: "center",
                                  gap: 4,
                                  width: "100%",
                                }}
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
                                  fontSize: 14,
                                  fontWeight: 600,
                                  marginBottom: 6,
                                }}>
                                Evidence Realisasi
                              </div>
                              {atts.length === 0 ? (
                                <div
                                  style={{
                                    fontSize: 12,
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
                                        fontSize: 14,
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
                                        style={{
                                          fontWeight: 600,
                                        }}>
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
                                style={{
                                  fontSize: 14,
                                }}
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
                                Maks 5 berkas · ≤ 10 MB/berkas · PDF, Excel,
                                Word, JPG/PNG{" "}
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
                                  fontSize: 14,
                                  fontWeight: 600,
                                  marginBottom: 6,
                                }}>
                                Riwayat Revisi (Target & Nilai Realisasi)
                              </div>
                              {revLoading ? (
                                <div
                                  style={{
                                    fontSize: 14,
                                    color: "var(--color-text-muted)",
                                  }}>
                                  Memuat…
                                </div>
                              ) : revisions.length === 0 ? (
                                <div
                                  style={{
                                    fontSize: 14,
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
                                        fontSize: 14,
                                        alignItems: "flex-start",
                                        borderLeft: `2px solid ${rv.entity === "period_target" ? "var(--color-accent)" : "var(--color-warning)"}`,
                                        paddingLeft: 8,
                                      }}>
                                      <span
                                        style={{
                                          fontSize: 12,
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
                                            <b>{String(rv.oldValue ?? "—")}</b>{" "}
                                            →{" "}
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
                                            fontSize: 10,
                                            marginTop: 2,
                                          }}>
                                          {rv.actor} ·{" "}
                                          {new Date(
                                            rv.createdAt,
                                          ).toLocaleString("id-ID", {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}
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
        </div>
      )}

      <ReviewerPickerModal
        open={pickerOpen}
        title="Alur Reviewer Realisasi"
        busy={submitting}
        fetchCandidates={inputRealisasi.reviewerCandidates}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  );
}
