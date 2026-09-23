import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../lib/types";

interface Props {
  children: React.ReactNode;
  roles?: Role[];
}

export function Protected({ children, roles }: Props) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role as Role))
    return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Inverse guard — for pages that should only be reachable when NOT logged in
// (e.g. /login). If a session already exists, redirect to the app's home page
// instead of rendering the guest-only page.
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Memuat…</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
