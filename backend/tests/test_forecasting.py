from datetime import date, timedelta

from app.forecasting import _metrics, forecast_daily


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
