import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Card, EmptyState, Field, FormError, PageHeader } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';

export function AccountPage() {
  const { user, setUser, logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const change = useMutation({
    mutationFn: () => api.auth.changePassword(form.currentPassword, form.newPassword),
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '' });
      if (user) setUser(user);
    },
  });
  return (
    <>
      <PageHeader title="Account" subtitle={user?.email} />
      <div className="grid grid-2">
        <Card
          title="Change password"
          subtitle="Changing your password signs out all your other sessions."
        >
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              change.mutate();
            }}
          >
            <FormError error={change.error} />
            {change.isSuccess && <div className="alert-box success">Password updated.</div>}
            <Field label="Current password" htmlFor="cp">
              <input
                id="cp"
                type="password"
                autoComplete="current-password"
                className="input"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              />
            </Field>
            <Field label="New password" htmlFor="np">
              <input
                id="np"
                type="password"
                autoComplete="new-password"
                className="input"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                disabled={change.isPending || !form.currentPassword || !form.newPassword}
              >
                Update password
              </button>
            </div>
          </form>
        </Card>
        <Card title="Session">
          <p className="muted" style={{ marginTop: 0 }}>
            Signed in as {user?.firstName} {user?.lastName} ({user?.role.toLowerCase()}).
          </p>
          <button className="btn" onClick={() => void logout()}>
            Sign out
          </button>
        </Card>
      </div>
    </>
  );
}

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState title="Page not found">
        <Link to="/">Go home</Link>
      </EmptyState>
    </Card>
  );
}
