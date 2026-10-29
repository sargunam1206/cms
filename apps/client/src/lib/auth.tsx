import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@cms/shared';
import { api, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from '@/api/client';
import type { Me } from '@/api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** UI convenience only; the server enforces every permission. */
  can: (...perms: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadMe = useCallback(async () => {
    const { data } = await api.get<Me>('/auth/me');
    setUser(data);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      qc.clear();
    });
    // Restore the session from the refresh cookie on page load
    refreshAccessToken()
      .then(loadMe)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [loadMe, qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<{ accessToken: string }>('/auth/login', { email, password });
      setAccessToken(data.accessToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
    }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
