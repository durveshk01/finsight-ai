# Forecasting approach

Revenue and expense activity is aggregated to a daily series and reindexed so dates with no transactions are explicit zeroes. Candidate models are evaluated on the latest chronological holdout; the model with the lowest defined WAPE is selected. Percentage errors omit zero actual values, and WAPE is undefined when the holdout contains no activity.

Candidates include a 7 day seasonal naive baseline, 28 day moving average, Holt-Winters exponential smoothing, ARIMA(1,1,1), and recursive gradient boosting. The XGBoost candidate uses XGBoost when it is installed and falls back to scikit-learn histogram gradient boosting otherwise. Features include lagged values, trailing mean and standard deviation, weekday, day, month, week, and quarter.

For fewer than 45 daily observations, the engine reports a 30 day moving average baseline and marks the result as limited data. Daily estimate bands are based on the 90th percentile of chronological validation absolute errors and widen with forecast distance. They are descriptive intervals, not confidence guarantees.

Cash flow starts with opening cash plus all completed inflows less completed outflows through today. Forecast inflows and outflows are applied once per future day. Pending and scheduled transactions are not part of model training; they are applied on their due dates as known items. The first projected day below the configured minimum reserve is surfaced as a warning.

## Known model limits

- Daily transaction series can be sparse and differ from accrual revenue recognition.
- A simple feature based regressor can extrapolate poorly after structural business changes.
- Validation is a single chronological holdout; production decisions should also consider repeated rolling evaluation and accounting context.
- The demo business is synthetic and is labelled as such in the UI.
