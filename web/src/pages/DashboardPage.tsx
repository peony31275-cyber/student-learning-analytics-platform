import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  AttendanceBandsChart,
  AttendanceChart,
  CourseComparisonChart,
  RiskDistributionChart,
  ScoreTrendChart,
} from '../charts/charts';
import {
  Card,
  EmptyState,
  PageHeader,
  QueryState,
  RiskBadge,
  StatCard,
  fmtPct,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { type AnalyticsFilter, api, qk } from '../services/api';

/** Shared filter source: the course select drives every chart on the page via the URL. */
function useCourseOptions() {
  return useQuery({
    queryKey: qk.courses({ pageSize: 100 }),
    queryFn: () => api.courses.list({ pageSize: 100 }),
  });
}

export function DashboardPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const courseId = params.get('courseId') ?? undefined;
  const f: AnalyticsFilter = { courseId };
  const courses = useCourseOptions();

  // Independent queries run in parallel; cached per filter so switching back is instant.
  const overview = useQuery({
    queryKey: qk.analytics('overview', f),
    queryFn: () => api.analytics.overview(f),
  });
  const trends = useQuery({
    queryKey: qk.analytics('trends', f),
    queryFn: () => api.analytics.scoreTrends(f),
  });
  const comparison = useQuery({
    queryKey: qk.analytics('comparison', f),
    queryFn: () => api.analytics.courseComparison(f),
  });
  const attendance = useQuery({
    queryKey: qk.analytics('attendance', f),
    queryFn: () => api.analytics.attendance(f),
  });
  const risk = useQuery({
    queryKey: qk.analytics('risk', f),
    queryFn: () => api.analytics.riskDistribution(f),
  });
  const alertQuery = { minLevel: 'MEDIUM', status: 'OPEN', pageSize: 6, courseId };
  const alerts = useQuery({
    queryKey: qk.alerts(alertQuery),
    queryFn: () => api.risk.list(alertQuery),
  });

  return (
    <>
      <PageHeader
        title={user?.role === 'ADMIN' ? 'School overview' : 'My classes'}
        subtitle="Live data from grades, attendance and the early-warning engine"
        actions={
          <select
            className="select"
            aria-label="Filter by course"
            value={courseId ?? ''}
            onChange={(e) => setParams(e.target.value ? { courseId: e.target.value } : {})}
          >
            <option value="">All courses</option>
            {courses.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="stack">
        <QueryState query={overview} loadingHeight={96}>
          {(o) => (
            <div className="grid grid-stats">
              <StatCard
                label="Students"
                value={o.students}
                hint={`${o.courses} course${o.courses === 1 ? '' : 's'}`}
              />
              <StatCard
                label="Average score"
                value={fmtPct(o.averageScore)}
                hint="weighted by assessment"
              />
              <StatCard
                label="Attendance"
                value={fmtPct(o.attendanceRate)}
                hint="late counts as attended"
              />
              <StatCard
                label="Work completed"
                value={fmtPct(o.completionRate)}
                hint="excused work excluded"
              />
              <StatCard
                label="At-risk students"
                value={o.atRiskStudents}
                hint={`${o.openAlerts} open alert${o.openAlerts === 1 ? '' : 's'}`}
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
              <Card title="Average score trend">
                <EmptyState title="No grades yet" />
              </Card>
            }
          >
            {(d) => <ScoreTrendChart data={d} />}
          </QueryState>
          <QueryState query={risk} loadingHeight={340}>
            {(d) => <RiskDistributionChart data={d} />}
          </QueryState>
        </div>

        <div className="grid grid-2">
          <QueryState
            query={attendance}
            loadingHeight={340}
            isEmpty={(d) => d.weekly.length === 0}
            empty={
              <Card title="Attendance">
                <EmptyState title="No attendance recorded yet" />
              </Card>
            }
          >
            {(d) => <AttendanceChart data={d} />}
          </QueryState>
          <QueryState
            query={attendance}
            loadingHeight={340}
            isEmpty={(d) => d.weekly.length === 0}
            empty={<span />}
          >
            {(d) => <AttendanceBandsChart data={d} />}
          </QueryState>
        </div>

        <div className="grid grid-2">
          <QueryState query={comparison} loadingHeight={300} isEmpty={(d) => d.length === 0}>
            {(d) => <CourseComparisonChart data={d} />}
          </QueryState>
          <Card
            title="Students needing attention"
            subtitle="Open medium and high alerts, highest score first"
            actions={<Link to="/alerts">All alerts →</Link>}
          >
            <QueryState
              query={alerts}
              isEmpty={(d) => d.data.length === 0}
              empty={<EmptyState title="No open alerts">Everyone is on track.</EmptyState>}
            >
              {(d) => (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Course</th>
                        <th>Risk</th>
                        <th>Top reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.data.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <Link to={`/students/${a.student.id}`}>
                              {a.student.firstName} {a.student.lastName}
                            </Link>
                          </td>
                          <td>{a.course.code}</td>
                          <td>
                            <RiskBadge level={a.level} score={a.score} />
                          </td>
                          <td className="muted" style={{ whiteSpace: 'normal', minWidth: 200 }}>
                            {a.factors[0]?.message ?? '—'}
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
    </>
  );
}
