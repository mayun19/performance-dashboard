import { useEffect, useState } from 'react';
import { X, Calendar, AlertTriangle } from 'lucide-react';
import { usePeriod } from '../context/PeriodContext';
import { periodTarget, type PeriodTarget } from '../lib/api';
import { strictNum, satuanCategory } from '../lib/satuan';

type AssignmentLike = { id: string; unitCode: string; bidang: string; target: string; target2: string };

type Props = {
  assignment: AssignmentLike | null;
  indikator: string;
  satuan: string;
  unitLabel: string;
  onClose: () => void;
};

const BULAN_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Disburse Target Tahun jadi 12 alokasi bulanan sekaligus — dibangun di atas PeriodTarget
// (living-target) yang sudah ada; lihat catatan di period-target.service.ts disburse().
export default function DisburseTargetModal({ assignment, indikator, satuan, unitLabel, onClose }: Props) {
  const { periods } = usePeriod();
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<Record<string, PeriodTarget | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; skippedFrozen: number; total: number } | null>(null);

  const currentYear = new Date().getFullYear();
  const yearPeriods = periods
    .filter((p) => p.yearMonth.startsWith(String(currentYear)))
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  useEffect(() => {
    if (!assignment) return;
    setValues({}); setExisting({}); setError(null); setResult(null);
    if (yearPeriods.length === 0) return;
    setLoading(true);
    Promise.all(yearPeriods.map((p) => periodTarget.list(p.id).catch(() => [] as PeriodTarget[])))
      .then((lists) => {
        const byPeriod: Record<string, PeriodTarget | undefined> = {};
        lists.forEach((list, i) => {
          byPeriod[yearPeriods[i].id] = list.find((pt) => pt.kpiAssignmentId === assignment.id);
        });
        setExisting(byPeriod);

        const cat = satuanCategory(satuan);
        const target2Num = strictNum(assignment.target2);
        const init: Record<string, string> = {};
        if (cat === 'additive' && target2Num !== null) {
          const n = yearPeriods.length;
          const share = Math.round((target2Num / n) * 100) / 100;
          yearPeriods.forEach((p, i) => {
            const own = byPeriod[p.id];
            init[p.id] = own ? own.target : String(i === n - 1 ? Math.round((target2Num - share * (n - 1)) * 100) / 100 : share);
          });
        } else if ((cat === 'percent' || cat === 'rate') && target2Num !== null) {
          yearPeriods.forEach((p) => { const own = byPeriod[p.id]; init[p.id] = own ? own.target : String(target2Num); });
        } else {
          yearPeriods.forEach((p) => { const own = byPeriod[p.id]; init[p.id] = own ? own.target : ''; });
        }
        setValues(init);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id]);

  if (!assignment) return null;

  const cat = satuanCategory(satuan);
  const target2Num = strictNum(assignment.target2);
  const sumFilled = yearPeriods.reduce((s, p) => s + (strictNum(values[p.id] ?? '') ?? 0), 0);
  const sumMismatch = cat === 'additive' && target2Num !== null && Math.abs(sumFilled - target2Num) > 0.01;

  const handleSave = async () => {
    setBusy(true); setError(null);
    try {
      const entries = yearPeriods
        .filter((p) => !existing[p.id]?.frozen)
        .map((p) => ({ periodId: p.id, target: (values[p.id] ?? '').trim() }))
        .filter((e) => e.target !== '');
      const res = await periodTarget.disburse(assignment.id, entries);
      setResult(res);
    } catch (e) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e as Error)?.message ?? 'Gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog" aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--space-4)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-lg, 10px)', width: 'min(640px, 100%)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} /> Atur Target Bulanan
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Tutup"><X size={16} /></button>
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 14, color: 'var(--color-text-muted)' }}>
            {indikator} · {unitLabel} — {assignment.bidang} (Target {currentYear}: <b>{assignment.target2 || '—'} {satuan}</b>)
          </p>

          {result ? (
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-success-tint)', color: 'var(--color-success)', borderRadius: 6, fontSize: 14 }}>
              {result.updated} bulan diperbarui.
              {result.skippedFrozen > 0 && ` ${result.skippedFrozen} bulan dilewati (sudah dibekukan, tak bisa dikoreksi lagi).`}
            </div>
          ) : loading ? (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>Memuat…</div>
          ) : (
            <>
              {cat === 'date' && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
                  Satuan bertipe tanggal/deadline/non-numerik — tidak ada saran otomatis, isi manual per bulan yang relevan (boleh kosongkan bulan yang tak berlaku).
                </p>
              )}
              {(cat === 'percent' || cat === 'rate') && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 var(--space-3)' }}>
                  Satuan {satuan} — nilai Target {currentYear} disalin sama ke tiap bulan (bukan dibagi), karena ini rate/tenggat berulang, bukan kuantitas kumulatif. Boleh disesuaikan manual per bulan.
                </p>
              )}
              {cat === 'additive' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, margin: '0 0 var(--space-3)', color: sumMismatch ? 'var(--color-warning)' : 'var(--color-success)' }}>
                  {sumMismatch && <AlertTriangle size={13} />}
                  Σ 12 bulan: <b>{Math.round(sumFilled * 100) / 100}</b> {target2Num !== null && <>/ Target {currentYear}: <b>{target2Num}</b></>}
                  {sumMismatch && ' — tidak sama persis (boleh, ini cuma peringatan rencana)'}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {yearPeriods.map((p, i) => {
                  const pt = existing[p.id];
                  const frozen = !!pt?.frozen;
                  return (
                    <div key={p.id}>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                        {BULAN_ID[i]} {p.label.replace(/\D/g, '') ? '' : ''}
                      </label>
                      <input
                        className="form-input form-input-sm" disabled={frozen}
                        value={values[p.id] ?? ''}
                        onChange={(e) => setValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder={frozen ? (pt?.frozenTarget ?? pt?.target ?? '') : '—'}
                      />
                      {frozen && <span style={{ fontSize: 10, color: 'var(--color-text-subtle)' }}>terkunci</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {error && <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{result ? 'Tutup' : 'Batal'}</button>
          {!result && (
            <button className="btn btn-primary" onClick={handleSave} disabled={busy || loading}>
              {busy ? 'Menyimpan…' : 'Simpan 12 Bulan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
