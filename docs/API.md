# REST API reference

Base path: `/api/v1`. All request and response bodies are JSON.

**Authentication:** `POST /auth/login` sets an httpOnly `sla_token` cookie, which browsers send
automatically. Non-browser clients can send the same JWT as `Authorization: Bearer <token>`.

**Response envelope**

```jsonc
// single resource / object
{ "data": { … } }
// list
{ "data": [ … ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
// error
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "path": "email", "message": "Must be a valid email address" }] } }
```

**Status codes:** `200` OK · `201` created · `204` no content · `400` validation or business-rule error ·
`401` not authenticated / invalid session · `403` role not allowed or password change required · `404` not found _or outside
your data scope_ · `409` conflict (duplicate, constraint) · `410` activation link no longer valid · `429` rate limited · `503` invites disabled · `500` unexpected.

**Rate limits** (per client IP): `POST /auth/login`, `POST /auth/activation/verify`,
`POST /auth/activation` and `PATCH /auth/password` each allow 20 **failed** attempts per 15 minutes
(successful requests are not counted); `POST /students/:id/activation-invite` allows 20 requests per
15 minutes (every invite counts); all of `/api/v1` allows 600 requests per minute. Responses carry `RateLimit-Policy` and
`RateLimit` headers (IETF draft 8); a blocked request gets `429`, a `Retry-After` header in seconds
and `{ "error": { "code": "RATE_LIMITED", "message": "Too many failed attempts. Try again in 6 minutes." } }`.

**Pagination:** list endpoints accept `page` (≥1, default 1) and `pageSize` (1–100, default 20).

Roles: **A** = Admin, **T** = Teacher, **S** = Student. "Scoped" means results are limited to
the caller's data (see [ARCHITECTURE.md §4](ARCHITECTURE.md#4-authorization-two-layers)).

## Auth

| Method | Path                      | Roles  | Body / query                       | Notes                                                                                                                   |
| ------ | ------------------------- | ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`             | public | `{ email, password }`              | sets cookie; returns `{ user }` (`user.mustChangePassword: true` means the next screen must be the password change)     |
| POST   | `/auth/activation/verify` | public | `{ token }`                        | checks an activation link; returns `{ firstName, lastName, email, school }`                                             |
| POST   | `/auth/activation`        | public | `{ token, password }`              | creates the student's login from the invite and links it to the profile; 201 `{ email }`; no session is started         |
| POST   | `/auth/logout`            | public | –                                  | clears cookie; 204                                                                                                      |
| POST   | `/auth/logout-all`        | any    | –                                  | revokes every token for the user; 204                                                                                   |
| GET    | `/auth/me`                | any    | –                                  | current user                                                                                                            |
| PATCH  | `/auth/password`          | any    | `{ currentPassword, newPassword }` | sets the new password, clears `mustChangePassword` and **ends every session, including this one** (cookie cleared); 204 |

Password policy: 8+ characters, at most 72 bytes, contains a letter and a number; a new password must
differ from the current one. The old `POST /auth/register` (student number + email) was removed.

**First sign-in with a temporary password.** Accounts created by an admin (`POST /users`) start with
`mustChangePassword: true`. Until the password is changed, every endpoint except `GET /auth/me`,
`PATCH /auth/password`, `POST /auth/logout` and `POST /auth/logout-all` answers
`403 PASSWORD_CHANGE_REQUIRED`.

**Activation link errors** (from both activation endpoints):

| Status | Code                       | Meaning                                                            |
| ------ | -------------------------- | ------------------------------------------------------------------ |
| 400    | `ACTIVATION_TOKEN_INVALID` | unknown or malformed token                                         |
| 410    | `ACTIVATION_TOKEN_EXPIRED` | older than 24 hours                                                |
| 410    | `ACTIVATION_TOKEN_USED`    | already used                                                       |
| 410    | `ACTIVATION_TOKEN_REVOKED` | replaced by a newer invite, or voided when an admin linked a login |
| 409    | `ACCOUNT_EXISTS`           | the student already has an account (also when it is disabled)      |
| 409    | `STUDENT_INACTIVE`         | the student record is not active                                   |

## School and users

| Method | Path         | Roles | Notes                                                                                                                                                                                                                                               |
| ------ | ------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/school`    | A T S | school info and counts                                                                                                                                                                                                                              |
| PATCH  | `/school`    | A     | `{ name?, timezone? }`                                                                                                                                                                                                                              |
| GET    | `/users`     | A     | `role`, `isActive`, `search`, pagination                                                                                                                                                                                                            |
| POST   | `/users`     | A     | `{ email, password, role, firstName, lastName, department?, studentId? }`: the password is temporary (`mustChangePassword: true`). TEACHER creates a teacher profile; STUDENT requires `studentId` to link and voids that student's pending invites |
| GET    | `/users/:id` | A     |                                                                                                                                                                                                                                                     |
| PATCH  | `/users/:id` | A     | `{ firstName?, lastName?, isActive?, department? }`; deactivating revokes sessions; admins cannot deactivate themselves                                                                                                                             |

