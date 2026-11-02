# Forecasting approach

Revenue and expense activity is aggregated to a daily series and reindexed so dates with no transactions are explicit zeroes. Candidate models are compared on up to three expanding-window validation folds; each fold trains only on dates before its validation period. The model with the lowest aggregate WAPE is selected. Percentage errors omit zero actual values, and WAPE is undefined when a validation set contains no activity.

Candidates include a 7 day seasonal naive baseline, 28 day moving average, simple exponential smoothing, Holt-Winters exponential smoothing, ARIMA(1,1,1), and recursive gradient boosting. SARIMA(1,1,1)(1,0,0,7) is added when the training window contains at least 180 daily observations. The XGBoost candidate uses XGBoost when it is installed and falls back to scikit-learn histogram gradient boosting otherwise. Features include lagged values, trailing mean and standard deviation, weekday, day, month, week, quarter, trailing 30 day and 90 day revenue, and month-over-month growth.

For fewer than 45 daily observations, the engine reports a 30 day moving average baseline and marks the result as limited data. Gradient boosting candidates are only considered when there are at least 60 daily observations, and SARIMA is only evaluated on folds with at least 180 training observations. Daily estimate bands are based on the 90th percentile of expanding-window validation absolute errors and widen with forecast distance. They are descriptive intervals, not confidence guarantees.

Cash flow starts with opening cash plus all completed inflows less completed outflows through today. Forecast inflows and outflows are applied once per future day. Pending and scheduled transactions are not part of model training; they are applied on their due dates as known items. The first projected day below the configured minimum reserve is surfaced as a warning.

## Known model limits

- Daily transaction series can be sparse and differ from accrual revenue recognition.
- A simple feature based regressor can extrapolate poorly after structural business changes.
- Seasonal and regression models can remain unstable with short or low-volume history; the validation fold count and limited-data status should be reviewed with each forecast.
- The demo business is synthetic and is labelled as such in the UI.
