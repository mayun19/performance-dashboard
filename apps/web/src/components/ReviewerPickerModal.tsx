import { useEffect, useState } from 'react';
import { X, Check, ArrowUp, ArrowDown, UserCheck, ShieldCheck } from 'lucide-react';

export type ReviewerCandidate = {
  id: string;
  name: string;
  role: string;
  unit: string;
  bidang?: string | null;
};

const UNIT_LABEL: Record<string, string> = {
  KP: 'Kantor Induk', UPMK1: 'UPMK I', UPMK2: 'UPMK II', UPMK3: 'UPMK III', UPMK4: 'UPMK IV', UPMK5: 'UPMK V',
};
const ROLE_LABEL: Record<string, string> = {
  ASMAN: 'ASMAN', MANAJER: 'Manajer', SRMANAJER: 'Senior Manajer', GM: 'General Manager',
};
const desc = (c: ReviewerCandidate) =>
  `${ROLE_LABEL[c.role] ?? c.role}${c.unit && c.unit !== 'KP' ? ' · ' + (UNIT_LABEL[c.unit] ?? c.unit) : ''}`;

type Props = {
  open: boolean;
  title?: string;
  busy?: boolean;
  fetchCandidates: () => Promise<{ checkers: ReviewerCandidate[]; approvers: ReviewerCandidate[] }>;
  onConfirm: (checkerIds: string[], approverId: string) => void;
  onCancel: () => void;
  // Pre-fill dari default KPI Master (Fase C) — submitter tetap bisa mengubahnya.
  initialCheckerIds?: string[];
  initialApproverId?: string;
};

export default function ReviewerPickerModal({ open, title, busy, fetchCandidates, onConfirm, onCancel, initialCheckerIds, initialApproverId }: Props) {
  const [checkers, setCheckers] = useState<ReviewerCandidate[]>([]);
  const [approvers, setApprovers] = useState<ReviewerCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]); // checker ids in review order
  const [approverId, setApproverId] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrder([]); setApproverId(''); setLoadErr(null); setPrefilled(false);
    setLoading(true);
    fetchCandidates()
      .then((d) => { setCheckers(d.checkers ?? []); setApprovers(d.approvers ?? []); })
      .catch((e) => setLoadErr((e as Error)?.message ?? 'Gagal memuat kandidat reviewer'))
      .finally(() => setLoading(false));
  }, [open, fetchCandidates]);

  // Pre-fill dari default KPI Master setelah kandidat termuat (hanya sekali per pembukaan).
  useEffect(() => {
    if (!open || loading || prefilled) return;
    if (checkers.length === 0 && approvers.length === 0) return;
    const validCheckerIds = (initialCheckerIds ?? []).filter((id) => checkers.some((c) => c.id === id));
    if (validCheckerIds.length > 0) setOrder(validCheckerIds);
    if (initialApproverId && approvers.some((a) => a.id === initialApproverId)) setApproverId(initialApproverId);
    setPrefilled(true);
  }, [open, loading, prefilled, checkers, approvers, initialCheckerIds, initialApproverId]);

  if (!open) return null;

  const toggleChecker = (id: string) =>
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const move = (id: string, dir: -1 | 1) =>
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const byId = (id: string) => checkers.find((c) => c.id === id);
  const canConfirm = order.length > 0 && !!approverId && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--space-4)' }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-lg, 10px)', width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title ?? 'Pilih Alur Reviewer'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Tutup"><X size={16} /></button>
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Tentukan <b>Checker</b> (berurutan; ASMAN/Manajer) lalu satu <b>Approver</b> (Senior Manajer/GM).
            Dokumen mengalir: Anda → Checker 1 → Checker 2 → … → Approver → konsolidasi GM.
          </p>
          {prefilled && (order.length > 0 || approverId) && (
            <div style={{ margin: '0 0 var(--space-3)', padding: '6px 10px', background: 'var(--color-accent-tint)', borderRadius: 6, fontSize: 11, color: 'var(--color-accent)' }}>
              Terisi otomatis dari default KPI Master — Anda tetap bisa mengubahnya.
            </div>
          )}

          {loading && <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>Memuat kandidat…</div>}
          {loadErr && <div style={{ padding: 'var(--space-3)', color: 'var(--color-danger)', fontSize: 13 }}>{loadErr}</div>}

          {!loading && !loadErr && (
            <>
              {/* Urutan checker terpilih */}
              {order.length > 0 && (
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <UserCheck size={14} /> Urutan Checker ({order.length})
                  </div>
                  {order.map((id, i) => {
                    const c = byId(id);
                    if (!c) return null;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--color-surface-2)', borderRadius: 6, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, minWidth: 18 }}>{i + 1}.</span>
                        <span style={{ flex: 1, fontSize: 13 }}>{c.name} <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>· {desc(c)}</span></span>
                        <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(id, -1)} aria-label="Naik"><ArrowUp size={13} /></button>
                        <button className="btn btn-ghost btn-sm" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label="Turun"><ArrowDown size={13} /></button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleChecker(id)} aria-label="Hapus"><X size={13} /></button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Daftar kandidat checker */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 'var(--space-2)' }}>Kandidat Checker</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                  {checkers.map((c) => {
                    const picked = order.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleChecker(c.id)}
                        style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: `1px solid ${picked ? 'var(--color-accent)' : 'var(--color-border)'}`, background: picked ? 'var(--color-accent-tint)' : 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        <span style={{ width: 16 }}>{picked && <Check size={14} />}</span>
                        <span style={{ fontSize: 13 }}>{c.name}<br /><span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{desc(c)}</span></span>
                      </button>
                    );
                  })}
                  {checkers.length === 0 && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Tidak ada kandidat checker.</span>}
                </div>
              </div>

              {/* Approver */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} /> Approver
                </div>
                <select className="form-input" value={approverId} onChange={(e) => setApproverId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— Pilih Approver —</option>
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} — {desc(a)}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Batal</button>
          <button className="btn btn-primary" onClick={() => onConfirm(order, approverId)} disabled={!canConfirm}>
            {busy ? 'Mengirim…' : 'Kirim untuk Review'}
          </button>
        </div>
      </div>
    </div>
  );
}
