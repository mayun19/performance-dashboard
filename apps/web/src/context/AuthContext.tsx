import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode,
} from 'react';
import { auth as authApi } from '../lib/api';
import type { User } from '../lib/types';
import { schedule } from '@/lib/authScheduler';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  viewAs: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setViewAs: (role: string | null) => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true, viewAs: null,
  login: async () => {}, logout: async () => {}, setViewAs: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAs, setViewAs] = useState<string | null>(null);

useEffect(() => {
  authApi
    .me()
    .then((u) => {
      setUser(u);
      schedule(); // reload: only /auth/me is called, refresh timer starts fresh
    })
    .catch(() => setUser(null))
    .finally(() => setLoading(false));
}, []);

  // When a non-auth API call gets a persistent 401 (refresh also failed), clear user
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await authApi.login(email, password);
    setUser(u);
    schedule();
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, viewAs, login, logout, setViewAs }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