## Students

| Method | Path                              | Roles          | Notes                                                                                                                                                                                                                                                                                                             |
| ------ | --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/students`                       | A T (scoped)   | `search`, `courseId`, `gradeLevel`, `status`, `riskLevel` (highest visible level), `sort` (`lastName`\|`studentNumber`\|`gradeLevel`\|`createdAt`), `order`, pagination                                                                                                                                           |
| GET    | `/students/directory`             | A T            | `search`, `limit` ≤ 50: minimal school-wide lookup for enrolling                                                                                                                                                                                                                                                  |
| POST   | `/students`                       | A T            | `{ studentNumber, firstName, lastName, email?, gradeLevel, courseIds[] }`; teachers must include ≥1 of their courses; transactional                                                                                                                                                                               |
| GET    | `/students/:id`                   | A T S (scoped) | profile, visible enrollments, risk summary, `account: { status: NONE \| ACTIVE \| DISABLED, pendingInvite }` (`pendingInvite` has `createdAt`/`expiresAt` only, never the token)                                                                                                                                  |
| POST   | `/students/:id/activation-invite` | A T (scoped)   | creates a one-time invite (24 h) and revokes earlier ones. With `INVITE_DELIVERY=dev-link` (development only) returns `{ delivery, expiresAt, activationUrl }`; with `disabled` (the default) answers `503 INVITES_DISABLED` and creates nothing. `409 ACCOUNT_EXISTS` / `STUDENT_INACTIVE`, `400 EMAIL_REQUIRED` |
| PATCH  | `/students/:id`                   | A T (scoped)   | any profile field plus `status`                                                                                                                                                                                                                                                                                   |
| GET    | `/students/:id/grades`            | A T S (scoped) | `courseId?`; grades with percentages                                                                                                                                                                                                                                                                              |
| GET    | `/students/:id/attendance`        | A T S (scoped) | `courseId?`, `from?`, `to?` (YYYY-MM-DD)                                                                                                                                                                                                                                                                          |
| GET    | `/students/:id/risk`              | A T S (scoped) | current alerts with factors and suggestions                                                                                                                                                                                                                                                                       |

## Courses, enrollments, assessments, grades, attendance

| Method | Path                               | Roles               | Notes                                                                                                                                                                                           |
| ------ | ---------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/courses`                         | A T S (scoped)      | `search`, `term`, `teacherId`, pagination                                                                                                                                                       |
| POST   | `/courses`                         | A T                 | `{ code, name, term (e.g. 2026-Fall), credits?, description?, teacherId? }` (admin must give `teacherId`); 409 on duplicate code+term                                                           |
| GET    | `/courses/:id`                     | A T S (scoped)      |                                                                                                                                                                                                 |
| PATCH  | `/courses/:id`                     | A T (manage)        | only admins may change `teacherId`                                                                                                                                                              |
| DELETE | `/courses/:id`                     | A                   | cascades to the course's data; 204                                                                                                                                                              |
| GET    | `/courses/:id/students`            | A T (manage)        | roster with enrollment status and risk                                                                                                                                                          |
| GET    | `/courses/:id/assessments`         | A T S (scoped)      | with graded count and average %                                                                                                                                                                 |
| POST   | `/courses/:id/assessments`         | A T (manage)        | `{ title, type, maxScore, weight?, dueDate }`                                                                                                                                                   |
| PATCH  | `/assessments/:id`                 | A T (manage)        | lowering `maxScore` below existing grades → 409                                                                                                                                                 |
| DELETE | `/assessments/:id`                 | A T (manage)        | 204                                                                                                                                                                                             |
| GET    | `/assessments/:id/grades`          | A T (manage)        | gradebook: every active student, graded or not                                                                                                                                                  |
| PUT    | `/assessments/:id/grades`          | A T (manage)        | `{ grades: [{ studentId, score?, status, feedback? }], reason? }`: bulk upsert in one transaction, writes grade history, triggers risk recalculation; returns `{ created, updated, unchanged }` |
| GET    | `/grades/:id/history`              | A T (manage)        | audit trail of a grade                                                                                                                                                                          |
| GET    | `/courses/:id/attendance`          | A T (manage)        | `date=YYYY-MM-DD`: roster with that day's marks                                                                                                                                                 |
| PUT    | `/courses/:id/attendance`          | A T (manage)        | `{ date, records: [{ studentId, status, note? }] }`: idempotent upsert; future dates rejected                                                                                                   |
| GET    | `/courses/:id/attendance/sessions` | A T (manage)        | recorded dates with per-status counts                                                                                                                                                           |
| GET    | `/enrollments`                     | A T (scoped)        | requires `courseId` or `studentId`; `status`, pagination                                                                                                                                        |
| POST   | `/enrollments`                     | A T (manage course) | `{ studentId, courseId }`: 201 new, 200 re-activated, 409 already active                                                                                                                        |
| PATCH  | `/enrollments/:id`                 | A T (manage)        | `{ status: ACTIVE \| DROPPED \| COMPLETED }`                                                                                                                                                    |

