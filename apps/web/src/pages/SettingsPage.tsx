import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { audit } from '../lib/api';
import type { AuditLog } from '../lib/types';
import {
  UserCircle2, ShieldCheck, BellRing, ScrollText, PlayCircle,
  Sun, Moon, User,
} from 'lucide-react';
import { SkeletonTable, EmptyState, ErrorState } from '../components/LoadState';

type Tab = 'profile' | 'roles' | 'notifications' | 'audit' | 'demo';

const ROLE_LABELS: Record<string, string> = {
  STAFF: 'Staff', ASMAN: 'Asman', MANAJER: 'Manajer',
  SRMANAJER: 'Sr. Manajer', GM: 'General Manager',
};

const ROLE_PERMS: Record<string, string[]> = {
  STAFF: ['Input Realisasi Bulanan', 'Lihat dashboard unit sendiri'],
  ASMAN: ['Input Realisasi Bulanan', 'Review laporan Staff', 'Lihat dashboard semua unit'],
  MANAJER: ['Approve laporan Asman', 'Review KM Usulan (WF-2)', 'Lihat semua dashboard'],
  SRMANAJER: ['Approve laporan Manajer', 'Review KM (WF-1b/WF-2)', 'Lihat audit log', 'View As semua role'],
  GM: ['Final approval semua laporan', 'Approve KM (GM Sign)', 'Akses penuh semua fitur', 'Lihat audit log lengkap'],
};

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>('profile');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  const loadAudit = () => {
    setLogsLoading(true);
    setLogsError(null);
    audit.logs()
      .then((r) => setLogs(r.data ?? []))
      .catch((e) => setLogsError(e?.message ?? 'Gagal memuat audit log'))
      .finally(() => setLogsLoading(false));
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'audit' && logs.length === 0) loadAudit();
  };

  const avatarInitials = user?.name?.split(' ').map(w => w[0]).slice(0, 2).join('') ?? '?';

  const tabs: Array<{ id: Tab; icon: React.ReactNode; label: string; badge?: string }> = [
    { id: 'profile', icon: <UserCircle2 size={16} />, label: 'Profil & Preferensi' },
    { id: 'roles', icon: <ShieldCheck size={16} />, label: 'Manajemen Peran' },
    { id: 'notifications', icon: <BellRing size={16} />, label: 'Notifikasi' },
    { id: 'audit', icon: <ScrollText size={16} />, label: 'Audit Log', badge: '17' },
    { id: 'demo', icon: <PlayCircle size={16} />, label: 'Panduan Demo', badge: 'UAT' },
  ];

  return (
    <div className="page settings-page">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="card p-0">
            <div className="card-header compact">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <User size={14} />Pengaturan
              </div>
            </div>
            <nav className="settings-nav">
              {tabs.map(t => (
                <button key={t.id} className={`settings-tab${tab === t.id ? ' active' : ''}`} onClick={() => handleTabChange(t.id)}>
                  {t.icon}<span>{t.label}</span>
                  {t.badge && <span className="tab-badge" style={t.id === 'demo' ? { background: 'var(--color-success)' } : {}}>{t.badge}</span>}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <main style={{ minWidth: 0 }}>
          {/* Profile Tab */}
          {tab === 'profile' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="card">
                <div className="card-header compact"><div className="card-title">Informasi Akun</div></div>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
                  <div className="user-avatar" style={{ width: 72, height: 72, fontSize: 24, borderRadius: 16, flexShrink: 0 }}>
                    {avatarInitials}
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{user?.name ?? '—'}</div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>{user?.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 8 }}>
                      <span className="status-pill in-review" style={{ fontSize: 12 }}>{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>· Unit: {user?.unit ?? '—'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header compact"><div className="card-title">Tampilan</div></div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Tema Aplikasi</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>Pilih tampilan terang atau gelap</div>
                    </div>
                    <button className="btn btn-secondary" onClick={toggleTheme} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                      {theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header compact"><div className="card-title">Informasi Sistem</div></div>
                <div className="card-body">
                  {[
                    { label: 'Versi Aplikasi', value: 'SIMPP v3.0' },
                    { label: 'Backend', value: 'NestJS 10 + Prisma + PostgreSQL 16' },
                    { label: 'Frontend', value: 'React 19 + Vite + TypeScript' },
                    { label: 'Periode Aktif', value: 'Februari 2026' },
                  ].map(({ label, value }) => (
                    <div key={label} className="settings-row">
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>{value}</span>
                    </div>
                  ))}
                </div>
                {user?.roleVariant && (
                  <div className="profile-variant text-muted">
                    {user.roleVariant.label} — {user.roleVariant.scope}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Roles Tab */}
          {tab === 'roles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {Object.entries(ROLE_LABELS).map(([roleKey, roleLabel]) => {
                const isCurrentRole = user?.role === roleKey;
                return (
                  <div key={roleKey} className="card" style={{ borderLeft: isCurrentRole ? '3px solid var(--color-accent)' : '3px solid transparent' }}>
                    <div className="card-header compact">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ShieldCheck size={16} color="var(--color-accent)" />
                        </div>
                        <div>
                          <div className="card-title" style={{ fontSize: 'var(--text-sm)' }}>{roleLabel}</div>
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{roleKey}</div>
                        </div>
                      </div>
                      {isCurrentRole && <span className="status-pill completed" style={{ fontSize: 12 }}>Peran Anda</span>}
                    </div>
                    <div className="card-body">
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(ROLE_PERMS[roleKey] ?? []).map((perm, i) => (
                          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' }}>
                            <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', flexShrink: 0 }}>✓</span>
                            {perm}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notifications Tab */}
          {tab === 'notifications' && (
            <div className="card">
              <div className="card-header compact"><div className="card-title">Preferensi Notifikasi</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {[
                  { label: 'Approval Laporan', desc: 'Notif saat laporan perlu tindakan Anda' },
                  { label: 'KPI Kritis', desc: 'Notif saat KPI di bawah threshold 90%' },
                  { label: 'Deadline Reminder', desc: 'Pengingat H-2 sebelum deadline laporan' },
                  { label: 'Kontrak Manajemen', desc: 'Notif workflow KM Usulan & Realisasi' },
                ].map((n, i) => (
                  <div key={i} className="settings-row" style={{ borderBottom: '1px solid var(--color-border)', padding: 'var(--space-3) 0' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{n.label}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>{n.desc}</div>
                    </div>
                    <div className="toggle">
                      <input type="checkbox" defaultChecked={i < 3} />
                      <span className="toggle-slider" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Log Tab */}
          {tab === 'audit' && (
            <div className="card p-0">
              <div className="card-header compact">
                <div className="card-title"><ScrollText size={14} />Audit Log Sistem</div>
                <button className="btn btn-ghost btn-sm" onClick={loadAudit}>Refresh</button>
              </div>
              <div className="table-wrap">
                {logsLoading ? (
                  <SkeletonTable rows={5} cols={6} />
                ) : logsError ? (
                  <ErrorState title="Gagal memuat audit log" message={logsError} />
                ) : (
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Aktor</th>
                        <th>Aksi</th>
                        <th>Entitas</th>
                        <th>Catatan</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                            {new Date(l.createdAt).toLocaleString('id-ID')}
                          </td>
                          <td style={{ fontWeight: 500 }}>{l.actor}</td>
                          <td><code style={{ fontSize: 12 }}>{l.action}</code></td>
                          <td style={{ color: 'var(--color-text-muted)' }}>{l.entity ?? '—'}</td>
                          <td style={{ color: 'var(--color-text-muted)', maxWidth: 200 }}>{l.note ?? '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--color-text-subtle)', fontFamily: 'monospace' }}>{(l as unknown as Record<string, unknown>).ip as string ?? '—'}</td>
                        </tr>
                      ))}
                      {logs.length === 0 && (
                        <tr><td colSpan={6}><EmptyState title="Tidak ada log audit" message="Klik Refresh untuk memuat data." /></td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Demo Tab */}
          {tab === 'demo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className="card">
                <div className="card-header compact"><div className="card-title">Panduan Demo SIMPP v3.0</div></div>
                <div className="card-body">
                  <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                    Aplikasi ini adalah demonstrasi SIMPP (Sistem Informasi Manajemen Proyek PUSMANPRO) versi 3.0.
                    Gunakan akun demo berikut untuk menjelajahi fitur sesuai peran masing-masing.
                  </p>
                </div>
              </div>
              <div className="card p-0">
                <div className="card-header compact"><div className="card-title">Akun Demo Tersedia</div></div>
                <div className="table-wrap">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Peran</th>
                        <th>Email</th>
                        <th>Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { role: 'General Manager', email: 'gm@pusmanpro.pln.co.id' },
                        { role: 'Sr. Manajer', email: 'srmanajer@pusmanpro.pln.co.id' },
                        { role: 'Manajer', email: 'manajer@pusmanpro.pln.co.id' },
                        { role: 'Asman', email: 'asman@pusmanpro.pln.co.id' },
                        { role: 'Staff', email: 'staff@pusmanpro.pln.co.id' },
                      ].map((a, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, color: 'var(--color-accent)' }}>{a.role}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{a.email}</td>
                          <td><code style={{ fontSize: 12 }}>Pusmanpro@2026</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
