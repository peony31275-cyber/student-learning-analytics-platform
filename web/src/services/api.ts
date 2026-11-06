/** Typed endpoint functions: the single place the frontend knows URLs. */
import type * as T from '../types/api';
import { data, http } from './http';

export type AnalyticsFilter = { courseId?: string; term?: string };
type ListParams = Record<string, string | number | undefined>;

export const api = {
  auth: {
    me: () => data(http.get<{ data: { user: T.SessionUser } }>('/auth/me')).then((d) => d.user),
    login: (email: string, password: string) =>
      data(http.post<{ data: { user: T.SessionUser } }>('/auth/login', { email, password })).then(
        (d) => d.user,
      ),
    // The activation token travels in a POST body, never in a URL the server logs.
    verifyActivation: (token: string) =>
      data(http.post<{ data: T.ActivationPreview }>('/auth/activation/verify', { token })),
    activate: (token: string, password: string) =>
      data(http.post<{ data: { email: string } }>('/auth/activation', { token, password })),
    logout: () => http.post<void>('/auth/logout'),
    /** Ends every session, this one included: sign in again afterwards. */
    changePassword: (currentPassword: string, newPassword: string) =>
      http.patch<void>('/auth/password', { currentPassword, newPassword }),
  },
  school: {
    get: () => data(http.get<{ data: T.School }>('/school')),
    update: (body: Partial<Pick<T.School, 'name' | 'timezone'>>) =>
      data(http.patch<{ data: T.School }>('/school', body)),
  },
  users: {
    list: (q: ListParams) => http.get<T.Page<T.AdminUser>>('/users', q),
    create: (body: Record<string, unknown>) =>
      data(http.post<{ data: T.AdminUser }>('/users', body)),
    update: (id: string, body: Record<string, unknown>) =>
      data(http.patch<{ data: T.AdminUser }>(`/users/${id}`, body)),
  },
  students: {
    list: (q: ListParams) => http.get<T.Page<T.StudentListItem>>('/students', q),
    directory: (search: string) =>
      data(http.get<{ data: T.DirectoryStudent[] }>('/students/directory', { search })),
    get: (id: string) => data(http.get<{ data: T.StudentDetail }>(`/students/${id}`)),
    createInvite: (id: string) =>
      data(http.post<{ data: T.ActivationInvite }>(`/students/${id}/activation-invite`)),
    create: (body: Record<string, unknown>) =>
      data(http.post<{ data: { id: string } }>('/students', body)),
    update: (id: string, body: Record<string, unknown>) =>
      data(http.patch<{ data: unknown }>(`/students/${id}`, body)),
    grades: (id: string, courseId?: string) =>
      data(http.get<{ data: T.StudentGrade[] }>(`/students/${id}/grades`, { courseId })),
    risk: (id: string) => data(http.get<{ data: T.RiskAlert[] }>(`/students/${id}/risk`)),
    progress: (id: string) =>
      data(http.get<{ data: T.StudentProgress }>(`/analytics/students/${id}/progress`)),
  },
  courses: {
    list: (q: ListParams) => http.get<T.Page<T.Course>>('/courses', q),
    get: (id: string) => data(http.get<{ data: T.Course }>(`/courses/${id}`)),
    create: (body: Record<string, unknown>) =>
      data(http.post<{ data: T.Course }>('/courses', body)),
    update: (id: string, body: Record<string, unknown>) =>
      data(http.patch<{ data: T.Course }>(`/courses/${id}`, body)),
    roster: (id: string) => data(http.get<{ data: T.RosterRow[] }>(`/courses/${id}/students`)),
    assessments: (id: string) =>
      data(http.get<{ data: T.Assessment[] }>(`/courses/${id}/assessments`)),
    createAssessment: (id: string, body: Record<string, unknown>) =>
      data(http.post<{ data: unknown }>(`/courses/${id}/assessments`, body)),
    attendance: (id: string, date: string) =>
      data(http.get<{ data: T.AttendanceSheet }>(`/courses/${id}/attendance`, { date })),
    recordAttendance: (
      id: string,
      body: { date: string; records: { studentId: string; status: T.AttendanceStatus }[] },
    ) => data(http.put<{ data: { recorded: number } }>(`/courses/${id}/attendance`, body)),
  },
  enrollments: {
    create: (studentId: string, courseId: string) =>
      data(http.post<{ data: unknown }>('/enrollments', { studentId, courseId })),
    update: (id: string, status: T.EnrollmentStatus) =>
      data(http.patch<{ data: unknown }>(`/enrollments/${id}`, { status })),
  },
  assessments: {
    remove: (id: string) => http.delete<void>(`/assessments/${id}`),
    gradebook: (id: string) => data(http.get<{ data: T.Gradebook }>(`/assessments/${id}/grades`)),
    saveGrades: (
      id: string,
      grades: { studentId: string; score: number | null; status: T.GradeStatus }[],
    ) =>
      data(
        http.put<{ data: { created: number; updated: number; unchanged: number } }>(
          `/assessments/${id}/grades`,
          { grades },
        ),
      ),
  },
  analytics: {
    overview: (f: AnalyticsFilter) =>
      data(http.get<{ data: T.Overview }>('/analytics/overview', f)),
    scoreTrends: (f: AnalyticsFilter) =>
      data(http.get<{ data: T.ScoreTrends }>('/analytics/score-trends', f)),
    courseComparison: (f: AnalyticsFilter) =>
      data(http.get<{ data: T.CourseComparison[] }>('/analytics/course-comparison', f)),
    attendance: (f: AnalyticsFilter) =>
      data(http.get<{ data: T.AttendanceAnalytics }>('/analytics/attendance', f)),
    riskDistribution: (f: AnalyticsFilter) =>
      data(http.get<{ data: T.RiskDistribution }>('/analytics/risk-distribution', f)),
  },
  risk: {
    list: (q: ListParams) => http.get<T.Page<T.RiskAlert>>('/risk-alerts', q),
    update: (id: string, body: { status: T.AlertStatus; note?: string | null }) =>
      data(http.patch<{ data: T.RiskAlert }>(`/risk-alerts/${id}`, body)),
    recalculate: (courseId?: string) =>
      data(
        http.post<{ data: T.RecalculationSummary }>(
          '/risk-alerts/recalculate',
          courseId ? { courseId } : {},
        ),
      ),
    config: () => data(http.get<{ data: T.RiskConfig }>('/settings/risk')),
    updateConfig: (config: T.RiskConfig) =>
      data(
        http.put<{ data: { config: T.RiskConfig; recalculation: T.RecalculationSummary } }>(
          '/settings/risk',
          config,
        ),
      ),
  },
};

