import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNotif } from "../context/NotifContext";
import { usePeriod } from "../context/PeriodContext";
import {
  LayoutDashboard,
  TrendingUp,
  Settings,
  Activity,
  Target,
  Users,
  CheckSquare,
  AlertTriangle,
  FileText,
  ClipboardEdit,
  Bell,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  Menu,
  Tv2,
  Search,
  Download,
  User,
  HelpCircle,
  FilePlus,
  LineChart,
  FileSpreadsheet,
  Image,
  Printer,
  ExternalLink,
  Workflow,
  Network,
  Leaf,
  MapPin,
  ShieldAlert,
} from "lucide-react";

const NAV_ITEMS = [
  {
    section: "Dashboard Kinerja",
    submenus: [
      { to: "/approvals", label: "Persetujuan", icon: CheckSquare },
      {
        to: "/input-kontrak",
        label: "Input Kontrak Manajemen",
        icon: FileText,
        hideForUpmk: true,
      },
      {
        to: "/input-realisasi",
        label: "Input Realisasi Bulanan",
        icon: ClipboardEdit,
      },
      { to: "/", label: "Executive Summary", icon: LayoutDashboard, end: true },
      {
        to: "/financial",
        label: "Cost & Capex",
        icon: TrendingUp,
        devOnly: true,
      },
      {
        to: "/operational",
        label: "Operational KPIs",
        icon: Activity,
        devOnly: true,
      },
      {
        to: "/proses-bisnis",
        label: "Proses Bisnis L2",
        icon: Workflow,
        devOnly: true,
      },
      {
        to: "/struktur-organisasi",
        label: "Struktur Organisasi",
        icon: Network,
        devOnly: true,
      },
      { to: "/gcg-esg", label: "GCG & ESG", icon: Leaf, devOnly: true },
      {
        to: "/strategic",
        label: "Strategic Targets",
        icon: Target,
        devOnly: true,
      },
      {
        to: "/human-capital",
        label: "Human Capital",
        icon: Users,
        devOnly: true,
      },
      {
        to: "/risk",
        label: "Manajemen Risiko",
        icon: AlertTriangle,
        devOnly: true,
      },
      {
        to: "/peta",
        label: "Peta Geografis UPMK",
        icon: MapPin,
        devOnly: true,
      },
    ],
    icon: LayoutDashboard,
  },
  {
    section: "Pengaturan",
    icon: Settings,
    submenus: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/admin", label: "Admin Tools", icon: ShieldAlert, devOnly: true },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  STAFF: "Staff",
  ASMAN: "Asman",
  MANAJER: "Manajer",
  SRMANAJER: "Sr. Manajer",
  GM: "General Manager",
  SUPERADMIN: "Super Admin",
  DEVELOPER: "Developer",
};

const ROUTE_NAMES: Record<string, string> = {
  "/": "Executive Summary",
  "/financial": "Cost & Capex",
  "/operational": "Operational KPIs",
  "/proses-bisnis": "Proses Bisnis L2",
  "/struktur-organisasi": "Struktur Organisasi",
  "/gcg-esg": "GCG & ESG",
  "/strategic": "Strategic Targets",
  "/human-capital": "Human Capital",
  "/risk": "Manajemen Risiko",
  "/peta": "Peta Geografis UPMK",
  "/approvals": "Persetujuan",
  "/input-realisasi": "Input Realisasi",
  "/input-kontrak": "Input Kontrak Manajemen",
  "/workflow-km/usulan": "Proses Usulan KM",
  "/workflow-km/realisasi": "Proses Realisasi KM",
  "/settings": "Settings",
  "/admin": "Admin Tools",
};

export function AppShell() {
  const { user, logout, viewAs, setViewAs } = useAuth();
  const {
    periods,
    periodId,
    setPeriodId,
    mode: periodMode,
    setMode: setPeriodMode,
  } = usePeriod();
  const { theme, toggle: toggleTheme } = useTheme();
  const { items: notifs, unreadCount, markAllRead } = useNotif();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [warRoomActive, setWarRoomActive] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);

  // Accordion state for collapsible nav sections.
  // Lazy-init: any section containing the current active route starts open,
  // so a hard refresh on a deep route doesn't hide the active item.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      NAV_ITEMS.forEach((section) => {
        const isActive = section.submenus.some(
          ({ to, end }) =>
            location.pathname === to ||
            (!end && to !== "/" && location.pathname.startsWith(to)),
        );
        if (isActive) initial[section.section] = true;
      });
      return initial;
    },
  );

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const currentPageName = ROUTE_NAMES[location.pathname] ?? "Dashboard";
  const effectiveRole = viewAs ?? user?.role ?? "STAFF";
  const avatarInitials =
    user?.name
      ?.split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("") ?? "?";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node))
        setUserMenuOpen(false);
      if (exportRef.current && !exportRef.current.contains(e.target as Node))
        setExportOpen(false);
      if (roleRef.current && !roleRef.current.contains(e.target as Node))
        setRoleMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="app" data-sidebar={collapsed ? "collapsed" : "expanded"}>
      {/* ==================== SIDEBAR ==================== */}
      <aside className="sidebar" aria-label="Navigasi utama">
        <div className="sidebar-brand">
          {!collapsed && (
            <img
              className="logo sidebar-brand-img"
              src="/brand/logo-pln-simpp-white-ic.svg"
              alt="PLN"
              style={{
                width: 196,
                height: 44,
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div
            className="sidebar-brand-text"
            onClick={() => setCollapsed((v) => !v)}>
            <Menu color="#FFFFFF" size={20} />
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Halaman">
          {NAV_ITEMS.map((section) => {
            // hideForUpmk: sembunyikan dari user unit UPMK (non-KP)
            const isUpmkUser = user?.unit && user.unit !== "KP";
            // devOnly: hanya tampil untuk SUPERADMIN dan DEVELOPER
            const isPrivileged =
              user?.role === "SUPERADMIN" || user?.role === "DEVELOPER";
            const visibleItems = section.submenus.filter((it) => {
              const nav = it as { hideForUpmk?: boolean; devOnly?: boolean };
              if (isUpmkUser && nav.hideForUpmk) return false;
              if (nav.devOnly && !isPrivileged) return false;
              return true;
            });
            if (visibleItems.length === 0) return null;

            const SectionIcon = (
              section as { icon?: React.ComponentType<{ size?: number }> }
            ).icon;
            const hasMultipleSubmenus = section.submenus?.length > 1;
            const showSectionIcon = hasMultipleSubmenus && SectionIcon;

            // Cek apakah salah satu submenu di section ini sedang aktif
            const isSectionActive = visibleItems.some(({ to, end }) => {
              return (
                location.pathname === to ||
                (!end && to !== "/" && location.pathname.startsWith(to))
              );
            });

            const sectionId = `nav-section-${section.section
              .toLowerCase()
              .replace(/\s+/g, "-")}`;
            // Sections with only one submenu are always "open" (nothing to toggle)
            const isOpen = hasMultipleSubmenus
              ? !!openSections[section.section]
              : true;

            return (
              <div key={section.section}>
                <button
                  type="button"
                  className="nav-section"
                  aria-current={isSectionActive ? "page" : undefined}
                  aria-expanded={hasMultipleSubmenus ? isOpen : undefined}
                  aria-controls={hasMultipleSubmenus ? sectionId : undefined}
                  disabled={!hasMultipleSubmenus}
                  onClick={() =>
                    hasMultipleSubmenus && toggleSection(section.section)
                  }>
                  {showSectionIcon && <SectionIcon size={14} />}
                  <span className="nav-section-label">{section.section}</span>
                </button>

                <div
                  id={sectionId}
                  className="nav-section-collapse"
                  data-open={isOpen}>
                  <div className="nav-section-items">
                    {visibleItems.map(({ to, label, icon: Icon, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className="nav-item"
                        aria-current={
                          location.pathname === to ||
                          (!end &&
                            location.pathname.startsWith(to) &&
                            to !== "/")
                            ? "page"
                            : undefined
                        }
                        title={collapsed ? label : undefined}>
                        <span className="nav-label">{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="sidebar-overlay" aria-hidden="true" />

      {/* ==================== TOPBAR ==================== */}
      <header className="topbar" role="banner">
        <div className="topbar-left">
          <button
            className="icon-btn hamburger-btn"
            aria-label="Buka menu"
            onClick={() => setCollapsed((v) => !v)}>
            <Menu size={18} />
          </button>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span className="breadcrumb-prev">Dashboard</span>
            <span className="breadcrumb-sep breadcrumb-prev">/</span>
            <span className="breadcrumb-current">{currentPageName}</span>
          </nav>
        </div>

        <div className="topbar-center">
          <div
            className="segmented"
            role="group"
            aria-label="Periode pelaporan">
            {(["Bulan", "Semester", "Tahun"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={periodMode === mode}
                onClick={() => setPeriodMode(mode)}>
                {mode}
              </button>
            ))}
          </div>
          {/* Pemilih periode dashboard — dashboard mengikuti periode terpilih */}
          {periods.length > 0 && (
            <select
              className="form-input form-input-sm"
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              style={{
                width: "auto",
                minWidth: 130,
                marginLeft: 8,
                fontWeight: 700,
              }}
              title="Periode data dashboard"
              aria-label="Periode dashboard">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="topbar-right">
          {/* Role badge / View As */}
          <div className="dropdown-anchor" ref={roleRef}>
            <button
              className="role-badge"
              aria-label="Mode pengguna"
              aria-haspopup="true"
              aria-expanded={roleMenuOpen}
              onClick={() => setRoleMenuOpen((v) => !v)}>
              <span className="dot" />
              <span>
                Mode:{" "}
                <strong>{ROLE_LABELS[effectiveRole] ?? effectiveRole}</strong>
              </span>
              <ChevronDown size={12} style={{ opacity: 0.6 }} />
            </button>
            <div
              className="dropdown-menu"
              data-open={String(roleMenuOpen)}
              role="menu">
              <div className="role-switcher-section">
                <div className="role-switcher-label">View As (Demo)</div>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <button
                    key={k}
                    className="role-option"
                    role="menuitemradio"
                    aria-pressed={effectiveRole === k}
                    onClick={() => {
                      setViewAs(k === user?.role ? null : k);
                      setRoleMenuOpen(false);
                    }}>
                    <User size={14} />
                    <span className="role-label">{v}</span>
                    <span className="role-level">{k}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search */}
          <button
            className="icon-btn"
            aria-label="Cari (Ctrl+K)"
            title="Ctrl+K">
            <Search size={18} />
          </button>

          {/* Notifications */}
          <div className="dropdown-anchor" ref={notifRef}>
            <button
              className="icon-btn icon-solid"
              aria-label="Notifikasi"
              aria-haspopup="true"
              aria-expanded={notifOpen}
              onClick={() => setNotifOpen((v) => !v)}>
              <Bell size={18} />
              {unreadCount > 0 && <span className="badge" aria-hidden="true" />}
            </button>
            <div
              className="dropdown-menu wide"
              data-open={String(notifOpen)}
              role="menu">
              <div className="dropdown-header">
                <span className="dropdown-title">Notifikasi</span>
                <button className="dropdown-action" onClick={markAllRead}>
                  Tandai semua dibaca
                </button>
              </div>
              <div className="notif-list">
                {notifs.length === 0 && (
                  <div
                    style={{
                      padding: "24px",
                      textAlign: "center",
                      color: "var(--color-text-muted)",
                      fontSize: "var(--text-xs)",
                    }}>
                    Tidak ada notifikasi
                  </div>
                )}
                {notifs.map((n) => (
                  <div
                    key={n.id}
                    className={`notif-item${n.unread ? " unread" : ""}`}
                    onClick={() => {
                      if (n.route) {
                        // Sisipkan targetId sebagai `focus` agar kartu terkait di-highlight (Task 10).
                        const tid = (n as { targetId?: string }).targetId;
                        const route = tid
                          ? `${n.route}${n.route.includes("?") ? "&" : "?"}focus=${encodeURIComponent(tid)}`
                          : n.route;
                        navigate(route);
                      }
                      setNotifOpen(false);
                    }}>
                    <div
                      className={`notif-icon ${n.type === "alert" ? "warning" : "info"}`}>
                      <Bell size={14} />
                    </div>
                    <div className="notif-body">
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-msg">{n.msg}</div>
                    </div>
                  </div>
                ))}
              </div>

              <button className="notif-clear">
                <div className="notif-clear-text">Hapus Semua Notifikasi</div>
              </button>
            </div>
          </div>

          {/* Export */}
          <div className="dropdown-anchor" ref={exportRef}>
            <button
              className="btn btn-secondary"
              aria-haspopup="true"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen((v) => !v)}>
              <Download size={14} />
              <span className="btn-export-text">Ekspor</span>
              <ChevronDown size={12} />
            </button>
            <div
              className="dropdown-menu"
              data-open={String(exportOpen)}
              role="menu">
              <button className="dropdown-item">
                <FileText size={14} />
                <span>Ekspor PDF</span>
              </button>
              <button className="dropdown-item">
                <FileSpreadsheet size={14} />
                <span>Ekspor CSV</span>
              </button>
              <button className="dropdown-item">
                <Image size={14} />
                <span>Unduh Chart (PNG)</span>
              </button>
              <div className="dropdown-divider" />
              <button className="dropdown-item">
                <Printer size={14} />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* War Room */}
          <button
            className="btn btn-ghost"
            aria-label="War Room Mode"
            title="War Room Mode — auto-rotate fullscreen"
            onClick={() => setWarRoomActive(true)}>
            <Tv2 size={16} />
            <span className="btn-warroom-text">War Room</span>
          </button>

          {/* Theme toggle */}
          <button
            className="icon-btn icon-solid"
            aria-label="Ubah tema"
            onClick={toggleTheme}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* User menu */}
          <div className="dropdown-anchor" ref={userRef}>
            <button
              className="icon-btn"
              aria-haspopup="true"
              aria-expanded={userMenuOpen}
              aria-label="Menu pengguna"
              onClick={() => setUserMenuOpen((v) => !v)}>
              <div className="user-avatar" aria-hidden="true">
                {avatarInitials}
              </div>
            </button>
            <div
              className="dropdown-menu wider"
              data-open={String(userMenuOpen)}
              role="menu">
              <div className="user-menu-header">
                <div className="user-avatar">{avatarInitials}</div>
                <div className="user-menu-info">
                  <div className="user-menu-name">{user?.name}</div>
                  <div className="user-menu-email">{user?.email}</div>
                </div>
              </div>
              <div className="dropdown-divider" />
              {/* <button className="dropdown-item">
                <User size={14} />
                <span>Profil saya</span>
              </button> */}
              <NavLink
                to="/settings"
                className="dropdown-item"
                onClick={() => setUserMenuOpen(false)}>
                <Settings size={14} />
                <span>Pengaturan Akun</span>
              </NavLink>
              {/* <button className="dropdown-item">
                <HelpCircle size={14} />
                <span>Bantuan</span>
              </button> */}
              {/* <div className="dropdown-divider" /> */}
              <button className="dropdown-item" onClick={handleLogout}>
                <LogOut size={14} />
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ==================== MAIN ==================== */}
      <main id="main-content" className="main" tabIndex={-1}>
        <div className="main-inner" id="main-inner">
          <Outlet />
        </div>
      </main>

      {/* War Room overlay */}
      {warRoomActive && (
        <div className="warroom-overlay">
          <button
            className="warroom-close"
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              color: "rgba(255,255,255,0.7)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            onClick={() => setWarRoomActive(false)}>
            ✕
          </button>
          <div style={{ textAlign: "center", opacity: 0.4 }}>
            <Tv2 size={48} color="#fff" />
            <p style={{ color: "#fff", marginTop: 12, fontSize: 16 }}>
              War Room — Coming in next build
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
