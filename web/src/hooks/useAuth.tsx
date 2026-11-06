import { type Query, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from 'react';
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

  /**
   * Switch the cached session to `user` (null = signed out) and drop every other
   * cached query, so no data from the previous session can be shown again.
   *
   * Never use `qc.clear()` here: it also removes the `me` query object that the
   * `useQuery` above is subscribed to. The following `setQueryData` then creates
   * a *new* query that nobody observes, so React keeps rendering the old user.
   * That was the sign-out bug. Instead we update `me` in place (its observer
   * re-renders the route guards) and remove only the other queries.
   */
  const switchSession = useCallback(
    (user: SessionUser | null) => {
      const isSession = (q: Query) => q.queryKey[0] === qk.me[0];
      void qc.cancelQueries({ predicate: (q) => !isSession(q) });
      qc.setQueryData(qk.me, user);
      qc.removeQueries({ predicate: (q) => !isSession(q) });
    },
    [qc],
  );

  // Any 401 from the API (expired/revoked session) logs the UI out.
  useEffect(() => onUnauthorized(() => switchSession(null)), [switchSession]);

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
        switchSession(user); // never show the previous user's cached data
        return user;
      },
      logout: async () => {
        // The server clears the httpOnly cookie. If the request fails (offline),
        // still end the session in the UI; the cookie then simply expires.
        await api.auth.logout().catch(() => undefined);
        switchSession(null);
      },
      setUser: switchSession,
    }),
    [me.data, me.isPending, loginMutation, switchSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
