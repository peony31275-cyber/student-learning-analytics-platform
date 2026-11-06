/**
 * API route map. Authentication is applied once for everything after /auth;
 * each route then declares which roles may call it (coarse RBAC). Row-level
 * rules are enforced again inside the services.
 */
import { Router } from 'express';
import {
  assessmentsController as assessments,
  coursesController as courses,
  enrollmentsController as enrollments,
  gradesController as grades,
  schoolController as school,
  studentsController as students,
  usersController as users,
} from '../controllers/resource.controllers.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { authRouter } from './auth.routes.js';

const ADMIN = requireRole('ADMIN');
const STAFF = requireRole('ADMIN', 'TEACHER');
const ANY = requireRole('ADMIN', 'TEACHER', 'STUDENT');

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use(authenticate);

// School & users (admin)
apiRouter.get('/school', ANY, school.get);
apiRouter.patch('/school', ADMIN, school.update);
apiRouter.get('/users', ADMIN, users.list);
apiRouter.post('/users', ADMIN, users.create);
apiRouter.get('/users/:id', ADMIN, users.get);
apiRouter.patch('/users/:id', ADMIN, users.update);

// Students
apiRouter.get('/students', STAFF, students.list);
apiRouter.get('/students/directory', STAFF, students.directory);
apiRouter.post('/students', STAFF, students.create);
apiRouter.get('/students/:id', ANY, students.get);
apiRouter.patch('/students/:id', STAFF, students.update);
apiRouter.get('/students/:id/grades', ANY, students.grades);
apiRouter.get('/students/:id/attendance', ANY, students.attendance);

// Courses (+ nested collections)
apiRouter.get('/courses', ANY, courses.list);
apiRouter.post('/courses', STAFF, courses.create);
apiRouter.get('/courses/:id', ANY, courses.get);
apiRouter.patch('/courses/:id', STAFF, courses.update);
apiRouter.delete('/courses/:id', ADMIN, courses.remove);
apiRouter.get('/courses/:id/students', STAFF, courses.roster);
apiRouter.get('/courses/:id/assessments', ANY, courses.listAssessments);
apiRouter.post('/courses/:id/assessments', STAFF, courses.createAssessment);
apiRouter.get('/courses/:id/attendance', STAFF, courses.getAttendance);
apiRouter.put('/courses/:id/attendance', STAFF, courses.recordAttendance);
apiRouter.get('/courses/:id/attendance/sessions', STAFF, courses.attendanceSessions);

// Enrollments
apiRouter.get('/enrollments', STAFF, enrollments.list);
apiRouter.post('/enrollments', STAFF, enrollments.create);
apiRouter.patch('/enrollments/:id', STAFF, enrollments.update);

// Assessments & grades
apiRouter.patch('/assessments/:id', STAFF, assessments.update);
apiRouter.delete('/assessments/:id', STAFF, assessments.remove);
apiRouter.get('/assessments/:id/grades', STAFF, assessments.gradebook);
apiRouter.put('/assessments/:id/grades', STAFF, assessments.upsertGrades);
apiRouter.get('/grades/:id/history', STAFF, grades.history);
