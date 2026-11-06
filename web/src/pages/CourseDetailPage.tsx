import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { AttendanceChart, ScoreTrendChart } from '../charts/charts';
import {
  Card,
  EmptyState,
  Field,
  FormError,
  Modal,
  PageHeader,
  QueryState,
  RiskBadge,
  StatCard,
  fmtDate,
  fmtPct,
} from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { api, qk } from '../services/api';
import { errorMessage } from '../services/http';
import type {
  AssessmentType,
  AttendanceSheet,
  AttendanceStatus,
  GradeStatus,
  Gradebook,
} from '../types/api';

const TABS = ['overview', 'roster', 'grades', 'attendance'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Analytics',
  roster: 'Roster',
  grades: 'Gradebook',
  attendance: 'Attendance',
};

/** After any write that feeds the risk engine, refresh the derived views. */
function useInvalidateDerived() {
  const qc = useQueryClient();
  return () => {
    for (const key of [['analytics'], ['risk'], ['students'], ['courses']])
      void qc.invalidateQueries({ queryKey: key });
  };
}

export function CourseDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'overview';
  const course = useQuery({ queryKey: qk.course(id), queryFn: () => api.courses.get(id) });

  return (
    <QueryState query={course}>
      {(c) => (
        <>
          <PageHeader
            title={`${c.code} · ${c.name}`}
            subtitle={
              <>
                {c.term} · {c.teacher.firstName} {c.teacher.lastName} · {c.studentCount} students
              </>
            }
          />
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setParams({ tab: t }, { replace: true })}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {tab === 'overview' && <CourseAnalytics courseId={id} />}
          {tab === 'roster' && <Roster courseId={id} />}
          {tab === 'grades' && <Grades courseId={id} />}
          {tab === 'attendance' && <AttendanceTaker courseId={id} />}
        </>
      )}
    </QueryState>
  );
}

function CourseAnalytics({ courseId }: { courseId: string }) {
  const f = { courseId };
  const overview = useQuery({
    queryKey: qk.analytics('overview', f),
    queryFn: () => api.analytics.overview(f),
  });
  const trends = useQuery({
    queryKey: qk.analytics('trends', f),
    queryFn: () => api.analytics.scoreTrends(f),
  });
  const attendance = useQuery({
    queryKey: qk.analytics('attendance', f),
    queryFn: () => api.analytics.attendance(f),
  });
  return (
    <div className="stack">
      <QueryState query={overview} loadingHeight={96}>
        {(o) => (
          <div className="grid grid-stats">
            <StatCard label="Average score" value={fmtPct(o.averageScore)} />
            <StatCard label="Attendance" value={fmtPct(o.attendanceRate)} />
            <StatCard label="Completion" value={fmtPct(o.completionRate)} />
            <StatCard
              label="High / medium risk"
              value={`${o.riskDistribution.HIGH} / ${o.riskDistribution.MEDIUM}`}
              hint={`of ${o.students} students`}
            />
          </div>
        )}
      </QueryState>
      <div className="grid grid-2">
        <QueryState
          query={trends}
          loadingHeight={340}
          isEmpty={(d) => d.overall.length === 0}
          empty={
            <Card title="Score trend">
              <EmptyState title="No grades yet" />
            </Card>
          }
        >
          {(d) => <ScoreTrendChart data={d} />}
        </QueryState>
        <QueryState
          query={attendance}
          loadingHeight={340}
          isEmpty={(d) => d.weekly.length === 0}
          empty={
            <Card title="Attendance">
              <EmptyState title="No attendance yet" />
            </Card>
          }
        >
          {(d) => <AttendanceChart data={d} />}
        </QueryState>
      </div>
    </div>
  );
}

