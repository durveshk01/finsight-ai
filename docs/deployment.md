# Local and hosted deployment

## Local Docker Compose

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET` and `POSTGRES_PASSWORD`.
2. Run `docker compose up --build` from the repository root.
3. Open `http://localhost:3000`. API docs are at `http://localhost:8000/docs` and health is at `http://localhost:8000/health`.
4. Demo access: `demo@finsight.ai` / `Demo1234!`.

PostgreSQL, Redis, API, and frontend run as separate services. PostgreSQL and Redis data persist in named Docker volumes. The API runs the Alembic migration before serving. Set `SEED_DEMO=false` when a deployment should not create the sample account.

## Hosted deployment

- Frontend: deploy the root Next.js project to Vercel. Set `NEXT_PUBLIC_API_URL` to the public API origin at build time.
- API: `render.yaml` defines the free Render Docker service. It runs in Oregon beside the existing Render Postgres database, keeps all FinSight tables in the `finsight` schema, generates its own JWT secret, and allows only the Vercel demo origin. Sync it from Render's **New Blueprint Instance** flow after connecting the GitHub repository.
- The API rate limiter uses Redis when `REDIS_URL` is set. Without Redis, development uses a bounded in-process fallback; production should use Redis for limits shared across workers.
- The free demo shares an existing Render Postgres instance in its own schema. The database expires on 2026-11-27 under Render's free database policy; export the schema and data before then or the demo will lose persistence. The free API has no Celery worker, so use synchronous forecast training; Docker Compose includes Redis and a worker for local development.
- Update `NEXT_PUBLIC_API_URL` to the actual Render API URL before the Vercel production build. Keep all production secrets out of Git.

## Free-tier limits

Provider limits checked on 2026-11-02:

- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is limited to personal, non-commercial use. Use an eligible paid plan for a commercial FinSight deployment.
- [Render's free services](https://render.com/docs/free) are for previews and hobby use, not production. Free web services sleep after 15 minutes without traffic and have ephemeral filesystems. Free Postgres expires after 30 days. [Free Render background workers are unavailable](https://render.com/docs/your-first-deploy), so the Celery training endpoint needs a paid worker or a different queue/worker host.
- [Supabase Free](https://supabase.com/pricing) currently includes a 500 MB database and at most two active free projects; projects with low activity may be paused after a week ([pause policy](https://supabase.com/docs/guides/platform/free-project-pausing)). It can support a non-critical demo, but it does not provide the same continuity as an always-on production database.
- [Upstash Redis Free](https://upstash.com/pricing/redis) currently includes up to 500,000 commands per month and 256 MB of data, for prototypes and hobby projects.

These limits mean the hosted version is a noncommercial demo with cold starts, possible pauses, and reduced background-processing reliability. Do not use it for live business records or describe it as production-ready.
