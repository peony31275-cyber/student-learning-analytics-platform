# Architecture and technical decisions

This document explains _why_ the system is built the way it is. Each section ends with
questions an interviewer is likely to ask, and the short answer.

## 1. Overall shape: separated SPA + REST API, deployed as one service

The React app and the Express API are separate workspaces with no shared runtime code; they talk
only through the REST API. In production, Express also serves the built SPA, so the browser
sees a single origin.

**Why:** separation keeps the frontend replaceable (a mobile client could use the same API)
and lets each side be tested in isolation. Serving from one origin removes CORS and third-party
cookie problems: the httpOnly auth cookie is first-party, so `SameSite=Lax` works.

_Q: Why not Next.js?_ The requirements call for a REST API used by an SPA. Express + Vite
keeps the boundary explicit and is a very common production setup. Server-side rendering isn't
needed for an authenticated dashboard.

## 2. Backend layering

```
route → authenticate → requireRole → controller → service → Prisma / SQL
                                                   ↘ domain/risk (pure)
```

| Layer          | Responsibility                                                            | Must not               |
| -------------- | ------------------------------------------------------------------------- | ---------------------- |
| `routes/`      | URL → handler, coarse role requirement                                    | contain logic          |
| `controllers/` | Zod-parse params/query/body, call one service, send the response envelope | touch the database     |
| `services/`    | business rules, data scoping, transactions, aggregation                   | know about `req`/`res` |
| `domain/risk/` | pure functions: metrics, rules, configuration                             | do I/O                 |

