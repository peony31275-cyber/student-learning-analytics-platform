/** DTOs returned by the REST API (mirrors the server's service-layer output). */

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type GradeStatus = 'SUBMITTED' | 'LATE' | 'MISSING' | 'EXCUSED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type AssessmentType = 'ASSIGNMENT' | 'QUIZ' | 'EXAM' | 'PROJECT';
export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'GRADUATED';
export type EnrollmentStatus = 'ACTIVE' | 'DROPPED' | 'COMPLETED';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  schoolId: string;
  teacherId: string | null;
  studentId: string | null;
}

export interface StudentListItem {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  gradeLevel: number;
  status: StudentStatus;
  hasAccount: boolean;
  activeCourses: number;
  riskLevel: RiskLevel | null;
}

export interface StudentDetail {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  gradeLevel: number;
  status: StudentStatus;
  hasAccount: boolean;
  riskLevel: RiskLevel | null;
  enrollments: {
    id: string;
    status: EnrollmentStatus;
    enrolledAt: string;
    course: {
      id: string;
      code: string;
      name: string;
      term: string;
      teacher: { user: { firstName: string; lastName: string } };
    };
  }[];
}

export interface DirectoryStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  gradeLevel: number;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  description: string | null;
  term: string;
  credits: number;
  teacher: {
    id: string;
    department: string | null;
    firstName: string;
    lastName: string;
    email: string;
  };
  studentCount: number;
  assessmentCount: number;
}

export interface RosterRow {
  enrollmentId: string;
  enrollmentStatus: EnrollmentStatus;
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  gradeLevel: number;
  riskLevel: RiskLevel | null;
  riskScore: number | null;
}

export interface Assessment {
  id: string;
  courseId: string;
  title: string;
  type: AssessmentType;
  maxScore: number;
  weight: number;
  dueDate: string;
  gradedCount: number;
  averagePercent: number | null;
}

export interface StudentRef {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}

export interface Gradebook {
  assessmentId: string;
  maxScore: number;
  rows: {
    student: StudentRef;
    gradeId: string | null;
    score: number | null;
    percent: number | null;
    status: GradeStatus | null;
    feedback: string | null;
  }[];
}

export interface StudentGrade {
  id: string;
  score: number | null;
  percent: number | null;
  status: GradeStatus;
  feedback: string | null;
  assessment: {
    id: string;
    title: string;
    type: AssessmentType;
    maxScore: number;
    dueDate: string;
    course: { id: string; code: string; name: string };
  };
}

export interface AttendanceSheet {
  courseId: string;
  date: string;
  rows: {
    student: StudentRef;
    attendanceId: string | null;
    status: AttendanceStatus | null;
    note: string | null;
  }[];
}

export interface RiskFactor {
  rule: 'recentPerformance' | 'decliningTrend' | 'attendance' | 'completion';
  severity: 'WARNING' | 'CRITICAL';
  points: number;
  value: number;
  threshold: number;
  message: string;
  suggestion: string;
}

export interface RiskAlert {
  id: string;
  level: RiskLevel;
  previousLevel: RiskLevel | null;
  score: number;
  factors: RiskFactor[];
  metrics: Record<string, unknown>;
  status: AlertStatus;
  computedAt: string;
  acknowledgedAt: string | null;
  note: string | null;
  student: StudentRef & { gradeLevel: number };
  course: { id: string; code: string; name: string };
}

export type LevelCounts = Record<RiskLevel, number>;

export interface Overview {
  courses: number;
  students: number;
  assessments: number;
  averageScore: number | null;
  attendanceRate: number | null;
  completionRate: number | null;
  riskDistribution: LevelCounts;
  atRiskStudents: number;
  openAlerts: number;
}

export interface ScoreTrends {
  overall: { period: string; averagePercent: number | null; gradedCount: number }[];
  byCourse: {
    courseId: string;
    code: string;
    name: string;
    points: { period: string; averagePercent: number | null }[];
  }[];
}

export interface CourseComparison {
  courseId: string;
  code: string;
  name: string;
  students: number;
  averageScore: number | null;
  completionRate: number | null;
  attendanceRate: number | null;
  risk: LevelCounts;
}

export interface AttendanceAnalytics {
  weekly: {
    period: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    attendanceRate: number | null;
  }[];
  distribution: { band: string; count: number }[];
}

export interface RiskDistribution {
  totals: LevelCounts;
  byCourse: ({ courseId: string; code: string } & LevelCounts)[];
  topFactors: { rule: RiskFactor['rule']; count: number }[];
}

export interface StudentProgress {
  courses: {
    courseId: string;
    code: string;
    name: string;
    averageScore: number | null;
    recentAverage: number | null;
    trendDelta: number | null;
    attendanceRate: number | null;
    completionRate: number | null;
    missingCount: number;
    riskLevel: RiskLevel | null;
    riskScore: number | null;
  }[];
  timeline: {
    assessmentId: string;
    title: string;
    type: AssessmentType;
    dueDate: string;
    courseId: string;
    courseCode: string;
    percent: number | null;
    classAverage: number | null;
    status: GradeStatus;
  }[];
  attendanceWeekly: { period: string; attendanceRate: number | null }[];
}

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  teacherProfile: { id: string; department: string | null; title: string | null } | null;
  studentProfile: { id: string; studentNumber: string } | null;
}

export interface School {
  id: string;
  name: string;
  timezone: string;
  counts: { students: number; teachers: number; courses: number };
}

export interface TierRule {
  enabled: boolean;
  warn: number;
  critical: number;
  warnPoints: number;
  criticalPoints: number;
}
export interface RiskConfig {
  levels: { medium: number; high: number };
  recentWindow: number;
  minGradedAssessments: number;
  minAttendanceSessions: number;
  rules: Record<RiskFactor['rule'], TierRule>;
}

export interface RecalculationSummary {
  courses: number;
  evaluated: number;
  byLevel: LevelCounts;
  durationMs: number;
}
