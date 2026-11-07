# FinSight AI – Time-Series Financial Forecasting Engine

FinSight AI employs a multi-model time-series forecasting architecture designed specifically for business cash flow, revenue predictability, and expense trajectory analysis.

---

## 1. Candidate Forecasting Models

For every business workspace, FinSight AI trains and statistically evaluates multiple candidate models:

1. **Seasonal Naïve Baseline**:
   - 7-day cyclical replication for daily operational transactions.
2. **Moving Averages**:
   - 14-day and 28-day trailing moving averages for stable baseline burn calculations.
3. **Exponential Smoothing (ETS)**:
   - Simple Exponential Smoothing (SES) and Holt-Winters with additive trend and weekly seasonality.
4. **ARIMA & SARIMA**:
   - Autoregressive Integrated Moving Average `ARIMA(1, 1, 1)` for non-seasonal differenced series.
   - Seasonal `SARIMA(1, 1, 1)(1, 0, 0, 7)` evaluated when at least 180 days of daily transaction history are available.
5. **Recursive Machine Learning Gradient Boosting**:
   - XGBoost (with scikit-learn Histogram Gradient Boosting fallback).
   - Engineered features:
     - Multi-day lagged actuals (`t-1`, `t-7`, `t-14`, `t-30`).
     - Rolling 7-day, 14-day, and 30-day moving means and standard deviations.
     - Calendar features: Day of week, day of month, month of year, quarter.
     - Momentum features: 30-day and 90-day trajectory indicators and MoM growth delta.

---

## 2. Chronological Walk-Forward Validation

To prevent temporal data leakage, **random train-test splitting is strictly prohibited**. 

The engine uses chronological, expanding-window walk-forward validation folds:
- Fold $k$ trains strictly on history $1 \dots t_k$.
- Evaluates out-of-sample predictions on holdout horizon $t_k+1 \dots t_k + H$.
- Candidate models are scored using **Weighted Absolute Percentage Error (WAPE)**:
  $$\text{WAPE} = \frac{\sum |y_t - \hat{y}_t|}{\sum y_t}$$
- The candidate minimizing out-of-sample WAPE across holdout folds is automatically selected.

### Secondary Metrics Reported:
- **MAE** (Mean Absolute Error)
- **RMSE** (Root Mean Squared Error)
- **MAPE** (Mean Absolute Percentage Error, calculated strictly on non-zero actuals to avoid division-by-zero singularities).

---

## 3. Daily Cash Flow Simulation Engine

Daily projected cash balances combine:
1. **Current Cash Balance**: Sum of all confirmed, reconciled bank, cash, and card accounts.
2. **Model Forecast Inflows & Outflows**: Daily predictions from the selected revenue and expense models.
3. **Confirmed Obligations**: Pending and scheduled accounts payable and receivables placed exactly on their due dates.
4. **Recurring Schedules**: Configured subscriptions, payroll, and lease obligations.
5. **Confidence Interval Bands**:
   Descriptive uncertainty bands generated from validation residual distributions (90th percentile) that widen with temporal distance from $t_0$.
6. **Reserve Threshold Alarms**:
   Real-time detection of the exact future calendar date when projected balance breaches the business's minimum cash reserve.
