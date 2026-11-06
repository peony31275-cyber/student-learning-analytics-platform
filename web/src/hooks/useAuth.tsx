import { type Query, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { api, qk } from '../services/api';
import { ApiError, onUnauthorized } from '../services/http';
import type { SessionUser } from '../types/api';

/** Why this browser ended the session on purpose; shown on /login. */
export type SessionEnd = { notice?: 'activated' | 'password-changed'; email?: string };

interface AuthActions {
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** The server already ended the session (e.g. password change): clear it here too. */
  endSession: (end: SessionEnd) => void;
}
interface AuthState extends AuthActions {
  user: SessionUser | null;
  isLoading: boolean;
  /**
   * Set after a deliberate sign-out or password change. Route guards redirect to
   * /login with this state instead of remembering the current page, so their
   * redirect is identical to the explicit one and the order of the two does not
   * matter (the session update and the router's navigation land in separate
   * ticks). Undefined after an expired session (401), which keeps "from".
   */
  sessionEnd: SessionEnd | undefined;
}

/**
 * Session state is server state: "who am I" is just the /auth/me query. The
 * token itself is an httpOnly cookie the JS never sees; the UI only knows the
 * user object returned by the API.
 */
const meQuery = queryOptions({
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
/** Starts with 'me', so switching sessions keeps it while dropping everything else. */
const SESSION_END = ['me', 'ended'] as const;

const AuthContext = createContext<AuthActions | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useQuery(meQuery); // starts the session check as soon as the app mounts

  /**
   * Switch the cached session to `user` (null = signed out) and drop every other
   * cached query, so no data from the previous session can be shown again.
   *
   * Never use `qc.clear()` here: it also removes the `me` query object that the
   * session observers are subscribed to. The following `setQueryData` then
   * creates a *new* query that nobody observes, so React keeps rendering the old
   * user. That was the sign-out bug. Instead we update `me` in place and remove
   * only the other queries.
   */
  const switchSession = useCallback(
    (user: SessionUser | null, end?: SessionEnd) => {
      const isSession = (q: Query) => q.queryKey[0] === qk.me[0];
      void qc.cancelQueries({ predicate: (q) => !isSession(q) });
      // Recorded before the session is cleared, so every re-render it causes sees it.
      if (end) qc.setQueryData(SESSION_END, end);
      else qc.removeQueries({ queryKey: SESSION_END, exact: true });
      qc.setQueryData(qk.me, user);
      qc.removeQueries({ predicate: (q) => !isSession(q) });
    },
    [qc],
  );

  // Any 401 from the API (expired/revoked session) logs the UI out.
  useEffect(() => onUnauthorized(() => switchSession(null)), [switchSession]);

  const actions = useMemo<AuthActions>(
    () => ({
      login: async (email, password) => {
        const user = await api.auth.login(email, password);
        switchSession(user); // never show the previous user's cached data
        return user;
      },
      logout: async () => {
        // The server clears the httpOnly cookie. If the request fails (offline),
        // still end the session in the UI; the cookie then simply expires.
        await api.auth.logout().catch(() => undefined);
        switchSession(null, {});
      },
      endSession: (end) => switchSession(null, end),
    }),
    [switchSession],
  );

  return <AuthContext.Provider value={actions}>{children}</AuthContext.Provider>;
}

/**
 * Each caller reads the session through its own query observer, which takes the
 * value from the cache on every render. A page rendered right after the session
 * changed (e.g. /login just after signing out) therefore never sees the previous
 * user, even though this provider sits above the router and re-renders later.
 */
export function useAuth(): AuthState {
  const actions = useContext(AuthContext);
  if (!actions) throw new Error('useAuth must be used inside <AuthProvider>');
  const qc = useQueryClient();
  const me = useQuery(meQuery);
  const sessionEnd = me.data ? undefined : qc.getQueryData<SessionEnd>(SESSION_END);
  return useMemo(
    () => ({ ...actions, user: me.data ?? null, isLoading: me.isPending, sessionEnd }),
    [actions, me.data, me.isPending, sessionEnd],
  );
}
