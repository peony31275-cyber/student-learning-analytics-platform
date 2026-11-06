import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { homeFor } from '../components/Layout';
import { Field, FormError } from '../components/ui';
import { type SessionEnd, useAuth } from '../hooks/useAuth';
import type { SessionUser } from '../types/api';

/** Where a signed-in user belongs; a temporary password must be replaced first. */
export const startPageFor = (u: SessionUser) =>
  u.mustChangePassword ? '/change-password' : homeFor(u.role);

/** Passed to /login: where to return to, or a notice after a flow that ends with signing in. */
export type LoginState = SessionEnd & { from?: string };
const NOTICES = {
  activated: 'Your account is active. Sign in with your school email and the password you chose.',
  'password-changed': 'Your password was changed. Sign in again with the new password.',
};

const DEMO = [
  { label: 'Admin', email: 'admin@riverside.edu' },
  { label: 'Teacher (Math)', email: 'teacher1@riverside.edu' },
  { label: 'Student', email: 'student1@riverside.edu' },
];
const DEMO_PASSWORD = 'Password123';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LoginState | null) ?? {};
  const [email, setEmail] = useState(state.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  // One destination for both redirects below. The router applies navigations as
  // transitions, so this page can re-render with the new user before submit()'s
  // navigation lands; both then point to the same place.
  const from = state.from && state.from !== '/login' ? state.from : null;
  const destination = (u: SessionUser) => (u.mustChangePassword || !from ? startPageFor(u) : from);

  if (user) return <Navigate to={destination(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(destination(u), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card stack">
        <div className="brand" style={{ justifyContent: 'center', padding: 0 }}>
          <img src="/favicon.svg" alt="" /> Learning Analytics
        </div>
        <form className="card stack" onSubmit={submit} noValidate>
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Track performance and catch students who need support early.
            </p>
          </div>
          {state.notice && !error && (
            <div className="alert-box success" role="status">
              {NOTICES[state.notice]}
            </div>
          )}
          <FormError error={error} />
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <button className="btn btn-primary" disabled={pending || !email || !password}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="subtle" style={{ margin: 0 }}>
            Got an activation link from your school?{' '}
            <Link to="/activate">Activate your account</Link>
          </p>
        </form>
        <div className="card">
          <div className="stat-label">Demo accounts</div>
          <p className="subtle" style={{ margin: '4px 0 0' }}>
            Seeded data · password {DEMO_PASSWORD}
          </p>
          <div className="demo-accounts">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setEmail(d.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                <strong>{d.label}</strong>&nbsp;<span className="muted">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
