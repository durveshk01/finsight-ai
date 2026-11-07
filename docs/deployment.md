# FinSight AI – Production Deployment & Operations Guide

## 1. Quick Start: Local Development with Docker Compose

1. Clone repository and initialize environment:
   ```bash
   cp .env.example .env
   ```
2. Launch the full production stack:
   ```bash
   docker compose up --build
   ```
3. Services running locally:
   - **Web Application**: `http://localhost:3000`
   - **FastAPI Backend**: `http://localhost:8000` (Interactive Swagger docs at `/docs`)
   - **PostgreSQL 16**: Port `5432`
   - **Redis 7**: Port `6379`
   - **Celery Worker**: Background statistical time-series training
4. Default Demo Account:
   - **Email**: `demo@finsight.ai`
   - **Password**: `Demo1234!`

---

## 2. Cloud Deployment (Render & Vercel)

### Backend API (Render)
1. FinSight AI backend is containerized via `backend/Dockerfile` and declared in `render.yaml`.
2. Connect your GitHub repository to Render and create a **Blueprint Instance**.
3. Environment variables configured in Render:
   - `DATABASE_URL`: Managed Render PostgreSQL connection string.
   - `DATABASE_SCHEMA`: `finsight` (enforces dedicated tenant isolation).
   - `JWT_SECRET`: 256-bit cryptographic key.
   - `SEED_DEMO`: `true` for staging/demo environments, `false` for live enterprise production.
   - `CORS_ORIGINS`: Origin of the deployed web application (e.g., `https://finsight-ai.vercel.app`).
4. Health check endpoint: `GET /health` (monitors database and service health).

### Frontend Web (Vercel)
1. Deploy the Next.js application to Vercel.
2. Set Environment Variables:
   - `NEXT_PUBLIC_API_URL`: Your deployed Render backend URL (e.g. `https://finsight-api.onrender.com`).
3. Build command: `npm run build` (runs Next.js 16 Turbopack with full TypeScript verification).

---

## 3. Mobile Android Application Deployment (`mobile/`)

### Running in Android Emulator / Device
```bash
cd mobile
npm install
npx expo start
```
- Press `a` in the terminal to launch on a running Android emulator.
- Scan QR code using Expo Go on a physical Android device.

### Building Standalone Android Release (APK / AAB)
```bash
cd mobile
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

---

## 4. Production Verification Checklist

- [x] All 27 backend unit and integration tests passing (`py -3.12 -m pytest backend/tests`).
- [x] All 9 frontend Vitest tests passing (`npm run test:ui`).
- [x] Next.js production build (`npm run build`) succeeds with 0 errors.
- [x] Monotonic synchronization tokens verified against duplicate pushes and conflicts.
- [x] Inter-account transfers verified to have zero net impact on business revenue or expense totals.
- [x] AR and AP ageing buckets calculated with strict decimal precision.
