/**
 * Thin HTTP adapters: parse + validate input with Zod, call a service, shape
 * the response. No business rules live here, which keeps services reusable
 * (seed scripts, jobs, tests) and controllers trivial to review.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/authorize.js';
import * as attendance from '../services/attendance.service.js';
import * as courses from '../services/courses.service.js';
import * as enrollments from '../services/enrollments.service.js';
import * as grades from '../services/grades.service.js';
import * as school from '../services/school.service.js';
import * as students from '../services/students.service.js';
import * as users from '../services/users.service.js';
import { created, noContent, ok, paginated } from '../utils/http.js';
import { idParam } from '../validators/common.js';
import * as v from '../validators/resource.validators.js';

const id = (req: Request) => idParam.parse(req.params).id;

// ── Users ──
export const usersController = {
  list: async (req: Request, res: Response) => {
    paginated(res, await users.listUsers(currentUser(req), v.listUsersQuery.parse(req.query)));
  },
  get: async (req: Request, res: Response) => {
    ok(res, await users.getUser(currentUser(req), id(req)));
  },
  create: async (req: Request, res: Response) => {
    created(res, await users.createUser(currentUser(req), v.createUserSchema.parse(req.body)));
  },
  update: async (req: Request, res: Response) => {
    ok(res, await users.updateUser(currentUser(req), id(req), v.updateUserSchema.parse(req.body)));
  },
};

// ── School ──
export const schoolController = {
  get: async (req: Request, res: Response) => {
    ok(res, await school.getSchool(currentUser(req)));
  },
  update: async (req: Request, res: Response) => {
    ok(res, await school.updateSchool(currentUser(req), v.updateSchoolSchema.parse(req.body)));
  },
};

// ── Students ──
export const studentsController = {
  list: async (req: Request, res: Response) => {
    paginated(
      res,
      await students.listStudents(currentUser(req), v.listStudentsQuery.parse(req.query)),
    );
  },
  directory: async (req: Request, res: Response) => {
    ok(res, await students.directory(currentUser(req), v.directoryQuery.parse(req.query)));
  },
  get: async (req: Request, res: Response) => {
    ok(res, await students.getStudent(currentUser(req), id(req)));
  },
  create: async (req: Request, res: Response) => {
    created(
      res,
      await students.createStudent(currentUser(req), v.createStudentSchema.parse(req.body)),
    );
  },
  update: async (req: Request, res: Response) => {
    ok(
      res,
      await students.updateStudent(
        currentUser(req),
        id(req),
        v.updateStudentSchema.parse(req.body),
      ),
    );
  },
  grades: async (req: Request, res: Response) => {
    const { courseId } = v.studentGradesQuery.parse(req.query);
    ok(res, await grades.getStudentGrades(currentUser(req), id(req), courseId));
  },
  attendance: async (req: Request, res: Response) => {
    ok(
      res,
      await attendance.getStudentAttendance(
        currentUser(req),
        id(req),
        v.studentAttendanceQuery.parse(req.query),
      ),
    );
  },
};

// ── Courses ──
export const coursesController = {
  list: async (req: Request, res: Response) => {
    paginated(
      res,
      await courses.listCourses(currentUser(req), v.listCoursesQuery.parse(req.query)),
    );
  },
  get: async (req: Request, res: Response) => {
    ok(res, await courses.getCourse(currentUser(req), id(req)));
  },
  create: async (req: Request, res: Response) => {
    created(
      res,
      await courses.createCourse(currentUser(req), v.createCourseSchema.parse(req.body)),
    );
  },
  update: async (req: Request, res: Response) => {
    ok(
      res,
      await courses.updateCourse(currentUser(req), id(req), v.updateCourseSchema.parse(req.body)),
    );
  },
  remove: async (req: Request, res: Response) => {
    await courses.deleteCourse(currentUser(req), id(req));
    noContent(res);
  },
  roster: async (req: Request, res: Response) => {
    ok(res, await courses.getRoster(currentUser(req), id(req)));
  },
  listAssessments: async (req: Request, res: Response) => {
    ok(res, await grades.listAssessments(currentUser(req), id(req)));
  },
  createAssessment: async (req: Request, res: Response) => {
    created(
      res,
      await grades.createAssessment(
        currentUser(req),
        id(req),
        v.createAssessmentSchema.parse(req.body),
      ),
    );
  },
  getAttendance: async (req: Request, res: Response) => {
    const { date } = v.attendanceDateQuery.parse(req.query);
    ok(res, await attendance.getCourseAttendance(currentUser(req), id(req), date));
  },
  recordAttendance: async (req: Request, res: Response) => {
    ok(
      res,
      await attendance.recordAttendance(
        currentUser(req),
        id(req),
        v.bulkAttendanceSchema.parse(req.body),
      ),
    );
  },
  attendanceSessions: async (req: Request, res: Response) => {
    ok(res, await attendance.listSessions(currentUser(req), id(req)));
  },
};

// ── Enrollments ──
export const enrollmentsController = {
  list: async (req: Request, res: Response) => {
    paginated(
      res,
      await enrollments.listEnrollments(currentUser(req), v.listEnrollmentsQuery.parse(req.query)),
    );
  },
  create: async (req: Request, res: Response) => {
    const { studentId, courseId } = v.createEnrollmentSchema.parse(req.body);
    const { enrollment, reactivated } = await enrollments.enroll(
      currentUser(req),
      studentId,
      courseId,
    );
    if (reactivated) ok(res, enrollment);
    else created(res, enrollment);
  },
  update: async (req: Request, res: Response) => {
    const { status } = v.updateEnrollmentSchema.parse(req.body);
    ok(res, await enrollments.updateEnrollment(currentUser(req), id(req), status));
  },
};

// ── Assessments & grades ──
export const assessmentsController = {
  update: async (req: Request, res: Response) => {
    ok(
      res,
      await grades.updateAssessment(
        currentUser(req),
        id(req),
        v.updateAssessmentSchema.parse(req.body),
      ),
    );
  },
  remove: async (req: Request, res: Response) => {
    await grades.deleteAssessment(currentUser(req), id(req));
    noContent(res);
  },
  gradebook: async (req: Request, res: Response) => {
    ok(res, await grades.getGradebook(currentUser(req), id(req)));
  },
  upsertGrades: async (req: Request, res: Response) => {
    ok(
      res,
      await grades.upsertGrades(currentUser(req), id(req), v.bulkGradesSchema.parse(req.body)),
    );
  },
};

export const gradesController = {
  history: async (req: Request, res: Response) => {
    ok(
      res,
      await grades.getGradeHistory(
        currentUser(req),
        z.object({ id: z.uuid() }).parse(req.params).id,
      ),
    );
  },
};
