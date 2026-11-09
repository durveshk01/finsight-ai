# Deployment and release operations

## Web/API development

Copy `.env.example` to `.env` and run `docker compose up --build`. The stack includes web on port 3000, API on 8000, PostgreSQL 16, Redis 7, and an optional Celery worker. `SEED_DEMO=true` creates the documented demo account; set it to false for real business deployments.

Standalone API: Python 3.12, `backend/requirements.txt`, `DATABASE_URL` (defaults to local SQLite), Alembic `upgrade head`, then `uvicorn app.main:app --port 8000`. Startup applies migrations. Standalone web: Node 24, `npm ci`, `npm run build`, `npm start`.

## Render/Vercel configuration

`render.yaml` declares the Docker API, `APP_ENV=production`, dedicated `DATABASE_SCHEMA=finsight`, generated JWT secret, demo seeding, CORS origin, and `/health` route. Provision or connect the declared PostgreSQL database when applying the Blueprint.

- `DATABASE_URL`: actual PostgreSQL connection string (or SQLite for standalone development).
- `DATABASE_SCHEMA`: optional application namespace; tenant membership still scopes financial data by business.
- `JWT_SECRET`: non-default random secret with at least 32 bytes; production/Render startup rejects weak/default secrets.
- `SEED_DEMO`: true only when the known demo account/data are intended.
- `CORS_ORIGINS`: comma-separated permitted web origins.
- `REDIS_URL`: optional shared rate-limit/background-service endpoint.

Vercel builds the repository root with `npm run build`; set `NEXT_PUBLIC_API_URL` to the actual HTTPS API URL. `/health` reports service readiness; it is not a financial-workflow or full database-integrity test. Test authenticated ledger/invoice/sync routes separately.

The previously referenced `https://finsight-api-public.onrender.com/health` returned **404** during this work. The web demo returning 200 does not prove a compatible API is deployed. API 1.1.0/protocol 2 must be deployed and configured before claiming live mobile cloud sync works.

## Android release builds

See [mobile/README.md](../mobile/README.md). From `mobile/`, use Node 24, Java 21, Android SDK 36/build-tools 36.0.0, then `npm ci` and `npm run build:android`. No EAS account is required.

The script produces a signed, bundled, non-debuggable `artifacts/FinSight-AI-1.1.0.apk` for arm64-v8a/x86_64 and an accompanying SHA-256 file. Android API 24+ is required. Keep ignored `.signing/` privately backed up. External signing configuration is supported through `FINSIGHT_KEYSTORE_PATH`, `FINSIGHT_KEY_ALIAS`, `FINSIGHT_STORE_PASSWORD`, and `FINSIGHT_KEY_PASSWORD`.

For CI signing, `node scripts/configure-ci-signing.cjs owner/repository` stores the generated key/password as encrypted GitHub Actions secrets without printing them. Main-branch builds reuse that key; PR builds without release secrets use temporary validation keys. Never put keystore files, passwords, `.env.local`, or tokens into source control/release assets.

## Release verification and publication

The CI workflow checks:

1. Backend Alembic upgrade/check and pytest.
2. Web clean install, lint, typecheck, UI tests, and production build.
3. Mobile clean install with patches, Expo compatibility, typecheck, Jest/native rendering, build-tool regressions, and audit threshold (moderate or higher).
4. Signed APK identity/signature/non-debuggable status, embedded JS/Hermes, and both 64-bit ABIs.
5. Installation and real native financial/file/import/restore/persistence workflows using the **same APK artifact** on API 29 and 35 x86_64 emulators, with screenshots/logs/results retained.
6. A fresh PostgreSQL-backed Compose stack, frontend reachability, login, analytics, and cash forecast smoke checks.

Inspect the actual job outcomes; a unit-suite pass or build badge alone is not device verification. CI emits `android-validation-apk` plus per-emulator native verification artifacts. Publish the APK that passed those checks, together with its matching `.apk.sha256`, under a new versioned GitHub release. Compare downloaded artifact hashes and APK signing certificate before publication.

Document actual tested environments and any remaining physical-device/live-cloud gaps. A signed artifact alone does not verify unsupported ABIs, iOS, arbitrary hardware, or the currently missing hosted API. Preserve the signing key for compatible subsequent Android updates.
