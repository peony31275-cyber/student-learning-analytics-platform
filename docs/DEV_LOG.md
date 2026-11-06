# Development log

A factual record of how the project was built and verified. Every number here was produced by
an actual command run on the development machine (Windows 10, Node 24.14, npm 11.9). Nothing is
estimated or extrapolated. There are no user or traffic numbers because the app has none yet.

## Environment and version decisions (2026-11-05)

- No Docker or system PostgreSQL available → `embedded-postgres` (real PostgreSQL 18 binaries
  from npm) for local development (port 5433) and for isolated integration tests (port 5434).
  Production uses Neon. Both are plain PostgreSQL, so the migrations are identical.
- Chose **Prisma 7.10.1** over the 8.0 release candidate (not stable yet), and **TypeScript 6.0.3**
  over 7.0 (typescript-eslint supports `<6.1`).
- `npm audit` reports one moderate advisory (`minimatch` ReDoS) that only affects ESLint dev
  tooling. Production dependencies are not affected; npm's suggested fix would downgrade ESLint,
  so it was not applied.

## Milestones

| Milestone                                                         | Commit                              | Verified by                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| M0–M2 scaffold, schema, migrations, seed, auth                    | `dcb7145`                           | `prisma validate`, migration applied, seed run twice with identical output, 19 auth integration tests |
| M3 core API                                                       | `b4dd96f`                           | 50 tests (+31)                                                                                        |
| M5 early-warning engine                                           | `91909e3`                           | 20 unit tests, all passing on the first run                                                           |
| M4 analytics API                                                  | `e98a111`                           | 83 tests; live `curl` checks against seeded data                                                      |
| M6 frontend                                                       | `479a519`                           | typecheck, lint, production build, headless-browser screenshots, 8 RTL tests                          |
| M7 hardening + CI                                                 | `6d9bf3b`                           | coverage run, format/lint/typecheck clean                                                             |
| M8 deployment config + docs                                       | `9aa9cf8`                           | production build served by Express, browser test against it                                           |
| Fixes: sign-out, sidebar, rate limiting                           | `bb33fb0`, `e32d053`, `902457a`     | regression tests for each (bugs 7–9 below); every commit checked out and tested on its own            |
| Account security: activation invites, first-login password change | `feat(auth)` commit after `902457a` | 39 new server tests, 14 new web tests, browser scenarios A–C (section below)                          |

## Measured results

**Seed** (`npm run db:seed -w server`): 1 school, 9 users, 60 students, 6 courses,
180 enrollments, 48 assessments, 1,440 grades, 3,240 attendance records. The risk engine then
evaluated 180 enrollments in 349 ms on a local database: 139 LOW, 15 MEDIUM, 26 HIGH.

**Tests** (`npm test`):

```
server  Test Files 10 passed (10)   Tests 126 passed (126)
web     Test Files 4 passed (4)    Tests 33 passed (33)
```

**Server coverage** (`npm run test:coverage -w server`, after the account-security work):
statements 90.75% (972/1071), branches 75.91% (435/573), functions 93.69% (312/333), lines 92.61%
(865/934). `src/domain/risk`: 99.10% statements, 100% lines. New security code:
`activation.service` 95.3% statements / 92% branches; `auth.service`, `lib/tokens`, `config/env` and
`authenticate` 100%.

**Production build** (`npm run build`): web entry chunk 364.6 kB (113.2 kB gzip); Recharts split
into a lazy chunk of 385.0 kB (110.7 kB gzip), so the login page does not load it.

**Production smoke test** (`NODE_ENV=production node server/dist/server.js` serving `web/dist`):
`/api/health` 200; SPA deep links 200; login cookie `HttpOnly; Secure; SameSite=Lax`; Helmet CSP
and HSTS headers present. Headless Edge (Playwright) logged in as a teacher, rendered 5 charts
with 0 console errors under the CSP, recorded attendance, reloaded and confirmed it persisted.

## Bugs found and fixed during development

