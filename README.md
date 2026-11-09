# FinSight AI

[![FinSight CI](https://github.com/durveshk01/finsight-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/durveshk01/finsight-ai/actions/workflows/ci.yml)

Financial activity, invoices, cash-flow planning, and an offline-first Android app. The stack is Next.js 16 / React 19, FastAPI / Python 3.12, SQLAlchemy / Alembic, and React Native 0.81 / Expo SDK 54. PostgreSQL is supported for hosted deployments; SQLite works for standalone development. Redis/Celery provide optional background services.

## What is implemented

- **Web:** authenticated business workspaces, ledger management and date filtering, account transfers, invoice ageing and partial payments, actual financial charts, exports, and server forecasting. The landing-page calculator is explicitly illustrative.
- **Android 1.1.0:** local workspace creation/resume, cloud registration/sign-in/business selection, persistent transaction CRUD and transfers, invoices and payments, accounts/settings, analytics, on-device forecasts/scenarios, sync status/conflicts, and real PDF/XLSX/CSV/JSON sharing and CSV/backup import.
- **Financial integrity:** two-decimal money, completed receipts/spending, opening cash added once, transfers excluded from operating revenue/expense, same-currency account validation, and payment-linked ledger entries protected from ordinary editing/deletion.
- **Sync protocol 2:** tenant-scoped ordering, retryable mutation acknowledgements, ID reconciliation, paginated deltas, permission refresh, and retained failed drafts. Native cloud mode requires API 1.1.0 or later implementing protocol 2.

Device-only mode does not need an API and never reports cloud synchronization. Cloud mode sends records only to the HTTPS API the user configures. The Android app stores bearer tokens in SecureStore and financial records in app-private AsyncStorage.

## Start locally

### Complete web/API stack

Copy `.env.example` to `.env`, then run:

```sh
docker compose up --build
```

Web: `http://localhost:3000`; API: `http://localhost:8000`; API documentation: `/docs`.
With `SEED_DEMO=true`, the demo account is `demo@finsight.ai` / `Demo1234!`.

### API without Docker

From `backend/`, install `requirements.txt` into a Python 3.12 virtual environment, then:

```sh
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

On Windows, `py -3.12 -m ...` selects the tested Python version. Startup also applies migrations. Set `SEED_DEMO=false` for an empty workspace database. Hosted production requires a non-default JWT secret of at least 32 bytes.

### Web

From the repository root, using Node 24:

```sh
npm ci
npm run dev
```

Set `NEXT_PUBLIC_API_URL` to the API address when it is not `http://localhost:8000`.

### Android

Download the APK and matching checksum from [GitHub Releases](https://github.com/durveshk01/finsight-ai/releases), or build from `mobile/`:

```sh
npm ci
npm run build:android
```

Local builds require Java 21 and Android SDK platform/build-tools 36. The helper generates native assets/projects, signs and verifies the APK, and writes `mobile/artifacts/FinSight-AI-1.1.0.apk` and its `.sha256` file. Supported devices: Android 7.0/API 24 or later, **arm64-v8a or x86_64**. See [the mobile guide](mobile/README.md) for signing, development, and installation details.

## Verification

From `backend/`:

```sh
python -m alembic upgrade head
python -m alembic check
python -m pytest -q
```

From the repository root:

```sh
npm run lint
npm run typecheck
npm run test:ui
npm run build
```

If Windows application control blocks Next.js's native SWC binding, the installed CLI supports `npm run build -- --webpack`; this was the successful local production-build path.

From `mobile/`:

```sh
npm run typecheck
npx expo install --check
npm test
npm run test:build-tools
npm audit --audit-level=moderate
```

The mobile unit/native-render suite mocks native modules. APK-level verification instead installs the signed release on a disposable Android emulator and exercises real forms, transfers, payments, files, document picking, restore, and restart persistence:

```sh
python scripts/verify-android.py --serial emulator-5554 --apk artifacts/FinSight-AI-1.1.0.apk
```

CI runs backend migrations/tests, web lint/types/tests/build, full mobile checks, a signed APK build, native APK workflows on Android API 29 and 35, and the PostgreSQL-backed Docker Compose smoke test. Check the workflow results and attached verification artifacts for the actual status.

## Documentation

- [Architecture and sync protocol](docs/architecture.md)
- [Deployment and release operations](docs/deployment.md)
- [Forecasting methodology and limitations](docs/forecasting.md)
- [Android mobile guide](mobile/README.md)
