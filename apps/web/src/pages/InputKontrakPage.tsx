import { useEffect, useRef, useState, Fragment } from "react";
import { inputKontrak } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  FileText,
  Plus,
  Trash2,
  Send,
  CheckCircle,
  Edit2,
  X,
  Upload,
  AlertCircle,
  Download,
  FileCheck2,
  ChevronDown,
} from "lucide-react";
import { SkeletonTable, EmptyState, ErrorState } from "../components/LoadState";
import type { KontrakManajemen } from "../lib/types";

type KpiItem = {
  indikator: string;
  formula: string; // Rumus / metode perhitungan KPI
  satuan: string;
  bobot: string;
  target: string; // Target Semester I
  target2: string; // Target tahunan (tahun saat ini)
};

const CURRENT_YEAR = new Date().getFullYear();
const emptyRow = (): KpiItem => ({
  indikator: "",
  formula: "",
  satuan: "",
  bobot: "",
  target: "",
  target2: "",
});

// Unit yang dapat mengajukan Kontrak Manajemen: Kantor Induk + 5 UPMK
const UNIT_OPTIONS = [
  { code: "KP", name: "Kantor Induk" },
  { code: "UPMK1", name: "UPMK I" },
  { code: "UPMK2", name: "UPMK II" },
  { code: "UPMK3", name: "UPMK III" },
  { code: "UPMK4", name: "UPMK IV" },
  { code: "UPMK5", name: "UPMK V" },
];
const UNIT_NAMES: Record<string, string> = Object.fromEntries(
  UNIT_OPTIONS.map((u) => [u.code, u.name]),
);
const RPC_BIDANG = "Perencanaan & Project Control";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Menunggu Review",
  ready: "Siap Konsolidasi",
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

