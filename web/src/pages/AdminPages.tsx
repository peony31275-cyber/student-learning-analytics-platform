import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { RULE_LABEL } from '../charts/charts';
import {
  Card,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  Pagination,
  QueryState,
  fmtDate,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, qk } from '../services/api';
import type { RiskConfig, Role, School, TierRule } from '../types/api';

// ── Users ───────────────────────────────────────────────────────────────────
export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<Role | ''>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const q = { page, pageSize: 20, role: role || undefined, search: debounced || undefined };
  const users = useQuery({
    queryKey: qk.users(q),
    queryFn: () => api.users.list(q),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.users.update(id, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Staff accounts and activated student logins"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Add staff user
          </button>
        }
      />
      <Card>
        <div className="filters">
          <input
            className="input"
            style={{ flex: '1 1 220px' }}
            placeholder="Search name or email…"
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="select"
            aria-label="Role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role | '');
              setPage(1);
            }}
          >
            <option value="">All roles</option>
            <option value="ADMIN">Admins</option>
            <option value="TEACHER">Teachers</option>
            <option value="STUDENT">Students</option>
          </select>
        </div>
        <FormError error={toggle.error} />
        <QueryState
          query={users}
          isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState title="No users found" />}
        >
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Detail</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.firstName} {u.lastName}
                        </td>
                        <td>{u.email}</td>
                        <td>{u.role.toLowerCase()}</td>
                        <td className="subtle">
                          {u.teacherProfile?.department ??
                            (u.studentProfile && `#${u.studentProfile.studentNumber}`) ??
                            '—'}
                        </td>
                        <td className="subtle">
                          {u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'never'}
                        </td>
                        <td>
                          {u.isActive ? (
                            <span className="badge badge-low">Active</span>
                          ) : (
                            <span className="badge">Disabled</span>
                          )}
                        </td>
                        <td className="right">
                          {u.id !== me?.id && (
                            <button
                              className="btn btn-sm"
                              disabled={toggle.isPending}
                              onClick={() => toggle.mutate({ id: u.id, isActive: !u.isActive })}
                            >
                              {u.isActive ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={d.meta} onPage={setPage} />
            </>
          )}
        </QueryState>
      </Card>
      {creating && <CreateUserModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    role: 'TEACHER',
    email: '',
    firstName: '',
    lastName: '',
    department: '',
    password: '',
  });
  const create = useMutation({
    mutationFn: () => api.users.create({ ...form, department: form.department || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="Add staff user" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormError error={create.error} />
        <div className="form-grid">
          <Field label="Role" htmlFor="u-r">
            <select id="u-r" className="select" value={form.role} onChange={set('role')}>
              <option value="TEACHER">Teacher</option>
              <option value="ADMIN">Admin</option>
            </select>
          </Field>
          <Field label="Department" htmlFor="u-d">
            <input
              id="u-d"
              className="input"
              value={form.department}
              onChange={set('department')}
              disabled={form.role !== 'TEACHER'}
            />
          </Field>
          <Field label="First name" htmlFor="u-fn">
            <input
              id="u-fn"
              className="input"
              value={form.firstName}
              onChange={set('firstName')}
              required
            />
          </Field>
          <Field label="Last name" htmlFor="u-ln">
            <input
              id="u-ln"
              className="input"
              value={form.lastName}
              onChange={set('lastName')}
              required
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="u-e">
          <input
            id="u-e"
            type="email"
            className="input"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <Field label="Initial password (8+ chars, letter and number)" htmlFor="u-p">
          <input
            id="u-p"
            type="password"
            autoComplete="new-password"
            className="input"
            value={form.password}
            onChange={set('password')}
            required
          />
        </Field>
        <p className="subtle" style={{ margin: 0 }}>
          Students activate their own accounts from the sign-in page using their student number.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Create user
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Settings (school + early-warning configuration) ─────────────────────────
export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="School information and early-warning configuration" />
      <div className="stack">
        <SchoolSettings />
        <RiskSettings />
      </div>
    </>
  );
}

function SchoolSettings() {
  const school = useQuery({ queryKey: qk.school, queryFn: api.school.get });
  return (
    <Card title="School">
      <QueryState query={school}>{(s) => <SchoolForm school={s} />}</QueryState>
    </Card>
  );
}

function SchoolForm({ school: s }: { school: School }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: s.name, timezone: s.timezone });
  const save = useMutation({
    mutationFn: () => api.school.update(form),
    onSuccess: (updated) => qc.setQueryData(qk.school, updated),
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <FormError error={save.error} />
      {save.isSuccess && <div className="alert-box success">Saved.</div>}
      <div className="form-grid">
        <Field label="Name" htmlFor="s-n">
          <input
            id="s-n"
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Timezone" htmlFor="s-tz">
          <input
            id="s-tz"
            className="input"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
        </Field>
      </div>
      <div className="row">
        <span className="subtle">
          {s.counts.students} active students · {s.counts.teachers} teachers · {s.counts.courses}{' '}
          courses
        </span>
        <span className="spacer" />
        <button className="btn btn-primary" disabled={save.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

const RULE_HELP: Record<string, string> = {
  recentPerformance:
    'Average % of the most recent graded assessments. Below the threshold adds points.',
  decliningTrend:
    'Drop (percentage points) from earlier work to recent work. A larger drop adds points.',
  attendance: 'Share of class meetings attended. Below the threshold adds points.',
  completion: 'Share of assigned work submitted. Below the threshold adds points.',
};

function RiskSettings() {
  const config = useQuery({ queryKey: qk.riskConfig, queryFn: api.risk.config });
  return (
    <Card
      title="Early-warning rules"
      subtitle="Each triggered rule adds points; the total (0–100) decides the risk level. Saving recalculates every alert."
    >
      <QueryState query={config}>{(c) => <RiskConfigForm config={c} />}</QueryState>
    </Card>
  );
}

function RiskConfigForm({ config: saved }: { config: RiskConfig }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<RiskConfig>(() => structuredClone(saved));
  const save = useMutation({
    mutationFn: (c: RiskConfig) => api.risk.updateConfig(c),
    onSuccess: (r) => {
      qc.setQueryData(qk.riskConfig, r.config);
      for (const k of [['risk', 'alerts'], ['analytics'], ['students']])
        void qc.invalidateQueries({ queryKey: k });
    },
  });
  const setRule = (rule: keyof RiskConfig['rules'], patch: Partial<TierRule>) =>
    setDraft({ ...draft, rules: { ...draft.rules, [rule]: { ...draft.rules[rule], ...patch } } });
  const n = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <FormError error={save.error} />
      {save.data && (
        <div className="alert-box success">
          Saved. Re-evaluated {save.data.recalculation.evaluated} enrollments:{' '}
          {save.data.recalculation.byLevel.HIGH} high, {save.data.recalculation.byLevel.MEDIUM}{' '}
          medium.
        </div>
      )}
      <div className="form-grid">
        <Field label="Medium risk at score ≥" htmlFor="lv-m">
          <input
            id="lv-m"
            className="input"
            type="number"
            value={draft.levels.medium}
            onChange={(e) =>
              setDraft({ ...draft, levels: { ...draft.levels, medium: n(e.target.value) } })
            }
          />
        </Field>
        <Field label="High risk at score ≥" htmlFor="lv-h">
          <input
            id="lv-h"
            className="input"
            type="number"
            value={draft.levels.high}
            onChange={(e) =>
              setDraft({ ...draft, levels: { ...draft.levels, high: n(e.target.value) } })
            }
          />
        </Field>
        <Field label="Recent window (assessments)" htmlFor="rw">
          <input
            id="rw"
            className="input"
            type="number"
            value={draft.recentWindow}
            onChange={(e) => setDraft({ ...draft, recentWindow: n(e.target.value) })}
          />
        </Field>
        <Field label="Min graded assessments" htmlFor="mg">
          <input
            id="mg"
            className="input"
            type="number"
            value={draft.minGradedAssessments}
            onChange={(e) => setDraft({ ...draft, minGradedAssessments: n(e.target.value) })}
          />
        </Field>
        <Field label="Min attendance sessions" htmlFor="ms">
          <input
            id="ms"
            className="input"
            type="number"
            value={draft.minAttendanceSessions}
            onChange={(e) => setDraft({ ...draft, minAttendanceSessions: n(e.target.value) })}
          />
        </Field>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>On</th>
              <th className="right">Warn threshold</th>
              <th className="right">Warn pts</th>
              <th className="right">Critical threshold</th>
              <th className="right">Critical pts</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(draft.rules) as (keyof RiskConfig['rules'])[]).map((k) => {
              const r = draft.rules[k];
              const num = (field: keyof TierRule) => (
                <input
                  className="input num"
                  style={{ width: 72 }}
                  type="number"
                  aria-label={`${RULE_LABEL[k]} ${field}`}
                  value={r[field] as number}
                  onChange={(e) => setRule(k, { [field]: n(e.target.value) })}
                />
              );
              return (
                <tr key={k}>
                  <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                    <strong>{RULE_LABEL[k]}</strong>
                    <div className="subtle">{RULE_HELP[k]}</div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Enable ${RULE_LABEL[k]}`}
                      checked={r.enabled}
                      onChange={(e) => setRule(k, { enabled: e.target.checked })}
                    />
                  </td>
                  <td className="right">{num('warn')}</td>
                  <td className="right">{num('warnPoints')}</td>
                  <td className="right">{num('critical')}</td>
                  <td className="right">{num('criticalPoints')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={() => setDraft(structuredClone(saved))}>
          Reset
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving & recalculating…' : 'Save and recalculate'}
        </button>
      </div>
    </form>
  );
}
