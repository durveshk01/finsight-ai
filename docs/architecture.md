# FinSight AI architecture

```mermaid
flowchart LR
  Browser[Next.js App Router UI] -->|JWT + business scope| API[FastAPI REST API]
  API --> DB[(PostgreSQL / SQLite)]
  API --> Forecast[Forecasting engine\nPandas · statsmodels · scikit-learn]
  API --> Reports[CSV · Excel · PDF exports]
  Worker[Celery forecast worker] --> DB
  Worker --> Forecast
  Worker --> Redis[(Redis broker)]
  API --> Redis
```

## Boundaries

- A user can access a business only through a `business_members` membership. Financial records, accounts, categories, invoices, forecasts, scenario assumptions, insights, and reports carry the business id and are queried within the selected membership.
- Workspace roles are owner, admin, accountant, and viewer. Owners manage membership; owners, admins, and accountants can change business records; viewers have read access.
- Monetary inputs and stored values use Python `Decimal` and SQL `NUMERIC(16,2)`. Conversion to display numbers occurs at the API response boundary.
- Transactions reference normalized business categories and may reference a financial account. Invoices create receivable or payable records; each settlement creates a payment and a completed ledger transaction, while only the remaining invoice balance is projected.
- Completed transactions power historical analytics. Pending and scheduled entries remain visible as open obligations and are applied on their due date in cash projections.
- Enabled recurring templates add future due dates. A scheduled transaction with matching date, type, amount, and category suppresses the duplicate recurring occurrence. Scheduled inflows and outflows are tracked separately so same day receipts do not hide payments.
- The dashboard labels its cash flow / revenue ratio as net cash margin. It does not imply accrual profit margin without ledger data for recognition and matching.
- Revenue and expense forecasts are separate. Forecast runs persist model metrics and daily point estimates with lower and upper bounds; candidate models use expanding-window validation and the baseline remains available when history is insufficient.
- Rule based insights report the evidence used and the action that follows from it. No LLM makes accounting decisions.

## Main services

- `backend/app/api.py`: authenticated routes, business scoping, imports, analytics, simulations, notifications, and exports.
- `backend/app/forecasting.py`: daily aggregation, feature creation, candidate evaluation, model selection, intervals, and limited-data baseline.
- `backend/app/seed.py`: repeatable 24 month synthetic demo business.
- `components/dashboard.tsx`: responsive dashboard and feature views backed by the API.
