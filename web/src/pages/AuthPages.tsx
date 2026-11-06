import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { homeFor } from '../components/Layout';
import { Field, FormError } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const u = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : homeFor(u.role), { replace: true });
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
            Student with a school record? <Link to="/register">Activate your account</Link>
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

export function RegisterPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    studentNumber: '',
    email: '',
    firstName: '',
    lastName: '',
    password: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const u = await api.auth.register(form);
      setUser(u);
      navigate('/me', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <div>
          <h1>Activate student account</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Use the student number and email your school has on file.
          </p>
        </div>
        <FormError error={error} />
        <Field label="Student number" htmlFor="sn">
          <input
            id="sn"
            className="input"
            value={form.studentNumber}
            onChange={set('studentNumber')}
            required
          />
        </Field>
        <Field label="School email" htmlFor="em">
          <input
            id="em"
            className="input"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <div className="form-grid">
          <Field label="First name" htmlFor="fn">
            <input
              id="fn"
              className="input"
              value={form.firstName}
              onChange={set('firstName')}
              required
            />
          </Field>
          <Field label="Last name" htmlFor="ln">
            <input
              id="ln"
              className="input"
              value={form.lastName}
              onChange={set('lastName')}
              required
            />
          </Field>
        </div>
        <Field label="Password (8+ characters, a letter and a number)" htmlFor="pw">
          <input
            id="pw"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
          />
        </Field>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </button>
        <p className="subtle" style={{ margin: 0 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
