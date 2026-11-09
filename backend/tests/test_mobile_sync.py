from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import get_db, migrate_database
from app.main import app
from .conftest import auth


def push(client, headers, entity, action, data=None, entity_id=None, mutation_id="test-mutation"):
    return client.post("/api/sync/push", headers=headers, json={"mutations": [{"client_mutation_id": mutation_id,
        "entity_type": entity, "action": action, "entity_id": entity_id, "data": data or {}}]})


def transaction_data(**changes):
    return {"kind": "income", "category": "Sales Revenue", "amount": "0.30", "date": date.today().isoformat(),
            "description": "Actual mobile sale", "payment_method": "Mobile entry", "status": "completed", **changes}


def invoice_data(**changes):
    return {"direction": "receivable", "invoice_number": "MOBILE-1", "counterparty": "Mobile Customer",
        "issue_date": date.today().isoformat(), "due_date": (date.today() + timedelta(days=30)).isoformat(),
        "amount": "50.30", "currency": "INR", "category": "Sales Revenue", "description": "", **changes}


def test_sync_full_acknowledgements_and_complete_transaction_updates(client, account):
    headers = auth(account)
    created = push(client, headers, "transaction", "create", transaction_data()).json()["applied"][0]
    assert created["record"]["amount"] == 0.3
    assert created["record"]["date"] == date.today().isoformat()
    updated = push(client, headers, "transaction", "update", transaction_data(kind="expense", amount="0.10",
        date=(date.today() - timedelta(days=1)).isoformat(), description="Changed category and date", reference="R-1"),
        created["entity_id"], "update-sale").json()["applied"][0]
    assert updated["record"]["kind"] == "expense"
    assert updated["record"]["reference"] == "R-1"
    assert updated["record"]["date"] == (date.today() - timedelta(days=1)).isoformat()
    removed = push(client, headers, "transaction", "delete", entity_id=created["entity_id"], mutation_id="delete-sale").json()
    assert removed["applied"][0]["status"] == "deleted"
    replay = push(client, headers, "transaction", "delete", entity_id=created["entity_id"], mutation_id="delete-sale").json()
    assert replay["applied"][0]["status"] == "already_applied"
    assert client.get("/api/transactions", headers=headers).json()["total"] == 0


def test_invoice_payment_retry_posts_exactly_once_and_delta_is_complete(client, account):
    headers = auth(account)
    invoice = push(client, headers, "invoice", "create", invoice_data()).json()["applied"][0]
    baseline = client.post("/api/sync/pull", headers=headers, json={"since_seq": 0}).json()
    assert baseline["role"] == "owner"
    assert baseline["business"]["opening_cash"] == 0
    payment = {"invoice_id": invoice["entity_id"], "amount": "10.10", "paid_on": date.today().isoformat(), "payment_method": "Bank transfer"}
    result = push(client, headers, "payment", "create", payment, mutation_id="settlement-1").json()["applied"][0]
    assert result["invoice"]["amount_due"] == 40.2
    assert result["transaction"]["invoice_id"] == invoice["entity_id"]
    replay = push(client, headers, "payment", "create", payment, mutation_id="settlement-1").json()["applied"][0]
    assert replay["status"] == "already_applied"
    assert replay["transaction"]["id"] == result["transaction"]["id"]
    assert replay["invoice"]["amount_due"] == 40.2
    assert client.get("/api/transactions", headers=headers).json()["total"] == 1
    assert len(client.get(f"/api/invoices/{invoice['entity_id']}/payments", headers=headers).json()) == 1
    kpis = client.get("/api/analytics/overview", headers=headers).json()["kpis"]
    assert kpis["current_cash"] == 10.1
    assert kpis["accounts_receivable"] == 40.2
    cursor = baseline["latest_seq"]
    changes = []
    while True:
        page = client.post("/api/sync/pull", headers=headers, json={"since_seq": cursor, "limit": 1}).json()
        changes.extend(page["changes"])
        assert page["new_seq"] > cursor
        cursor = page["new_seq"]
        if not page["has_more"]:
            break
    assert [change["entity_type"] for change in changes] == ["transaction", "invoice", "payment"]
    assert len({change["seq_num"] for change in changes}) == 3
    assert changes[0]["data"]["invoice_id"] == invoice["entity_id"]
    invalid_reuse = push(client, headers, "payment", "create", {**payment, "amount": "1.00"}, mutation_id="settlement-1").json()
    assert not invalid_reuse["applied"]
    assert "different change" in invalid_reuse["conflicts"][0]["error"]


