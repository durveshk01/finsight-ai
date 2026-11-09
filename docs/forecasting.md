# Forecasting methodology

FinSight has distinct **on-device mobile projections** and **server-side statistical forecasts**. The browser landing calculator is an explicitly illustrative sample, not a statement about a user's records or measured forecast accuracy.

## Native mobile engine

`mobile/src/services/financial-engine.ts` calculates completed-ledger KPIs, calendar-based runway, ageing, and local projections. Opening cash is added once; transfers are excluded from operating flow. Unpaid invoices do not count as cash receipts until paid.

Local statistical history requires at least **6 completed operating entries spanning 14 calendar days** in the evaluated range. Eligible revenue series evaluate **7-, 14-, and 30-day moving averages** against chronological one-day-ahead holdouts. Candidates report actual MAE and WAPE and identify the selected model. WAPE is undefined when holdout revenue is zero; the UI does not invent an accuracy percentage.

With insufficient history, the projection uses **confirmed obligations only**: remaining receivables/payables and pending/scheduled entries placed on their dates. Matching invoice references are not counted twice. No synthetic SARIMA, XGBoost, or cloud model result is presented as an on-device calculation.

Forecast cash starts from actual operating cash and accumulates estimated recurring flows plus confirmed dated obligations. Scenario growth/expense assumptions adjust estimated recurring flow; payment delays shift obligations; capital costs are deducted today. Obligations shifted beyond the selected horizon are excluded. These assumptions change projections, never the ledger.

Runway uses trailing **90 calendar days** of net completed operating burn. No trailing burn is shown as undefined/no net burn, not unlimited guaranteed reserves. Unknown future costs are not included in forecasts.

## Server-side engine

`backend/app/forecasting.py` aggregates dated values onto a daily calendar. It offers Seasonal Naïve, Moving Average, Simple Exponential Smoothing, Holt-Winters, and ARIMA; Gradient Boosting/XGBoost candidates require at least 60 observations, and SARIMA requires sufficiently long training windows of at least 180 observations. XGBoost has a scikit-learn fallback when unavailable. Failed/convergence-ineligible models are excluded or fall back to a moving average.

For eligible series with at least 45 calendar observations, expanding chronological folds score out-of-sample predictions. The candidate with the lowest defined WAPE is selected; MAE/RMSE and non-zero-actual MAPE are also returned. Random splitting is not used. Model names alone do not indicate that every candidate was successfully evaluated for a particular workspace.

For short/non-positive series or explicitly simple forecasts, the engine returns a moving-average baseline with **`validation_folds: 0`**. Its descriptive metrics are not an out-of-sample accuracy claim. Empty input returns zero baseline predictions with insufficient-data status and no invented metrics.

Descriptive uncertainty bands use empirical residual spread and widen with horizon; they are not guaranteed coverage. The cash-flow API combines forecast streams with known obligations/scenario assumptions and reports projected reserve breaches. Consolidated opening cash comes from business settings and completed operating activity, not the sum of independently allocated account opening balances.

## Verification/reporting

Tests cover transfer/opening-cash semantics, actual calendar ageing, sparse-history fallback, chronological model evaluation, zero-revenue WAPE, obligations without duplication, scenario timing/costs, and explicit `asOf` dates. Native APK checks additionally mount the actual chart screens and verify a capital-cost scenario without mutating recorded cash.

When reporting forecasts, include the selected model, history sufficiency, validation status, dates/horizon, and assumptions. Do not label limited-history baselines or illustrative demonstrations as measured future accuracy.
