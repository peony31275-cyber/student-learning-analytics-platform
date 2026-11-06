import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Card,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  Pagination,
  QueryState,
  RiskBadge,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, qk } from '../services/api';

export function StudentsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);

  // Filter state lives in the URL: shareable, bookmarkable, survives refresh.
  const q = {
    page: Number(params.get('page') ?? 1),
    pageSize: 15,
    search: debounced || undefined,
    courseId: params.get('courseId') ?? undefined,
    riskLevel: params.get('riskLevel') ?? undefined,
    gradeLevel: params.get('gradeLevel') ?? undefined,
  };
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const students = useQuery({
    queryKey: qk.students(q),
    queryFn: () => api.students.list(q),
    placeholderData: keepPreviousData,
  });
  const courses = useQuery({
    queryKey: qk.courses({ pageSize: 100 }),
    queryFn: () => api.courses.list({ pageSize: 100 }),
  });

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Profiles, enrollments and current risk level"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Add student
          </button>
        }
      />
      <Card>
        <div className="filters">
          <input
            className="input"
            style={{ flex: '1 1 220px' }}
            placeholder="Search name, number or email…"
            aria-label="Search students"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              update({ search: e.target.value || undefined });
            }}
          />
          <select
            className="select"
            aria-label="Course"
            value={q.courseId ?? ''}
            onChange={(e) => update({ courseId: e.target.value || undefined })}
          >
            <option value="">All courses</option>
            {courses.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Risk level"
            value={q.riskLevel ?? ''}
            onChange={(e) => update({ riskLevel: e.target.value || undefined })}
          >
            <option value="">Any risk</option>
            <option value="HIGH">High risk</option>
            <option value="MEDIUM">Medium risk</option>
            <option value="LOW">Low risk</option>
          </select>
          <select
            className="select"
            aria-label="Grade level"
            value={q.gradeLevel ?? ''}
            onChange={(e) => update({ gradeLevel: e.target.value || undefined })}
          >
            <option value="">All grades</option>
            {[9, 10, 11, 12].map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </div>
        <QueryState
          query={students}
          isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState title="No students match these filters" />}
        >
          {(d) => (
            <>
              <div className="table-wrap" style={{ opacity: students.isPlaceholderData ? 0.6 : 1 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Student #</th>
                      <th className="right">Grade</th>
                      <th className="right">Courses</th>
                      <th>Account</th>
                      <th>Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/students/${s.id}`}>
                            {s.lastName}, {s.firstName}
                          </Link>
                        </td>
                        <td className="num">{s.studentNumber}</td>
                        <td className="right num">{s.gradeLevel}</td>
                        <td className="right num">{s.activeCourses}</td>
                        <td>
                          {s.hasAccount ? 'Active' : <span className="subtle">Not activated</span>}
                        </td>
                        <td>
                          <RiskBadge level={s.riskLevel} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={d.meta} onPage={(p) => update({ page: String(p) })} />
            </>
          )}
        </QueryState>
      </Card>
      {creating && <CreateStudentModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateStudentModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({
    queryKey: qk.courses({ pageSize: 100 }),
    queryFn: () => api.courses.list({ pageSize: 100 }),
  });
  const [form, setForm] = useState({
    studentNumber: '',
    firstName: '',
    lastName: '',
    email: '',
    gradeLevel: '9',
  });
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      api.students.create({
        ...form,
        email: form.email || null,
        gradeLevel: Number(form.gradeLevel),
        courseIds,
      }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      navigate(`/students/${s.id}`);
    },
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Modal title="Add student" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <FormError error={create.error} />
        <div className="form-grid">
          <Field label="Student number" htmlFor="c-sn">
            <input
              id="c-sn"
              className="input"
              value={form.studentNumber}
              onChange={set('studentNumber')}
              required
            />
          </Field>
          <Field label="Grade level" htmlFor="c-gl">
            <select
              id="c-gl"
              className="select"
              value={form.gradeLevel}
              onChange={set('gradeLevel')}
            >
              {[9, 10, 11, 12].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="First name" htmlFor="c-fn">
            <input
              id="c-fn"
              className="input"
              value={form.firstName}
              onChange={set('firstName')}
              required
            />
          </Field>
          <Field label="Last name" htmlFor="c-ln">
            <input
              id="c-ln"
              className="input"
              value={form.lastName}
              onChange={set('lastName')}
              required
            />
          </Field>
        </div>
        <Field label="Email (optional, used for account activation)" htmlFor="c-em">
          <input
            id="c-em"
            type="email"
            className="input"
            value={form.email}
            onChange={set('email')}
          />
        </Field>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="stat-label" style={{ marginBottom: 6 }}>
            Enroll in {user?.role === 'TEACHER' && '(at least one)'}
          </legend>
          <div className="row">
            {courses.data?.data.map((c) => (
              <label key={c.id} className="badge" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={courseIds.includes(c.id)}
                  onChange={(e) =>
                    setCourseIds(
                      e.target.checked
                        ? [...courseIds, c.id]
                        : courseIds.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.code}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Create student'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
