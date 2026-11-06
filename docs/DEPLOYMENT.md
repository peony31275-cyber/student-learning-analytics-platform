# Deployment guide: Neon PostgreSQL + Render

Target setup: **one Render web service** (Node) that runs migrations, serves `/api`, and serves
the built React app; **Neon** hosts PostgreSQL. Both have free tiers.

```
Browser ──HTTPS──► Render web service (Express: /api + static SPA) ──TLS──► Neon PostgreSQL
```

## 1. Create the Neon database

1. Sign up at <https://neon.tech> (GitHub login works).
2. **Create project** → name it `learning-analytics`, PostgreSQL version 17 (or the default).
3. **Region:** pick the one closest to where the API will run. Database round-trips dominate
   latency, so the API and the DB should be in the same region. For Render's _Virginia_ region, choose
   **AWS US East (N. Virginia), `us-east-1`**; for Render _Oregon_, choose **AWS US West (Oregon)**.
4. Open **Dashboard → Connect**. You need two connection strings for the same database:
   - **Pooled** (toggle _Connection pooling_ **on**; the host contains `-pooler`). This is `DATABASE_URL`, used by the running app.
   - **Direct** (pooling **off**). This is `DIRECT_URL`, used by `prisma migrate`. Migrations
     need a direct session: PgBouncer in transaction mode does not support the advisory locks
     migrations use.

   Both look like `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require`. Keep `sslmode=require`.

> Never commit these strings. They only go into `server/.env.neon` (git-ignored) and the Render
> dashboard, never into `server/.env`.

## 2. Keep the Neon strings in `server/.env.neon` and run the migrations from your machine

`server/.env` stays pointed at the local database, so `npm run dev`, the tests and
`npm run db:seed` never reach Neon. Put the two Neon strings in their own file, which the `.env.*`
rule in `.gitignore` keeps out of Git:

```bash
# server/.env.neon
DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require"
DIRECT_URL="postgresql://…/neondb?sslmode=require"
```

Only two scripts read it, through `server/prisma.neon.config.ts`, which also refuses a `DIRECT_URL`
that is pooled or not on Neon:

```bash
npm run db:neon:status -w server   # which migrations Neon has
npm run db:neon:deploy -w server   # apply prisma/migrations to Neon (prisma migrate deploy)
```

The scripts that reset or wipe data (`db:migrate`, `db:seed`, `db:reset`) refuse to run unless
`DATABASE_URL` and `DIRECT_URL` point at localhost, and the test suite refuses a non-local
`TEST_DATABASE_URL`. A cloud string pasted into the wrong file stops them before anything happens.

Prisma 7 notes: there is no `url` in `schema.prisma` any more. The CLI reads the connection from
`server/prisma.config.ts` (DIRECT_URL, falling back to DATABASE_URL), and the app connects with
`@prisma/adapter-pg` using DATABASE_URL.

## 3. Push the code to GitHub

```bash
git remote add origin https://github.com/<you>/student-learning-analytics.git
git push -u origin main
```

## 4. Create the Render service

1. Sign up at <https://render.com> with GitHub.
2. **New → Blueprint**, pick the repository. Render reads `render.yaml` (build:
   `npm ci --include=dev && npm run build`, start: `npm start`, health check `/api/health`).
   Or create a **Web Service** by hand with the same commands.
3. Set the environment variables marked `sync: false`:

| Variable          | Value                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | Neon **pooled** string                                                                                                                                                                       |
| `DIRECT_URL`      | Neon **direct** string                                                                                                                                                                       |
| `CORS_ORIGINS`    | your Render URL, e.g. `https://learning-analytics.onrender.com`                                                                                                                              |
| `JWT_SECRET`      | generated automatically by the blueprint (or `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`)                                                               |
| `INVITE_DELIVERY` | already `disabled` in `render.yaml`. Keep it until a secure delivery channel (email) exists: invites then answer 503 and no token is created. `dev-link` is refused at startup in production |
| `APP_URL`         | only needed once invites are delivered: the public URL used in activation links, e.g. `https://learning-analytics.onrender.com`                                                              |

`NODE_ENV=production`, `WEB_DIST_DIR=web/dist` and the rest are already set in `render.yaml`.
Leave `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MINUTES` unset in production: the defaults
(20 failed sign-in attempts per IP per 15 minutes) are the production values. The 1-minute window
in `.env.example` is for local development only.

4. Deploy. `npm start` runs `prisma migrate deploy` before starting the server, so the schema is
   always current.

### Seeding demo data on Neon (optional, once)

The seed starts with a `TRUNCATE` of every application table, so run it only on a new, empty
database. `npm run db:seed` is local-only. To seed Neon on purpose, load the Neon strings explicitly
from `server/`. Later `--env-file` values override earlier ones, so the Neon URLs replace the local
ones and the rest of `.env` still applies:

```bash
npx tsx --env-file=.env --env-file=.env.neon prisma/seed.ts
```

In the Render shell the Neon strings are already the environment, and the seed refuses
`NODE_ENV=production` unless told otherwise:

```bash
cd server && SEED_ALLOW_PRODUCTION=true npx tsx prisma/seed.ts
```

## 5. Verify the deployment

```bash
curl https://<your-app>.onrender.com/api/health
```

Then log in through the UI with a demo account and check: dashboard charts load, a teacher can
save grades and attendance, the alerts page shows explanations, and a student account only
sees its own data.

## Notes

- The free Render plan sleeps after inactivity, so the first request can take ~30–60 s. Neon's free
  tier also suspends compute when idle and resumes on the first query.
- The cookie is `Secure` in production, which requires HTTPS. Render provides it automatically.
- `trust proxy` is enabled in production so rate limiting sees the real client IP behind Render's proxy.
