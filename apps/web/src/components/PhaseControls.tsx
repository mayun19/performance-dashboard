// Living-target: toggle fase snapshot dashboard (Final vs Sementara) + badge provisional.
// Dipakai bersama oleh Executive & Operational dashboard.
export type SnapshotPhase = 'sementara' | 'final';

export function PhaseControls({
  requested, shown, onChange,
}: {
  requested: SnapshotPhase | undefined; // yang diminta user (undefined = otomatis/default)
  shown: SnapshotPhase | undefined; // fase yang benar-benar ditampilkan (dari respons)
  onChange: (p: SnapshotPhase) => void;
}) {
  // Tombol aktif = fase yang sedang ditampilkan (default backend: final bila ada, else sementara).
  const active = requested ?? shown ?? 'sementara';
  const btn = (val: SnapshotPhase, label: string) => (
    <button
      type="button"
      className={`btn btn-sm ${active === val ? 'btn-primary' : 'btn-ghost'}`}
      onClick={() => onChange(val)}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {shown === 'final' ? (
        <span className="meta-pill" style={{ background: 'var(--color-success-tint)', color: 'var(--color-success)', fontWeight: 700 }}
          title="Nilai FINAL — sudah direstate terhadap KM Final (target resmi dari holding)">
          ● Final (KM Final)
        </span>
      ) : (
        <span className="meta-pill" style={{ background: 'var(--color-warning-tint)', color: 'var(--color-warning)', fontWeight: 700 }}
          title="Nilai PROVISIONAL — dihitung terhadap KM Sementara (target hidup), belum final sampai KM Final tiba">
          ● Provisional / Sementara
        </span>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        {btn('final', 'Final')}
        {btn('sementara', 'Sementara')}
      </div>
    </div>
  );
}