Grade `status`: `SUBMITTED` / `LATE` (score required) · `MISSING` / `EXCUSED` (score stored as null).
Attendance `status`: `PRESENT`, `LATE`, `ABSENT`, `EXCUSED`.

## Analytics

All analytics endpoints accept `courseId?` and `term?`. Teachers get their own courses, admins the whole school.

| Method | Path                               | Roles          | Returns                                                                                                            |
| ------ | ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/analytics/overview`              | A T            | counts, weighted average score, attendance rate, completion rate, risk distribution, at-risk students, open alerts |
| GET    | `/analytics/score-trends`          | A T            | `{ overall: [{ period, averagePercent, gradedCount }], byCourse: [...] }` by assessment due week                   |
| GET    | `/analytics/course-comparison`     | A T            | per course: students, average score, attendance, completion, risk counts                                           |
| GET    | `/analytics/attendance`            | A T            | weekly present/late/absent/excused + rate; distribution of enrollments by attendance band                          |
| GET    | `/analytics/risk-distribution`     | A T            | totals, per-course counts, most frequent risk factors                                                              |
| GET    | `/analytics/students/:id/progress` | A T S (scoped) | per-course metrics and risk; each graded assessment vs. class average; weekly attendance                           |

## Early-warning engine

| Method | Path                       | Roles        | Notes                                                                                                                               |
| ------ | -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/risk-alerts`             | A T (scoped) | `level` or `minLevel`, `status`, `courseId`, `studentId`, pagination; ordered by score                                              |
| GET    | `/risk-alerts/:id`         | A T (scoped) |                                                                                                                                     |
| PATCH  | `/risk-alerts/:id`         | A T (manage) | `{ status: OPEN \| ACKNOWLEDGED \| RESOLVED, note? }`                                                                               |
| POST   | `/risk-alerts/recalculate` | A T          | `{ courseId? }`: teachers recalculate their courses, admins the whole school; returns `{ courses, evaluated, byLevel, durationMs }` |
| GET    | `/settings/risk`           | A T          | effective configuration (defaults merged)                                                                                           |
| PUT    | `/settings/risk`           | A            | full or partial config (validated: medium < high, critical worse than warn, no unknown keys); recalculates the school               |

Alert `factors[]` item:

```json
{
  "rule": "attendance",
  "severity": "CRITICAL",
  "points": 25,
  "value": 76.5,
  "threshold": 80,
  "message": "Attendance is 76.5% (4 absences), below the 80% threshold",
  "suggestion": "Contact the student and family about attendance and agree on a plan."
}
```

## Health

`GET /api/health` → `{ "data": { "status": "ok", "time": "…" } }` (runs `SELECT 1` against the database).

## Example session (curl)

```bash
curl -c jar -H 'Content-Type: application/json' \
     -d '{"email":"teacher1@riverside.edu","password":"Password123"}' \
     http://localhost:4000/api/v1/auth/login
curl -b jar 'http://localhost:4000/api/v1/students?riskLevel=HIGH&pageSize=5'
curl -b jar http://localhost:4000/api/v1/analytics/overview
```