// ── Roster ──────────────────────────────────────────────────────────────────
function Roster({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDerived();
  const roster = useQuery({
    queryKey: qk.roster(courseId),
    queryFn: () => api.courses.roster(courseId),
  });
  const [adding, setAdding] = useState(false);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DROPPED' }) =>
      api.enrollments.update(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.roster(courseId) });
      invalidate();
    },
  });
  return (
    <Card
      title="Roster"
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
          Enroll student
        </button>
      }
    >
      <FormError error={setStatus.error} />
      <QueryState
        query={roster}
        isEmpty={(r) => r.length === 0}
        empty={<EmptyState title="No students enrolled yet" />}
      >
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Number</th>
                  <th className="right">Grade</th>
                  <th>Enrollment</th>
                  <th>Risk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.enrollmentId}
                    style={{ opacity: r.enrollmentStatus === 'ACTIVE' ? 1 : 0.55 }}
                  >
                    <td>
                      <Link to={`/students/${r.id}`}>
                        {r.lastName}, {r.firstName}
                      </Link>
                    </td>
                    <td className="num">{r.studentNumber}</td>
                    <td className="right num">{r.gradeLevel}</td>
                    <td>{r.enrollmentStatus.toLowerCase()}</td>
                    <td>
                      {r.enrollmentStatus === 'ACTIVE' ? (
                        <RiskBadge level={r.riskLevel} score={r.riskScore} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="right">
                      {r.enrollmentStatus === 'ACTIVE' ? (
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={setStatus.isPending}
                          onClick={() =>
                            confirm(`Drop ${r.firstName} ${r.lastName} from this course?`) &&
                            setStatus.mutate({ id: r.enrollmentId, status: 'DROPPED' })
                          }
                        >
                          Drop
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: r.enrollmentId, status: 'ACTIVE' })}
                        >
                          Re-enroll
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {adding && <EnrollModal courseId={courseId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function EnrollModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDerived();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const directory = useQuery({
    queryKey: qk.directory(debounced),
    queryFn: () => api.students.directory(debounced),
  });
  const enroll = useMutation({
    mutationFn: (studentId: string) => api.enrollments.create(studentId, courseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.roster(courseId) });
      invalidate();
    },
  });
  return (
    <Modal title="Enroll a student" onClose={onClose}>
      <div className="stack">
        <input
          className="input"
          placeholder="Search the school directory…"
          aria-label="Search directory"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FormError error={enroll.error} />
        {enroll.isSuccess && <div className="alert-box success">Student enrolled.</div>}
        <QueryState
          query={directory}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState title="No matching students" />}
        >
          {(list) => (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="table">
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.lastName}, {s.firstName}{' '}
                        <span className="subtle">
                          #{s.studentNumber} · grade {s.gradeLevel}
                        </span>
                      </td>
                      <td className="right">
                        <button
                          className="btn btn-sm"
                          disabled={enroll.isPending}
                          onClick={() => enroll.mutate(s.id)}
                        >
                          Enroll
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>
    </Modal>
  );
}

// ── Assessments & gradebook ─────────────────────────────────────────────────
function Grades({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDerived();
  const assessments = useQuery({
    queryKey: qk.assessments(courseId),
    queryFn: () => api.courses.assessments(courseId),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api.assessments.remove(id),
    onSuccess: () => {
      setSelected(null);
      void qc.invalidateQueries({ queryKey: qk.assessments(courseId) });
      invalidate();
    },
  });

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card
        title="Assessments"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            New assessment
          </button>
        }
      >
        <FormError error={remove.error} />
        <QueryState
          query={assessments}
          isEmpty={(a) => a.length === 0}
          empty={<EmptyState title="No assessments yet" />}
        >
          {(list) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Due</th>
                    <th className="right">Max</th>
                    <th className="right">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setSelected(a.id)}
                      style={{
                        cursor: 'pointer',
                        background: selected === a.id ? 'var(--accent-soft)' : undefined,
                      }}
                    >
                      <td>
                        <button
                          className="btn-ghost"
                          style={{
                            border: 0,
                            background: 'none',
                            padding: 0,
                            color: 'var(--accent)',
                            font: 'inherit',
                            cursor: 'pointer',
                          }}
                        >
                          {a.title}
                        </button>
                      </td>
                      <td>{a.type.toLowerCase()}</td>
                      <td>{fmtDate(a.dueDate)}</td>
                      <td className="right num">
                        {a.maxScore} <span className="subtle">×{a.weight}</span>
                      </td>
                      <td className="right num">{fmtPct(a.averagePercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Card>
      {selected ? (
        <GradebookEditor
          assessmentId={selected}
          title={assessments.data?.find((a) => a.id === selected)?.title ?? ''}
          onDelete={() =>
            confirm('Delete this assessment and all of its grades?') && remove.mutate(selected)
          }
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: qk.assessments(courseId) });
            invalidate();
          }}
        />
      ) : (
        <Card>
          <EmptyState title="Select an assessment">
            Pick an assessment to enter or edit grades.
          </EmptyState>
        </Card>
      )}
      {creating && <CreateAssessmentModal courseId={courseId} onClose={() => setCreating(false)} />}
    </div>
  );
}