/**
 * Query-key factory. Hierarchical keys let a mutation invalidate exactly the
 * affected caches (e.g. saving grades invalidates analytics and risk, but not users).
 */
export const qk = {
  me: ['me'] as const,
  school: ['school'] as const,
  users: (q: object) => ['users', q] as const,
  students: (q: object) => ['students', 'list', q] as const,
  student: (id: string) => ['students', 'detail', id] as const,
  studentGrades: (id: string) => ['students', 'detail', id, 'grades'] as const,
  studentRisk: (id: string) => ['risk', 'student', id] as const,
  studentProgress: (id: string) => ['analytics', 'student', id] as const,
  directory: (s: string) => ['students', 'directory', s] as const,
  courses: (q: object) => ['courses', 'list', q] as const,
  course: (id: string) => ['courses', 'detail', id] as const,
  roster: (id: string) => ['courses', 'detail', id, 'roster'] as const,
  assessments: (id: string) => ['courses', 'detail', id, 'assessments'] as const,
  gradebook: (id: string) => ['gradebook', id] as const,
  attendance: (id: string, date: string) => ['attendance', id, date] as const,
  analytics: (name: string, f: AnalyticsFilter) => ['analytics', name, f] as const,
  alerts: (q: object) => ['risk', 'alerts', q] as const,
  riskConfig: ['risk', 'config'] as const,
};