1. **Test DB migrations ran against the wrong database.** Vitest's `test.env` is only injected
   into worker processes, not `globalSetup`, so `prisma migrate deploy` picked up `.env`.
   Fixed by sharing the test URL through `tests/test-env.ts` and passing it explicitly.
2. **Prisma nested-write error in the seed.** A scalar FK (`schoolId`) can't be combined with a
   nested relation `create`. Fixed by creating the user first and linking with `userId`.
3. **Data-scoping bug in the student list (found through UI review).** A teacher's student list showed
   risk levels computed from _other teachers'_ courses, and the risk filter matched them. Fixed
   by scoping the nested `riskAlerts`/`_count` selections with `courseScope(user)` and matching
   the filter on the highest _visible_ level. A regression test was added and confirmed to fail
   with the fix reverted.
4. **`RequireRole` redirected during session loading.** Found by a component test; the guard now
   waits for the `/auth/me` query.
5. **React anti-pattern flagged by `eslint-plugin-react-hooks`.** Forms copied server data into state
   in effects. They were refactored into keyed child components initialized with `useState(initial)`.
6. **Date locale.** Charts followed the OS locale (Chinese month names); they are pinned to `en-US` for a
   consistent English UI.
7. **Sign-out did not return to the login page (found in manual testing).** After "Sign out" the
   shell and the user's name stayed on screen, and protected pages showed "Authentication
   required". Cause: `logout()` called `queryClient.clear()`, which also removed the `['me']`
   query object that `useQuery` in `AuthProvider` was subscribed to; the following
   `setQueryData(['me'], null)` created a new query nobody observed, so React never re-rendered
   with `user = null`. (Login seemed fine only because the login mutation re-rendered the
   provider.) Fixed by updating the session query in place and removing only the other queries
   (`switchSession`), which is also used by the global 401 handler. Explicit sign-out navigates
   to `/login` without remembering the previous page. Six RTL regression tests (5 failed before
   the fix) and two server tests for cookie clearing; verified in headless Edge for a teacher and
   a student: redirect, `Set-Cookie` expiry, no cookie left, Back button and direct URLs stay on
   `/login`, `/auth/me` returns 401.
8. **Long emails overflowed the sidebar (found in manual testing).** With
   `benjamin.anderson.20@students.riverside.edu`, the email ran 56 px past the sidebar on desktop
   (48 px in the mobile drawer), and the Sign out button stuck out with it. Cause: the footer is a
   grid with an implicit `auto` column, which grows to its widest unbreakable content, and an email
   has no line-break opportunities. Fixed with `grid-template-columns: minmax(0, 1fr)`; role and
   email are now a wrapping flex row, so an email that fits stays fully visible (beside or below the
   role, as before), and only an email wider than the sidebar is cut with `text-overflow: ellipsis`
   (`min-width: 0` on the flex item) and shown in full in a `title` tooltip. The same email widened
   the Account page at 320 px (scroll width 324 px); its header now uses `overflow-wrap: anywhere`.
   Five RTL tests load the real stylesheet and assert the computed styles (all five failed before
   the fix); jsdom has no layout engine, so the pixel check runs in a real browser.
9. **Switching accounts triggered "Too many attempts" (found in manual testing).** The credential
   limiter counted every request per IP, successful sign-ins included, and login, registration and
   password change shared one counter. During development all traffic arrives from localhost
   through the Vite proxy, so ordinary role switching (plus automated browser checks) used up the
   20 attempts in 15 minutes. The limiter was also skipped in tests, so none of this was covered.
   Fixed: only failed attempts count (`skipSuccessfulRequests`), each endpoint has its own counter,
   the 429 message says when to retry, and the limits come from `AUTH_RATE_LIMIT_MAX` /
   `AUTH_RATE_LIMIT_WINDOW_MINUTES` (production defaults 20 per 15 min; `.env.example` uses a
   1-minute window for development). Six integration tests build an app with a small limit (five
   failed against the old behavior). In headless Edge, 30 sign-ins switching between Admin, Teacher
   and Student all returned 200; failed attempts were blocked with `429` and `Retry-After`, the login
   page showed "Try again in 15 seconds", and sign-in worked again after the window.