type Draft = Record<string, { score: string; status: GradeStatus }>;
const toDraft = (g: Gradebook): Draft =>
  Object.fromEntries(
    g.rows.map((r) => [
      r.student.id,
      { score: r.score === null ? '' : String(r.score), status: r.status ?? 'SUBMITTED' },
    ]),
  );

function GradebookEditor({
  assessmentId,
  title,
  onSaved,
  onDelete,
}: {
  assessmentId: string;
  title: string;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const book = useQuery({
    queryKey: qk.gradebook(assessmentId),
    queryFn: () => api.assessments.gradebook(assessmentId),
  });
  const [result, setResult] = useState<{ id: string; text: string } | null>(null);
  return (
    <Card
      title={`Gradebook · ${title}`}
      subtitle={book.data && `Max score ${book.data.maxScore}`}
      actions={
        <button className="btn btn-sm btn-danger" onClick={onDelete}>
          Delete
        </button>
      }
    >
      {result?.id === assessmentId && (
        <div className="alert-box success" style={{ marginBottom: 12 }}>
          {result.text}
        </div>
      )}
      <QueryState
        query={book}
        isEmpty={(b) => b.rows.length === 0}
        empty={<EmptyState title="No active students" />}
      >
        {/* Keyed per assessment: switching assessments re-initialises the draft without an effect. */}
        {(b) => (
          <GradebookForm
            key={assessmentId}
            book={b}
            onSaved={(text) => {
              setResult({ id: assessmentId, text });
              onSaved();
            }}
          />
        )}
      </QueryState>
    </Card>
  );
}

function GradebookForm({
  book: b,
  onSaved,
}: {
  book: Gradebook;
  onSaved: (message: string) => void;
}) {
  const qc = useQueryClient();
  const assessmentId = b.assessmentId;
  const [draft, setDraft] = useState<Draft>(() => toDraft(b));

  const save = useMutation({
    mutationFn: () => {
      const original = toDraft(b);
      // Only send rows that changed and are complete.
      const grades = Object.entries(draft)
        .filter(
          ([id, d]) =>
            JSON.stringify(d) !== JSON.stringify(original[id]) &&
            (d.score !== '' || d.status === 'MISSING' || d.status === 'EXCUSED'),
        )
        .map(([studentId, d]) => ({
          studentId,
          status: d.status,
          score: d.status === 'MISSING' || d.status === 'EXCUSED' ? null : Number(d.score),
        }));
      if (grades.length === 0) return Promise.resolve({ created: 0, updated: 0, unchanged: 0 });
      return api.assessments.saveGrades(assessmentId, grades);
    },
    onSuccess: (r) => {
      onSaved(`Saved: ${r.created} new, ${r.updated} updated. Risk levels recalculated.`);
      void qc.invalidateQueries({ queryKey: qk.gradebook(assessmentId) });
    },
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {save.isError && <div className="alert-box error">{errorMessage(save.error)}</div>}
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => {
              const d = draft[r.student.id] ?? { score: '', status: 'SUBMITTED' as GradeStatus };
              const noScore = d.status === 'MISSING' || d.status === 'EXCUSED';
              return (
                <tr key={r.student.id}>
                  <td>
                    {r.student.lastName}, {r.student.firstName}
                  </td>
                  <td>
                    <input
                      className="input num"
                      style={{ width: 80 }}
                      type="number"
                      min={0}
                      max={b.maxScore}
                      step="0.5"
                      disabled={noScore}
                      aria-label={`Score for ${r.student.firstName} ${r.student.lastName}`}
                      value={noScore ? '' : d.score}
                      onChange={(e) =>
                        setDraft({ ...draft, [r.student.id]: { ...d, score: e.target.value } })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Status for ${r.student.firstName}`}
                      value={d.status}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [r.student.id]: { ...d, status: e.target.value as GradeStatus },
                        })
                      }
                    >
                      <option value="SUBMITTED">Submitted</option>
                      <option value="LATE">Late</option>
                      <option value="MISSING">Missing</option>
                      <option value="EXCUSED">Excused</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save grades'}
        </button>
      </div>
    </form>
  );
}

function CreateAssessmentModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    type: 'ASSIGNMENT' as AssessmentType,
    maxScore: '100',
    weight: '1',
    dueDate: new Date().toISOString().slice(0, 10),
  });
  const create = useMutation({
    mutationFn: () =>
      api.courses.createAssessment(courseId, {
        ...form,
        maxScore: Number(form.maxScore),
        weight: Number(form.weight),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.assessments(courseId) });
      onClose();
    },
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="New assessment" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <FormError error={create.error} />
        <Field label="Title" htmlFor="a-t">
          <input id="a-t" className="input" value={form.title} onChange={set('title')} required />
        </Field>
        <div className="form-grid">
          <Field label="Type" htmlFor="a-ty">
            <select id="a-ty" className="select" value={form.type} onChange={set('type')}>
              <option value="ASSIGNMENT">Assignment</option>
              <option value="QUIZ">Quiz</option>
              <option value="EXAM">Exam</option>
              <option value="PROJECT">Project</option>
            </select>
          </Field>
          <Field label="Due date" htmlFor="a-d">
            <input
              id="a-d"
              className="input"
              type="date"
              value={form.dueDate}
              onChange={set('dueDate')}
              required
            />
          </Field>
          <Field label="Max score" htmlFor="a-m">
            <input
              id="a-m"
              className="input"
              type="number"
              min={1}
              value={form.maxScore}
              onChange={set('maxScore')}
            />
          </Field>
          <Field label="Weight" htmlFor="a-w">
            <input
              id="a-w"
              className="input"
              type="number"
              min={0}
              step="0.5"
              value={form.weight}
              onChange={set('weight')}
            />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────
const STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

function AttendanceTaker({ courseId }: { courseId: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const sheet = useQuery({
    queryKey: qk.attendance(courseId, date),
    queryFn: () => api.courses.attendance(courseId, date),
  });
  const recorded = sheet.data?.rows.some((r) => r.status !== null);

  return (
    <Card
      title="Take attendance"
      subtitle={
        recorded
          ? 'Already recorded for this date; saving updates it'
          : 'Not recorded yet for this date'
      }
      actions={
        <input
          type="date"
          className="input"
          aria-label="Class date"
          value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
        />
      }
    >
      <QueryState
        query={sheet}
        isEmpty={(s) => s.rows.length === 0}
        empty={<EmptyState title="No active students" />}
      >
        {(s) => <AttendanceForm key={date} sheet={s} />}
      </QueryState>
    </Card>
  );
}

function AttendanceForm({ sheet: s }: { sheet: AttendanceSheet }) {
  const invalidate = useInvalidateDerived();
  const qc = useQueryClient();
  const { courseId, date } = s;
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(s.rows.map((r) => [r.student.id, r.status ?? 'PRESENT'])),
  );
  const save = useMutation({
    mutationFn: () =>
      api.courses.recordAttendance(courseId, {
        date,
        records: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.attendance(courseId, date) });
      invalidate();
    },
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
      {save.isSuccess && (
        <div className="alert-box success">Attendance saved for {s.rows.length} students.</div>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setMarks(Object.fromEntries(s.rows.map((r) => [r.student.id, 'PRESENT'])))}
        >
          Mark all present
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.student.id}>
                <td>
                  {r.student.lastName}, {r.student.firstName}
                </td>
                <td className="right">
                  <div
                    className="segmented"
                    role="radiogroup"
                    aria-label={`Attendance for ${r.student.firstName} ${r.student.lastName}`}
                  >
                    {STATUSES.map((st) => (
                      <button
                        type="button"
                        key={st}
                        aria-pressed={marks[r.student.id] === st}
                        onClick={() => setMarks({ ...marks, [r.student.id]: st })}
                      >
                        {st.charAt(0) + st.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save attendance'}
        </button>
      </div>
    </form>
  );
}
