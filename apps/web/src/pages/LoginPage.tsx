import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Mail, Lock, Eye, EyeOff, LogIn, KeyRound, ChevronDown, AlertCircle,
} from 'lucide-react';

const DEMO_PASSWORD = 'Pusmanpro@2026';

// Akun demo per role yang telah di-seed (Kantor Induk per bidang + UPMK + GM).
const DEMO_GROUPS: Array<{ label: string; accounts: Array<{ role: string; email: string }> }> = [
  {
    label: 'Manajemen Puncak & Sistem',
    accounts: [
      { role: 'General Manager',  email: 'gm@pusmanpro.pln.co.id' },
      { role: 'Super Admin',      email: 'superadmin@pusmanpro.pln.co.id' },
      { role: 'Developer',        email: 'developer@pusmanpro.pln.co.id' },
    ],
  },
  {
    label: 'KI — Operasi Manajemen Proyek (OMP)',
    accounts: [
      { role: 'Staff/PIC Kinerja', email: 'staff.officer@pusmanpro.pln.co.id' },
      { role: 'ASMAN Elektromekanik', email: 'asman.em.omp@pusmanpro.pln.co.id' },
      { role: 'ASMAN Jaringan', email: 'asman.jr.omp@pusmanpro.pln.co.id' },
      { role: 'Manajer Operasi Pembangkit', email: 'man.pembangkit.omp@pusmanpro.pln.co.id' },
      { role: 'Manajer Operasi Jaringan', email: 'man.jaringan.omp@pusmanpro.pln.co.id' },
      { role: 'Senior Manajer OMP', email: 'sm.omp@pusmanpro.pln.co.id' },
    ],
  },
  {
    label: 'KI — QA/QC',
    accounts: [
      { role: 'Staff/PIC Kinerja', email: 'staff.qaqc@pusmanpro.pln.co.id' },
      { role: 'Manajer QA/QC Pembangkit', email: 'man.qaqc.pembangkit@pusmanpro.pln.co.id' },
      { role: 'Manajer QA/QC Jaringan', email: 'man.qaqc.jaringan@pusmanpro.pln.co.id' },
      { role: 'Senior Manajer QA/QC', email: 'sm.qaqc@pusmanpro.pln.co.id' },
    ],
  },
  {
    label: 'KI — Perencanaan & Project Control (RPC)',
    accounts: [
      { role: 'Staff/PIC Kinerja', email: 'staff.rpc@pusmanpro.pln.co.id' },
      { role: 'Manajer Project Control', email: 'man.pc@pusmanpro.pln.co.id' },
      { role: 'Manajer Perencanaan', email: 'man.perencanaan@pusmanpro.pln.co.id' },
      { role: 'Senior Manajer RPC', email: 'sm.rpc@pusmanpro.pln.co.id' },
    ],
  },
  {
    label: 'KI — Keuangan, Komunikasi & Umum (KKU)',
    accounts: [
      { role: 'Staff/PIC Kinerja', email: 'staff.kku@pusmanpro.pln.co.id' },
      { role: 'Manajer Keuangan', email: 'man.keuangan@pusmanpro.pln.co.id' },
      { role: 'Manajer Akuntansi', email: 'man.akuntansi@pusmanpro.pln.co.id' },
      { role: 'Manajer Aset & Properti', email: 'man.aset@pusmanpro.pln.co.id' },
      { role: 'Senior Manajer KKU', email: 'sm.kku@pusmanpro.pln.co.id' },
    ],
  },
  {
    label: 'KI — K3L & MRO',
    accounts: [
      { role: 'Staff Kinerja K3L', email: 'staff.k3l@pusmanpro.pln.co.id' },
      { role: 'ASMAN K3L', email: 'asman.k3l@pusmanpro.pln.co.id' },
      { role: 'Staff Kinerja MRO', email: 'staff.mro@pusmanpro.pln.co.id' },
      { role: 'ASMAN Manajemen Risiko & Kepatuhan', email: 'asman.mro@pusmanpro.pln.co.id' },
    ],
  },
  ...(['1', '2', '3', '4', '5'].map((n) => ({
    label: `UPMK ${['I', 'II', 'III', 'IV', 'V'][Number(n) - 1]}`,
    accounts: [
      { role: 'Staff Kinerja', email: `staff.upmk${n}@pusmanpro.pln.co.id` },
      { role: 'ASMAN UPMK', email: `asman.upmk${n}@pusmanpro.pln.co.id` },
      { role: 'Manajer (MUP)', email: `manajer.upmk${n}@pusmanpro.pln.co.id` },
    ],
  }))),
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Email atau kata sandi salah.');
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError('');
  }

  return (
    <div className="login-screen">
      {/* LEFT — form column */}
      <div className="login-body">
        <div className="login-brand-strip">
          <img
            src="/brand/Logo_PLN.png"
            alt="PLN"
            className="login-brand-strip-pln"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="login-brand-strip-text">
            PT PLN (Persero) PUSAT MANAJEMEN PROYEK
          </span>
          <img
            src="/brand/logo_simpp_brand_data.png"
            alt="SIMPP"
            className="login-brand-strip-simpp"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        <div className="login-panel">
          <div className="login-card">
            <h1 className="login-headline">Selamat Datang!</h1>
            <p className="login-subline">
              Masuk ke Dashboard Kinerja PT PLN (Persero) PUSMANPRO
            </p>

            <div className={`login-error-banner${error ? ' visible' : ''}`}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="login-field">
                <label className="login-label" htmlFor="login-email">Username</label>
                <div className="login-input-row">
                  <Mail size={18} className="login-input-icon" />
                  <input
                    id="login-email"
                    type="email"
                    className="login-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Masukkan email / username LDAP anda"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="login-password">Kata Sandi</label>
                <div className="login-input-row">
                  <Lock size={18} className="login-input-icon" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    className="login-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi anda"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="login-eye-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="login-meta-row">
                <label className="login-remember">
                  <input type="checkbox" />
                  <span>Ingat kata sandi</span>
                </label>
                <a
                  className="login-forgot"
                  href="#"
                  onClick={(e) => e.preventDefault()}
                >
                  Lupa kata sandi?
                </a>
              </div>

              <button type="submit" className="login-submit" disabled={loading}>
                {loading ? (
                  <span className="login-spinner" />
                ) : (
                  <LogIn size={18} className="login-btn-icon" />
                )}
                <span>{loading ? 'Memproses…' : 'Masuk'}</span>
              </button>
            </form>

            <p className="login-register-hint">
              Belum memiliki akun?
              <a href="#" onClick={(e) => e.preventDefault()}>Daftar disini</a>
            </p>

            <div className="login-hint">
              <button
                type="button"
                className={`login-hint-toggle${hintOpen ? ' open' : ''}`}
                aria-expanded={hintOpen}
                onClick={() => setHintOpen((v) => !v)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <KeyRound size={14} />
                  Akun Demo - klik untuk isi otomatis
                </span>
                <ChevronDown
                  size={14}
                  className="chevron"
                  style={{
                    transition: 'transform 0.2s',
                    transform: hintOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              </button>
              <div className={`login-hint-body${hintOpen ? ' open' : ''}`}>
                <select
                  className="login-input"
                  aria-label="Pilih akun demo"
                  value={email}
                  onChange={(e) => { if (e.target.value) fillDemo(e.target.value); }}
                  style={{ width: '100%', padding: '10px 12px' }}
                >
                  <option value="">— Pilih akun demo (isi otomatis) —</option>
                  {DEMO_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.accounts.map((a) => (
                        <option key={a.email} value={a.email}>{a.role} · {a.email.split('@')[0]}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
                  Password semua akun demo: <code>{DEMO_PASSWORD}</code>
                </div>
              </div>
            </div>

            <div className="login-footer">
              <span>&copy; 2026 PT PLN (Persero) &middot; PUSMANPRO</span>
              <span>v1.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — brand illustration column */}
      <aside className="login-illustration" aria-hidden="true">
        <div className="login-illustration-inner">
          <img
            src="/brand/login_right_data.png"
            alt="SIMPP"
            className="login-illustration-logo"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <h2 className="login-illustration-tagline">SIMPP</h2>
          <p className="login-illustration-sub">
            Sistem Informasi Monitoring Penugasan dan Pelaporan
          </p>
        </div>
      </aside>
    </div>
  );
}
