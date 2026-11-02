# FinSight AI

FinSight AI is a cash flow and business forecasting workspace for small and midsize businesses. It brings transactions, financial calculations, time series forecasts, cash reserve warnings, what-if scenarios, explainable insights, and report exports into one application.

## Start locally

### Docker Compose (recommended)

```powershell
Copy-Item .env.example .env
# Edit .env and set POSTGRES_PASSWORD and JWT_SECRET.
docker compose up --build
```

Open the frontend at [http://localhost:3000](http://localhost:3000), API docs at [http://localhost:8000/docs](http://localhost:8000/docs), and health check at [http://localhost:8000/health](http://localhost:8000/health).

Demo sign in: `demo@finsight.ai` / `Demo1234!`. Demo records are synthetic. Register additional accounts with `POST /api/auth/register` and use the returned bearer token.

### Run without Docker

Backend (Python 3.12+):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

This uses a local SQLite file by default. To use PostgreSQL, set `DATABASE_URL` to `postgresql+psycopg://...` before starting. The API seeds the demo account on its first start unless `SEED_DEMO=false`.

Frontend (Node 20.9+):

```powershell
npm ci
npm run dev
```

Set `NEXT_PUBLIC_API_URL` to the API origin if it is not `http://localhost:8000`.

## Features

- Authenticated business workspaces and business scoped transaction records.
- Transaction search, filters, create, edit, delete, CSV / Excel preview, duplicate detection, and import.
- Decimal backed revenue, expense, net cash flow, margins, runway, receivables, payables, working capital, and category analytics.
- Revenue, expense, category expense, and daily cash forecasts with model comparison and chronological holdout metrics.
- Reserve breach detection that combines historical forecasts with due dated pending and scheduled transactions.
- Recurring transaction schedules for weekly, monthly, or quarterly cash obligations and receipts.
- Deterministic scenario comparisons, rule based financial insights, notification center, and PDF / Excel / CSV exports.
- Light and dark dashboard themes, responsive navigation, and Recharts visualizations.
- Argon2 password hashing, expiring JWT sessions, business scoped access, audit events, and request throttling for authentication and API routes.
- Docker Compose services for frontend, API, PostgreSQL, and Redis; initial Alembic migration; GitHub Actions build and test workflow.

## API areas

All user data routes except login, registration, and health require `Authorization: Bearer <token>`. Send `X-Business-Id` to choose a workspace the user belongs to.

| Area | Routes |
| --- | --- |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Workspaces | `GET /api/businesses`, `POST /api/businesses`, `PATCH /api/businesses/current` |
| Transactions | `GET/POST /api/transactions`, `PUT/DELETE /api/transactions/{id}`, import preview / confirm, CSV / Excel templates |
| Analytics | `GET /api/analytics/overview`, `/revenue`, `/expenses`, `/cash-flow` |
| Forecasts | `POST /api/forecasts/train` or `/train/async`, task status, `GET /api/forecasts/{revenue,expenses}`, `/models`, `/cash-flow`, `/expenses/categories` |
| Recurring | `GET/POST /api/recurring`, `PATCH/DELETE /api/recurring/{id}` |
| Scenarios | `POST/GET /api/scenarios`, simulate, compare |
| Insights and notifications | `GET /api/insights`, `POST /api/insights/generate`, `GET /api/notifications` |
| Reports | `POST /api/reports/generate` with `format` `pdf`, `xlsx`, or `csv` |

## Project structure

```text
app/                    Next.js App Router entry and global styles
components/             Dashboard, visualizations, forms, and UI primitives
backend/app/            FastAPI routes, ORM models, security, calculations, forecasting
backend/migrations/     Alembic environment and initial schema migration
backend/tests/          Backend unit and API tests
docs/                   Architecture, forecasting notes, and deployment guide
```

## Financial definitions

- Revenue and expenses in a period are sums of completed transaction amounts for their transaction dates.
- Net cash flow is income less expenses; this is cash movement and is not accrual accounting profit.
- The dashboard reports net cash margin (net cash flow ÷ cash revenue), not accounting profit margin. Accrual profit requires bookkeeping data this transaction ledger does not contain.
- Current cash is opening cash plus completed net transaction activity through today.
- Cash runway is shown only when trailing net burn is positive; otherwise the UI reports a healthy/no burn condition.
- Pending income and expense activity is shown as receivable and payable and is applied on its scheduled date in cash forecasts.

See [docs/architecture.md](docs/architecture.md), [docs/forecasting.md](docs/forecasting.md), and [docs/deployment.md](docs/deployment.md) for design details and limitations.
