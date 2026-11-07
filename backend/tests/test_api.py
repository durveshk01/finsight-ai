from datetime import date, timedelta
from io import BytesIO

from openpyxl import load_workbook
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


def test_auth_endpoints_are_rate_limited(client: TestClient):
    payload = {"name": "Rate Limited", "password": "strong-password-123", "business_name": "Workspace", "currency": "USD"}
    for index in range(5):
        response = client.post("/api/auth/register", json={**payload, "email": f"rate-{index}@example.com"})
        assert response.status_code == 200, response.text
    limited = client.post("/api/auth/register", json={**payload, "email": "rate-6@example.com"})
    assert limited.status_code == 429
    assert limited.headers["Retry-After"]


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


def test_import_preview_allows_explicit_column_mapping(client: TestClient, account):
    headers = auth(account)
    data = b"Transaction On,Value INR,Flow,Payee,Notes\n2026-04-03,925.50,Credit,Sales Revenue,Remapped transaction\n"
    auto = client.post("/api/transactions/import/preview", headers=headers,
                       files={"file": ("statement.csv", data, "text/csv")})
    assert auto.status_code == 422
    mapped = client.post("/api/transactions/import/preview", headers=headers,
                         files={"file": ("statement.csv", data, "text/csv")},
                         data={"mapping": '{"date":"Transaction On","amount":"Value INR","kind":"Flow","category":"Payee","description":"Notes"}'})
    assert mapped.status_code == 200, mapped.text
    assert mapped.json()["valid_count"] == 1
    assert mapped.json()["rows"][0] == {
        "date": "2026-04-03", "amount": "925.50", "kind": "income", "category": "Sales Revenue",
        "description": "Remapped transaction", "status": "completed", "payment_method": "Imported",
    }


def test_financial_reports_include_forecasts_charts_and_history(client: TestClient, account):
    headers = auth(account)
    pdf = client.post("/api/reports/generate", headers=headers, json={"format": "pdf", "months": 3, "report_type": "risk"})
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF")

    workbook_response = client.post("/api/reports/generate", headers=headers, json={"format": "xlsx", "months": 3, "report_type": "forecast"})
    assert workbook_response.status_code == 200, workbook_response.text
    workbook = load_workbook(BytesIO(workbook_response.content))
    assert {"Financial summary", "Monthly summary", "90-day forecast", "Forecast model metrics", "Insights", "Methodology"}.issubset(workbook.sheetnames)
    assert workbook["Monthly summary"]._charts

    history = client.get("/api/reports", headers=headers)
    assert history.status_code == 200
    assert [item["format"] for item in history.json()] == ["xlsx", "pdf"]
    assert history.json()[0]["report_type"] == "forecast"


