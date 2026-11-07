# FinSight AI – Mobile Application (Android / React Native / Expo)

FinSight AI Mobile is an executive-grade financial command center powered by a **Local-First, Device-Powered Architecture**.

It enables finance teams, founders, and treasurers to perform real-time scenario modeling, KPI calculations, spending aggregations, and offline transaction drafting directly on their Android device, backed by Render cloud synchronization with monotonic sequence tokens.

---

## Key Features

1. **Local-First & Device-Powered**:
   - Zero-latency KPI computation (Net Cash Flow, Runway, Working Capital, Burn Rate).
   - Real-time What-If scenario sandbox running 100% locally on device with zero API latency.
   - Category-wise spending breakdowns and dynamic aggregations computed on-device.
   - Offline transaction drafting with local mutation queuing.

2. **Cloud Synchronization (Render PostgreSQL)**:
   - Incremental sync using monotonic sequence tokens (`seq_num`).
   - Idempotency with unique `client_mutation_id` prevents duplicate bookings.
   - Conflict resolution following Last-Write-Wins (LWW) accounting rules.

3. **Production Modules**:
   - **Executive Home**: Cash runway gauge, daily net flow, liquidity status, and quick sync status.
   - **Transaction Activity**: Filter, search, categorize, and draft offline transactions.
   - **Analytics**: Top spending categories and month-over-month burn rate comparisons.
   - **Forecasting & ML**: 30-day and 90-day cash projections with statistical model benchmarks (SARIMA, Holt-Winters, Gradient Boosting).
   - **Invoices & AR/AP**: Receivables & payables ageing schedules (Current, 1-30d, 31-60d, 61-90d, 90+d).
   - **Financial Reports**: Device-prepared P&L, Cash Position, and Tax summaries with native sharing.

---

## Prerequisites

- **Node.js**: `v18+` or `v20+`
- **Expo CLI**: `npm install -g expo-cli`
- **Android Studio** & Android SDK (for physical device or emulator execution)
- **Render Backend URL**: Deployed FinSight AI backend endpoint (default: `http://10.0.2.2:8000` for Android Emulator, or `https://finsight-ai.onrender.com`).

---

## Quick Start

### 1. Install Dependencies
```bash
cd mobile
npm install
```

### 2. Configure Backend Endpoint (Optional)
If running against a local or staging backend, configure `EXPO_PUBLIC_API_URL` or edit `mobile/src/services/sync.ts`:
```bash
export EXPO_PUBLIC_API_URL=https://your-finsight-api.onrender.com
```
*Note: For the standard Android emulator connecting to `localhost:8000`, use `http://10.0.2.2:8000`.*

### 3. Start Development Server
```bash
npx expo start
```
- Press `a` to open in Android Emulator.
- Or scan the QR code with **Expo Go** on your Android device.

---

## Building Android Standalone APK / Bundle

To build a production release APK for Android using EAS (Expo Application Services):

### 1. Install EAS CLI
```bash
npm install -g eas-cli
eas login
```

### 2. Configure Build Profile
```bash
eas build:configure
```

### 3. Build Android APK
```bash
eas build -p android --profile preview
```

Or generate local native Android code:
```bash
npx expo run:android
```

---

## Verification & Architecture Safety

- **No Float Inaccuracies**: All device computations use fixed-point / decimal-safe rounding.
- **Transfers Are Non-Revenue**: Mobile transactions designated as `transfer` adjust account balances without distorting business operating revenues or expenses.
- **Offline Resilient**: In flight mode, transactions are stored in AsyncStorage and flushed immediately upon reconnection.
