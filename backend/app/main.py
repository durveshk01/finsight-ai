import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .api import router
from .database import Base, SessionLocal, engine
from .rate_limit import RateLimiter, RateLimitMiddleware
from .seed import seed_demo

rate_limiter = RateLimiter(os.getenv("REDIS_URL"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if os.getenv("SEED_DEMO", "true").lower() == "true":
        with SessionLocal() as db:
            seed_demo(db)
    try:
        yield
    finally:
        await rate_limiter.close()


app = FastAPI(title="FinSight AI API", version="1.0.0", description="Financial analytics, forecasting, and cash flow planning API", lifespan=lifespan)
app.state.rate_limiter = rate_limiter
app.add_middleware(RateLimitMiddleware, limiter=rate_limiter)
origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "finsight-api"}

