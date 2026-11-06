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
- Credential endpoints (login, registration, password change) each have their own per-IP limit on
  **failed** attempts: 20 per 15 minutes in production (`AUTH_RATE_LIMIT_MAX`,
  `AUTH_RATE_LIMIT_WINDOW_MINUTES`; local development keeps 20 but uses a 1-minute window).
  Successful sign-ins are not counted, so switching accounts never locks anyone out. A blocked
  request gets `429` with `Retry-After` and a message saying when to try again. The whole API also
  has a coarser limit of 600 requests per minute per IP.
- **Students activate their login with a one-time invite**, not by typing a student number and
  email (anyone who knew those could have claimed the account). An admin, or a teacher for a
  student in one of their courses, creates the invite. The API generates 32 bytes from the OS
  CSPRNG (`crypto.randomBytes`, base64url) and stores **only the SHA-256 hash**, with a 24-hour
  expiry. Creating a new invite revokes the earlier ones, and so does an admin linking a login
  directly. The link carries the token in the URL fragment (`/activate#token=…`), which browsers
  never send to a server; the page posts it in a request body, so it never appears in access logs
  or `Referer` headers. The account is built from the profile (email, name, school, role STUDENT);
  the client only chooses the password, and no session is started. Unknown, expired, used and
  revoked tokens, inactive records and students that already have an account (**including a
  disabled one**) are refused with distinct codes.
- **Activation is one transaction with a fixed lock order.** It locks the student's profile row
  (`SELECT … FOR UPDATE`), re-checks that there is no login, claims the token with a conditional
  `UPDATE … WHERE usedAt IS NULL AND revokedAt IS NULL AND expiresAt > now()`, creates the user
  (email is unique), links the profile and revokes the other invites. Creating an invite takes the
  same lock first. A test fires five parallel requests with one token, and two with different
  tokens; exactly one account results.
- **Invite delivery** is a setting, not a code path that leaks. `INVITE_DELIVERY=disabled`, the
  default, answers 503 and creates no token; `dev-link` returns the link to the staff member who
  asked, for local testing only. Startup validation refuses `dev-link` when `NODE_ENV=production`.
  An email channel would slot in at the same place.
- **First sign-in with a temporary password.** Accounts an admin creates carry
  `mustChangePassword`. `requirePasswordChanged` runs right after `authenticate` on every business
  route, so until the user picks their own password the API answers `403 PASSWORD_CHANGE_REQUIRED`
  to everything except `/auth/me`, `/auth/password` and logout. Changing a password bumps
  `tokenVersion`, which ends every session including the current one, and clears the flag; the user
  signs in again. Existing accounts got `false` from the migration, so the demo logins still work.

_Q: Why count only failed attempts, and why not reset the counter after a successful sign-in?_
Successful sign-ins are not an attack, and counting them locked out legitimate users (a tester
switching roles, or a classroom behind one school IP). Failures are never reset by a success,
because the key is the IP: anyone with one valid account could otherwise sign in every few tries
and keep guessing other accounts' passwords.
_Q: Per IP or per account?_ Per IP today. Per account alone would let an attacker lock any user
out on purpose; per IP alone shares one budget across a NAT. The usual next step is two limits: a
strict one per (IP, account) and a looser one per IP. The in-memory store also needs Redis once
there is more than one server instance.
_Q: Why SHA-256 for activation tokens but bcrypt for passwords?_ bcrypt exists to slow down
guessing of low-entropy secrets. A 256-bit random token cannot be guessed, so a fast hash already
makes a leaked database useless, and a deterministic hash lets the database find the token through
a unique index instead of comparing hashes row by row.
_Q: How do you stop two requests from activating the same student twice?_ The token claim is a
conditional `UPDATE`, so only one request can mark it used, and the email is unique. The first
version deadlocked when two _different_ tokens for one student raced (PostgreSQL `40P01`): each
transaction held its own token row and waited for the other's insert into the users index. Locking
the profile row first, in every code path that touches a student's login or invites, makes
competing requests queue instead; the loser sees the new account and gets 409.
_Q: Why enforce the first-login password change on the server?_ A route guard in the SPA is only
navigation. Anyone with the cookie can call the API directly, so the middleware refuses every
business endpoint until the flag is cleared; the frontend redirect is just the friendly version.
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
enforces everything on its own, including an object-level sweep that requests another teacher's
student and course through every read and write endpoint (all 404).

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
  cookie expires or is revoked. `useAuth()` reads that query through its own observer, so a screen
  rendered right after signing in or out already sees the new session (the provider sits above the
  router and would otherwise update a tick later).
- **Redirects that can race always agree.** React Router applies navigations as transitions, so a
  route guard can re-render, and redirect, before an explicit navigation lands. A deliberate
  sign-out or password change therefore records why the session ended (`sessionEnd`), and guards
  redirect to `/login` with that same state instead of remembering the old page; the login page's
  own redirect uses the same destination as its submit handler. An expired session still returns
  the user to where they were.
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
- [x] Rate limiting (failed credential and activation attempts per endpoint, invites, global), 100 kB JSON body limit
- [x] One-time activation invites: 256-bit tokens, SHA-256 at rest, 24 h expiry, single use, revocation, row-locked transaction
- [x] Activation tokens never in server-side URLs or logs (fragment + POST body, log redaction); dev-only link delivery refused in production
- [x] Forced first-login password change for admin-created accounts, enforced by middleware; a password change ends every session
- [x] Secrets only via environment variables, validated at startup; `.env` git-ignored
- [x] Logs redact `Authorization`, `Cookie`, `Set-Cookie` and password fields
- [x] Seed script refuses to run against production unless explicitly overridden
