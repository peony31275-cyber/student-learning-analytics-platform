import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Card,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  Pagination,
  QueryState,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, qk } from '../services/api';

export function CoursesPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const q = { page, pageSize: 20, search: debounced || undefined };
  const courses = useQuery({
    queryKey: qk.courses(q),
    queryFn: () => api.courses.list(q),
    placeholderData: keepPreviousData,
  });
  const staff = user?.role !== 'STUDENT';

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={
          user?.role === 'TEACHER'
            ? 'Courses you teach'
            : user?.role === 'STUDENT'
              ? 'Courses you are enrolled in'
              : 'All courses in the school'
        }
        actions={
          staff && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              New course
            </button>
          )
        }
      />
      <Card>
        <div className="filters">
          <input
            className="input"
            style={{ flex: '1 1 220px' }}
            placeholder="Search code or name…"
            aria-label="Search courses"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <QueryState
          query={courses}
          isEmpty={(d) => d.data.length === 0}
          empty={<EmptyState title="No courses found" />}
        >
          {(d) => (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Term</th>
                      <th>Teacher</th>
                      <th className="right">Students</th>
                      <th className="right">Assessments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((c) => (
                      <tr key={c.id}>
                        <td>{staff ? <Link to={`/courses/${c.id}`}>{c.code}</Link> : c.code}</td>
                        <td>{c.name}</td>
                        <td>{c.term}</td>
                        <td>
                          {c.teacher.firstName} {c.teacher.lastName}
                        </td>
                        <td className="right num">{c.studentCount}</td>
                        <td className="right num">{c.assessmentCount}</td>
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
      {creating && <CreateCourseModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateCourseModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const teachers = useQuery({
    queryKey: qk.users({ role: 'TEACHER', pageSize: 100 }),
    queryFn: () => api.users.list({ role: 'TEACHER', pageSize: 100 }),
    enabled: user?.role === 'ADMIN',
  });
  const [form, setForm] = useState({
    code: '',
    name: '',
    term: '2026-Fall',
    credits: '3',
    description: '',
    teacherId: '',
  });
  const create = useMutation({
    mutationFn: () =>
      api.courses.create({
        code: form.code,
        name: form.name,
        term: form.term,
        credits: Number(form.credits),
        description: form.description || null,
        ...(user?.role === 'ADMIN' && { teacherId: form.teacherId }),
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/courses/${c.id}`);
    },
  });
  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="New course" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormError error={create.error} />
        <div className="form-grid">
          <Field label="Code" htmlFor="n-code">
            <input
              id="n-code"
              className="input"
              placeholder="MATH-101"
              value={form.code}
              onChange={set('code')}
              required
            />
          </Field>
          <Field label="Term" htmlFor="n-term">
            <input
              id="n-term"
              className="input"
              placeholder="2026-Fall"
              value={form.term}
              onChange={set('term')}
              required
            />
          </Field>
          <Field label="Credits" htmlFor="n-cr">
            <input
              id="n-cr"
              className="input"
              type="number"
              min={0}
              max={10}
              value={form.credits}
              onChange={set('credits')}
            />
          </Field>
        </div>
        <Field label="Name" htmlFor="n-name">
          <input id="n-name" className="input" value={form.name} onChange={set('name')} required />
        </Field>
        {user?.role === 'ADMIN' && (
          <Field label="Teacher" htmlFor="n-t">
            <select
              id="n-t"
              className="select"
              value={form.teacherId}
              onChange={set('teacherId')}
              required
            >
              <option value="">Select a teacher…</option>
              {teachers.data?.data
                .filter((t) => t.teacherProfile && t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.teacherProfile!.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Description" htmlFor="n-d">
          <textarea
            id="n-d"
            className="input"
            rows={3}
            value={form.description}
            onChange={set('description')}
          />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Create course
          </button>
        </div>
      </form>
    </Modal>
  );
}