def test_paid_invoice_and_payment_cannot_be_changed_independently(client, account):
    headers = auth(account)
    invoice = client.post("/api/invoices", headers=headers, json=invoice_data()).json()
    settled = client.post(f"/api/invoices/{invoice['id']}/payments", headers=headers,
        json={"amount": "10.10", "paid_on": date.today().isoformat()}).json()
    assert client.put(f"/api/transactions/{settled['transaction']['id']}", headers=headers, json=transaction_data()).status_code == 409
    rejected = push(client, headers, "transaction", "delete", entity_id=settled["transaction"]["id"]).json()
    assert rejected["conflicts"]
    assert client.delete(f"/api/invoices/{invoice['id']}", headers=headers).status_code == 409
    assert client.put(f"/api/invoices/{invoice['id']}", headers=headers, json=invoice_data(direction="payable")).status_code == 409
    assert client.put(f"/api/invoices/{invoice['id']}", headers=headers, json=invoice_data(amount="1.00")).status_code == 409
    bulk = client.post("/api/transactions/bulk", headers=headers, json={"action": "update_status", "status": "pending", "transaction_ids": [settled["transaction"]["id"]]}).json()
    assert bulk["affected"] == 0
    assert client.get("/api/transactions", headers=headers).json()["items"][0]["status"] == "completed"


def test_invoice_edit_and_delete_keep_normalized_obligations_in_step(client, account):
    headers = auth(account)
    invoice = client.post("/api/invoices", headers=headers, json=invoice_data()).json()
    changed = client.put(f"/api/invoices/{invoice['id']}", headers=headers, json=invoice_data(direction="payable", amount="25.25", category="Rent"))
    assert changed.status_code == 200, changed.text
    kpis = client.get("/api/analytics/overview", headers=headers).json()["kpis"]
    assert kpis["accounts_receivable"] == 0
    assert kpis["accounts_payable"] == 25.25
    assert client.delete(f"/api/invoices/{invoice['id']}", headers=headers).status_code == 200
    assert client.get("/api/analytics/overview", headers=headers).json()["kpis"]["accounts_payable"] == 0


