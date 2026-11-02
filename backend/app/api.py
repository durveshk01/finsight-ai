from __future__ import annotations

import csv
import io
import json
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .database import get_db
from .forecasting import forecast_daily
from .models import AuditLog, Business, BusinessMember, FinancialScenario, ForecastJob, ForecastRun, Notification, RecurringTransaction, Transaction, User
from .schemas import AuthIn, BusinessIn, BusinessOut, RecurringTransactionIn, RegisterIn, ScenarioIn, TransactionIn, TransactionOut, UserOut
from .security import create_token, current_user, hash_password, user_business, verify_password

router = APIRouter(prefix="/api")


def _business(user: User, db: Session, business_id: int | None) -> Business:
    return user_business(user, db, business_id)


def _decimal(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _month_start(months: int) -> date:
    today = date.today()
    month_index = today.year * 12 + today.month - 1 - max(months - 1, 0)
    year, zero_based_month = divmod(month_index, 12)
    return date(year, zero_based_month + 1, 1)


def _transactions(db: Session, business: Business, start: date | None = None, end: date | None = None,
                  statuses: tuple[str, ...] = ("completed",)) -> list[Transaction]:
    stmt = select(Transaction).where(Transaction.business_id == business.id, Transaction.status.in_(statuses))
    if start:
        stmt = stmt.where(Transaction.date >= start)
    if end:
        stmt = stmt.where(Transaction.date <= end)
    return list(db.scalars(stmt.order_by(Transaction.date, Transaction.id)))


def _serialize_transaction(t: Transaction) -> dict:
    return {"id": t.id, "business_id": t.business_id, "kind": t.kind, "category": t.category,
            "amount": float(t.amount), "date": t.date.isoformat(), "description": t.description,
            "payment_method": t.payment_method, "status": t.status, "reference": t.reference,
            "created_at": t.created_at.isoformat() if t.created_at else None}


def _audit(db: Session, user: User, business: Business, action: str, entity: str, entity_id: int | None, detail: dict) -> None:
    db.add(AuditLog(business_id=business.id, user_id=user.id, action=action, entity=entity, entity_id=entity_id,
                    detail_json=json.dumps(detail, default=str)))


def _next_occurrence(value: date, frequency: str) -> date:
    if frequency == "weekly":
        return value + timedelta(days=7)
    months = 1 if frequency == "monthly" else 3
    month_index = value.year * 12 + value.month - 1 + months
    year, month = divmod(month_index, 12)
    day = min(value.day, monthrange(year, month + 1)[1])
    return date(year, month + 1, day)


def _monthly(db: Session, business: Business, months: int = 6, kind: str | None = None) -> list[dict]:
    start_month = _month_start(months)
    rows = _transactions(db, business, start_month, date.today())
    totals: dict[str, dict[str, Decimal]] = {}
    cur = start_month
    for _ in range(months):
        key = cur.strftime("%Y-%m")
        totals[key] = {"income": Decimal("0"), "expense": Decimal("0")}
        next_month = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        cur = next_month
    for row in rows:
        key = row.date.strftime("%Y-%m")
        if key in totals and (kind is None or row.kind == kind):
            totals[key][row.kind] += row.amount
    return [{"month": key, "revenue": float(v["income"]), "expenses": float(v["expense"]),
             "net_cash_flow": float(v["income"] - v["expense"])} for key, v in totals.items()]


def _forecast_for(db: Session, business: Business, kind: str, horizon: int) -> dict:
    rows = _transactions(db, business, end=date.today(), statuses=("completed",))
    points = [(t.date, float(t.amount)) for t in rows if t.kind == kind]
    return forecast_daily(points, horizon)


def _current_cash(db: Session, business: Business) -> Decimal:
    rows = _transactions(db, business, end=date.today())
    net = sum((t.amount if t.kind == "income" else -t.amount for t in rows), Decimal("0"))
    return _decimal(business.opening_cash + net)


def _cash_projection(db: Session, business: Business, horizon: int = 90) -> dict:
    inc = _forecast_for(db, business, "income", horizon)
    out = _forecast_for(db, business, "expense", horizon)
    inflows = {p["date"]: p["value"] for p in inc["predictions"]}
    outflows = {p["date"]: p["value"] for p in out["predictions"]}
    future = _transactions(db, business, statuses=("scheduled", "pending"))
    obligations: dict[str, float] = {}
    known_items: set[tuple[str, str, str, str]] = set()
    for t in future:
        due = max(t.date, date.today() + timedelta(days=1))
        due_key = due.isoformat()
        obligations.setdefault(due_key, 0.0)
        obligations[due_key] += float(t.amount) * (1 if t.kind == "income" else -1)
        known_items.add((due_key, t.kind, str(_decimal(t.amount)), t.category.lower()))
    recurring_occurrences = 0
    recurring = db.scalars(select(RecurringTransaction).where(RecurringTransaction.business_id == business.id, RecurringTransaction.enabled.is_(True))).all()
    for item in recurring:
        due = item.next_date
        while due <= date.today():
            due = _next_occurrence(due, item.frequency)
        while due <= date.today() + timedelta(days=horizon) and (item.end_date is None or due <= item.end_date):
            key = due.isoformat()
            duplicate_key = (key, item.kind, str(_decimal(item.amount)), item.category.lower())
            if duplicate_key not in known_items:
                obligations[key] = obligations.get(key, 0.0) + float(item.amount) * (1 if item.kind == "income" else -1)
                recurring_occurrences += 1
            due = _next_occurrence(due, item.frequency)
    balance = float(_current_cash(db, business))
    current = balance
    lower_balance = balance
    upper_balance = balance
    income_points = {p["date"]: p for p in inc["predictions"]}
    expense_points = {p["date"]: p for p in out["predictions"]}
    points = []
    shortfall = ({"date": date.today().isoformat(), "amount_below_reserve": round(float(business.minimum_reserve) - balance, 2)}
                 if balance < float(business.minimum_reserve) else None)
    min_balance = balance
    for i in range(1, horizon + 1):
        day = date.today() + timedelta(days=i)
        key = day.isoformat()
        inflow = inflows.get(key, 0.0)
        outflow = outflows.get(key, 0.0)
        scheduled_net = obligations.get(key, 0.0)
        balance += inflow - outflow + scheduled_net
        lower_balance += income_points.get(key, {}).get("lower", inflow) - expense_points.get(key, {}).get("upper", outflow) + scheduled_net
        upper_balance += income_points.get(key, {}).get("upper", inflow) - expense_points.get(key, {}).get("lower", outflow) + scheduled_net
        min_balance = min(min_balance, balance)
        if shortfall is None and balance < float(business.minimum_reserve):
            shortfall = {"date": key, "amount_below_reserve": round(float(business.minimum_reserve) - balance, 2)}
        points.append({"date": key, "inflows": round(inflow + max(scheduled_net, 0), 2),
                       "outflows": round(outflow + max(-scheduled_net, 0), 2), "balance": round(balance, 2),
                       "lower_balance": round(lower_balance, 2), "upper_balance": round(upper_balance, 2)})
    return {"opening_balance": round(current, 2), "minimum_reserve": float(business.minimum_reserve),
            "minimum_expected_balance": round(min_balance, 2), "shortfall": shortfall, "days": points,
            "revenue_model": inc["selected_model"], "expense_model": out["selected_model"],
            "confirmed_obligations": len(future), "recurring_occurrences": recurring_occurrences}


def _insights(db: Session, business: Business) -> list[dict]:
    monthly = _monthly(db, business, 6)
    insights = []
    if len(monthly) >= 2:
        prev, latest = monthly[-2], monthly[-1]
        if prev["revenue"] > 0:
            change = (latest["revenue"] / prev["revenue"] - 1) * 100
            if abs(change) >= 8:
                down = change < 0
                insights.append({"title": "Revenue is declining" if down else "Revenue is growing",
                    "description": f"Revenue changed {abs(change):.1f}% from {prev['month']} to {latest['month']}.",
                    "supporting_figures": {"previous_month": prev["revenue"], "current_month": latest["revenue"], "change_pct": round(change, 1)},
                    "period": f"{prev['month']}–{latest['month']}", "severity": "warning" if down else "positive",
                    "recommended_action": "Review sales pipeline and collections." if down else "Protect capacity and working capital as demand grows.",
                    "reference": "Completed income transactions grouped by calendar month."})
    completed = _transactions(db, business, end=date.today())
    recent = [t for t in completed if t.date >= date.today() - timedelta(days=90) and t.kind == "expense"]
    total = sum((t.amount for t in recent), Decimal("0"))
    category_totals: dict[str, Decimal] = {}
    for t in recent:
        category_totals[t.category] = category_totals.get(t.category, Decimal("0")) + t.amount
    if total and category_totals:
        category, amount = max(category_totals.items(), key=lambda item: item[1])
        share = float(amount / total * 100)
        insights.append({"title": f"{category} is the largest expense", "description": f"{category} represents {share:.1f}% of expenses over the past 90 days.",
            "supporting_figures": {"category": category, "amount": float(amount), "share_pct": round(share, 1)},
            "period": "Last 90 days", "severity": "info", "recommended_action": "Review this category for supplier or usage savings.",
            "reference": "Category share = category spend / all completed spend, trailing 90 days."})
    current_30 = [t for t in completed if t.kind == "expense" and t.date >= date.today() - timedelta(days=30)]
    prior_30 = [t for t in completed if t.kind == "expense" and date.today() - timedelta(days=60) <= t.date < date.today() - timedelta(days=30)]
    current_by_category: dict[str, Decimal] = {}
    prior_by_category: dict[str, Decimal] = {}
    for t in current_30:
        current_by_category[t.category] = current_by_category.get(t.category, Decimal("0")) + t.amount
    for t in prior_30:
        prior_by_category[t.category] = prior_by_category.get(t.category, Decimal("0")) + t.amount
    for category, amount in current_by_category.items():
        previous_amount = prior_by_category.get(category, Decimal("0"))
        if previous_amount >= Decimal("1000") and amount >= previous_amount * Decimal("1.25"):
            increase = float((amount / previous_amount - 1) * 100)
            insights.append({"title": f"{category} spend increased", "description": f"{category} spend is up {increase:.1f}% over the prior 30 day period.",
                "supporting_figures": {"previous_30_days": float(previous_amount), "current_30_days": float(amount), "increase_pct": round(increase, 1)},
                "period": "Current 30 days vs previous 30 days", "severity": "warning",
                "recommended_action": "Review recent purchases and confirm whether the higher spend is planned.",
                "reference": "Completed expense totals grouped by category across adjacent 30 day windows."})
    projection = _cash_projection(db, business, 90)
    if projection["shortfall"]:
        s = projection["shortfall"]
        insights.append({"title": "Cash may fall below your reserve", "description": f"Projected balance is below the configured reserve by {business.currency} {s['amount_below_reserve']:,.0f} on {s['date']}.",
            "supporting_figures": s, "period": "Next 90 days", "severity": "critical", "recommended_action": "Accelerate collections, review discretionary spend, or arrange financing before the projected date.",
            "reference": "Daily cash projection uses historical forecast averages plus scheduled and pending transactions."})
    if not insights:
        insights.append({"title": "Financial data is ready for analysis", "description": "Continue recording transactions to build stronger trend signals.",
                         "supporting_figures": {"transaction_count": len(completed)}, "period": "Current", "severity": "info",
                         "recommended_action": "Import recent bank or accounting transactions.", "reference": "Rule based insight engine."})
    return insights


@router.post("/auth/register")
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, name=payload.name.strip(), password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    business = Business(name=payload.business_name.strip(), currency=payload.currency.upper(), opening_cash=0, minimum_reserve=100000)
    db.add(business)
    db.flush()
    db.add(BusinessMember(user_id=user.id, business_id=business.id, role="owner"))
    db.commit()
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": UserOut.model_validate(user), "business": BusinessOut.model_validate(business)}


@router.post("/auth/login")
def login(payload: AuthIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    businesses = db.scalars(select(Business).join(BusinessMember).where(BusinessMember.user_id == user.id).order_by(Business.id)).all()
    return {"access_token": create_token(user.id), "token_type": "bearer", "user": UserOut.model_validate(user),
            "businesses": [BusinessOut.model_validate(b) for b in businesses]}


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/businesses", response_model=list[BusinessOut])
def list_businesses(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Business).join(BusinessMember).where(BusinessMember.user_id == user.id).order_by(Business.id)).all()


@router.get("/businesses/{business_id}", response_model=BusinessOut)
def get_business(business_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _business(user, db, business_id)


@router.post("/businesses", response_model=BusinessOut)
def create_business(payload: BusinessIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    business = Business(**payload.model_dump())
    db.add(business)
    db.flush()
    db.add(BusinessMember(user_id=user.id, business_id=business.id, role="owner"))
    db.commit()
    db.refresh(business)
    return business


@router.patch("/businesses/current", response_model=BusinessOut)
def update_business(payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    for key in ("name", "currency", "minimum_reserve", "opening_cash"):
        if key in payload:
            setattr(business, key, payload[key])
    db.commit()
    db.refresh(business)
    return business


@router.get("/transactions")
def list_transactions(user: User = Depends(current_user), db: Session = Depends(get_db),
                      x_business_id: int | None = Header(default=None), search: str = "", kind: str | None = None,
                      category: str | None = None, status: str | None = None, start: date | None = None, end: date | None = None,
                      sort: str = "date", direction: str = "desc", page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200)):
    business = _business(user, db, x_business_id)
    stmt = select(Transaction).where(Transaction.business_id == business.id)
    if kind in ("income", "expense"):
        stmt = stmt.where(Transaction.kind == kind)
    if category:
        stmt = stmt.where(Transaction.category == category)
    if status:
        stmt = stmt.where(Transaction.status == status)
    if start:
        stmt = stmt.where(Transaction.date >= start)
    if end:
        stmt = stmt.where(Transaction.date <= end)
    if search:
        needle = f"%{search[:100]}%"
        stmt = stmt.where(or_(Transaction.description.ilike(needle), Transaction.category.ilike(needle), Transaction.reference.ilike(needle)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    column = getattr(Transaction, sort, Transaction.date)
    stmt = stmt.order_by(column.asc() if direction == "asc" else column.desc(), Transaction.id.desc()).offset((page - 1) * limit).limit(limit)
    return {"items": [_serialize_transaction(t) for t in db.scalars(stmt)], "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit}


@router.post("/transactions")
def create_transaction(payload: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = Transaction(business_id=business.id, **payload.model_dump())
    db.add(row)
    db.flush()
    _audit(db, user, business, "create", "transaction", row.id, _serialize_transaction(row))
    db.commit()
    db.refresh(row)
    return _serialize_transaction(row)


@router.put("/transactions/{transaction_id}")
def update_transaction(transaction_id: int, payload: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    before = _serialize_transaction(row)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.flush()
    _audit(db, user, business, "update", "transaction", row.id, {"before": before, "after": _serialize_transaction(row)})
    db.commit()
    db.refresh(row)
    return _serialize_transaction(row)


@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    _audit(db, user, business, "delete", "transaction", row.id, _serialize_transaction(row))
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.get("/recurring")
def list_recurring(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(RecurringTransaction).where(RecurringTransaction.business_id == business.id).order_by(RecurringTransaction.next_date)).all()
    return [{"id": row.id, "kind": row.kind, "category": row.category, "amount": float(row.amount), "frequency": row.frequency,
             "next_date": row.next_date.isoformat(), "end_date": row.end_date.isoformat() if row.end_date else None,
             "description": row.description, "payment_method": row.payment_method, "enabled": row.enabled} for row in rows]


@router.post("/recurring")
def create_recurring(payload: RecurringTransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    if payload.end_date and payload.end_date < payload.next_date:
        raise HTTPException(422, "End date must be on or after the first due date")
    row = RecurringTransaction(business_id=business.id, **payload.model_dump())
    db.add(row)
    db.flush()
    _audit(db, user, business, "create", "recurring_transaction", row.id, {"category": row.category, "amount": str(row.amount), "frequency": row.frequency})
    db.commit()
    db.refresh(row)
    return {"id": row.id, "kind": row.kind, "category": row.category, "amount": float(row.amount), "frequency": row.frequency,
            "next_date": row.next_date.isoformat(), "end_date": row.end_date.isoformat() if row.end_date else None,
            "description": row.description, "payment_method": row.payment_method, "enabled": row.enabled}


@router.patch("/recurring/{recurring_id}")
def update_recurring(recurring_id: int, payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Recurring transaction not found")
    if "enabled" in payload:
        row.enabled = bool(payload["enabled"])
    if "next_date" in payload:
        row.next_date = date.fromisoformat(payload["next_date"])
    if "end_date" in payload:
        row.end_date = date.fromisoformat(payload["end_date"]) if payload["end_date"] else None
    _audit(db, user, business, "update", "recurring_transaction", row.id, {"enabled": row.enabled, "next_date": row.next_date.isoformat()})
    db.commit()
    return {"id": row.id, "enabled": row.enabled, "next_date": row.next_date.isoformat()}


@router.delete("/recurring/{recurring_id}")
def delete_recurring(recurring_id: int, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Recurring transaction not found")
    _audit(db, user, business, "delete", "recurring_transaction", row.id, {"category": row.category, "amount": str(row.amount)})
    db.delete(row)
    db.commit()
    return {"deleted": True}


def _read_upload(file: UploadFile) -> list[dict]:
    if not file.filename or Path(file.filename).suffix.lower() not in {".csv", ".xlsx", ".xls"}:
        raise HTTPException(415, "Upload a CSV or Excel file")
    raw = file.file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File is larger than 10 MB")
    try:
        frame = pd.read_excel(io.BytesIO(raw)) if Path(file.filename).suffix.lower() != ".csv" else pd.read_csv(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(400, f"Could not read file: {exc}") from exc
    normalized = {str(c).strip().lower().replace(" ", "_"): c for c in frame.columns}
    def col(*options):
        return next((normalized[o] for o in options if o in normalized), None)
    date_col, amount_col, kind_col, cat_col = col("date", "transaction_date"), col("amount", "value"), col("type", "kind"), col("category")
    if not date_col or not amount_col:
        raise HTTPException(422, "Columns named date and amount are required; type and category are optional")
    rows, errors = [], []
    for line, record in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            when = pd.to_datetime(record[date_col], errors="raise").date()
            amount = _decimal(record[amount_col])
            if amount <= 0:
                raise ValueError("amount must be greater than zero")
            typ = str(record[kind_col]).lower().strip() if kind_col and pd.notna(record.get(kind_col)) else "expense"
            typ = "income" if typ in ("income", "revenue", "credit", "inflow") else "expense"
            category = str(record[cat_col]).strip() if cat_col and pd.notna(record.get(cat_col)) else ("Other Income" if typ == "income" else "Other Expenses")
            desc_col = col("description", "memo", "note")
            rows.append({"date": when.isoformat(), "amount": str(amount), "kind": typ, "category": category,
                         "description": str(record.get(desc_col, "") or "")[:240], "status": "completed", "payment_method": "Imported"})
        except Exception as exc:
            errors.append({"line": line, "error": str(exc)})
    return [{"rows": rows, "errors": errors, "valid_count": len(rows), "invalid_count": len(errors)}]


@router.post("/transactions/import/preview")
def preview_import(file: UploadFile = File(...), user: User = Depends(current_user)):
    return _read_upload(file)[0]


@router.post("/transactions/import/confirm")
def confirm_import(payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = payload.get("rows", [])
    if len(rows) > 10000:
        raise HTTPException(413, "A single import is limited to 10,000 rows")
    existing = {(t.date.isoformat(), t.kind, str(_decimal(t.amount)), t.category.lower()) for t in _transactions(db, business, statuses=("completed", "pending", "scheduled"))}
    inserted, duplicates, errors = 0, 0, []
    for idx, row in enumerate(rows, start=1):
        try:
            item = TransactionIn.model_validate(row)
            key = (item.date.isoformat(), item.kind, str(item.amount.quantize(Decimal("0.01"))), item.category.lower())
            if key in existing:
                duplicates += 1
                continue
            existing.add(key)
            db.add(Transaction(business_id=business.id, **item.model_dump()))
            inserted += 1
        except Exception as exc:
            errors.append({"row": idx, "error": str(exc)})
    db.commit()
    return {"imported": inserted, "duplicates": duplicates, "errors": errors}


@router.get("/transactions/template.csv")
def transaction_template():
    content = "date,amount,type,category,description\n2026-01-15,25000,income,Sales Revenue,Sample customer payment\n2026-01-16,12000,expense,Salaries,Monthly salary\n"
    return StreamingResponse(io.BytesIO(content.encode()), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=finsight-transactions-template.csv"})


@router.get("/transactions/template.xlsx")
def transaction_template_xlsx():
    output = io.BytesIO()
    frame = pd.DataFrame([{"date": "2026-01-15", "amount": "25000.00", "type": "income", "category": "Sales Revenue", "description": "Sample customer payment"},
                          {"date": "2026-01-16", "amount": "12000.00", "type": "expense", "category": "Salaries", "description": "Monthly salary"}])
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        frame.to_excel(writer, index=False, sheet_name="Transactions")
    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=finsight-transactions-template.xlsx"})


@router.get("/analytics/overview")
def overview(months: int = Query(6, ge=1, le=24), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    series = _monthly(db, business, months)
    all_rows = _transactions(db, business, end=date.today())
    window_rows = all_rows[-999999:]
    now = date.today()
    start = _month_start(months)
    selected = [t for t in window_rows if t.date >= start]
    rev = sum((t.amount for t in selected if t.kind == "income"), Decimal("0"))
    exp = sum((t.amount for t in selected if t.kind == "expense"), Decimal("0"))
    cash = _current_cash(db, business)
    recent90 = [t for t in all_rows if t.date >= now - timedelta(days=90)]
    burn = (sum((t.amount for t in recent90 if t.kind == "expense"), Decimal("0")) - sum((t.amount for t in recent90 if t.kind == "income"), Decimal("0"))) / Decimal("90")
    runway = float(cash / burn) if burn > 0 else None
    pending = _transactions(db, business, statuses=("pending", "scheduled"))
    receivables = sum((t.amount for t in pending if t.kind == "income"), Decimal("0"))
    payables = sum((t.amount for t in pending if t.kind == "expense"), Decimal("0"))
    categories: dict[str, Decimal] = {}
    for t in selected:
        if t.kind == "expense":
            categories[t.category] = categories.get(t.category, Decimal("0")) + t.amount
    prev = series[-2] if len(series) > 1 else None
    last = series[-1] if series else None
    growth = ((last["revenue"] / prev["revenue"] - 1) * 100) if prev and prev["revenue"] else 0
    expenses_growth = ((last["expenses"] / prev["expenses"] - 1) * 100) if prev and prev["expenses"] else 0
    return {"business": {"id": business.id, "name": business.name, "currency": business.currency, "is_demo": business.is_demo,
                          "minimum_reserve": str(business.minimum_reserve), "opening_cash": str(business.opening_cash)},
        "period": {"months": months, "start": start.isoformat(), "end": now.isoformat()},
        "kpis": {"revenue": float(rev), "expenses": float(exp), "net_cash_flow": float(rev-exp), "current_cash": float(cash),
                 "profit_margin_pct": None, "cash_margin_pct": float((rev-exp) / rev * 100) if rev else 0, "cash_runway_days": runway,
                 "monthly_revenue_growth_pct": growth, "monthly_expense_growth_pct": expenses_growth,
                 "expense_to_revenue_pct": float(exp / rev * 100) if rev else 0, "accounts_receivable": float(receivables),
                 "accounts_payable": float(payables), "working_capital": float(cash + receivables - payables),
                 "average_monthly_burn": float(max(Decimal("0"), burn) * Decimal("30"))},
        "monthly": series, "expense_categories": [{"category": k, "amount": float(v), "share_pct": float(v / exp * 100) if exp else 0} for k, v in sorted(categories.items(), key=lambda x: x[1], reverse=True)],
        "recent_transactions": [_serialize_transaction(t) for t in sorted(all_rows, key=lambda r: (r.date, r.id), reverse=True)[:8]],
        "upcoming_obligations": [_serialize_transaction(t) for t in sorted(pending, key=lambda r: r.date)[:8]], "insights": _insights(db, business)}


@router.get("/analytics/revenue")
def revenue_analytics(months: int = Query(12, ge=1, le=36), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    data = _monthly(db, business, months)
    return {"series": [{"month": x["month"], "revenue": x["revenue"]} for x in data], "growth": [
        {"month": data[i]["month"], "growth_pct": round((data[i]["revenue"] / data[i-1]["revenue"] - 1) * 100, 2) if data[i-1]["revenue"] else None} for i in range(1, len(data))]}


@router.get("/analytics/expenses")
def expense_analytics(months: int = Query(12, ge=1, le=36), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    start = _month_start(months)
    rows = [t for t in _transactions(db, business, start, date.today()) if t.kind == "expense"]
    by_category: dict[str, Decimal] = {}
    by_month: dict[str, Decimal] = {}
    for row in rows:
        by_category[row.category] = by_category.get(row.category, Decimal("0")) + row.amount
        key = row.date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, Decimal("0")) + row.amount
    total = sum(by_category.values(), Decimal("0"))
    return {"categories": [{"category": k, "amount": float(v), "share_pct": float(v / total * 100) if total else 0} for k, v in sorted(by_category.items(), key=lambda x: x[1], reverse=True)],
            "monthly": [{"month": k, "expenses": float(v)} for k, v in sorted(by_month.items())], "total": float(total)}


@router.get("/analytics/cash-flow")
def cash_flow_analytics(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None), horizon: int = Query(90, ge=7, le=365)):
    business = _business(user, db, x_business_id)
    return _cash_projection(db, business, horizon)


@router.get("/risk")
def financial_risk(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    monthly = _monthly(db, business, 6)
    current_cash = float(_current_cash(db, business))
    rows = _transactions(db, business, start=date.today() - timedelta(days=90), end=date.today())
    income = sum(float(t.amount) for t in rows if t.kind == "income")
    expenses = sum(float(t.amount) for t in rows if t.kind == "expense")
    monthly_burn = max(0.0, (expenses - income) / 3)
    coverage = current_cash / max(monthly_burn, 1.0)
    revenue_growth = ((monthly[-1]["revenue"] / monthly[-2]["revenue"] - 1) * 100
                      if len(monthly) > 1 and monthly[-2]["revenue"] else 0.0)
    six_month_revenue = sum(x["revenue"] for x in monthly)
    six_month_expenses = sum(x["expenses"] for x in monthly)
    cash_margin = (six_month_revenue - six_month_expenses) / six_month_revenue * 100 if six_month_revenue else 0.0
    cash = _cash_projection(db, business, 90)
    deductions = {"cash_coverage": 30 if coverage < 1 else 16 if coverage < 2 else 0,
                  "profitability": 30 if cash_margin < 0 else 15 if cash_margin < 10 else 0,
                  "reserve_breach": 25 if cash["shortfall"] else 0,
                  "revenue_decline": 15 if revenue_growth < -10 else 0}
    score = max(0, min(100, 100 - sum(deductions.values())))
    return {"score": score, "category": "healthy" if score >= 80 else "monitor" if score >= 55 else "elevated_risk",
            "indicators": {"cash_coverage_months": round(coverage, 2), "cash_margin_pct": round(cash_margin, 2),
                           "reserve_breach": cash["shortfall"], "monthly_revenue_growth_pct": round(revenue_growth, 2)},
            "deductions": deductions, "methodology": "Starts at 100 and deducts the documented thresholds in deductions. This is an operational warning indicator, not a credit rating."}


@router.post("/forecasts/train")
def train_forecasts(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    results = {}
    for kind, label in (("income", "revenue"), ("expense", "expenses")):
        result = _forecast_for(db, business, kind, 30)
        run = ForecastRun(business_id=business.id, target=label, selected_model=result["selected_model"],
                          training_start=date.fromisoformat(result["training_start"]) if result["training_start"] else None,
                          training_end=date.fromisoformat(result["training_end"]) if result["training_end"] else None,
                          metrics_json=json.dumps(result["metrics"]))
        db.add(run)
        results[label] = result
    db.commit()
    return {"revenue": results["revenue"], "expenses": results["expenses"], "generated_at": datetime.utcnow().isoformat() + "Z"}


@router.post("/forecasts/train/async", status_code=202)
def train_forecasts_async(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    try:
        from .tasks import train_forecasts as forecast_task
        task = forecast_task.delay(business.id)
    except Exception as exc:
        raise HTTPException(503, "Forecast worker is unavailable. Start Redis and the Celery worker, or use the synchronous train route.") from exc
    db.add(ForecastJob(task_id=task.id, business_id=business.id))
    db.commit()
    return {"task_id": task.id, "status": "queued"}


@router.get("/forecasts/tasks/{task_id}")
def forecast_task_status(task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    job = db.scalar(select(ForecastJob).where(ForecastJob.task_id == task_id, ForecastJob.business_id == business.id))
    if not job:
        raise HTTPException(404, "Forecast task not found")
    try:
        from .tasks import celery_app
        result = celery_app.AsyncResult(task_id)
        if result.ready() and result.successful():
            return {"task_id": task_id, "status": "completed", "result": result.result}
        if result.failed():
            return {"task_id": task_id, "status": "failed", "error": str(result.result)}
        return {"task_id": task_id, "status": result.state.lower()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Forecast task status is unavailable") from exc


@router.get("/forecasts/models")
def forecast_models(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(ForecastRun).where(ForecastRun.business_id == business.id).order_by(ForecastRun.created_at.desc()).limit(20)).all()
    return [{"target": r.target, "selected_model": r.selected_model, "training_start": r.training_start.isoformat() if r.training_start else None,
             "training_end": r.training_end.isoformat() if r.training_end else None, "metrics": json.loads(r.metrics_json),
             "generated_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


@router.get("/forecasts/{target}")
def forecast_target(target: str, horizon: int = Query(30, ge=7, le=365), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    if target not in ("revenue", "expenses"):
        raise HTTPException(404, "Forecast target must be revenue or expenses")
    business = _business(user, db, x_business_id)
    kind = "income" if target == "revenue" else "expense"
    result = _forecast_for(db, business, kind, horizon)
    run = ForecastRun(business_id=business.id, target=target, selected_model=result["selected_model"],
                      training_start=date.fromisoformat(result["training_start"]) if result["training_start"] else None,
                      training_end=date.fromisoformat(result["training_end"]) if result["training_end"] else None,
                      metrics_json=json.dumps(result["metrics"]))
    db.add(run)
    db.commit()
    return result


@router.get("/forecasts/expenses/categories")
def category_forecasts(horizon: int = Query(30, ge=7, le=365), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = [t for t in _transactions(db, business, end=date.today()) if t.kind == "expense"]
    categories = sorted({t.category for t in rows})
    data = []
    for category in categories:
        result = forecast_daily([(t.date, float(t.amount)) for t in rows if t.category == category], horizon, simple=True)
        data.append({"category": category, "forecast_total": round(sum(p["value"] for p in result["predictions"]), 2), "model": result["selected_model"], "predictions": result["predictions"]})
    return {"categories": sorted(data, key=lambda item: item["forecast_total"], reverse=True)}


@router.get("/forecasts/cash-flow")
def forecast_cash(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None), horizon: int = Query(90, ge=7, le=365)):
    business = _business(user, db, x_business_id)
    return _cash_projection(db, business, horizon)


@router.post("/scenarios")
def save_scenario(payload: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    values = payload.model_dump()
    row = FinancialScenario(business_id=business.id, name=values.pop("name"), assumptions=json.dumps(values, default=str))
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "assumptions": json.loads(row.assumptions), "created_at": row.created_at.isoformat() if row.created_at else None}


@router.get("/scenarios")
def list_scenarios(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(FinancialScenario).where(FinancialScenario.business_id == business.id).order_by(FinancialScenario.created_at.desc())).all()
    return [{"id": r.id, "name": r.name, "assumptions": json.loads(r.assumptions), "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


def _simulate(db: Session, business: Business, values: dict, name: str) -> dict:
    monthly = _monthly(db, business, 6)
    latest = monthly[-1] if monthly else {"revenue": 0, "expenses": 0}
    current_month = latest.get("month")
    recent = [t for t in _transactions(db, business, end=date.today()) if t.date.strftime("%Y-%m") == current_month]
    categories: dict[str, float] = {}
    for transaction in recent:
        if transaction.kind == "expense":
            categories[transaction.category.lower()] = categories.get(transaction.category.lower(), 0.0) + float(transaction.amount)
    revenue = latest["revenue"] * (1 + float(values.get("revenue_change_pct", 0)) / 100) + float(values.get("new_monthly_revenue", 0))
    expenses = latest["expenses"] * (1 + float(values.get("expense_change_pct", 0)) / 100)
    expenses -= categories.get("marketing", 0.0) * float(values.get("marketing_reduction_pct", 0)) / 100
    expenses += categories.get("salaries", 0.0) * float(values.get("salary_increase_pct", 0)) / 100
    expenses += categories.get("inventory", 0.0) * float(values.get("inventory_increase_pct", 0)) / 100
    expenses += float(values.get("new_hire_monthly_cost", 0)) + float(values.get("campaign_monthly_cost", 0)) + float(values.get("additional_loan_payment", 0))
    expenses = max(0.0, expenses)
    one_time = float(values.get("one_time_cost", 0)) + float(values.get("capital_investment", 0))
    loan_proceeds = float(values.get("loan_proceeds", 0))
    horizon = int(values.get("horizon_months", 6))
    net = revenue - expenses
    cash = float(_current_cash(db, business)) + loan_proceeds
    closing = cash + net * horizon - one_time
    runway = cash / max(expenses - revenue, 1) * 30 if expenses > revenue else None
    return {"name": name, "monthly_revenue": round(revenue, 2), "monthly_expenses": round(expenses, 2), "monthly_net_cash_flow": round(net, 2),
            "closing_cash": round(closing, 2), "cash_runway_days": round(runway, 1) if runway else None,
            "risk": "high" if closing < float(business.minimum_reserve) else "moderate" if closing < float(business.minimum_reserve) * 1.5 else "low",
            "horizon_months": horizon}


@router.post("/scenarios/{scenario_id}/simulate")
def simulate_saved(scenario_id: int, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(FinancialScenario).where(FinancialScenario.id == scenario_id, FinancialScenario.business_id == business.id))
    if not row:
        raise HTTPException(404, "Scenario not found")
    return _simulate(db, business, json.loads(row.assumptions), row.name)


@router.post("/scenarios/simulate")
def simulate(payload: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    values = payload.model_dump()
    return _simulate(db, business, values, values["name"])


@router.get("/scenarios/compare")
def compare_scenarios(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    presets = [("Baseline", 0, 0), ("Optimistic", 15, -5), ("Pessimistic", -20, 12)]
    results = [_simulate(db, business, {"revenue_change_pct": r, "expense_change_pct": e, "horizon_months": 6}, name) for name, r, e in presets]
    saved = list_scenarios(user, db, x_business_id)
    results.extend(_simulate(db, business, {**r["assumptions"], "horizon_months": r["assumptions"].get("horizon_months", 6)}, r["name"]) for r in saved)
    return {"scenarios": results}


@router.get("/insights")
def get_insights(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    return _insights(db, _business(user, db, x_business_id))


@router.post("/insights/generate")
def generate_insights(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    items = _insights(db, business)
    for item in items:
        exists = db.scalar(select(Notification).where(Notification.business_id == business.id, Notification.title == item["title"], Notification.is_read.is_(False)))
        if not exists and item["severity"] in ("critical", "warning"):
            db.add(Notification(business_id=business.id, title=item["title"], message=item["description"], severity=item["severity"]))
    db.commit()
    return {"insights": items}


@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(Notification).where(Notification.business_id == business.id).order_by(Notification.created_at.desc()).limit(100)).all()
    return [{"id": r.id, "title": r.title, "message": r.message, "severity": r.severity, "is_read": r.is_read,
             "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows]


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    row = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.business_id == business.id))
    if not row:
        raise HTTPException(404, "Notification not found")
    row.is_read = True
    db.commit()
    return {"updated": True}


@router.post("/reports/generate")
def generate_report(payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    fmt = payload.get("format", "csv").lower()
    months = min(max(int(payload.get("months", 12)), 1), 36)
    start = _month_start(months)
    rows = _transactions(db, business, start, date.today())
    output = io.BytesIO()
    if fmt == "csv":
        text = io.StringIO()
        writer = csv.DictWriter(text, fieldnames=["Date", "Type", "Category", "Description", "Amount", "Status", "Payment method"])
        writer.writeheader()
        for t in rows:
            writer.writerow({"Date": t.date.isoformat(), "Type": t.kind, "Category": t.category, "Description": t.description, "Amount": str(t.amount), "Status": t.status, "Payment method": t.payment_method})
        output.write(text.getvalue().encode("utf-8-sig"))
        mime, extension = "text/csv", "csv"
    elif fmt == "xlsx":
        frame = pd.DataFrame([{"Date": t.date.isoformat(), "Type": t.kind, "Category": t.category, "Description": t.description, "Amount": float(t.amount), "Status": t.status, "Payment method": t.payment_method} for t in rows])
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            frame.to_excel(writer, index=False, sheet_name="Transactions")
            pd.DataFrame(_monthly(db, business, months)).to_excel(writer, index=False, sheet_name="Monthly summary")
        mime, extension = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    elif fmt == "pdf":
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet
        doc = SimpleDocTemplate(output, pagesize=landscape(A4))
        styles = getSampleStyleSheet()
        monthly = _monthly(db, business, months)
        data = [["Month", "Revenue", "Expenses", "Net cash flow"]] + [[x["month"], f"{x['revenue']:,.2f}", f"{x['expenses']:,.2f}", f"{x['net_cash_flow']:,.2f}"] for x in monthly]
        table = Table(data, repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#102d25")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), .3, colors.HexColor("#dbe4df")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7f5")]), ("PADDING", (0, 0), (-1, -1), 8)]))
        doc.build([Paragraph(f"{business.name} · Financial report", styles["Title"]), Paragraph(f"Period: {start.isoformat()} to {date.today().isoformat()} · Currency: {business.currency}", styles["Normal"]), Spacer(1, 18), table])
        mime, extension = "application/pdf", "pdf"
    else:
        raise HTTPException(422, "format must be csv, xlsx, or pdf")
    output.seek(0)
    return StreamingResponse(output, media_type=mime, headers={"Content-Disposition": f"attachment; filename=finsight-{business.id}-report.{extension}"})


@router.get("/health")
def api_health():
    return {"status": "ok", "service": "finsight-api"}

