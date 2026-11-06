import { z } from 'zod';
import {
  AlertStatus,
  AssessmentType,
  AttendanceStatus,
  EnrollmentStatus,
  GradeStatus,
  RiskLevel,
  Role,
  StudentStatus,
} from '../generated/prisma/enums.js';
import { paginationQuery } from '../utils/pagination.js';
import { email, isoDate, password, personName, searchTerm, uuid } from './common.js';

const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

// ── Users (admin) ───────────────────────────────────────────────────────────
export const listUsersQuery = paginationQuery.extend({
  role: z.enum(Role).optional(),
  isActive: boolQuery,
  search: searchTerm,
});

export const createUserSchema = z
  .object({
    email,
    password,
    role: z.enum(Role),
    firstName: personName,
    lastName: personName,
    department: z.string().trim().max(80).optional(),
    /** For STUDENT accounts: the existing profile to link the login to. */
    studentId: uuid.optional(),
  })
  .refine((u) => u.role !== 'STUDENT' || u.studentId, {
    message: 'studentId is required when creating a STUDENT account',
    path: ['studentId'],
  });

export const updateUserSchema = z
  .object({
    firstName: personName,
    lastName: personName,
    isActive: z.boolean(),
    department: z.string().trim().max(80).nullable(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field is required');

// ── School ──────────────────────────────────────────────────────────────────
export const updateSchoolSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(1).max(64),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field is required');

// ── Students ────────────────────────────────────────────────────────────────
export const STUDENT_SORT = ['lastName', 'studentNumber', 'gradeLevel', 'createdAt'] as const;

export const listStudentsQuery = paginationQuery.extend({
  search: searchTerm,
  courseId: uuid.optional(),
  gradeLevel: z.coerce.number().int().min(1).max(12).optional(),
  status: z.enum(StudentStatus).optional(),
  riskLevel: z.enum(RiskLevel).optional(),
  sort: z.enum(STUDENT_SORT).default('lastName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const directoryQuery = z.object({
  search: searchTerm,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const studentFields = {
  studentNumber: z.string().trim().min(1).max(40),
  firstName: personName,
  lastName: personName,
  email: email.nullable().optional(),
  gradeLevel: z.number().int().min(1).max(12),
};

export const createStudentSchema = z.object({
  ...studentFields,
  /** Courses to enroll the new student in (required for teachers, see service). */
  courseIds: z.array(uuid).max(20).default([]),
});

export const updateStudentSchema = z
  .object({ ...studentFields, status: z.enum(StudentStatus) })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field is required');

// ── Courses ─────────────────────────────────────────────────────────────────
export const listCoursesQuery = paginationQuery.extend({
  search: searchTerm,
  term: z.string().trim().max(20).optional(),
  teacherId: uuid.optional(),
});

const courseFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  term: z.string().trim().regex(/^\d{4}-(Spring|Summer|Fall|Winter)$/, 'Term must look like 2026-Fall'),
  credits: z.number().int().min(0).max(10).default(3),
};

export const createCourseSchema = z.object({
  ...courseFields,
  /** Admins must pick the teacher; for teachers it is always themselves. */
  teacherId: uuid.optional(),
});

export const updateCourseSchema = z
  .object({ ...courseFields, credits: z.number().int().min(0).max(10), teacherId: uuid })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field is required');

// ── Enrollments ─────────────────────────────────────────────────────────────
export const createEnrollmentSchema = z.object({ studentId: uuid, courseId: uuid });
export const updateEnrollmentSchema = z.object({ status: z.enum(EnrollmentStatus) });
export const listEnrollmentsQuery = paginationQuery
  .extend({
    courseId: uuid.optional(),
    studentId: uuid.optional(),
    status: z.enum(EnrollmentStatus).optional(),
  })
  .refine((q) => q.courseId || q.studentId, 'courseId or studentId is required');

// ── Assessments & grades ────────────────────────────────────────────────────
const assessmentFields = {
  title: z.string().trim().min(1).max(120),
  type: z.enum(AssessmentType),
  maxScore: z.number().positive().max(10000),
  weight: z.number().min(0).max(100).default(1),
  dueDate: z.iso.datetime({ offset: true }).or(z.iso.date()).transform((s) => new Date(s)),
};
export const createAssessmentSchema = z.object(assessmentFields);
export const updateAssessmentSchema = z
  .object({ ...assessmentFields, weight: z.number().min(0).max(100) })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'At least one field is required');

export const gradeEntrySchema = z
  .object({
    studentId: uuid,
    score: z.number().min(0).nullable().optional(),
    status: z.enum(GradeStatus).default('SUBMITTED'),
    feedback: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((g) => (g.status === 'SUBMITTED' || g.status === 'LATE' ? typeof g.score === 'number' : true), {
    message: 'score is required for SUBMITTED or LATE work',
    path: ['score'],
  });

export const bulkGradesSchema = z.object({
  grades: z
    .array(gradeEntrySchema)
    .min(1)
    .max(500)
    .refine((arr) => new Set(arr.map((g) => g.studentId)).size === arr.length, 'Duplicate studentId in request'),
  reason: z.string().trim().max(300).optional(),
});

export const studentGradesQuery = z.object({ courseId: uuid.optional() });

// ── Attendance ──────────────────────────────────────────────────────────────
export const attendanceDateQuery = z.object({ date: isoDate });

export const bulkAttendanceSchema = z.object({
  date: isoDate,
  records: z
    .array(
      z.object({
        studentId: uuid,
        status: z.enum(AttendanceStatus),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(500)
    .refine((arr) => new Set(arr.map((r) => r.studentId)).size === arr.length, 'Duplicate studentId in request'),
});

export const studentAttendanceQuery = z.object({
  courseId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ── Risk alerts ─────────────────────────────────────────────────────────────
export const listAlertsQuery = paginationQuery.extend({
  level: z.enum(RiskLevel).optional(),
  status: z.enum(AlertStatus).optional(),
  courseId: uuid.optional(),
  studentId: uuid.optional(),
  minLevel: z.enum(RiskLevel).optional(),
});

export const updateAlertSchema = z.object({
  status: z.enum(AlertStatus),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const recalculateSchema = z.object({ courseId: uuid.optional() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListStudentsQuery = z.infer<typeof listStudentsQuery>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type BulkGradesInput = z.infer<typeof bulkGradesSchema>;
export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>;