def test_report_type_validation_and_business_isolation(client: TestClient, account):
    headers = auth(account)
    invalid = client.post("/api/reports/generate", headers=headers, json={"format": "pdf", "report_type": "unknown"})
    assert invalid.status_code == 422
    other = client.post("/api/auth/register", json={"name": "Morgan Owner", "email": "reports@example.com", "password": "different-password-456", "business_name": "Morgan Goods", "currency": "USD"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}", "X-Business-Id": str(other["business"]["id"])}
    assert client.get("/api/reports", headers=other_headers).json() == []


def test_accounts_invoices_partial_payments_and_cash_projection(client: TestClient, account):
    headers = auth(account)
    account_response = client.post("/api/accounts", headers=headers, json={
        "name": "Operating bank", "account_type": "bank", "opening_balance": "1000.00"
    })
    assert account_response.status_code == 200, account_response.text
    account_id = account_response.json()["id"]
    assert account_response.json()["current_balance"] == 1000.0
    categories = client.get("/api/categories?kind=income", headers=headers).json()
    assert "Sales Revenue" in {row["name"] for row in categories}

    due = date.today() + timedelta(days=10)
    invoice_response = client.post("/api/invoices", headers=headers, json={
        "direction": "receivable", "invoice_number": "AR-1001", "counterparty": "Acme Co",
        "issue_date": date.today().isoformat(), "due_date": due.isoformat(), "amount": "500.25",
        "category": "Sales Revenue", "account_id": account_id,
    })
    assert invoice_response.status_code == 200, invoice_response.text
    invoice = invoice_response.json()
    assert invoice["amount_due"] == 500.25
    assert client.get("/api/analytics/overview", headers=headers).json()["kpis"]["accounts_receivable"] == 500.25
    projection = client.get("/api/analytics/cash-flow?horizon=15", headers=headers).json()
    assert projection["confirmed_obligations"] == 1
    assert next(day for day in projection["days"] if day["date"] == due.isoformat())["inflows"] == 500.25

    partial = client.post(f"/api/invoices/{invoice['id']}/payments", headers=headers, json={
        "amount": "200.10", "paid_on": date.today().isoformat(), "account_id": account_id,
        "payment_method": "Bank transfer", "reference": "PAY-1",
    })
    assert partial.status_code == 200, partial.text
    assert partial.json()["invoice"]["status"] == "partially_paid"
    assert partial.json()["invoice"]["amount_due"] == 300.15
    assert client.get("/api/analytics/overview", headers=headers).json()["kpis"]["accounts_receivable"] == 300.15
    assert client.get("/api/accounts", headers=headers).json()[0]["current_balance"] == 1200.1
    assert len(client.get(f"/api/invoices/{invoice['id']}/payments", headers=headers).json()) == 1
    overpayment = client.post(f"/api/invoices/{invoice['id']}/payments", headers=headers, json={
        "amount": "400.00", "paid_on": date.today().isoformat(),
    })
    assert overpayment.status_code == 422

    other = client.post("/api/auth/register", json={"name": "Other Owner", "email": "invoices@example.com",
        "password": "another-strong-password", "business_name": "Other Workspace", "currency": "USD"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/invoices", headers=other_headers).json()["items"] == []
    assert client.get(f"/api/invoices/{invoice['id']}/payments", headers=other_headers).status_code == 404

    payable = client.post("/api/invoices", headers=headers, json={
        "direction": "payable", "invoice_number": "AP-1001", "counterparty": "Studio Rent Ltd",
        "issue_date": date.today().isoformat(), "due_date": due.isoformat(), "amount": "800.00",
        "category": "Rent", "account_id": account_id,
    })
    assert payable.status_code == 200, payable.text
    assert client.get("/api/analytics/overview", headers=headers).json()["kpis"]["accounts_payable"] == 800.0
    cash_after_invoice = client.get("/api/analytics/cash-flow?horizon=15", headers=headers).json()
    due_point = next(day for day in cash_after_invoice["days"] if day["date"] == due.isoformat())
    assert due_point["outflows"] >= 800.0
    soon = client.post("/api/invoices", headers=headers, json={
        "direction": "payable", "invoice_number": "AP-SOON", "counterparty": "Utilities Co",
        "issue_date": date.today().isoformat(), "due_date": (date.today() + timedelta(days=3)).isoformat(),
        "amount": "50.00", "category": "Utilities", "account_id": account_id,
    })
    assert soon.status_code == 200
    client.post("/api/insights/generate", headers=headers)
    notifications = client.get("/api/notifications", headers=headers).json()
    assert any("due in the next 7 days" in item["title"].lower() for item in notifications)


def test_forecast_snapshots_and_normalized_metrics_are_business_scoped(client: TestClient, account):
    headers = auth(account)
    today = date.today().isoformat()
    client.post("/api/transactions", headers=headers, json={"kind": "income", "category": "Sales Revenue",
        "amount": "123.45", "date": today, "description": "First sale", "status": "completed"})
    forecast = client.get("/api/forecasts/revenue?horizon=7", headers=headers)
    assert forecast.status_code == 200, forecast.text
    assert len(forecast.json()["predictions"]) == 7
    history = client.get("/api/forecasts/history?target=revenue", headers=headers)
    assert history.status_code == 200
    assert len(history.json()) == 1
    assert len(history.json()[0]["predictions"]) == 7
    assert history.json()[0]["selected_model"] == forecast.json()["selected_model"]
    cash_forecast = client.get("/api/forecasts/cash-flow?horizon=7", headers=headers)
    assert cash_forecast.status_code == 200, cash_forecast.text
    assert len(cash_forecast.json()["days"]) == 7
    client.post("/api/transactions", headers=headers, json={"kind": "income", "category": "Sales Revenue",
        "amount": "10000.00", "date": today, "description": "Large new sale", "status": "completed"})
    changed = client.post("/api/forecasts/generate", headers=headers,
                          json={"target": "revenue", "horizon": 7})
    assert changed.status_code == 200, changed.text
    notifications = client.get("/api/notifications", headers=headers).json()
    assert any("forecast changed significantly" in item["title"].lower() for item in notifications)

    other = client.post("/api/auth/register", json={"name": "Forecast Owner", "email": "forecast@example.com",
        "password": "another-strong-password", "business_name": "Forecast Workspace", "currency": "USD"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/forecasts/history", headers=other_headers).json() == []


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


def test_account_transfers_do_not_distort_revenue_or_expenses(client: TestClient, account):
    headers = auth(account)
    # Create Bank A and Bank B
    acc_a = client.post("/api/accounts", headers=headers, json={"name": "Bank Alpha", "account_type": "bank", "opening_balance": "5000.00"}).json()
    acc_b = client.post("/api/accounts", headers=headers, json={"name": "Bank Beta", "account_type": "bank", "opening_balance": "2000.00"}).json()

    today = date.today().isoformat()
    # Record income into Bank A
    client.post("/api/transactions", headers=headers, json={"kind": "income", "category": "Sales Revenue", "amount": "1000.00", "date": today, "account_id": acc_a["id"], "description": "Customer sale"})
    # Record transfer of 1500 from Bank A to Bank B
    transfer = client.post("/api/transactions", headers=headers, json={"kind": "transfer", "category": "Transfer", "amount": "1500.00", "date": today, "account_id": acc_a["id"], "to_account_id": acc_b["id"], "description": "Inter-account transfer"})
    assert transfer.status_code == 200, transfer.text
    assert transfer.json()["to_account_id"] == acc_b["id"]

    # Check accounts
    accounts = client.get("/api/accounts", headers=headers).json()
    alpha = next(a for a in accounts if a["id"] == acc_a["id"])
    beta = next(a for a in accounts if a["id"] == acc_b["id"])
    # Alpha: 5000 opening + 1000 income - 1500 transfer out = 4500
    assert alpha["current_balance"] == 4500.0
    # Beta: 2000 opening + 1500 transfer in = 3500
    assert beta["current_balance"] == 3500.0

    # Verify overview does not count transfer as revenue or expense
    overview = client.get("/api/analytics/overview?months=1", headers=headers).json()
    assert overview["kpis"]["revenue"] == 1000.0
    assert overview["kpis"]["expenses"] == 0.0
    assert overview["kpis"]["net_cash_flow"] == 1000.0


def test_bulk_transactions_operations(client: TestClient, account):
    headers = auth(account)
    today = date.today().isoformat()
    t1 = client.post("/api/transactions", headers=headers, json={"kind": "expense", "category": "Rent", "amount": "100.00", "date": today, "status": "completed"}).json()["id"]
    t2 = client.post("/api/transactions", headers=headers, json={"kind": "expense", "category": "Rent", "amount": "200.00", "date": today, "status": "completed"}).json()["id"]

    # Bulk update category
    cat_update = client.post("/api/transactions/bulk", headers=headers, json={"action": "update_category", "transaction_ids": [t1, t2], "category": "Utilities"})
    assert cat_update.status_code == 200
    assert cat_update.json()["affected"] == 2

    # Bulk delete
    del_res = client.post("/api/transactions/bulk", headers=headers, json={"action": "delete", "transaction_ids": [t1, t2]})
    assert del_res.status_code == 200
    assert del_res.json()["affected"] == 2


def test_accounts_receivable_and_payable_ageing_reports(client: TestClient, account):
    headers = auth(account)
    today = date.today()
    # Add an overdue receivable invoice (20 days past due) and a current one
    client.post("/api/invoices", headers=headers, json={
        "direction": "receivable", "invoice_number": "AR-OVERDUE", "counterparty": "Apex Corp",
        "issue_date": (today - timedelta(days=50)).isoformat(), "due_date": (today - timedelta(days=20)).isoformat(),
        "amount": "1500.00", "category": "Sales Revenue"
    })
    client.post("/api/invoices", headers=headers, json={
        "direction": "receivable", "invoice_number": "AR-CURRENT", "counterparty": "Apex Corp",
        "issue_date": today.isoformat(), "due_date": (today + timedelta(days=15)).isoformat(),
        "amount": "800.00", "category": "Sales Revenue"
    })

    # Query AR ageing
    ar = client.get("/api/invoices/receivables/ageing", headers=headers)
    assert ar.status_code == 200, ar.text
    ar_data = ar.json()
    assert ar_data["total_outstanding"] == 2300.0
    assert ar_data["total_overdue"] == 1500.0
    assert ar_data["buckets"]["days_1_30"] == 1500.0
    assert ar_data["buckets"]["current"] == 800.0
    assert len(ar_data["customers"]) == 1
    assert ar_data["customers"][0]["customer"] == "Apex Corp"


def test_cloud_synchronization_pull_and_push_with_idempotency(client: TestClient, account):
    headers = auth(account)
    # Check initial status
    status = client.get("/api/sync/status", headers=headers)
    assert status.status_code == 200, status.text

    # Push a mutation batch from client
    client_mut_id = "draft-uuid-001"
    push_payload = {
        "mutations": [
            {
                "client_mutation_id": client_mut_id,
                "entity_type": "transaction",
                "action": "create",
                "data": {
                    "kind": "income",
                    "category": "Sales Revenue",
                    "amount": 750.50,
                    "date": date.today().isoformat(),
                    "description": "Offline mobile sale",
                    "payment_method": "UPI",
                    "status": "completed",
                }
            }
        ]
    }
    push_res = client.post("/api/sync/push", headers=headers, json=push_payload)
    assert push_res.status_code == 200, push_res.text
    applied = push_res.json()["applied"]
    assert len(applied) == 1
    assert applied[0]["status"] == "created"

    # Idempotent push of same mutation should not create a duplicate
    push_retry = client.post("/api/sync/push", headers=headers, json=push_payload)
    assert push_retry.status_code == 200
    assert push_retry.json()["applied"][0]["status"] == "already_applied"

    # Pull changes
    pull_res = client.post("/api/sync/pull", headers=headers, json={"since_seq": 0})
    assert pull_res.status_code == 200, pull_res.text
    assert pull_res.json()["mode"] == "baseline"
    assert any(t["description"] == "Offline mobile sale" for t in pull_res.json()["data"]["transactions"])


def test_flexible_overview_date_filters_and_period_comparisons(client: TestClient, account):
    headers = auth(account)
    res_7d = client.get("/api/analytics/overview?preset=last_7_days", headers=headers)
    assert res_7d.status_code == 200
    assert res_7d.json()["period"]["preset"] == "last_7_days"
    assert "period_revenue_growth_pct" in res_7d.json()["kpis"]


