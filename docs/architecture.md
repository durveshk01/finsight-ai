# FinSight AI – Production Architecture & System Design

```mermaid
flowchart TD
  subgraph Clients["Client Ecosystem"]
    Web["Web App (Next.js 16 + React 19)\nLocal-first decimal compute"]
    Mobile["Android Mobile App (React Native / Expo)\nOn-device What-If simulation & local KPIs"]
  end

  subgraph Cloud["Render Cloud Infrastructure"]
    API["FastAPI 0.115 Core Engine\nDecimal-safe accounting & Auth"]
    DB[("PostgreSQL\n`sync_changes` monotonic sequence token log")]
    Worker["Celery / Python 3.12 ML Worker\nARIMA, SARIMA, XGBoost, Holt-Winters"]
    Redis[("Redis Broker & Cache")]
  end

  Web -->|Monotonic Sync & REST API| API
  Mobile -->|Incremental Delta Sync (seq_num)| API
  API --> DB
  API --> Redis
  Worker --> Redis
  Worker --> DB
```

---

## 1. Architectural Boundaries & Data Integrity

1. **Multi-Tenant Workspace Security**:
   - Every financial record (`Transaction`, `Account`, `Invoice`, `RecurringTransaction`, `ScenarioAssumption`, `SyncChange`) is strictly partitioned by `business_id`.
   - Access requires an authenticated session and verified membership in `business_members` with roles: `owner`, `admin`, `accountant`, or `viewer`.

2. **Decimal-Safe Monetary Arithmetic**:
   - Floating-point calculations are strictly forbidden for accounting ledgers.
   - Database columns use `NUMERIC(16, 2)`.
   - Python code uses `Decimal` with `ROUND_HALF_UP`.
   - Web and Mobile clients use the high-precision fixed-point mathematical libraries (`lib/financial-engine.ts` and `mobile/src/services/financial-engine.ts`).

3. **Accounting Semantics for Transfers**:
   - Inter-account transfers specify both `account_id` (source) and `to_account_id` (destination).
   - Transfers decrement the source account and increment the destination account.
   - Transfers produce **$0 change** to overall business revenue, expense, and net operating cash flow.

4. **Invoices and Working Capital (AR / AP)**:
   - Receivables and payables track `amount`, `amount_paid`, and `amount_due`.
   - Partial payments record immediate completed transactions in the general ledger while reducing remaining invoice balances.
   - Unsettled balances feed into chronological Ageing Schedules across five standardized buckets: **Current (Not Due)**, **1–30 Days**, **31–60 Days**, **61–90 Days**, and **>90 Days**.

---

## 2. Device-Powered & Local-First Processing

To minimize API latency and ensure seamless offline execution, suitable computations run locally on the client:

| Operation | Execution Target | Engine Implementation |
| :--- | :--- | :--- |
| **KPI Calculations** | On-Device / Browser | `FinancialEngine.calculateKPIs()` |
| **Category Spending Breakdown** | On-Device / Browser | `FinancialEngine.aggregateCategorySpending()` |
| **What-If Scenario Sandbox** | On-Device / Browser | `FinancialEngine.simulateScenario()` (Instant response, zero API wait) |
| **Client Duplicate Detection** | On-Device / Browser | `FinancialEngine.detectDuplicates()` |
| **Offline Transaction Drafts** | Mobile Local Storage | `OfflineSyncQueue` & `AsyncStorage` |
| **Report Compilation** | On-Device / Browser | Native client-rendered P&L and Cash Flow statements |
| **Heavy ML Model Retraining** | Cloud Worker / Celery | `backend/app/forecasting.py` (Walk-forward WAPE optimization) |
| **Authoritative State Persistence** | Cloud PostgreSQL | `backend/app/api.py` with monotonic revision tracking |

---

## 3. Cloud Synchronization Protocol (Render PostgreSQL)

The synchronization engine enforces three core guarantees:

1. **Monotonic Ordering**:
   Every database mutation writes a row to `sync_changes` with an auto-incrementing `seq_num` sequence token.
2. **Idempotency**:
   Every client mutation includes a unique UUID (`client_mutation_id`). Retried push requests are deduplicated by the database and never cause double-counting.
3. **Conflict Resolution**:
   Last-Write-Wins (LWW) resolution based on UTC timestamps.

### Endpoints:
- `POST /api/sync/pull`: Accepts `{ since_seq: N }`. Returns `mode: "baseline"` for fresh clients or `mode: "delta"` with an array of sequential changes since `N`.
- `POST /api/sync/push`: Accepts `{ mutations: [...] }`. Validates, applies, and returns applied sequence numbers.
- `GET /api/sync/status`: Reports the latest committed server sequence token.

---

## 4. Mobile Architecture (`mobile/`)

- Built with **React Native** and **Expo SDK 52**.
- Structured with bottom tabs (`Home`, `Transactions`, `Analytics`, `Forecasts`, `More`) and native stack navigation for sub-screens (`Invoices`, `Simulator`, `Sync`, `Reports`).
- Works fully offline using local storage (`AsyncStorage`) and auto-syncs when online.
