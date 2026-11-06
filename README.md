# Student Learning Analytics Platform

A full-stack web application for schools: teachers manage students, courses, grades and
attendance; a **rule-based, explainable early-warning engine** flags students who need
support; students track their own progress. Admins manage users, school data and the
risk-engine configuration.

> Stack: React 19 · TypeScript · Vite · TanStack Query · Recharts · Node.js · Express 5 ·
> Zod · Prisma 7 · PostgreSQL (Neon) · Vitest · Supertest · React Testing Library

## Features

| Area                      | What it does                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth & RBAC**           | Registration (student account activation), login, logout, logout-everywhere, password change. bcrypt hashing, JWT in an httpOnly cookie, `tokenVersion` revocation. Three roles (Admin / Teacher / Student) enforced on the server, with row-level data scoping.                                              |
| **Student management**    | Create, list, search, filter (course, grade, risk), paginate, view and update students. Teachers only see students enrolled in their courses.                                                                                                                                                                 |
| **Courses & performance** | Courses, enrollments (enroll / drop / re-enroll), assessments with weights, bulk grade entry with an audit history of every change, attendance taking per class meeting.                                                                                                                                      |
| **Analytics dashboard**   | Overview KPIs, weekly score trends (overall / by course), course comparison, attendance by week and attendance-rate bands, at-risk distribution with top causes, per-student progress against the class average. Every chart has a tooltip, a legend where needed and a table view; light and dark themes.    |
| **Early-warning engine**  | Four transparent rules (recent performance, declining trend, attendance, completion) produce a 0–100 score and a LOW / MEDIUM / HIGH level. Thresholds are configurable per school, results are persisted with the reasons, and recalculation runs automatically after grade/attendance changes or on demand. |

## Architecture

```
 Browser (React SPA)                          Server (Node.js / Express 5)                 PostgreSQL (Neon)
┌─────────────────────────┐   /api/v1/*    ┌──────────────────────────────────────┐   ┌──────────────────┐
│ pages → hooks/queries   │ ─────────────► │ routes → authenticate → requireRole  │   │ 11 tables         │
│ TanStack Query cache    │  JSON + cookie │   → controllers (Zod parse)          │   │ FKs, unique and   │
│ Recharts charts         │ ◄───────────── │   → services (business rules,        │──►│ composite indexes │
│ httpOnly cookie session │                │      access scoping, transactions)   │   │ Prisma migrations │
└─────────────────────────┘                │   → domain/risk (pure rule engine)   │   └──────────────────┘
                                           │ error-handler → { error: {…} }       │
                                           └──────────────────────────────────────┘
```

- **Layered backend.** Controllers only validate input and shape responses; services own the
  business rules; `domain/risk` is pure TypeScript with no I/O. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Authorization in one place.** `services/access.service.ts` defines what each role can see, and
  every query composes those `where` fragments. Out-of-scope IDs return 404 to prevent ID probing.
- **Database design.** Covered in [docs/DATABASE.md](docs/DATABASE.md): relationships,
  constraints and why each index exists.
- **API reference.** See [docs/API.md](docs/API.md).

## Getting started (local)

Requirements: **Node.js ≥ 20.19** (developed on 24) and npm. No Docker or local PostgreSQL install is
needed: `npm run db:local` runs a real PostgreSQL 18 server from npm-distributed binaries.

```bash
npm install                                 # installs both workspaces, generates the Prisma client
cp server/.env.example server/.env          # then set JWT_SECRET (see the comment in the file)

npm run db:local                            # terminal 1: local PostgreSQL on port 5433 (leave running)
npm run db:migrate -w server                # apply migrations
npm run db:seed -w server                   # demo data + initial risk evaluation (re-runnable)
npm run dev                                 # terminal 2: API on :4000 and web on :5173
```

Open http://localhost:5173. Demo accounts (password `Password123`):

| Role    | Email                                                   |
| ------- | ------------------------------------------------------- |
| Admin   | `admin@riverside.edu`                                   |
| Teacher | `teacher1@riverside.edu` (also `teacher2`, `teacher3`)  |
| Student | `student1@riverside.edu` (also `student2` … `student5`) |

To use Neon instead of the local database, put the Neon connection strings in `DATABASE_URL`
and `DIRECT_URL` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Scripts

| Command                                                       | Purpose                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                                                 | API (tsx watch) + web (Vite) together                                                        |
| `npm test`                                                    | Server tests (starts its own throwaway PostgreSQL on port 5434), then web tests              |
| `npm run lint` / `npm run typecheck` / `npm run format:check` | Static checks for both workspaces                                                            |
| `npm run build`                                               | Prisma generate + `tsc` for the server, type-check + Vite build for the web                  |
| `npm start`                                                   | Production: apply pending migrations, then serve API + built SPA                             |
| `npm run db:seed -w server`                                   | Reset and seed demo data (refuses `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`) |
| `npm run test:coverage -w server`                             | Server tests with a coverage report                                                          |

## Testing

Measured on the development machine (see [docs/DEV_LOG.md](docs/DEV_LOG.md) for the record):

- **Server: 84 tests**: 20 unit tests for the risk engine, and 64 integration tests that go through
  the full HTTP stack against a real PostgreSQL database. They cover authentication, the
  authorization matrix (role checks, cross-teacher and cross-school isolation, IDOR attempts),
  CRUD, validation, transactions and rollbacks, analytics numbers checked by hand, and the alert lifecycle.
- **Web: 8 tests** (React Testing Library): data states, risk explanation, login flow, role guard.
- Server coverage: 89% statements, 91% lines, 74% branches; the `domain/risk` engine is at 99% / 100%.
- CI (`.github/workflows/ci.yml`) runs format, lint, typecheck, all tests against a PostgreSQL
  service container, and the production build on every push and pull request.

## Deployment

One Node web service (e.g. Render) runs Express, which serves both `/api` and the built React app,
so the auth cookie is same-origin. The database is Neon PostgreSQL. `render.yaml` is a ready-made
blueprint; step-by-step instructions, including Neon setup, are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Project structure

```
server/
  prisma/            schema.prisma, migrations/, seed.ts
  scripts/           local PostgreSQL launcher (embedded-postgres)
  src/
    config/          Zod-validated environment
    controllers/     HTTP adapters (parse → service → respond)
    domain/risk/     pure early-warning engine: config, metrics, rules
    lib/             prisma client, jwt, password hashing, logger
    middleware/      authenticate, requireRole, error handler
    routes/          route map with per-route role requirements
    services/        business logic, access scoping, analytics SQL
    validators/      Zod request schemas
  tests/             unit + integration tests, fixtures
web/
  src/
    charts/          chart kit + Recharts charts
    components/      layout, guards, UI primitives, risk explanation
    hooks/           auth context, debounce
    pages/           route screens
    services/        typed fetch client, endpoint map, query keys
    types/           API DTO types
  tests/             React Testing Library tests
docs/                architecture, database, API, deployment, development log
```

## Scope and honest limitations

- The risk engine is a **transparent rule-based rubric, not a machine-learning model**. It does not
  predict outcomes; it flags combinations of known warning signs, and it explains each one.
- Student self-registration matches student number + email against a staff-created record. A
  production system would add email verification or invite tokens.
- Sessions are single JWTs (8h) with server-side revocation via `tokenVersion`; there is no refresh-token rotation.
- Multi-school data isolation is implemented and tested, but there is no UI to create schools (seeded).
