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

> Never commit these strings. They only go into `server/.env` (git-ignored) and the Render
> dashboard.

## 2. (Optional) Point your local setup at Neon and run the migrations

```bash
# server/.env
DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require"
DIRECT_URL="postgresql://…/neondb?sslmode=require"
```

```bash
npm run db:deploy -w server       # applies prisma/migrations to Neon
npm run db:seed -w server         # demo data (only if you want it on this database)
```

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

| Variable       | Value                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` | Neon **pooled** string                                                                                                         |
| `DIRECT_URL`   | Neon **direct** string                                                                                                         |
| `CORS_ORIGINS` | your Render URL, e.g. `https://learning-analytics.onrender.com`                                                                |
| `JWT_SECRET`   | generated automatically by the blueprint (or `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |

`NODE_ENV=production`, `WEB_DIST_DIR=web/dist` and the rest are already set in `render.yaml`. 4. Deploy. `npm start` runs `prisma migrate deploy` before starting the server, so the schema is
always current.

### Seeding demo data in production (optional)

The seed refuses to run when `NODE_ENV=production`. To load demo data into a fresh Neon database
once, run it from your machine against Neon (step 2), or in the Render shell:

```bash
SEED_ALLOW_PRODUCTION=true npm run db:seed -w server
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
