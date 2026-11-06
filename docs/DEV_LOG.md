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

| Milestone                                      | Commit        | Verified by                                                                                           |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| M0–M2 scaffold, schema, migrations, seed, auth | `dcb7145`     | `prisma validate`, migration applied, seed run twice with identical output, 19 auth integration tests |
| M3 core API                                    | `b4dd96f`     | 50 tests (+31)                                                                                        |
| M5 early-warning engine                        | `91909e3`     | 20 unit tests, all passing on the first run                                                           |
| M4 analytics API                               | `e98a111`     | 83 tests; live `curl` checks against seeded data                                                      |
| M6 frontend                                    | `479a519`     | typecheck, lint, production build, headless-browser screenshots, 8 RTL tests                          |
| M7 hardening + CI                              | `6d9bf3b`     | coverage run, format/lint/typecheck clean                                                             |
| M8 deployment config + docs                    | (this commit) | production build served by Express, browser test against it                                           |

## Measured results

**Seed** (`npm run db:seed -w server`): 1 school, 9 users, 60 students, 6 courses,
180 enrollments, 48 assessments, 1,440 grades, 3,240 attendance records. The risk engine then
evaluated 180 enrollments in 349 ms on a local database: 139 LOW, 15 MEDIUM, 26 HIGH.

**Tests** (`npm test`):

```
server  Test Files 5 passed (5)   Tests 86 passed (86)
web     Test Files 3 passed (3)   Tests 19 passed (19)
```

**Server coverage** (`npm run test:coverage -w server`): statements 89.18% (882/989),
branches 73.86% (390/528), functions 91.44% (278/304), lines 91.26% (784/859).
`src/domain/risk`: 99.09% statements, 100% lines.

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

## Not yet done

- Cloud deployment (needs Neon and Render accounts; see `docs/DEPLOYMENT.md`).
- The first GitHub Actions run (needs the repository to be pushed).
- Docker image (not needed for the Render deployment; can be added later).
