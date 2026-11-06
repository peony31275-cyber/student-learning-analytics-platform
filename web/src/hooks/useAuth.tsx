import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { api, qk } from '../services/api';
import { ApiError, onUnauthorized } from '../services/http';
import type { SessionUser } from '../types/api';

interface AuthState {
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  setUser: (u: SessionUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Session state is server state: "who am I" is just the /auth/me query. The
 * token itself is an httpOnly cookie the JS never sees; the UI only knows the
 * user object returned by the API.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Any 401 from the API (expired/revoked session) logs the UI out.
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.setQueryData(qk.me, null);
      }),
    [qc],
  );

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.auth.login(email, password),
  });

  const value = useMemo<AuthState>(
    () => ({
      user: me.data ?? null,
      isLoading: me.isPending,
      login: async (email, password) => {
        const user = await loginMutation.mutateAsync({ email, password });
        qc.clear(); // never show the previous user's cached data
        qc.setQueryData(qk.me, user);
        return user;
      },
      logout: async () => {
        await api.auth.logout().catch(() => undefined);
        qc.clear();
        qc.setQueryData(qk.me, null);
      },
      setUser: (u) => {
        qc.clear();
        qc.setQueryData(qk.me, u);
      },
    }),
    [me.data, me.isPending, loginMutation, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
