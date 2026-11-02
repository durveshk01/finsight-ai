from __future__ import annotations

import copy
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
    return [lag(1), lag(7), lag(30), lag(90), float(np.mean(prior)) if len(prior) else 0.0,
            float(np.std(prior)) if len(prior) else 0.0, stamp.dayofweek, stamp.day, stamp.month,
            (stamp.dayofyear - 1) // 7 + 1, (stamp.month - 1) // 3 + 1]


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
    if model_name == "Holt-Winters":
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
            seasonal = "add" if len(train) >= 28 and train.std() > 0 else None
            fit = ExponentialSmoothing(train, trend="add", seasonal=seasonal,
                                       seasonal_periods=7 if seasonal else None,
                                       initialization_method="estimated").fit(optimized=True)
            return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
        except Exception:
            return _predict_walk_forward(series, train_end, horizon, "Moving average")
    if model_name == "ARIMA":
        try:
            from statsmodels.tsa.arima.model import ARIMA
            fit = ARIMA(train, order=(1, 1, 1), enforce_stationarity=False, enforce_invertibility=False).fit()
            return np.maximum(0, np.asarray(fit.forecast(horizon), dtype=float))
        except Exception:
            return _predict_walk_forward(series, train_end, horizon, "Moving average")
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
                "training_end": None, "metrics": [], "predictions": [{"date": d.isoformat(), "value": 0.0, "lower": 0.0, "upper": 0.0} for d in dates]}
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
    else:
        test_size = min(30, max(7, len(series) // 5))
        train_end = len(series) - test_size
        candidates = ["Seasonal naïve", "Moving average", "Holt-Winters", "ARIMA", "Gradient boosting", "XGBoost"]
        scored = []
        for candidate in candidates:
            try:
                predicted = _predict_walk_forward(series, train_end, test_size, candidate)
                score = _metrics(series.iloc[train_end:].to_numpy(), predicted)
                scored.append((candidate, score))
            except Exception:
                continue
        if not scored:
            scored = [("Moving average", _metrics(series.iloc[train_end:].to_numpy(), _predict_walk_forward(series, train_end, test_size, "Moving average")))]
        selected = min(scored, key=lambda item: item[1]["wape"] if item[1]["wape"] is not None else float("inf"))[0]
        all_preds = _predict_walk_forward(series, len(series), horizon, selected)
        errors = np.abs(series.iloc[train_end:].to_numpy() - _predict_walk_forward(series, train_end, test_size, selected))
        margin = float(np.quantile(errors, .9)) if len(errors) else 0.0
        preds = np.asarray(all_preds)
        metrics = [{"model": name, **score, "selected": name == selected} for name, score in scored]
        model = selected
        status = "trained"
    last = series.index[-1]
    result = []
    for i, value in enumerate(preds, start=1):
        spread = margin * min(2.2, sqrt(i / 7))
        result.append({"date": (last + pd.Timedelta(days=i)).date().isoformat(), "value": round(float(max(value, 0)), 2),
                       "lower": round(float(max(value - spread, 0)), 2), "upper": round(float(max(value + spread, 0)), 2)})
    return {"selected_model": model, "status": status, "training_start": series.index[0].date().isoformat(),
            "training_end": last.date().isoformat(), "metrics": metrics, "predictions": result}

