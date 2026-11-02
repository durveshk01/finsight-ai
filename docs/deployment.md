# Local and hosted deployment

## Local Docker Compose

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET` and `POSTGRES_PASSWORD`.
2. Run `docker compose up --build` from the repository root.
3. Open `http://localhost:3000`. API docs are at `http://localhost:8000/docs` and health is at `http://localhost:8000/health`.
4. Demo access: `demo@finsight.ai` / `Demo1234!`.

PostgreSQL, Redis, API, and frontend run as separate services. PostgreSQL and Redis data persist in named Docker volumes. The API runs the Alembic migration before serving. Set `SEED_DEMO=false` when a deployment should not create the sample account.

## Hosted deployment

- Frontend: deploy the root Next.js project to Vercel. Set `NEXT_PUBLIC_API_URL` to the public API origin at build time.
- API: deploy `backend/Dockerfile` to Render, Fly.io, or another persistent container platform. Set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `REDIS_URL`, and `SEED_DEMO`.
- The API rate limiter uses Redis when `REDIS_URL` is set. Without Redis, development uses a bounded in-process fallback; production should use Redis for limits shared across workers.
- Database: use a managed PostgreSQL service and keep `DATABASE_URL` private.
- Background work: attach Redis and run the worker command `celery -A app.tasks.celery_app worker --loglevel=info` from the backend image. Docker Compose starts this worker automatically.
- Update CORS to the exact deployed frontend origin. Change default credentials and secrets before making a demo deployment public.

No live URL is attached to this repository yet. Production PostgreSQL and Redis instances, their connection strings, a public API origin, and the matching CORS and frontend environment values must be provisioned before the complete application can be deployed and verified. Keep all production secrets out of Git.
