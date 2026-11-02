from __future__ import annotations

import copy
import warnings
from datetime import date, timedelta
from functools import lru_cache
from math import sqrt

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


def _features(series: pd.Series, index: int) -> list[float]:
    stamp = series.index[index]
    values = series.to_numpy(dtype=float)
    def lag(n: int) -> float:
        return float(values[index - n]) if index >= n else float(np.mean(values[:max(index, 1)]))
    prior = values[max(0, index - 30):index]
    previous_month = values[max(0, index - 30):index]
    previous_quarter = values[max(0, index - 90):index]
    prior_month = values[max(0, index - 60):max(0, index - 30)]
    month_total = float(np.sum(previous_month))
    prior_month_total = float(np.sum(prior_month))
    growth = (month_total - prior_month_total) / abs(prior_month_total) if prior_month_total else 0.0
    return [lag(1), lag(7), lag(30), lag(90), float(np.mean(prior)) if len(prior) else 0.0,
            float(np.std(prior)) if len(prior) else 0.0, stamp.dayofweek, stamp.day, stamp.month,
            stamp.isocalendar().week, (stamp.month - 1) // 3 + 1, month_total,
            float(np.sum(previous_quarter)), float(growth)]


def _candidate_models(train_length: int) -> list[str]:
    candidates = ["Seasonal naïve", "Moving average", "Simple exponential smoothing", "Holt-Winters", "ARIMA"]
    if train_length >= 180:
        candidates.append("SARIMA")
    if train_length >= 60:
        candidates.extend(["Gradient boosting", "XGBoost"])
    return candidates


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    if not len(actual):
        return {"mae": 0.0, "rmse": 0.0, "mape": None, "wape": None}
    absolute = np.abs(actual - predicted)
    denom = np.abs(actual)
    nonzero = denom > 1e-9
    mape = float(np.mean(absolute[nonzero] / denom[nonzero]) * 100) if np.any(nonzero) else None
    total = float(np.sum(denom))
    return {"mae": float(mean_absolute_error(actual, predicted)),
            "rmse": float(sqrt(mean_squared_error(actual, predicted))),
            "mape": mape, "wape": float(np.sum(absolute) / total * 100) if total else None}


def _predict_walk_forward(series: pd.Series, train_end: int, horizon: int, model_name: str) -> np.ndarray:
    train = series.iloc[:train_end].astype(float)
    if model_name == "Moving average":
        return np.repeat(max(0.0, float(train.tail(28).mean())), horizon)
    if model_name == "Seasonal naïve":
        values = train.to_numpy()
        return np.maximum(0, np.array([values[-7 + (i % 7)] if len(values) >= 7 else values[-1] for i in range(horizon)]))
    if model_name == "Simple exponential smoothing":
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing
        fit = SimpleExpSmoothing(train, initialization_method="estimated").fit(optimized=True)
        return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
    if model_name == "Holt-Winters":
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        seasonal = "add" if len(train) >= 28 and train.std() > 0 else None
        fit = ExponentialSmoothing(train, trend="add", seasonal=seasonal,
                                   seasonal_periods=7 if seasonal else None,
                                   initialization_method="estimated").fit(optimized=True)
        return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
    if model_name == "ARIMA":
        from statsmodels.tsa.arima.model import ARIMA
        fit = ARIMA(train, order=(1, 1, 1), enforce_stationarity=False, enforce_invertibility=False).fit()
        return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
    if model_name == "SARIMA":
        if train_end < 180:
            raise ValueError("SARIMA needs at least 180 daily observations")
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        from statsmodels.tools.sm_exceptions import ConvergenceWarning
        with warnings.catch_warnings():
            warnings.simplefilter("error", ConvergenceWarning)
            fit = SARIMAX(train, order=(1, 1, 1), seasonal_order=(1, 0, 0, 7),
                          enforce_stationarity=False, enforce_invertibility=False).fit(disp=False, maxiter=60)
        if not fit.mle_retvals.get("converged", True):
            raise RuntimeError("SARIMA did not converge")
        return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
    if model_name in {"Gradient boosting", "XGBoost"}:
        if train_end < 60:
            return _predict_walk_forward(series, train_end, horizon, "Moving average")
        X = np.asarray([_features(series, i) for i in range(1, train_end)])
        y = train.to_numpy()[1:]
        if model_name == "XGBoost":
            try:
                from xgboost import XGBRegressor
                model = XGBRegressor(n_estimators=100, max_depth=3, learning_rate=0.04,
                                     objective="reg:squarederror", n_jobs=1, verbosity=0)
            except ImportError:
                model = HistGradientBoostingRegressor(max_iter=100, max_leaf_nodes=15, l2_regularization=2)
        else:
            model = HistGradientBoostingRegressor(max_iter=100, max_leaf_nodes=15, l2_regularization=2)
        model.fit(X, y)
        predictions = []
        working = series.copy()
        for _ in range(horizon):
            idx = len(working)
            next_date = working.index[-1] + pd.Timedelta(days=1)
            extended = pd.concat([working, pd.Series([0.0], index=[next_date])])
            x = _features(extended, idx)
            value = max(0.0, float(model.predict([x])[0]))
            predictions.append(value)
            extended.iloc[idx] = value
            working = extended
        return np.asarray(predictions)
    return _predict_walk_forward(series, train_end, horizon, "Moving average")


