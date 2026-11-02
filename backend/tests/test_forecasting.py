from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.forecasting import _candidate_models, _features, _metrics, _predict_walk_forward, forecast_daily


def test_percentage_metrics_handle_zero_actuals():
    result = _metrics(__import__("numpy").array([0.0, 10.0]), __import__("numpy").array([3.0, 12.0]))
    assert result["mape"] == 20.0
    assert result["wape"] == 50.0


def test_limited_history_uses_baseline_and_returns_nonnegative_intervals():
    start = date.today() - timedelta(days=20)
    points = [(start + timedelta(days=i), float(1000 + i * 25)) for i in range(21)]
    result = forecast_daily(points, horizon=7)
    assert result["status"] == "limited_data"
    assert "Moving average" in result["selected_model"]
    assert len(result["predictions"]) == 7
    assert all(point["lower"] <= point["value"] <= point["upper"] for point in result["predictions"])


def test_category_baseline_avoids_weakly_supported_model_selection():
    start = date.today() - timedelta(days=90)
    points = [(start + timedelta(days=i), 100.0 + (i % 7) * 5) for i in range(91)]
    result = forecast_daily(points, horizon=7, simple=True)
    assert result["status"] == "baseline"
    assert result["selected_model"] == "Moving average"


def test_feature_builder_uses_only_history_and_includes_monthly_context():
    index = pd.date_range("2026-01-01", periods=120, freq="D")
    values = pd.Series(np.arange(120, dtype=float), index=index)
    changed_future = values.copy()
    changed_future.iloc[90:] = 1_000_000
    assert _features(values, 60) == _features(changed_future, 60)
    assert len(_features(values, 60)) == 14


def test_exponential_smoothing_candidates_and_seasonal_support_threshold():
    values = pd.Series(
        100 + np.sin(np.arange(220) * 2 * np.pi / 7) * 15 + np.arange(220) * 0.1,
        index=pd.date_range("2026-01-01", periods=220, freq="D"),
    )
    predictions = _predict_walk_forward(values, len(values), 7, "Simple exponential smoothing")
    assert len(predictions) == 7
    assert np.all(predictions >= 0)
    assert "Simple exponential smoothing" in _candidate_models(120)
    assert "Gradient boosting" not in _candidate_models(45)
    assert "SARIMA" not in _candidate_models(179)
    assert "SARIMA" in _candidate_models(180)


def test_model_selection_uses_multiple_expanding_window_folds():
    start = date.today() - timedelta(days=89)
    points = [(start + timedelta(days=i), float(1000 + i * 3 + (i % 7) * 15)) for i in range(90)]
    result = forecast_daily(points, horizon=7)
    assert result["status"] == "trained"
    assert result["validation_folds"] == 3
    assert any(metric["selected"] for metric in result["metrics"])
