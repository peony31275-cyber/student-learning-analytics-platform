/**
 * Deterministic, re-runnable seed.
 *
 *   npm run db:seed
 *
 * - Wipes all application tables (TRUNCATE ... CASCADE) and recreates the data,
 *   so running it twice yields the same database.
 * - Uses a seeded PRNG: the same "random" students, grades and attendance every run.
 * - Refuses to run against NODE_ENV=production unless SEED_ALLOW_PRODUCTION=true.
 *
 * Demo accounts (password for all: Password123):
 *   admin@riverside.edu, teacher1..3@riverside.edu, student1..5@riverside.edu
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import {
  type AssessmentType,
  type AttendanceStatus,
  type GradeStatus,
  PrismaClient,
} from '../src/generated/prisma/client.js';

export const DEMO_PASSWORD = 'Password123';
export const TERM = '2026-Fall';
const TERM_START = new Date('2026-09-07T00:00:00.000Z'); // a Monday
const WEEKS = 9;

// ── Deterministic PRNG (mulberry32) ─────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260907);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
/** Approximately normal noise (sum of uniforms). */
const noise = (sd: number) => (rand() + rand() + rand() - 1.5) * sd * 1.4;

const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Ethan', 'Sofia', 'Lucas', 'Chloe', 'Mason', 'Zoe', 'Logan', 'Lily', 'Aiden', 'Grace', 'Elijah', 'Nora', 'James', 'Ella', 'Benjamin', 'Aria', 'Henry', 'Layla', 'Daniel', 'Hannah', 'Jack', 'Maya', 'Wei', 'Priya', 'Diego'] as const;
const LAST = ['Chen', 'Garcia', 'Smith', 'Patel', 'Johnson', 'Kim', 'Nguyen', 'Brown', 'Lopez', 'Wang', 'Davis', 'Martinez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Lee', 'Harris'] as const;

/**
 * Student archetypes give the analytics and the risk engine realistic signal:
 * most students are fine, some decline over the term, some struggle throughout,
 * some mainly have an attendance problem.
 */
type Archetype = 'steady' | 'strong' | 'declining' | 'struggling' | 'absentee';
const ARCHETYPES: { kind: Archetype; weight: number }[] = [
  { kind: 'strong', weight: 0.25 },
  { kind: 'steady', weight: 0.45 },
  { kind: 'declining', weight: 0.13 },
  { kind: 'struggling', weight: 0.09 },
  { kind: 'absentee', weight: 0.08 },
];
function pickArchetype(): Archetype {
  let r = rand();
  for (const a of ARCHETYPES) {
    if ((r -= a.weight) <= 0) return a.kind;
  }
  return 'steady';
}
const PROFILE: Record<Archetype, { base: number; drift: number; present: number; missing: number }> = {
  strong: { base: 91, drift: 0, present: 0.97, missing: 0.01 },
  steady: { base: 80, drift: 0, present: 0.93, missing: 0.04 },
  declining: { base: 82, drift: -3.2, present: 0.86, missing: 0.12 },
  struggling: { base: 61, drift: -0.5, present: 0.8, missing: 0.22 },
  absentee: { base: 74, drift: -1, present: 0.62, missing: 0.15 },
};

const COURSES = [
  { code: 'MATH-201', name: 'Algebra II', teacher: 0, description: 'Functions, polynomials and systems of equations.' },
  { code: 'MATH-310', name: 'AP Statistics', teacher: 0, description: 'Exploratory data analysis, probability and inference.' },
  { code: 'SCI-220', name: 'Chemistry', teacher: 1, description: 'Atomic structure, bonding and reactions.' },
  { code: 'SCI-305', name: 'AP Biology', teacher: 1, description: 'Cell biology, genetics and evolution.' },
  { code: 'ENG-210', name: 'American Literature', teacher: 2, description: 'Major works and movements in American literature.' },
  { code: 'CS-150', name: 'Intro to Programming', teacher: 2, description: 'Problem solving with Python.' },
] as const;