Express 5 forwards rejected promises to the error middleware, so services just `throw`
(`AppError`, `ZodError`, Prisma errors). `middleware/error-handler.ts` turns them into one
response shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [ … ] } }
```

Any other error becomes a generic 500 and is logged with its stack trace. Internal details never
reach the client.

_Q: Why are controllers so thin?_ So the same business rules can be reused by the seed script and
by background-style recalculation, and so services can be tested through any entry point. Each
controller has one job: turn HTTP into a typed service call.

## 3. Authentication

- Passwords are hashed with **bcrypt** (cost 12 in production, 4 in tests for speed). Passwords
  over 72 bytes are rejected because bcrypt silently truncates them.
- Login issues an **HS256 JWT** `{ sub, role, tv }` in an **httpOnly, Secure (in production), SameSite=Lax** cookie.
  JavaScript cannot read it, so an XSS payload cannot steal it. Lax stops it being sent with
  cross-site POST/PUT/PATCH/DELETE requests, which mitigates CSRF.
- `authenticate` verifies the token with a **pinned algorithm** (prevents the `alg: none` and
  algorithm-confusion attacks) and **reloads the user by primary key** on each request.
  Comparing `tv` against `User.tokenVersion` gives instant revocation for logout-everywhere,
  password change and deactivation. The cost is one indexed lookup per request, accepted in
  exchange for the security benefit.
- Login returns the same 401 message for an unknown email and a wrong password, and runs a dummy
  bcrypt comparison when the email does not exist, so response timing does not reveal which
  accounts exist.
- Credential endpoints have a per-IP rate limit (20 per 15 minutes); the whole API has a coarser one.
- Public registration can only create **STUDENT** accounts, and only for a student record the
  school already created (matching student number + email). A `role` field in the request is ignored.

_Q: Why not store the JWT in localStorage?_ Any XSS could read it. An httpOnly cookie
cannot be read by script, and SameSite handles CSRF for a same-origin app.
_Q: Stateless JWT but you hit the DB every request, so why JWT?_ The token still carries a
tamper-proof identity without a session table. The PK lookup buys revocation and fresh role/active
checks. A Redis session store would be the next step at larger scale.

## 4. Authorization: two layers

1. **Role (route level):** `requireRole('ADMIN','TEACHER')` rejects with 403.
2. **Data scope (service level):** `access.service.ts` returns Prisma `where` fragments:

| Role    | Students visible                | Courses visible              |
| ------- | ------------------------------- | ---------------------------- |
| Admin   | all in their school             | all in their school          |
| Teacher | enrolled in a course they teach | courses they teach           |
| Student | only their own profile          | courses they are enrolled in |

Every list query composes the fragment (`AND: [scope, filters]`), and every single-resource
endpoint calls an `assert…Access` helper first. Out-of-scope IDs return **404, not 403**, so
nobody can tell whether another teacher's student exists (protection against IDOR enumeration).
The frontend route guards are only for UX; the tests call the API directly to show the server
enforces everything on its own.

A bug found during UI review shows why this matters: the student list showed a student's risk
level computed across _all_ their courses, including other teachers' courses. The fix scoped the
nested `riskAlerts` and `_count` selections with the same `courseScope(user)`, and a regression
test now covers it.

## 5. Early-warning engine

`domain/risk/metrics.ts` turns one student's grades and attendance in one course into metrics
(weighted average, recent vs. earlier average, trend, attendance rate, completion rate).
`domain/risk/engine.ts` evaluates four **tiered rules**:

| Rule               | Metric                            | Warning → points | Critical → points |
| ------------------ | --------------------------------- | ---------------- | ----------------- |
| Recent performance | avg % of last 3 graded items      | < 70% → 15       | < 60% → 30        |
| Declining trend    | drop of recent avg vs earlier avg | ≥ 5 pts → 10     | ≥ 10 pts → 20     |
| Attendance         | attended / counted sessions       | < 90% → 10       | < 80% → 25        |
| Completion         | submitted / expected work         | < 90% → 10       | < 75% → 25        |

Score = sum (capped at 100). Level: **≥ 50 HIGH, ≥ 25 MEDIUM, else LOW**. Rules are skipped,
with the reason recorded, when there is not enough data (fewer than 3 graded items or 4 sessions),
so one bad quiz does not trigger an alarm. All numbers live in a Zod schema with defaults; admins
override them per school (`School.riskConfig`). A corrupt stored config falls back to the
defaults instead of crashing.

**Persistence:** one `RiskAlert` row per (student, course), upserted on recalculation. It stores
the score, level, previous level, `factors` (message, observed value, threshold, points,
suggestion) and the raw `metrics`, so every decision can be audited later.
**Lifecycle:** LOW is auto-resolved; a new alert or an escalation (e.g. MEDIUM → HIGH) is
re-opened; otherwise a teacher's ACKNOWLEDGED/RESOLVED status is kept.
**Triggers:** after every grade or attendance write (only for the affected students), after
config changes (whole school), or manually from the alerts page.

**Query cost:** evaluating a course uses a fixed number of queries (enrollments, grades,
attendance, existing alerts, then one write transaction) no matter how many students it has.
Grouping happens in memory. This avoids an N+1 pattern of per-student queries.

_Q: Why not machine learning?_ There is no labelled outcome data, and teachers need to be able to
see why a student was flagged and disagree. A transparent rubric is the honest choice. The
engine's interface (metrics in, factors out) would let a model be plugged in later.
_Q: Why is the engine a pure function?_ It can be unit tested exhaustively (boundaries,
insufficient data, disabled rules, invalid configs) in milliseconds without a database, and
the same code runs in the API and the seed script.

## 6. Analytics queries

Analytics endpoints first resolve the course IDs the caller may see (the same scope rules), then
run **parameterized SQL** through Prisma's tagged templates (`$queryRaw`): `GROUP BY`,
`COUNT(*) FILTER (WHERE …)`, `date_trunc('week', …)`, and weighted averages. Only summary rows
leave the database. All statistics join on the **ACTIVE** enrollment, so dropped students don't
skew the numbers. Values are bind parameters, never string concatenation, which rules out SQL
injection.

_Q: Why raw SQL here when Prisma is used elsewhere?_ Prisma's `groupBy` cannot express weighted
averages, conditional counts or week bucketing. Using SQL for aggregation and the ORM for CRUD is
a deliberate split.

## 7. Frontend

- **Server state lives in TanStack Query**, not in a global store. Hierarchical query keys
  (`['analytics', name, filter]`, `['students', 'detail', id]`) let a mutation invalidate exactly
  the views it affects. For example, saving grades refreshes analytics, risk and student views.
  A 30-second `staleTime` removes duplicate requests while navigating; 4xx responses are never retried.
- **The session is the `/auth/me` query.** A global 401 listener drops the UI to the login page if the
  cookie expires or is revoked.
- **Filter state lives in the URL** (`?courseId=…&riskLevel=HIGH&page=2`), so views can be
  shared and bookmarked and survive a refresh.
- Every data view uses `QueryState` to handle **loading / error (with retry) / empty / data** the same way.
- Forms initialized from server data are separate components with a `key`, which avoids the
  "copy props into state in an effect" anti-pattern.
- **Route-level code splitting:** chart pages are lazy-loaded, so Recharts (≈110 kB gzip) is
  not part of the login bundle.
- **Charts:** categorical colors use a palette validated for color-vision deficiency, and risk uses
  reserved status colors that always come with a shape and a text label. Each chart has a
  tooltip and a table view, and there are separate light and dark palettes.

## 8. Testing strategy

| Level                       | Tool                                 | What                                                                        |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Unit                        | Vitest                               | risk metrics, rules, thresholds, config validation                          |
| Integration                 | Vitest + Supertest + real PostgreSQL | every endpoint through the full middleware stack                            |
| Component                   | React Testing Library + jsdom        | UI states, login flow, role guard                                           |
| Smoke / E2E (manual script) | Playwright (headless Edge)           | production build: login, charts render under the CSP, attendance round trip |

Integration tests run against **real PostgreSQL**, not mocks or SQLite, because the analytics SQL,
unique constraints, cascades and transactions are exactly what needs verifying. Locally the
global setup starts a throwaway PostgreSQL and applies the real migrations; in CI it uses a
PostgreSQL service container.

## 9. Security checklist

- [x] bcrypt password hashing, 72-byte limit, password policy
- [x] httpOnly / Secure / SameSite=Lax cookie, pinned JWT algorithm, server-side revocation
- [x] RBAC on every route plus row-level scoping in services; 404 for out-of-scope IDs
- [x] Zod validation of every body, query and path parameter (UUIDs checked before DB access)
- [x] Parameterized SQL only; explicit `select` allow-lists (no `passwordHash` in any response)
- [x] Helmet security headers (CSP, HSTS, nosniff, frame-ancestors), `x-powered-by` disabled
- [x] Rate limiting (credentials + global), 100 kB JSON body limit
- [x] Secrets only via environment variables, validated at startup; `.env` git-ignored
- [x] Logs redact `Authorization`, `Cookie`, `Set-Cookie` and password fields
- [x] Seed script refuses to run against production unless explicitly overridden
