import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/api';
import { Loading } from './ui';

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ['ADMIN', 'TEACHER'] },
  { to: '/me', label: 'My progress', roles: ['STUDENT'] },
  { to: '/students', label: 'Students', roles: ['ADMIN', 'TEACHER'] },
  { to: '/courses', label: 'Courses', roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
  { to: '/alerts', label: 'Risk alerts', roles: ['ADMIN', 'TEACHER'] },
  { to: '/admin/users', label: 'Users', roles: ['ADMIN'] },
  { to: '/admin/settings', label: 'Settings', roles: ['ADMIN'] },
  { to: '/account', label: 'Account', roles: ['ADMIN', 'TEACHER', 'STUDENT'] },
];

export const homeFor = (role: Role) => (role === 'STUDENT' ? '/me' : '/dashboard');

/**
 * Explicit sign-out: end the session, then go to /login *without* remembering
 * the current page (unlike an expired session), so the next person signing in
 * on this browser is not sent to the previous user's screen.
 */
export function useSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return async () => {
    await logout();
    navigate('/login', { replace: true });
  };
}

/** Route guard: unauthenticated users go to /login (remembering where they were headed). */
export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading)
    return (
      <div className="main">
        <Loading />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

/**
 * Role guard for UX only. It hides screens a role cannot use; the real
 * enforcement is the API's RBAC, which rejects the request regardless.
 */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, isLoading } = useAuth();
  // Wait for the session check; redirecting now would bounce a logged-in user to /login.
  if (isLoading) return <Loading />;
  if (!user || !roles.includes(user.role))
    return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
  return <Outlet />;
}

function AppShell() {
  const { user } = useAuth();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const links = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          Learning Analytics
        </div>
        <nav onClick={() => setOpen(false)}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className="nav-link">
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>
            <div style={{ fontWeight: 600 }}>
              {user.firstName} {user.lastName}
            </div>
            <div className="subtle">
              {user.role.charAt(0) + user.role.slice(1).toLowerCase()} · {user.email}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <button className="btn btn-sm" onClick={() => setOpen(true)} aria-label="Open navigation">
            ☰
          </button>
          <strong>Learning Analytics</strong>
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
