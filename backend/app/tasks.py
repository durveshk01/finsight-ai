import json
import os
from datetime import date

from celery import Celery

from .api import _forecast_for
from .database import SessionLocal
from .models import Business, ForecastRun

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("finsight", broker=REDIS_URL, backend=REDIS_URL, include=["app.tasks"])
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"], task_track_started=True)


@celery_app.task(name="finsight.train_forecasts")
def train_forecasts(business_id: int) -> dict:
    with SessionLocal() as db:
        business = db.get(Business, business_id)
        if not business:
            raise ValueError("Business workspace no longer exists")
        results = {}
        for kind, target in (("income", "revenue"), ("expense", "expenses")):
            result = _forecast_for(db, business, kind, 30)
            run = ForecastRun(business_id=business.id, target=target, selected_model=result["selected_model"],
                              training_start=date.fromisoformat(result["training_start"]) if result["training_start"] else None,
                              training_end=date.fromisoformat(result["training_end"]) if result["training_end"] else None,
                              metrics_json=json.dumps(result["metrics"]))
            db.add(run)
            results[target] = result
        db.commit()
        return {"revenue": results["revenue"], "expenses": results["expenses"]}
