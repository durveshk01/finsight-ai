from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def client(monkeypatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("SEED_DEMO", "false")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def account(client: TestClient):
    response = client.post("/api/auth/register", json={"name": "Taylor Owner", "email": "taylor@example.com", "password": "strong-password-123", "business_name": "Taylor Workshop", "currency": "INR"})
    assert response.status_code == 200, response.text
    result = response.json()
    return {"token": result["access_token"], "business": result["business"]}


def auth(account, business_id=None):
    headers = {"Authorization": f"Bearer {account['token']}"}
    if business_id:
        headers["X-Business-Id"] = str(business_id)
    return headers
