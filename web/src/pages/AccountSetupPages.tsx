import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { homeFor, useSignOut } from '../components/Layout';
import { Field, FormError, Loading } from '../components/ui';
import { type SessionEnd, useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { ApiError } from '../services/http';
import type { ActivationPreview } from '../types/api';
import type { LoginState } from './AuthPages';

function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="card auth-card stack">
        <div>
          <h1>{title}</h1>
          {intro && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {intro}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Student activation (one-time invite link) ──────────────────────────────────

/** The token is in the URL fragment (#token=…), which browsers never send to a server. */
function tokenFromHash(hash: string) {
  return /(?:^#|&)token=([^&]+)/.exec(hash)?.[1] ?? null;
}

const LINK_PROBLEMS: Record<string, { title: string; text: string }> = {
  ACTIVATION_TOKEN_INVALID: {
    title: 'This activation link is not valid',
    text: 'Make sure you opened the complete link. If it still does not work, ask your teacher or school administrator for a new one.',
  },
  ACTIVATION_TOKEN_EXPIRED: {
    title: 'This activation link has expired',
    text: 'Links work for 24 hours. Ask your teacher or school administrator for a new one.',
  },
  ACTIVATION_TOKEN_USED: {
    title: 'This activation link has already been used',
    text: 'If you activated your account, sign in. If you did not, contact your school.',
  },
  ACTIVATION_TOKEN_REVOKED: {
    title: 'This activation link was replaced',
    text: 'A newer link was created for you. Use the most recent one you received.',
  },
};

function linkProblem(err: unknown) {
  if (!(err instanceof ApiError)) return null;
  if (LINK_PROBLEMS[err.code]) return LINK_PROBLEMS[err.code]!;
  // Account problems (already exists, disabled, inactive record) carry the server's message.
  if (err.status === 409) return { title: 'This account cannot be activated', text: err.message };
  return null;
}

function Problem({ error }: { error: unknown }) {
  const problem = linkProblem(error);
  if (!problem) return <FormError error={error} />;
  return (
    <div className="alert-box error" role="alert">
      <strong>{problem.title}.</strong> {problem.text}
    </div>
  );
}

export function ActivatePage() {
  const { user } = useAuth();
  const location = useLocation();
  const token = tokenFromHash(location.hash);
  const preview = useQuery({
    queryKey: ['activation', token],
    queryFn: () => api.auth.verifyActivation(token!),
    enabled: !!token && !user,
    retry: false,
    staleTime: Infinity,
  });

  if (user) {
    return (
      <AuthCard title="Activate your account">
        <div className="alert-box info">
          You are signed in as {user.email}. Sign out, or open the activation link in a private
          window.
        </div>
        <Link to="/">Back to the app</Link>
      </AuthCard>
    );
  }
  if (!token) {
    return (
      <AuthCard
        title="Activate your account"
        intro="Account activation uses a personal link from your school."
      >
        <p style={{ margin: 0 }}>
          Ask your teacher or school administrator for an activation link, then open it in this
          browser. The link works once and expires after 24 hours.
        </p>
        <p className="subtle" style={{ margin: 0 }}>
          Already activated? <Link to="/login">Sign in</Link>
        </p>
      </AuthCard>
    );
  }
  if (preview.isPending) {
    return (
      <AuthCard title="Activate your account">
        <Loading />
      </AuthCard>
    );
  }
  if (preview.isError) {
    return (
      <AuthCard title="Activate your account">
        <Problem error={preview.error} />
        <p className="subtle" style={{ margin: 0 }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </AuthCard>
    );
  }
  return <ActivationForm token={token} student={preview.data} />;
}

function ActivationForm({ token, student }: { token: string; student: ActivationPreview }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const activate = useMutation({
    mutationFn: () => api.auth.activate(token, form.password),
    onSuccess: ({ email }) => {
      const state: LoginState = { notice: 'activated', email };
      navigate('/login', { replace: true, state });
    },
  });

  return (
    <AuthCard
      title="Activate your account"
      intro={`${student.firstName} ${student.lastName} · ${student.school}`}
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setMismatch(form.password !== form.confirm);
          if (form.password === form.confirm) activate.mutate();
        }}
      >
        {activate.error ? <Problem error={activate.error} /> : null}
        {mismatch && (
          <div className="alert-box error" role="alert">
            The passwords do not match.
          </div>
        )}
        <Field label="School email (you sign in with this)" htmlFor="act-email">
          <input
            id="act-email"
            className="input"
            value={student.email}
            readOnly
            autoComplete="username"
          />
        </Field>
        <Field label="New password (8+ characters, a letter and a number)" htmlFor="act-pw">
          <input
            id="act-pw"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </Field>
        <Field label="Confirm password" htmlFor="act-pw2">
          <input
            id="act-pw2"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            required
          />
        </Field>
        <button
          className="btn btn-primary"
          disabled={activate.isPending || !form.password || !form.confirm}
        >
          {activate.isPending ? 'Activating…' : 'Activate account'}
        </button>
      </form>
    </AuthCard>
  );
}

// ── First sign-in with a temporary password ────────────────────────────────────

/**
 * Users created by an admin must replace their temporary password first. The API
 * enforces this (403 PASSWORD_CHANGE_REQUIRED); this page is the only screen they
 * can reach until then.
 */
export function ChangePasswordPage() {
  const { user, endSession, sessionEnd } = useAuth();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => api.auth.changePassword(form.current, form.next),
    onSuccess: () => {
      // The server ended every session, this one included: sign in again.
      const end: SessionEnd = { notice: 'password-changed', email: user?.email };
      endSession(end);
      navigate('/login', { replace: true, state: end });
    },
  });

  if (!user) return <Navigate to="/login" replace state={sessionEnd} />;
  if (!user.mustChangePassword) return <Navigate to={homeFor(user.role)} replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <AuthCard
      title="Set your own password"
      intro="Your account was created with a temporary password. Choose a new one to continue; you will then sign in again."
    >
      <form
        className="stack"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setMismatch(form.next !== form.confirm);
          if (form.next === form.confirm) change.mutate();
        }}
      >
        <FormError error={change.error} />
        {mismatch && (
          <div className="alert-box error" role="alert">
            The new passwords do not match.
          </div>
        )}
        <Field label="Email" htmlFor="cp-email">
          <input
            id="cp-email"
            className="input"
            value={user.email}
            readOnly
            autoComplete="username"
          />
        </Field>
        <Field label="Temporary password" htmlFor="cp-current">
          <input
            id="cp-current"
            className="input"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={set('current')}
            required
          />
        </Field>
        <Field label="New password (8+ characters, a letter and a number)" htmlFor="cp-new">
          <input
            id="cp-new"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.next}
            onChange={set('next')}
            required
          />
        </Field>
        <Field label="Confirm new password" htmlFor="cp-confirm">
          <input
            id="cp-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
            required
          />
        </Field>
        <button
          className="btn btn-primary"
          disabled={change.isPending || !form.current || !form.next || !form.confirm}
        >
          {change.isPending ? 'Saving…' : 'Change password'}
        </button>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}