export function InputKontrakPage() {
  const { user } = useAuth();
  const [kontrakList, setKontrakList] = useState<KontrakManajemen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedUnit, setSelectedUnit] = useState("KP");
  const [bidang, setBidang] = useState("");
  // Unit sasaran KM pada form (KP / UPMK1-5). PIC RPC dapat membuat KM untuk UPMK (ditag bidang RPC).
  const [formUnit, setFormUnit] = useState("KP");
  const [holder, setHolder] = useState("");
  const [kpiItems, setKpiItems] = useState<KpiItem[]>([emptyRow()]);
  // Registri KM yang sudah disahkan (digabung dari halaman "Kontrak Manajemen Disetujui")
  const [approvedList, setApprovedList] = useState<KontrakManajemen[]>([]);
  const [approvedExpanded, setApprovedExpanded] = useState<string | null>(null);

  // Default unit mengikuti unit user (bila ada)
  useEffect(() => {
    if (user?.unit) setSelectedUnit(user.unit);
  }, [user?.unit]);

  // Hanya GM yang boleh pilih unit bebas untuk monitoring
  const canSelectUnit = user?.role === "GM";
  const lockedUnit = user?.unit ?? "KP";

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit]);

  // Registri KM disahkan (lintas unit) — dimuat sekali.
  useEffect(() => {
    inputKontrak
      .approved()
      .then((d) => setApprovedList(d as KontrakManajemen[]))
      .catch(() => {});
  }, [submitted]);

  const loadData = async () => {
    try {
      // GM filter by selected unit; others load all KMs so self-created cross-unit KMs (e.g. UPMK KM by Staff RPC) are always visible.
      // filterKm handles display scoping.
      const unitFilter = user?.role === "GM" ? selectedUnit : undefined;
      const data = await inputKontrak.list(unitFilter);
      setKontrakList(data as KontrakManajemen[]);
    } catch (e) {
      setError((e as Error)?.message ?? "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    // Default bidang ke bidang user (PIC) agar tidak salah pilih; GM tanpa bidang dibebaskan.
    setBidang(user?.bidang ?? "");
    setFormUnit("KP");
    setHolder("");
    setKpiItems([emptyRow()]);
    setShowForm(false);
    setEditingId(null);
    setNotice(null);
    setFormError(null);
  };

  const handleEdit = (kontrak: KontrakManajemen) => {
    setBidang(kontrak.bidang);
    setFormUnit(kontrak.unitCode);
    setHolder(kontrak.holder);
    setKpiItems(
      (kontrak.kpiItems as Partial<KpiItem>[]).map((it) => ({
        indikator: it.indikator ?? "",
        formula: it.formula ?? "",
        satuan: it.satuan ?? "",
        bobot: it.bobot ?? "",
        target: it.target ?? "",
        target2: it.target2 ?? "",
      })),
    );
    setEditingId(kontrak.id);
    setShowForm(true);
    setNotice(null);
  };

  const handleSave = async () => {
    if (!user) return;
    // Validasi dengan pesan yang jelas (bukan tombol mati diam-diam)
    if (!bidang.trim() || !holder.trim()) {
      setFormError(
        'Lengkapi "Bidang / Unit" dan "Penanggung Jawab" sebelum menyimpan.',
      );
      return;
    }
    if (kpiItems.every((k) => !k.indikator.trim())) {
      setFormError("Minimal satu Indikator Kinerja harus diisi.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await inputKontrak.save(
        formUnit,
        bidang.trim(),
        holder.trim(),
        kpiItems as unknown as Record<string, unknown>[],
        editingId ?? undefined,
      );
      setSubmitted(true);
      setSelectedUnit(formUnit); // tampilkan unit yang baru dibuat di daftar
      resetForm();
      await loadData();
      setTimeout(() => setSubmitted(false), 3000);
    } catch (e) {
      setFormError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
          (e as Error)?.message ??
          "Gagal menyimpan",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (id: string) => {
    setSubmitting(true);
    try {
      await inputKontrak.submit(id);
      setSubmitted(true);
      await loadData();
      setTimeout(() => setSubmitted(false), 3000);
    } catch (e) {
      setError((e as Error)?.message ?? "Gagal mengirim");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Hapus kontrak ini?")) return;
    try {
      await inputKontrak.delete(id);
      await loadData();
    } catch (e) {
      setError((e as Error)?.message ?? "Gagal menghapus");
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = ""; // reset agar file sama bisa dipilih ulang
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await inputKontrak.uploadExcel(file);
      const rows = (res?.kpiItems ?? []) as KpiItem[];
      if (rows.length === 0) {
        setError("Tidak ada indikator yang terbaca dari file.");
        return;
      }
      setShowForm(true);
      setEditingId(null);
      setBidang(user?.bidang ?? ""); // bidang KM = bidang PIC (terisi otomatis)
      setFormUnit("KP"); // default unit Kantor Induk; PIC RPC bisa ganti ke UPMK
      setHolder("");
      setFormError(null);
      setKpiItems(rows.map((r) => ({ ...emptyRow(), ...r })));
      setNotice(
        `${rows.length} indikator berhasil diimpor dari Excel. Lengkapi Penanggung Jawab lalu simpan.`,
      );
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (err as Error)?.message ??
        "Gagal mengunggah file";
      setError(typeof msg === "string" ? msg : "Gagal mengunggah file");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await inputKontrak.downloadTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "template-kontrak-manajemen.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Gagal mengunduh template");
    }
  };

  const addKpiRow = () => setKpiItems((prev) => [...prev, emptyRow()]);
  const removeKpiRow = (i: number) =>
    setKpiItems((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i),
    );
  const updateKpiRow = (i: number, field: keyof KpiItem, value: string) =>
    setKpiItems((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)),
    );

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Input Kontrak Manajemen</h1>
        </div>
        <SkeletonTable rows={4} cols={6} />
      </div>
    );
  }

  if (error && kontrakList.length === 0 && !showForm)
    return <ErrorState title="Gagal memuat data" message={error} />;

  // Hanya Kantor Induk yang boleh membuat KM (termasuk KM untuk UPMK). UPMK hanya mengisi realisasi.
  const canCreateKm = user?.unit === "KP";
  // Scoping daftar KM:
  // - GM + Konsolidator RPC → lintas unit & bidang
  // - User lain → filter per UNIT, lalu KP staff tambah filter per BIDANG
  const myBidang = user?.bidang ?? null;
  const myUnit = user?.unit ?? null;
  const canSeeAllKm = user?.role === "GM";
  // Hanya PIC/Staff Kinerja bidang ybs (Kantor Induk) yang boleh edit/hapus/kirim KM bidang itu.
  // Staff RPC yang membuat KM UPMK dengan bidang lain (OMP/QAQC/KKU) tetap bisa submit KM tersebut.
  const canActOnRow = (k: KontrakManajemen) =>
    user?.role === "STAFF" &&
    user?.unit === "KP" &&
    ((user?.bidang ?? null) === k.bidang || k.submitterId === user?.id);
  // Opsi sasaran KM pada form.
  const formTargetOptions: Array<{ unit: string; label: string }> = !myBidang
    ? []
    : myBidang === RPC_BIDANG
      ? [
          { unit: "KP", label: `${myBidang} (Kantor Induk)` },
          ...UNIT_OPTIONS.filter((u) => u.code !== "KP").map((u) => ({
            unit: u.code,
            label: u.name,
          })),
        ]
      : [{ unit: "KP", label: `${myBidang} (Kantor Induk)` }];

  const filterKm = (list: KontrakManajemen[]) => {
    if (canSeeAllKm) return list;
    return list.filter((k) => {
      // Tampilkan KM yang dibuat sendiri (termasuk KM UPMK dengan bidang berbeda)
      if (k.submitterId === user?.id) return true;
      // Filter utama: unit harus cocok
      if (myUnit && k.unitCode !== myUnit) return false;
      // KP dengan bidang: filter tambahan agar tidak melihat KM bidang lain
      if (myUnit === "KP" && myBidang) return k.bidang === myBidang;
      return true;
    });
  };
  const visibleKontrak = filterKm(kontrakList);
  const visibleApproved = filterKm(approvedList);
  const draftCount = visibleKontrak.filter((k) => k.status === "draft").length;
  const submittedCount = visibleKontrak.filter(
    (k) => k.status === "submitted",
  ).length;

  return (
    <div className="page input-kontrak-page">
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
            <FileText size={24} color="var(--color-accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>
              Input Kontrak Manajemen Tahun {CURRENT_YEAR}
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
                  {UNIT_NAMES[lockedUnit] ?? lockedUnit}
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
                · {visibleKontrak.length} kontrak · Draft: {draftCount} ·
                Terkirim: {submittedCount}
              </span>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          {canCreateKm && (
            <>
              <button
                className="btn btn-ghost"
                onClick={handleDownloadTemplate}
                title="Unduh template Excel">
                <Download size={16} /> Template
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => fileRef.current?.click()}
                disabled={submitting}
                title="Format: .xlsx/.xls/.csv dengan kolom Indikator Kinerja, Formula, Satuan, Bobot, Target Semester I, Target tahun">
                <Upload size={16} /> Upload Excel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                disabled={showForm}>
                <Plus size={16} /> Tambah Kontrak
              </button>
            </>
          )}
        </div>
      </div>

      {submitted && (
        <div
          className="status-banner success"
          style={{ marginBottom: "var(--space-4)" }}>
          <CheckCircle size={18} />
          <strong>Berhasil disimpan!</strong>
        </div>
      )}

      {error && showForm && (
        <div
          className="status-banner danger"
          style={{ marginBottom: "var(--space-4)" }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {/* Catatan untuk unit non-Kantor Induk (UPMK): KM disusun oleh Kantor Induk */}
      {!canCreateKm && (
        <div
          className="status-banner"
          style={{
            marginBottom: "var(--space-4)",
            background: "var(--color-surface-2)",
          }}>
          <AlertCircle size={16} /> Kontrak Manajemen disusun & diajukan oleh
          Kantor Induk. Unit Anda cukup mengisi{" "}
          <strong>Input Realisasi Bulanan</strong> terhadap KM yang sudah
          disahkan.
        </div>
      )}

      {/* Form */}
      {canCreateKm && showForm && (
        <div
          className="card"
          style={{
            marginBottom: "var(--space-6)",
            borderLeft: "4px solid var(--color-warning)",
          }}>
          <div className="card-header compact">
            <div className="card-title">
              <Edit2 size={14} />
              {editingId ? "Edit Kontrak" : "Kontrak Baru"}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={resetForm}>
              <X size={14} />
            </button>
          </div>
          <div
            className="card-body"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}>
            {notice && (
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-success)",
                  background: "var(--color-success-tint)",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-md)",
                }}>
                {notice}
              </div>
            )}
            {formError && (
              <div className="status-banner danger" style={{ margin: 0 }}>
                <AlertCircle size={16} /> {formError}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "var(--space-4)",
              }}>
              <div>
                <label className="form-label">
                  Unit Sasaran{" "}
                  <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <select
                  className="form-input"
                  value={formUnit}
                  onChange={(e) => {
                    const u = e.target.value;
                    setFormUnit(u);
                    setBidang(u === "KP" ? (user?.bidang ?? "") : "");
                    if (formError) setFormError(null);
                  }}>
                  {formTargetOptions.length === 0 && (
                    <option value="">— Tidak tersedia —</option>
                  )}
                  {formTargetOptions.map((o) => (
                    <option key={o.unit} value={o.unit}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">
                  Penanggung Jawab{" "}
                  <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <input
                  className="form-input"
                  value={holder}
                  onChange={(e) => {
                    setHolder(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Nama penanggung jawab"
                  style={
                    formError && !holder.trim()
                      ? { borderColor: "var(--color-danger)" }
                      : undefined
                  }
                />
              </div>
            </div>

            {formUnit !== "KP" && (
              <div>
                <label className="form-label">
                  Bidang KPI{" "}
                  <span style={{ color: "var(--color-danger)" }}>*</span>
                </label>
                <select
                  className="form-input"
                  value={bidang}
                  onChange={(e) => {
                    setBidang(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  style={
                    formError && !bidang.trim()
                      ? { borderColor: "var(--color-danger)" }
                      : undefined
                  }>
                  <option value="">
                    — Pilih bidang penanggung jawab KPI —
                  </option>
                  <option value="Operasi Manajemen Proyek">
                    Operasi Manajemen Proyek
                  </option>
                  <option value="QA/QC">QA/QC</option>
                  <option value="Keuangan, Komunikasi & Umum">
                    Keuangan, Komunikasi &amp; Umum
                  </option>
                  <option value="Perencanaan & Project Control">
                    Perencanaan &amp; Project Control
                  </option>
                  <option value="K3L">
                    K3L (Kesehatan, Keselamatan Kerja &amp; Lingkungan)
                  </option>
                  <option value="MRO">
                    MRO (Manajemen Risiko &amp; Kepatuhan)
                  </option>
                </select>
              </div>
            )}

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "var(--space-2)",
                }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Indikator KPI ({kpiItems.length})
                </label>
                <button className="btn btn-ghost btn-sm" onClick={addKpiRow}>
                  <Plus size={14} /> Tambah Indikator
                </button>
              </div>
              <div className="table-wrap">
                <table className="data-table compact input-km">
                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Indikator Kinerja</th>
                      <th>Formula</th>
                      <th>Satuan</th>
                      <th className="num">Bobot</th>
                      <th>Target Semester I</th>
                      <th>Target {CURRENT_YEAR}</th>
                      <th style={{ width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiItems.map((item, i) => (
                      <tr key={i}>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {i + 1}
                        </td>
                        <td>
                          <input
                            className="form-input form-input-sm"
                            value={item.indikator}
                            onChange={(e) =>
                              updateKpiRow(i, "indikator", e.target.value)
                            }
                            placeholder="Nama indikator"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input form-input-sm"
                            value={item.formula}
                            onChange={(e) =>
                              updateKpiRow(i, "formula", e.target.value)
                            }
                            placeholder="Rumus / metode"
                          />
                        </td>
                        <td>
                          <input
                            className="form-input form-input-sm"
                            value={item.satuan}
                            onChange={(e) =>
                              updateKpiRow(i, "satuan", e.target.value)
                            }
                            placeholder="Satuan"
                            style={{ width: 80 }}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="form-input form-input-sm"
                            type="number"
                            value={item.bobot}
                            onChange={(e) =>
                              updateKpiRow(i, "bobot", e.target.value)
                            }
                            placeholder="0"
                            style={{ width: 70 }}
                          />
                        </td>
                        <td>
                          <input
                            className="form-input form-input-sm"
                            value={item.target}
                            onChange={(e) =>
                              updateKpiRow(i, "target", e.target.value)
                            }
                            placeholder="Sem I"
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <input
                            className="form-input form-input-sm"
                            value={item.target2}
                            onChange={(e) =>
                              updateKpiRow(i, "target2", e.target.value)
                            }
                            placeholder={`Target ${CURRENT_YEAR}`}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeKpiRow(i)}
                            disabled={kpiItems.length <= 1}
                            title={
                              kpiItems.length <= 1
                                ? "Minimal 1 indikator"
                                : "Hapus indikator"
                            }
                            style={{
                              color:
                                kpiItems.length <= 1
                                  ? "var(--color-text-subtle)"
                                  : "var(--color-danger)",
                            }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-3)",
                alignItems: "center",
              }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-text-muted)",
                }}>
                <span style={{ color: "var(--color-danger)" }}>*</span> wajib
                diisi
              </span>
              <button className="btn btn-ghost" onClick={resetForm}>
                Batal
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={submitting}>
                {submitting
                  ? "Menyimpan…"
                  : editingId
                    ? "Update"
                    : "Simpan Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kontrak List */}
      {visibleKontrak.length === 0 ? (
        <EmptyState
          title="Belum ada kontrak"
          message="Klik 'Tambah Kontrak' atau 'Upload Excel' untuk membuat kontrak manajemen baru."
        />
      ) : (
        <div className="card p-0">
          <div className="card-header compact">
            <div className="card-title">
              <FileText size={14} />
              Daftar Kontrak Manajemen
            </div>
            <span className="card-meta">{visibleKontrak.length} kontrak</span>
          </div>
          <div
            className="table-wrap"
            style={{ paddingBottom: "var(--space-7)" }}>
            <div className="table-scroll">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Bidang</th>
                    <th>Penanggung Jawab</th>
                    <th>Jumlah KPI</th>
                    <th>Status</th>
                    <th>Tanggal</th>
                    <th style={{ width: 180 }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleKontrak.map((k) => (
                    <tr key={k.id}>
                      <td style={{ fontWeight: 600 }}>{k.bidang}</td>
                      <td>{k.holder}</td>
                      <td
                        className="num"
                        style={{ color: "var(--color-text-muted)" }}>
                        {k.kpiItems.length} indikator
                      </td>
                      <td>
                        <span
                          className={`status-pill ${STATUS_PILL[k.status] ?? "in-review"}`}>
                          {STATUS_LABEL[k.status] ?? k.status}
                        </span>
                        {k.status === "submitted" &&
                          (() => {
                            const kk = k as KontrakManajemen & {
                              steps?: { label: string }[];
                              currentStepIndex?: number;
                            };
                            const lbl =
                              (kk.steps ?? [])[kk.currentStepIndex ?? 0]
                                ?.label ?? "tahap review";
                            return (
                              <div
                                style={{
                                  color: "var(--color-text-muted)",
                                  marginTop: 4,
                                  fontSize: 14,
                                  fontWeight: 500,
                                }}>
                                di {lbl}
                              </div>
                            );
                          })()}
                        {k.status === "ready" && (
                          <div
                            style={{
                              color: "var(--color-warning)",
                              fontSize: 14,
                              fontWeight: 500,
                            }}>
                            lolos rantai → menunggu bundle GM
                          </div>
                        )}
                        {k.status === "rejected" && k.reviewNote && (
                          <div
                            style={{
                              color: "var(--color-danger)",
                              fontSize: 14,
                              fontWeight: 500,
                              maxWidth: 220,
                            }}>
                            {k.reviewNote}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          color: "var(--color-text-muted)",
                          whiteSpace: "nowrap",
                        }}>
                        {new Date(k.submittedAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "var(--space-2)" }}>
                          {k.status === "draft" || k.status === "rejected" ? (
                            canActOnRow(k) ? (
                              <>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleEdit(k)}
                                  title="Edit">
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleDelete(k.id)}
                                  title="Hapus"
                                  style={{ color: "var(--color-danger)" }}>
                                  <Trash2 size={14} />
                                </button>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleSubmit(k.id)}
                                  disabled={submitting}>
                                  <Send size={14} /> Kirim
                                </button>
                              </>
                            ) : (
                              <span
                                style={{
                                  fontSize: "var(--text-xs)",
                                  color: "var(--color-text-subtle)",
                                }}>
                                Bidang lain — lihat saja
                              </span>
                            )
                          ) : k.status === "submitted" ? (
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-text-muted)",
                              }}>
                              Menunggu review
                            </span>
                          ) : k.status === "approved" ? (
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-success)",
                              }}>
                              ✓ Disetujui {k.reviewer ? `· ${k.reviewer}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Registri Kontrak Manajemen yang sudah disahkan (digabung dari halaman terpisah) */}
      <div className="card p-0" style={{ marginTop: "var(--space-6)" }}>
        <div className="card-header compact">
          <div className="card-title">
            <FileCheck2 size={14} />
            Kontrak Manajemen Disetujui (Sah)
          </div>
          <span className="card-meta">
            {visibleApproved.length} kontrak · disahkan GM · read-only
          </span>
        </div>
        {visibleApproved.length === 0 ? (
          <div className="card-body">
            <EmptyState
              title="Belum ada KM disetujui"
              message="Belum ada Kontrak Manajemen yang disahkan penuh hingga General Manager."
            />
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
                    <th>Penanggung Jawab</th>
                    <th>KPI</th>
                    <th>Disahkan oleh</th>
                    <th>Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleApproved.map((k) => (
                    <Fragment key={k.id}>
                      <tr>
                        <td style={{ fontWeight: 600 }}>
                          {UNIT_NAMES[k.unitCode] ?? k.unitCode}
                        </td>
                        <td>{k.bidang}</td>
                        <td style={{ color: "var(--color-text-muted)" }}>
                          {k.holder}
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setApprovedExpanded(
                                approvedExpanded === k.id ? null : k.id,
                              )
                            }>
                            {k.kpiItems.length} indikator{" "}
                            <ChevronDown
                              size={12}
                              style={{
                                transform:
                                  approvedExpanded === k.id
                                    ? "rotate(180deg)"
                                    : "none",
                                transition: "transform .2s",
                              }}
                            />
                          </button>
                        </td>
                        <td>
                          <span className="status-pill completed">
                            {k.reviewer ?? "GM"}
                          </span>
                        </td>
                        <td
                          style={{
                            color: "var(--color-text-muted)",
                            whiteSpace: "nowrap",
                          }}>
                          {k.reviewedAt
                            ? new Date(k.reviewedAt).toLocaleDateString(
                                "id-ID",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                },
                              )
                            : "—"}
                        </td>
                      </tr>
                      {approvedExpanded === k.id && (
                        <tr>
                          <td
                            colSpan={6}
                            style={{
                              background: "var(--color-surface-2)",
                              padding: 0,
                            }}>
                            <table
                              className="data-table table-expanded"
                              style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>No</th>
                                  <th>Indikator Kinerja</th>
                                  <th>Formula</th>
                                  <th>Satuan</th>
                                  <th className="num">Bobot</th>
                                  <th>Target Sem I</th>
                                  <th>Target Tahun {CURRENT_YEAR}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(k.kpiItems as Record<string, string>[]).map(
                                  (it, idx) => (
                                    <tr key={idx}>
                                      <td>{idx + 1}</td>
                                      <td>{it.indikator}</td>
                                      <td>{it.formula}</td>
                                      <td>{it.satuan}</td>
                                      <td className="num">{it.bobot}</td>
                                      <td>{it.target}</td>
                                      <td>{it.target2}</td>
                                    </tr>
                                  ),
                                )}
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
        )}
      </div>
    </div>
  );
}