def forecast_daily(points: list[tuple[date, float]], horizon: int = 30, simple: bool = False) -> dict:
    key = tuple(sorted((point_date, float(value)) for point_date, value in points))
    return copy.deepcopy(_cached_forecast(key, horizon, simple))


@lru_cache(maxsize=128)
def _cached_forecast(points: tuple[tuple[date, float], ...], horizon: int, simple: bool) -> dict:
    return _forecast_daily_uncached(list(points), horizon, simple)


def _forecast_daily_uncached(points: list[tuple[date, float]], horizon: int, simple: bool) -> dict:
    if not points:
        today = date.today()
        dates = [today + timedelta(days=i + 1) for i in range(horizon)]
        return {"selected_model": "Moving average (limited data)", "status": "insufficient_data", "training_start": None,
                "training_end": None, "validation_folds": 0, "metrics": [],
                "predictions": [{"date": d.isoformat(), "value": 0.0, "lower": 0.0, "upper": 0.0} for d in dates]}
    frame = pd.DataFrame(points, columns=["date", "value"])
    frame["date"] = pd.to_datetime(frame["date"])
    series = frame.groupby("date")["value"].sum().sort_index()
    full_idx = pd.date_range(series.index.min(), series.index.max(), freq="D")
    series = series.reindex(full_idx, fill_value=0.0).astype(float)
    if simple or len(series) < 45 or float(series.sum()) <= 0:
        level = max(0.0, float(series.tail(30).mean()))
        residual = np.abs(series.tail(30).to_numpy() - level)
        margin = float(np.quantile(residual, .9)) if len(residual) else 0.0
        preds = np.repeat(level, horizon)
        metrics = [{"model": "Moving average", **_metrics(series.tail(min(30, len(series))).to_numpy(), np.repeat(level, min(30, len(series)))), "selected": True}]
        model = "Moving average" if simple and len(series) >= 45 else "Moving average (limited data)"
        status = "baseline" if simple and len(series) >= 45 else "limited_data"
        validation_folds = 0
    else:
        test_size = min(30, max(7, len(series) // 10))
        fold_count = min(3, max(1, (len(series) - 30) // test_size))
        first_origin = len(series) - fold_count * test_size
        origins = [first_origin + fold * test_size for fold in range(fold_count)]
        candidates = _candidate_models(len(series))
        scored: list[tuple[str, dict, list[np.ndarray], list[np.ndarray]]] = []
        for candidate in candidates:
            actual_segments: list[np.ndarray] = []
            predicted_segments: list[np.ndarray] = []
            failed = False
            try:
                for origin in origins:
                    if candidate == "SARIMA" and origin < 180:
                        continue
                    predicted = _predict_walk_forward(series, origin, min(test_size, len(series) - origin), candidate)
                    actual_segments.append(series.iloc[origin:origin + len(predicted)].to_numpy())
                    predicted_segments.append(predicted)
            except Exception:
                failed = True
            if actual_segments and not failed:
                actual = np.concatenate(actual_segments)
                predicted = np.concatenate(predicted_segments)
                score = _metrics(actual, predicted)
                scored.append((candidate, score, actual_segments, predicted_segments))
        if not scored:
            origin = len(series) - test_size
            actual = series.iloc[origin:].to_numpy()
            predicted = _predict_walk_forward(series, origin, len(actual), "Moving average")
            scored = [("Moving average", _metrics(actual, predicted), [actual], [predicted])]
        selected_result = min(scored, key=lambda item: item[1]["wape"] if item[1]["wape"] is not None else float("inf"))
        selected = selected_result[0]
        try:
            all_preds = _predict_walk_forward(series, len(series), horizon, selected)
        except Exception:
            selected = "Moving average"
            all_preds = _predict_walk_forward(series, len(series), horizon, selected)
            selected_result = next((item for item in scored if item[0] == selected), scored[0])
        errors = np.abs(np.concatenate(selected_result[2]) - np.concatenate(selected_result[3]))
        margin = float(np.quantile(errors, .9)) if len(errors) else 0.0
        preds = np.asarray(all_preds)
        metrics = [{"model": name, **score, "selected": name == selected} for name, score, _, _ in scored]
        model = selected
        status = "trained"
        validation_folds = len(selected_result[2])
    last = series.index[-1]
    result = []
    for i, value in enumerate(preds, start=1):
        spread = margin * min(2.2, sqrt(i / 7))
        result.append({"date": (last + pd.Timedelta(days=i)).date().isoformat(), "value": round(float(max(value, 0)), 2),
                       "lower": round(float(max(value - spread, 0)), 2), "upper": round(float(max(value + spread, 0)), 2)})
    return {"selected_model": model, "status": status, "validation_folds": validation_folds,
            "training_start": series.index[0].date().isoformat(),
            "training_end": last.date().isoformat(), "metrics": metrics, "predictions": result}

