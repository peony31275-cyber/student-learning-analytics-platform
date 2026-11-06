/**
 * Minimal, explicit test fixtures. Each test file builds exactly the data it
 * asserts on, so tests stay readable and independent of the demo seed.
 */
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp } from '../../src/app.js';
import type { Role } from '../../src/generated/prisma/enums.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';

export const PASSWORD = 'Password123';
export const app = createApp() as unknown as App;

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE activation_tokens, risk_alerts, grade_history, grades, attendance, assessments, enrollments, courses, student_profiles, teacher_profiles, users, schools CASCADE',
  );
}

export async function createSchool(name = 'Test School') {
  return prisma.school.create({ data: { name } });
}

let cachedHash: string | undefined;
async function passwordHash() {
  cachedHash ??= await hashPassword(PASSWORD);
  return cachedHash;
}

export async function createUser(
  schoolId: string,
  role: Role,
  overrides: { email?: string; isActive?: boolean } = {},
) {
  const email = overrides.email ?? `${role.toLowerCase()}-${uniq()}@test.edu`;
  return prisma.user.create({
    data: {
      schoolId,
      email,
      passwordHash: await passwordHash(),
      role,
      firstName: 'Test',
      lastName: role,
      isActive: overrides.isActive ?? true,
      ...(role === 'TEACHER' && { teacherProfile: { create: { department: 'Testing' } } }),
    },
    include: { teacherProfile: true },
  });
}

export async function createStudent(
  schoolId: string,
  opts: { userId?: string; email?: string; lastName?: string } = {},
) {
  return prisma.studentProfile.create({
    data: {
      schoolId,
      userId: opts.userId ?? null,
      studentNumber: `S-${uniq()}`,
      firstName: 'Stu',
      lastName: opts.lastName ?? 'Dent',
      email: opts.email ?? null,
      gradeLevel: 10,
    },
  });
}

export async function createCourse(schoolId: string, teacherId: string, code = `C-${uniq()}`) {
  return prisma.course.create({
    data: { schoolId, teacherId, code, name: `Course ${code}`, term: '2026-Fall' },
  });
}

export async function enroll(studentId: string, courseId: string) {
  return prisma.enrollment.create({ data: { studentId, courseId } });
}

/** Logs in through the real endpoint and returns an agent that carries the auth cookie. */
export async function loginAs(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/**
 * A small but complete world used by most integration tests:
 * one school with an admin, two teachers (each with a course and a student),
 * a student login, and a second school to verify tenant isolation.
 */
export async function buildWorld() {
  const school = await createSchool();
  const otherSchool = await createSchool('Other School');

  const admin = await createUser(school.id, 'ADMIN');
  const teacherA = await createUser(school.id, 'TEACHER');
  const teacherB = await createUser(school.id, 'TEACHER');
  const studentUser = await createUser(school.id, 'STUDENT');
  const otherAdmin = await createUser(otherSchool.id, 'ADMIN');

  const courseA = await createCourse(school.id, teacherA.teacherProfile!.id);
  const courseB = await createCourse(school.id, teacherB.teacherProfile!.id);

  const studentA = await createStudent(school.id, { userId: studentUser.id, lastName: 'Alpha' });
  const studentB = await createStudent(school.id, { lastName: 'Beta' });
  await enroll(studentA.id, courseA.id);
  await enroll(studentB.id, courseB.id);

  return {
    school,
    otherSchool,
    admin,
    teacherA,
    teacherB,
    studentUser,
    otherAdmin,
    courseA,
    courseB,
    studentA,
    studentB,
  };
}
export type World = Awaited<ReturnType<typeof buildWorld>>;
