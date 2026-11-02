from datetime import date, timedelta

from fastapi.testclient import TestClient

from .conftest import auth


def test_registration_login_and_workspace_access(client: TestClient, account):
    assert client.get("/api/auth/me", headers=auth(account)).status_code == 200
    login = client.post("/api/auth/login", json={"email": "taylor@example.com", "password": "strong-password-123"})
    assert login.status_code == 200
    assert login.json()["businesses"][0]["name"] == "Taylor Workshop"

    other = client.post("/api/auth/register", json={"name": "Morgan Owner", "email": "morgan@example.com", "password": "different-password-456", "business_name": "Morgan Goods", "currency": "USD"}).json()
    forbidden = client.get("/api/businesses/2", headers={"Authorization": f"Bearer {account['token']}"})
    assert forbidden.status_code == 404
    assert other["business"]["currency"] == "USD"


def test_transaction_crud_and_business_scope(client: TestClient, account):
    headers = auth(account)
    payload = {"kind": "income", "category": "Sales Revenue", "amount": "12800.45", "date": date.today().isoformat(), "description": "Customer settlement", "payment_method": "Bank transfer", "status": "completed"}
    created = client.post("/api/transactions", json=payload, headers=headers)
    assert created.status_code == 200, created.text
    row_id = created.json()["id"]
    assert created.json()["amount"] == 12800.45
    update = {**payload, "amount": "13000.00", "description": "Updated settlement"}
    assert client.put(f"/api/transactions/{row_id}", json=update, headers=headers).json()["amount"] == 13000.0
    assert client.get("/api/transactions?search=Updated", headers=headers).json()["total"] == 1
    assert client.delete(f"/api/transactions/{row_id}", headers=headers).json()["deleted"] is True
    assert client.get("/api/transactions", headers=headers).json()["total"] == 0


def test_decimal_kpis_open_obligations_and_reserve_settings(client: TestClient, account):
    headers = auth(account)
    client.patch("/api/businesses/current", headers=headers, json={"minimum_reserve": 100, "opening_cash": 1000})
    today = date.today().isoformat()
    for payload in [
        {"kind": "income", "category": "Sales Revenue", "amount": "250.00", "date": today, "description": "Sale", "status": "completed"},
        {"kind": "expense", "category": "Salaries", "amount": "50.00", "date": today, "description": "Payroll", "status": "completed"},
        {"kind": "income", "category": "Service Revenue", "amount": "75.00", "date": today, "description": "Invoice due", "status": "pending"},
        {"kind": "expense", "category": "Rent", "amount": "25.00", "date": today, "description": "Rent due", "status": "scheduled"},
    ]:
        assert client.post("/api/transactions", headers=headers, json=payload).status_code == 200
    result = client.get("/api/analytics/overview?months=1", headers=headers)
    assert result.status_code == 200, result.text
    kpi = result.json()["kpis"]
    assert kpi["revenue"] == 250.0
    assert kpi["expenses"] == 50.0
    assert kpi["net_cash_flow"] == 200.0
    assert kpi["current_cash"] == 1200.0
    assert kpi["accounts_receivable"] == 75.0
    assert kpi["accounts_payable"] == 25.0


def test_import_preview_duplicate_detection_and_exports(client: TestClient, account):
    headers = auth(account)
    csv_data = b"date,amount,type,category,description\n2026-03-01,500,income,Sales Revenue,New sale\n2026-03-02,not-money,expense,Rent,Invalid row\n"
    preview = client.post("/api/transactions/import/preview", headers=headers, files={"file": ("bank.csv", csv_data, "text/csv")})
    assert preview.status_code == 200, preview.text
    assert preview.json()["valid_count"] == 1
    assert preview.json()["invalid_count"] == 1
    rows = preview.json()["rows"]
    first = client.post("/api/transactions/import/confirm", headers=headers, json={"rows": rows}).json()
    second = client.post("/api/transactions/import/confirm", headers=headers, json={"rows": rows}).json()
    assert first["imported"] == 1
    assert second["duplicates"] == 1
    report = client.post("/api/reports/generate", headers=headers, json={"format": "csv", "months": 12})
    assert report.status_code == 200
    assert "New sale" in report.text
    xlsx_template = client.get("/api/transactions/template.xlsx")
    assert xlsx_template.status_code == 200
    assert xlsx_template.content[:2] == b"PK"


def test_scenario_simulation_and_insights(client: TestClient, account):
    headers = auth(account)
    today = date.today().isoformat()
    for kind, category, amount in [("income", "Sales Revenue", "10000"), ("expense", "Rent", "4000")]:
        client.post("/api/transactions", headers=headers, json={"kind": kind, "category": category, "amount": amount, "date": today, "description": "test", "status": "completed"})
    scenario = client.post("/api/scenarios", headers=headers, json={"name": "Hire plan", "revenue_change_pct": 10, "expense_change_pct": 5, "horizon_months": 6})
    assert scenario.status_code == 200
    sim = client.post(f"/api/scenarios/{scenario.json()['id']}/simulate", headers=headers)
    assert sim.status_code == 200
    assert sim.json()["monthly_net_cash_flow"] > 0
    custom = client.post("/api/scenarios/simulate", headers=headers, json={"name": "Loan and hire", "new_hire_monthly_cost": "500.00", "loan_proceeds": "2000.00", "one_time_cost": "5000.00", "capital_investment": "3000.00", "horizon_months": 6})
    assert custom.status_code == 200, custom.text
    assert custom.json()["monthly_net_cash_flow"] == 5500.0
    assert custom.json()["closing_cash"] == 33000.0
    assert client.get("/api/insights", headers=headers).status_code == 200


def test_recurring_due_dates_are_projected_without_double_counting(client: TestClient, account):
    headers = auth(account)
    due = date.today() + timedelta(days=10)
    recurring = client.post("/api/recurring", headers=headers, json={"kind": "expense", "category": "Rent", "amount": "500.00", "frequency": "monthly", "next_date": due.isoformat(), "description": "Monthly rent"})
    assert recurring.status_code == 200, recurring.text
    scheduled = client.post("/api/transactions", headers=headers, json={"kind": "expense", "category": "Rent", "amount": "500.00", "date": due.isoformat(), "description": "Confirmed rent", "status": "scheduled"})
    assert scheduled.status_code == 200
    projection = client.get("/api/analytics/cash-flow?horizon=90", headers=headers)
    assert projection.status_code == 200, projection.text
    result = projection.json()
    assert result["confirmed_obligations"] == 1
    assert result["recurring_occurrences"] == 2
    point = next(item for item in result["days"] if item["date"] == due.isoformat())
    assert point["outflows"] == 500.0