def test_sync_validates_tenants_roles_accounts_and_mutation_data(client, account):
    headers = auth(account)
    other = client.post("/api/auth/register", json={"name": "Other Owner", "email": "sync-other@example.com", "password": "strong-password-123", "business_name": "Other Company", "currency": "USD"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign_account = client.post("/api/accounts", headers=other_headers, json={"name": "Other bank"}).json()
    denied = push(client, headers, "transaction", "create", transaction_data(account_id=foreign_account["id"])).json()
    assert not denied["applied"]
    assert "Account not found" in denied["conflicts"][0]["error"]
    for changes in [{"amount": "-1.00"}, {"amount": "0.001"}, {"kind": "transfer"}, {"date": "2026-02-30"}, {"date": (date.today() + timedelta(days=1)).isoformat()}]:
        result = push(client, headers, "transaction", "create", transaction_data(**changes)).json()
        assert result["conflicts"] and not result["applied"]
    owned_account = client.post("/api/accounts", headers=headers, json={"name": "Owner bank"}).json()
    ordinary_entry = transaction_data(to_account_id=owned_account["id"])
    assert client.post("/api/transactions", headers=headers, json=ordinary_entry).status_code == 422
    rejected_destination = push(client, headers, "transaction", "create", ordinary_entry).json()
    assert not rejected_destination["applied"]
    assert "only valid for transfers" in rejected_destination["conflicts"][0]["error"]
    assert client.post("/api/businesses/current/members", headers=headers, json={"email": other["user"]["email"], "role": "viewer"}).status_code == 200
    viewer = {**other_headers, "X-Business-Id": str(account["business"]["id"])}
    assert client.post("/api/sync/pull", headers=viewer, json={"since_seq": 0}).json()["role"] == "viewer"
    assert push(client, viewer, "transaction", "create", transaction_data()).status_code == 403
    assert client.get("/api/transactions", headers=headers).json()["total"] == 0


@pytest.mark.parametrize("role", ["admin", "accountant"])
def test_only_owner_changes_business_settings_through_rest_or_sync(client, account, role):
    owner_headers = auth(account)
    editor = client.post("/api/auth/register", json={"name": "Workspace Editor", "email": f"settings-{role}@example.com",
        "password": "strong-password-123", "business_name": "Editor Company", "currency": "INR"}).json()
    assert client.post("/api/businesses/current/members", headers=owner_headers,
        json={"email": editor["user"]["email"], "role": role}).status_code == 200
    business_id = account["business"]["id"]
    editor_headers = {"Authorization": f"Bearer {editor['access_token']}", "X-Business-Id": str(business_id)}
    before = client.post("/api/sync/pull", headers=owner_headers, json={"since_seq": 0}).json()
    settings = {"opening_cash": "100.00", "minimum_reserve": "20.00"}
    assert client.patch("/api/businesses/current", headers=editor_headers, json=settings).status_code == 403
    denied = push(client, editor_headers, "business", "update", settings, business_id, "denied-settings").json()
    assert not denied["applied"]
    assert "Only workspace owners" in denied["conflicts"][0]["error"]
    after = client.post("/api/sync/pull", headers=owner_headers, json={"since_seq": 0}).json()
    assert after["business"] == before["business"]
    assert after["latest_seq"] == before["latest_seq"]
    allowed_entry = push(client, editor_headers, "transaction", "create", transaction_data(), mutation_id="allowed-entry").json()
    assert len(allowed_entry["applied"]) == 1
    saved = push(client, owner_headers, "business", "update", settings, business_id, "owner-settings").json()
    assert saved["applied"][0]["record"]["opening_cash"] == 100
    assert saved["applied"][0]["record"]["minimum_reserve"] == 20


def test_sync_batch_conflicts_are_atomic_and_do_not_drop_later_valid_changes(client, account):
    headers = auth(account)
    mutations = [
        {"client_mutation_id": "account-1", "entity_type": "account", "action": "create", "data": {"name": "Bank", "opening_balance": "0.00"}},
        {"client_mutation_id": "account-duplicate", "entity_type": "account", "action": "create", "data": {"name": "Bank"}},
        {"client_mutation_id": "invalid-amount", "entity_type": "transaction", "action": "create", "data": transaction_data(amount="-5.00")},
        {"client_mutation_id": "valid-sale", "entity_type": "transaction", "action": "create", "data": transaction_data()},
    ]
    result = client.post("/api/sync/push", headers=headers, json={"mutations": mutations})
    assert result.status_code == 200, result.text
    assert len(result.json()["applied"]) == 2
    assert len(result.json()["conflicts"]) == 2
    assert client.get("/api/transactions", headers=headers).json()["total"] == 1
    assert len(client.get("/api/accounts", headers=headers).json()) == 1
    settings = push(client, headers, "business", "update", {"opening_cash": "0.00", "minimum_reserve": "0.00"}, account["business"]["id"], "settings-1").json()
    assert settings["applied"][0]["record"]["minimum_reserve"] == 0
    assert client.post("/api/sync/pull", headers=headers, json={"since_seq": 999999}).json()["mode"] == "baseline"


def test_concurrent_retries_use_unique_monotonic_sequences_on_a_migrated_database(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'concurrent.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("SEED_DEMO", "false")
    migrate_database()
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    def database():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = database
    app.state.rate_limiter.clear_memory()
    try:
        with TestClient(app) as client:
            owner = client.post("/api/auth/register", json={"name": "Concurrent Owner", "email": "concurrent@example.com", "password": "strong-password-123", "business_name": "Concurrent Business", "currency": "INR"}).json()
            headers = {"Authorization": f"Bearer {owner['access_token']}"}
            def submit(index):
                return push(client, headers, "transaction", "create", transaction_data(), mutation_id=f"concurrent-{index % 8}")
            with ThreadPoolExecutor(max_workers=8) as pool:
                responses = list(pool.map(submit, range(16)))
            assert all(response.status_code == 200 and len(response.json()["applied"]) == 1 for response in responses), [response.text for response in responses]
            assert client.get("/api/transactions", headers=headers).json()["total"] == 8
            status = client.get("/api/sync/status", headers=headers).json()
            assert status["latest_seq"] == 8
            delta = client.post("/api/sync/pull", headers=headers, json={"since_seq": 1, "limit": 100}).json()
            assert [change["seq_num"] for change in delta["changes"]] == list(range(2, 9))
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_production_startup_rejects_the_development_signing_secret(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr("app.security.SECRET_KEY", "local-development-secret-change-before-deploy")
    with pytest.raises(RuntimeError, match="private JWT_SECRET"):
        with TestClient(app):
            pass