## Account security enhancement (2026-11-05)

Replaced the "student number + email" self-registration (anyone who knew both could claim an
unactivated student) with one-time activation invites, and added a forced password change on the
first sign-in of admin-created accounts.

- **Migration** `20261106052320_account_security`: adds `users.mustChangePassword` (default `false`)
  and the `activation_tokens` table. Generated with `prisma migrate diff` from the committed schema,
  reviewed (only `ADD COLUMN` / `CREATE TABLE` / indexes / foreign keys) and applied to the dev
  database with `prisma migrate deploy`. Data afterwards: 11 users, 60 students, 1,440 grades and
  3,240 attendance records, unchanged; 0 accounts flagged, so every demo login still works.
- **Tests:** 39 new server tests (activation 16, delivery disabled 2, environment validation 4,
  first sign-in 10, authorization 4, rate limit 1, auth 2) and 14 new web tests; the 5 tests of the
  removed registration endpoint were replaced by one proving it can no longer create an account.
- **Browser (headless Edge, dev servers):** 41 checks across scenario A (admin creates a profile,
  invites, the student activates and sees their own data), B (temporary password, forced change,
  old session revoked server-side, re-login) and C (invalid, used, replaced and expired links,
  student and teacher RBAC, cross-teacher 404s, disabled account not re-activated), all passing
  with 0 page errors. A second script checked the session-ending navigations (15 checks).
- **Test data cleanup:** the browser checks created clearly named records in the dev database (6
  `E2E-*` student profiles, 3 student logins, 4 `e2e.teacher.*` accounts, 3 enrollments, 9
  activation tokens), none of which any other row referenced. They were removed in one transaction
  that deleted exactly those rows and would have rolled back unless the legitimate data still
  matched a snapshot taken beforehand: 11 accounts (identical fingerprints of email, password hash,
  status, session version and first-login flag), 60 students, 180 enrollments, 180 risk alerts,
  1,440 grades and 3,240 attendance records. No reset or re-seed. A stray test-database directory
  at the repository root (from running vitest outside `server/`) was deleted after confirming no
  PostgreSQL process used it; the test setup now resolves that directory from the server package.

Problems found while building it:

1. **Deadlock between two activations for one student.** The concurrency test with two different
   valid tokens got a 500: PostgreSQL `40P01`. Each transaction held its own token row and waited for
   the other's insert into the users email index. Fixed by locking the profile row first in every
   code path that touches a student's login or invites; the loser now gets 409. The test was then
   run five more times in a row, all passing.
2. **Preview showed the stored email casing** while the account uses the lowercased address. Fixed.
3. **The session was read from a context above the router**, which updates a tick after the cache,
   so the login page could see the previous user right after signing out. `useAuth()` now reads the
   session through its own query observer.
4. **Redirect races under router transitions** (found by the browser check, not by the jsdom tests).
   After a password change the "password changed" notice was lost, and after signing out from a deep
   page the next person was sent to that page. React Router applies navigations as transitions, so a
   route guard re-rendered with no user first and issued its own redirect. `flushSync` on the
   navigations did not fix it; making the competing redirects identical did: a deliberate session end
   is recorded (`sessionEnd`) and the guards redirect with the same state, and the login page's own
   redirect uses the same destination as its submit handler. Two web tests and three browser checks
   cover it, including returning to the previous page after an _expired_ session.

## Environment notes

- On Windows, stopping the shell that runs `npm run dev` can leave `tsx watch` and its child running,
  still holding port 4000 with the old configuration. Check with
  `Get-NetTCPConnection -LocalPort 4000 -State Listen` and stop the tree with `taskkill /PID <pid> /T /F`.

## Not yet done

- Email delivery for activation invites. Until it exists, production keeps `INVITE_DELIVERY=disabled`.
- Password reset ("forgot password") and an admin reset for existing accounts.

- Cloud deployment (needs Neon and Render accounts; see `docs/DEPLOYMENT.md`).
- The first GitHub Actions run (needs the repository to be pushed).
- Docker image (not needed for the Render deployment; can be added later).
