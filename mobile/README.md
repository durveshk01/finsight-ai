# FinSight AI Android

React Native 0.81.5 / React 19.1 / Expo SDK 54. Version **1.1.0**, Android version code **2**, package **`ai.finsight.mobile`**.

## Install and start

Get the APK and `.apk.sha256` file from [GitHub Releases](https://github.com/durveshk01/finsight-ai/releases). Android 7.0/API 24 or newer and an **arm64-v8a or x86_64** device are required; this APK does not include 32-bit Android ABIs.

Choose **Create local workspace**, enter your name, workspace currency, actual total opening cash, and minimum reserve. An operating-cash account is created. No internet or account is needed; records survive app restarts. **Close workspace** retains records and offers **Resume** on the welcome screen.

Cloud sign-in/registration requires your own working **HTTPS** FinSight API 1.1.0 or later with **sync protocol 2**. Enter its address on the sign-in screen. `EXPO_PUBLIC_API_URL` can optionally prefill the address at development/build time; no obsolete public API address is shipped as a default. HTTP/localhost addresses are rejected. A fresh cloud session stays read-only until a successful pull confirms its role.

## Workflows and accounting

- **Home:** actual operating cash, receipts/spending, invoice balances, trailing-calendar-day runway, and recent activity.
- **Activity:** search/date/type filters; income, expense, and transfer create/edit/delete. Transfers require two distinct active same-currency accounts and do not add revenue or change consolidated cash.
- **Invoices:** receivables/payables, due-date ageing, edits, and partial settlement. A payment reduces the invoice balance and posts one completed ledger entry; it must not be entered again as an ordinary transaction. Payment-linked entries cannot be edited/deleted as ordinary activity.
- **Settings/accounts:** owner-controlled business settings; permitted editors can add accounts. Account opening balances represent allocations, not additional consolidated opening cash. Currency is fixed after accounts or financial records exist.
- **Analytics/forecasts/scenarios:** actual ledger aggregates and on-device moving-average projections. Sparse history uses confirmed obligations only. [Methodology](../docs/forecasting.md) explains holdouts and assumptions.
- **Synchronization:** active-app reconnect/foreground/one-minute synchronization, sequential queued pushes, paginated pulls, acknowledgements and ID remapping, retained conflicts, and permission refresh. This is not OS background synchronization. An empty queue does not prove the API is reachable; local mode has no cloud queue.

Native amounts support at most 12 whole-number digits and two decimal places. Currencies: INR, USD, EUR, GBP, CAD, AUD, SGD, AED. Consolidated cash is total business opening cash + completed receipts − completed spending, excluding transfers.

## Files, import, and storage

**Reports & exports** generates real files locally and opens Android's share sheet:

| Format | Contents |
| --- | --- |
| PDF | Cash-basis financial and monthly summary plus invoices, rendered through Expo Print |
| XLSX | Summary, Ledger, Invoices, and Monthly sheets; numeric/value cells, no formulas |
| CSV | Ledger with account names and formula-injection protection |
| JSON | Portable `finsight.backup.v1` snapshot with business, accounts, transactions, and invoices |

Reports include records on the device, including pending cloud changes. They are cash-basis management summaries, not audited accrual statements or tax filings.

CSV import previews valid new rows, duplicates, and errors before atomically adding the confirmed valid rows. Maximum 500 rows per import; picked files must be no larger than 5 MB. Required columns: `date`, `kind` (or `type`), `category`, `amount`; optional columns: `description`, `status`, `payment_method`, `reference`, `account`, `to_account`. Dates must be real `YYYY-MM-DD` values; named accounts must exist in the workspace.

**Open backup as local workspace** validates JSON and opens a new local workspace. The previous workspace cache remains; restored data never implicitly uploads to a cloud account. Backups do not contain bearer tokens/passwords.

Financial records use app-private AsyncStorage, not a separate encrypted financial database. Bearer tokens use Expo SecureStore backed by the device keystore; session metadata and local-resume information are separate. Android automatic backup and production cleartext traffic are disabled. Export your own JSON backups to retain financial records outside the app installation.

## Development

Use Node **24** and install from the lockfile:

```sh
npm ci
npm run assets
npx expo start
```

Use an SDK-54-compatible Expo Go client, or `npx expo run:android` for a native development build. A current Expo Go client for another SDK is not interchangeable. The standalone APK does not require Expo Go or Metro.

```sh
npm run typecheck
npx expo install --check
npm test
npm run test:build-tools
npm audit --audit-level=moderate
```

`postinstall` reapplies the tracked Metro/image-size and deepmerge CJS patches. Overrides retain SDK 54 compatibility while addressing affected Glob, Minimatch, PostCSS, and image-size dependencies. As of the local November 2026 audit, all remaining 17 low findings (9 with dev dependencies omitted) propagate the same `deepmerge` advisory. Its CJS entry used by Expo/Jest is patched and covered by prototype-poisoning regression tests; npm audit remains version-based and still reports those notices. Do not force-upgrade Expo/Jest to SDK 58 to silence them.

## Reproducible signed APK builds

Requirements: Java 21, Android SDK platform 36/build-tools 36.0.0, the SDK's native build tools/NDK (Gradle installs missing licensed components), and enough memory/disk for a React Native release build. Set `ANDROID_HOME` and `JAVA_HOME`; Windows SDK discovery also supports the standard `%LOCALAPPDATA%\Android\Sdk` location.

```sh
npm ci
npm run build:android
```

The helper generates assets, prebuilds Android, configures release signing, assembles both 64-bit ABIs, checks APK signature/package/version/non-debuggable status and bundled Hermes/app code, and writes:

- `artifacts/FinSight-AI-1.1.0.apk`
- `artifacts/FinSight-AI-1.1.0.apk.sha256`

Without external signing configuration, it creates/reuses ignored `.signing/finsight-release.p12` and `.signing/release.json`. Keep both privately backed up: later compatible Android updates require the same signing key. Never commit them.

External signing variables: `FINSIGHT_KEYSTORE_PATH`, `FINSIGHT_KEY_ALIAS`, `FINSIGHT_STORE_PASSWORD`, and optional `FINSIGHT_KEY_PASSWORD` (defaults to store password). `FINSIGHT_GRADLE_WORKERS` defaults to 2; use 1 on memory-constrained hosts. This local Gradle workflow does not require EAS or an Expo account.

CI can reuse the generated key through GitHub's encrypted Actions secrets:

```sh
node scripts/configure-ci-signing.cjs owner/repository
```

Requires an authenticated GitHub CLI account with repository secret access. It transfers the keystore and password via stdin, without printing their values. Main-branch builds use `FINSIGHT_ANDROID_KEYSTORE_BASE64` and `FINSIGHT_ANDROID_STORE_PASSWORD`; other builds use temporary validation keys. The `android-validation-apk` artifact is not automatically published.

## Actual native release verification

With a booted, rootable `default` or `google_apis` emulator (never a physical device):

```sh
python scripts/verify-android.py --serial emulator-5554 --apk artifacts/FinSight-AI-1.1.0.apk
```

The verifier intentionally clears FinSight's emulator data, installs the signed APK, disables internet, creates named verification records through the UI, verifies transfers/payments and cash, generates and inspects native files/share sheets, picks CSV/JSON documents, edits/deletes/restores records, and checks restart/close/resume persistence. It stores screenshots, UI trees, files, logs, and `results.json` (including the tested APK's SHA-256) under `artifacts/verification/`.

Verification also requires Java 21 and installed Android SDK platform/build-tools. It builds and installs a small native Java share receiver from `tests/android/` under the evidence directory. After choosing that receiver in the real Android share sheet, it opens each FinSight file using the actual `ACTION_SEND` URI permission grant and records the MIME type, URI, byte count, and SHA-256. PDF/XLSX/CSV/JSON contents are checked from the received bytes. The receiver requests no storage or network permissions and uses its own disposable test signing key.

Jest rendering and mocked native-module tests are useful regression checks but are not proof of APK installation or physical-device compatibility. CI checks the downloaded checksum and exercises the same signed artifact on Android API 29 and 35 AOSP x86_64 emulators with hardware keyboards. Physical arm64-device and live hosted-cloud checks must be identified separately when reporting a release's verification.

The reusable native workflow also supports verification-only runs against an existing CI APK:

```sh
gh workflow run android-native.yml -f apk-run-id=YOUR_CI_RUN_ID
```

Replace `YOUR_CI_RUN_ID` with a FinSight CI run whose `android-build` job passed. Before installation, the workflow checks that the artifact's application/build/dependency source matches the current checkout. It then retains separate results and screenshots for both emulator API levels.
