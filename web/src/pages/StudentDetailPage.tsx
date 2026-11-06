import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { StudentAttendanceChart, StudentScoreChart } from '../charts/charts';
import { RiskExplanation } from '../components/RiskFactors';
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
import { api, qk } from '../services/api';
import type { StudentDetail, StudentProgress, StudentStatus } from '../types/api';

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const student = useQuery({ queryKey: qk.student(id), queryFn: () => api.students.get(id) });
  const [editing, setEditing] = useState(false);

  return (
    <QueryState query={student}>
      {(s) => (
        <>
          <PageHeader
            title={`${s.firstName} ${s.lastName}`}
            subtitle={
              <>
                #{s.studentNumber} · Grade {s.gradeLevel} · {s.status.toLowerCase()} ·{' '}
                {s.hasAccount ? 'account active' : 'no login yet'}
              </>
            }
            actions={
              <>
                <RiskBadge level={s.riskLevel} />
                <button className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </>
            }
          />
          <StudentInsights studentId={id} />
          {editing && <EditStudentModal student={s} onClose={() => setEditing(false)} />}
        </>
      )}
    </QueryState>
  );
}

/** Shared by the staff student page and the student's own dashboard. */
export function StudentInsights({
  studentId,
  audience = 'staff',
}: {
  studentId: string;
  audience?: 'staff' | 'student';
}) {
  const progress = useQuery({
    queryKey: qk.studentProgress(studentId),
    queryFn: () => api.students.progress(studentId),
  });
  const risk = useQuery({
    queryKey: qk.studentRisk(studentId),
    queryFn: () => api.students.risk(studentId),
  });
  const grades = useQuery({
    queryKey: qk.studentGrades(studentId),
    queryFn: () => api.students.grades(studentId),
  });

  return (
    <div className="stack">
      <QueryState
        query={progress}
        loadingHeight={96}
        isEmpty={(p) => p.courses.length === 0}
        empty={
          <Card>
            <EmptyState title="Not enrolled in any courses yet" />
          </Card>
        }
      >
        {(p) => <ProgressSummary progress={p} linkCourses={audience === 'staff'} />}
      </QueryState>

      <div className="grid grid-2">
        <QueryState
          query={progress}
          loadingHeight={340}
          isEmpty={(p) => p.timeline.length === 0}
          empty={
            <Card title="Scores">
              <EmptyState title="No graded work yet" />
            </Card>
          }
        >
          {(p) => <StudentScoreChart timeline={p.timeline} />}
        </QueryState>
        <Card title="Early-warning analysis" subtitle="Rule-based: every point is explained">
          <QueryState
            query={risk}
            isEmpty={(r) => r.length === 0}
            empty={<EmptyState title="Not evaluated yet" />}
          >
            {(alerts) => (
              <div className="stack">
                {alerts.map((a) => (
                  <RiskExplanation key={a.id} alert={a} audience={audience} />
                ))}
              </div>
            )}
          </QueryState>
        </Card>
      </div>

      <div className="grid grid-2">
        <QueryState
          query={progress}
          loadingHeight={260}
          isEmpty={(p) => p.attendanceWeekly.length === 0}
          empty={<span />}
        >
          {(p) => <StudentAttendanceChart weekly={p.attendanceWeekly} />}
        </QueryState>
        <Card title="Grade history">
          <QueryState
            query={grades}
            isEmpty={(g) => g.length === 0}
            empty={<EmptyState title="No grades yet" />}
          >
            {(g) => (
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Assessment</th>
                      <th>Course</th>
                      <th>Due</th>
                      <th className="right">Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...g].reverse().map((x) => (
                      <tr key={x.id}>
                        <td>{x.assessment.title}</td>
                        <td>{x.assessment.course.code}</td>
                        <td>{fmtDate(x.assessment.dueDate)}</td>
                        <td className="right num">
                          {x.score === null ? '—' : `${x.score}/${x.assessment.maxScore}`}{' '}
                          <span className="subtle">{fmtPct(x.percent)}</span>
                        </td>
                        <td>
                          {x.status === 'SUBMITTED' ? (
                            <span className="subtle">Submitted</span>
                          ) : (
                            <span className="badge">{x.status.toLowerCase()}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}

function ProgressSummary({
  progress,
  linkCourses,
}: {
  progress: StudentProgress;
  linkCourses: boolean;
}) {
  const avg = (k: 'averageScore' | 'attendanceRate' | 'completionRate') => {
    const v = progress.courses.map((c) => c[k]).filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  return (
    <div className="stack">
      <div className="grid grid-stats">
        <StatCard
          label="Average score"
          value={fmtPct(avg('averageScore'))}
          hint={`across ${progress.courses.length} courses`}
        />
        <StatCard label="Attendance" value={fmtPct(avg('attendanceRate'))} />
        <StatCard
          label="Work completed"
          value={fmtPct(avg('completionRate'))}
          hint={`${progress.courses.reduce((s, c) => s + c.missingCount, 0)} missing`}
        />
      </div>
      <Card title="Courses">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th className="right">Average</th>
                <th className="right">Recent</th>
                <th className="right">Trend</th>
                <th className="right">Attendance</th>
                <th className="right">Completion</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {progress.courses.map((c) => (
                <tr key={c.courseId}>
                  <td>
                    {linkCourses ? (
                      <Link to={`/courses/${c.courseId}`}>{c.code}</Link>
                    ) : (
                      <strong>{c.code}</strong>
                    )}{' '}
                    <span className="subtle">{c.name}</span>
                  </td>
                  <td className="right num">{fmtPct(c.averageScore)}</td>
                  <td className="right num">{fmtPct(c.recentAverage)}</td>
                  <td className="right num">
                    {c.trendDelta === null
                      ? '—'
                      : `${c.trendDelta > 0 ? '▲ +' : c.trendDelta < 0 ? '▼ ' : ''}${c.trendDelta}`}
                  </td>
                  <td className="right num">{fmtPct(c.attendanceRate)}</td>
                  <td className="right num">{fmtPct(c.completionRate)}</td>
                  <td>
                    <RiskBadge level={c.riskLevel} score={c.riskScore} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function EditStudentModal({ student, onClose }: { student: StudentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: student.firstName,
    lastName: student.lastName,
    email: student.email ?? '',
    gradeLevel: String(student.gradeLevel),
    status: student.status,
  });
  const save = useMutation({
    mutationFn: () =>
      api.students.update(student.id, {
        ...form,
        email: form.email || null,
        gradeLevel: Number(form.gradeLevel),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="Edit student" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <FormError error={save.error} />
        <div className="form-grid">
          <Field label="First name" htmlFor="e-fn">
            <input id="e-fn" className="input" value={form.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Last name" htmlFor="e-ln">
            <input id="e-ln" className="input" value={form.lastName} onChange={set('lastName')} />
          </Field>
          <Field label="Grade level" htmlFor="e-gl">
            <select
              id="e-gl"
              className="select"
              value={form.gradeLevel}
              onChange={set('gradeLevel')}
            >
              {[9, 10, 11, 12].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="e-st">
            <select
              id="e-st"
              className="select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as StudentStatus })}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="GRADUATED">Graduated</option>
            </select>
          </Field>
        </div>
        <Field label="Email" htmlFor="e-em">
          <input
            id="e-em"
            type="email"
            className="input"
            value={form.email}
            onChange={set('email')}
          />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