const ASSESSMENT_PLAN: { type: AssessmentType; title: string; week: number; max: number; weight: number }[] = [
  { type: 'ASSIGNMENT', title: 'Homework 1', week: 1, max: 20, weight: 1 },
  { type: 'QUIZ', title: 'Quiz 1', week: 2, max: 10, weight: 0.5 },
  { type: 'ASSIGNMENT', title: 'Homework 2', week: 3, max: 20, weight: 1 },
  { type: 'EXAM', title: 'Midterm Exam', week: 4, max: 100, weight: 3 },
  { type: 'ASSIGNMENT', title: 'Homework 3', week: 5, max: 20, weight: 1 },
  { type: 'QUIZ', title: 'Quiz 2', week: 6, max: 10, weight: 0.5 },
  { type: 'PROJECT', title: 'Unit Project', week: 7, max: 50, weight: 2 },
  { type: 'ASSIGNMENT', title: 'Homework 4', week: 8, max: 20, weight: 1 },
];

export async function seed(prisma: PrismaClient) {
  console.log('Clearing existing data...');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE risk_alerts, grade_history, grades, attendance, assessments, enrollments, courses, student_profiles, teacher_profiles, users, schools RESTART IDENTITY CASCADE',
  );

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── School and staff ───────────────────────────────────────────────────────
  const school = await prisma.school.create({ data: { name: 'Riverside High School' } });

  await prisma.user.create({
    data: { schoolId: school.id, email: 'admin@riverside.edu', passwordHash, role: 'ADMIN', firstName: 'Alex', lastName: 'Morgan' },
  });

  const teacherSeeds = [
    { first: 'Sarah', last: 'Thompson', dept: 'Mathematics' },
    { first: 'David', last: 'Okafor', dept: 'Science' },
    { first: 'Emily', last: 'Rivera', dept: 'English & Computer Science' },
  ];
  const teachers: string[] = [];
  for (const [i, t] of teacherSeeds.entries()) {
    const user = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `teacher${i + 1}@riverside.edu`,
        passwordHash,
        role: 'TEACHER',
        firstName: t.first,
        lastName: t.last,
        teacherProfile: { create: { department: t.dept, title: 'Teacher' } },
      },
      select: { teacherProfile: { select: { id: true } } },
    });
    teachers.push(user.teacherProfile!.id);
  }

  // ── Courses and assessments ────────────────────────────────────────────────
  const courses: { id: string; assessments: { id: string; maxScore: unknown; dueDate: Date }[] }[] = [];
  for (const c of COURSES) {
    const course = await prisma.course.create({
      data: {
        schoolId: school.id,
        teacherId: teachers[c.teacher]!,
        code: c.code,
        name: c.name,
        description: c.description,
        term: TERM,
        assessments: {
          create: ASSESSMENT_PLAN.map((a) => ({
            title: a.title,
            type: a.type,
            maxScore: a.max,
            weight: a.weight,
            dueDate: addDays(TERM_START, a.week * 7 + 4), // Friday of that week
          })),
        },
      },
      include: { assessments: { orderBy: { dueDate: 'asc' } } },
    });
    courses.push(course);
  }

  // ── Students ───────────────────────────────────────────────────────────────
  const STUDENT_COUNT = 60;
  const students: { id: string; archetype: Archetype }[] = [];
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const firstName = FIRST[i % FIRST.length]!;
    const lastName = LAST[(i * 7) % LAST.length]!;
    const studentNumber = `S2026${String(i + 1).padStart(3, '0')}`;
    const email = `${firstName}.${lastName}.${i + 1}@students.riverside.edu`.toLowerCase();
    // The first five students have login accounts. The demo student (student1)
    // is "declining" so the student dashboard has something to show.
    const archetype: Archetype = i === 0 ? 'declining' : i === 1 ? 'strong' : pickArchetype();
    const hasAccount = i < 5;
    const accountEmail = `student${i + 1}@riverside.edu`;
    const account = hasAccount
      ? await prisma.user.create({
          data: { schoolId: school.id, email: accountEmail, passwordHash, role: 'STUDENT', firstName, lastName },
          select: { id: true },
        })
      : null;
    const profile = await prisma.studentProfile.create({
      data: {
        schoolId: school.id,
        userId: account?.id ?? null,
        studentNumber,
        firstName,
        lastName,
        email: hasAccount ? accountEmail : email,
        gradeLevel: 9 + (i % 4),
      },
      select: { id: true },
    });
    students.push({ id: profile.id, archetype });
  }

  // ── Enrollments, grades and attendance (bulk inserts) ──────────────────────
  const enrollments: { studentId: string; courseId: string }[] = [];
  const grades: { assessmentId: string; studentId: string; score: number | null; status: GradeStatus; gradedAt: Date }[] = [];
  const attendance: { studentId: string; courseId: string; date: Date; status: AttendanceStatus }[] = [];

  // Two class meetings per week (Mon + Wed) for each course.
  const sessions: Date[] = [];
  for (let w = 0; w < WEEKS; w++) sessions.push(addDays(TERM_START, w * 7), addDays(TERM_START, w * 7 + 2));

  for (const [si, s] of students.entries()) {
    const p = PROFILE[s.archetype];
    // Each student takes 3–4 courses; offset by index so every course gets a full roster.
    const count = 3 + (si % 2);
    const chosen = Array.from({ length: count }, (_, k) => courses[(si + k * 2) % courses.length]!);
    const unique = [...new Map(chosen.map((c) => [c.id, c])).values()];

    for (const course of unique) {
      enrollments.push({ studentId: s.id, courseId: course.id });
      const courseOffset = noise(4);

      course.assessments.forEach((a, idx) => {
        const r = rand();
        let status: GradeStatus = 'SUBMITTED';
        if (r < p.missing) status = 'MISSING';
        else if (r < p.missing + 0.06) status = 'LATE';
        else if (r > 0.99) status = 'EXCUSED';

        const pct = clamp(p.base + courseOffset + p.drift * idx + noise(6) - (status === 'LATE' ? 5 : 0), 25, 100);
        const max = Number(a.maxScore);
        const score = status === 'MISSING' || status === 'EXCUSED' ? null : Math.round((pct / 100) * max * 2) / 2;
        grades.push({ assessmentId: a.id, studentId: s.id, score, status, gradedAt: addDays(a.dueDate, 3) });
      });

      sessions.forEach((date, idx) => {
        // Declining students also attend less as the term goes on.
        const presentP = s.archetype === 'declining' ? p.present - idx * 0.012 : p.present;
        const r = rand();
        let status: AttendanceStatus = 'PRESENT';
        if (r > presentP) status = rand() < 0.75 ? 'ABSENT' : 'EXCUSED';
        else if (r > presentP - 0.05) status = 'LATE';
        attendance.push({ studentId: s.id, courseId: course.id, date, status });
      });
    }
  }

  await prisma.enrollment.createMany({ data: enrollments });
  await prisma.grade.createMany({ data: grades });
  await prisma.attendance.createMany({ data: attendance });

  const summary = {
    schools: 1,
    users: await prisma.user.count(),
    students: students.length,
    courses: courses.length,
    enrollments: enrollments.length,
    assessments: courses.length * ASSESSMENT_PLAN.length,
    grades: grades.length,
    attendance: attendance.length,
  };
  return { schoolId: school.id, summary };
}

// Run when executed directly (not when imported by tests).
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts');
if (isMain) {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    console.error('Refusing to seed a production database. Set SEED_ALLOW_PRODUCTION=true to override.');
    process.exit(1);
  }
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const started = Date.now();
    const { summary } = await seed(prisma);
    console.log('Seed complete:', summary, `in ${Date.now() - started}ms`);
  } finally {
    await prisma.$disconnect();
  }
}
