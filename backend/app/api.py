from __future__ import annotations

import csv
import io
import json
import hashlib
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .forecasting import forecast_daily
from .models import (Account, AuditLog, Business, BusinessMember, FinancialForecast, FinancialInsight, FinancialScenario,
                     ForecastJob, ForecastMetric, ForecastRun, Invoice, Notification, Payable, Payment, Receivable,
                     RecurringTransaction, ReportRun, ScenarioAssumption, SyncChange, Transaction, TransactionCategory, User)
from .schemas import (AccountIn, AuthIn, BulkTransactionIn, BusinessIn, BusinessMemberIn, BusinessMemberRoleIn, BusinessOut, CategoryIn,
                      ForecastGenerateIn, InvoiceIn, InvoicePaymentIn,
                      RecurringTransactionIn, RegisterIn, ReportIn, ScenarioIn, SyncMutation, SyncPullIn, SyncPushIn, TransactionIn, TransactionOut, UserOut)
from .security import create_token, current_user, hash_password, user_business, verify_password

router = APIRouter(prefix="/api")


def _business(user: User, db: Session, business_id: int | None) -> Business:
    return user_business(user, db, business_id)


def _lock_business(db: Session, business: Business) -> None:
    # All financial writers acquire this tenant lock first. A no-op UPDATE also
    # reserves SQLite's writer lock, unlike SELECT FOR UPDATE (ignored there).
    db.execute(update(Business).where(Business.id == business.id).values(sync_seq=Business.sync_seq),
               execution_options={"synchronize_session": False})
    db.refresh(business)


def _require_write_access(user: User, db: Session, business: Business) -> None:
    _lock_business(db, business)
    role = _membership_role(user, db, business)
    if role not in {"owner", "admin", "accountant"}:
        raise HTTPException(403, "This workspace role can view financial data but cannot make changes")


def _membership_role(user: User, db: Session, business: Business) -> str | None:
    return db.scalar(select(BusinessMember.role).where(BusinessMember.user_id == user.id,
                                                       BusinessMember.business_id == business.id))


def _require_owner(user: User, db: Session, business: Business) -> None:
    _lock_business(db, business)
    if _membership_role(user, db, business) != "owner":
        raise HTTPException(403, "Only workspace owners can manage team access")


def _decimal(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _metric_decimal(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.0001"))


DEFAULT_CATEGORIES = {
    "income": ("Sales Revenue", "Service Revenue", "Interest Income", "Investment Income", "Other Income"),
    "expense": ("Salaries", "Rent", "Utilities", "Marketing", "Inventory", "Transportation",
                "Software Subscriptions", "Taxes", "Loan Repayments", "Maintenance", "Other Expenses"),
}


def _ensure_category(db: Session, business: Business, kind: str, name: str) -> TransactionCategory:
    cleaned = name.strip()
    cat_kind = "expense" if kind == "transfer" else kind
    row = db.scalar(select(TransactionCategory).where(TransactionCategory.business_id == business.id,
                                                       TransactionCategory.kind == cat_kind,
                                                       func.lower(TransactionCategory.name) == cleaned.lower()))
    if row:
        return row
    row = TransactionCategory(business_id=business.id, kind=cat_kind, name=cleaned,
                              is_system=cleaned in DEFAULT_CATEGORIES.get(cat_kind, ()))
    db.add(row)
    db.flush()
    return row


def _ensure_default_categories(db: Session, business: Business) -> None:
    for kind, names in DEFAULT_CATEGORIES.items():
        for name in names:
            _ensure_category(db, business, kind, name)


def _owned_account(db: Session, business: Business, account_id: int | None) -> Account | None:
    if account_id is None:
        return None
    account = db.scalar(select(Account).where(Account.id == account_id, Account.business_id == business.id,
                                               Account.is_active.is_(True)))
    if not account:
        raise HTTPException(404, "Account not found in this business")
    if account.currency != business.currency:
        raise HTTPException(422, "Account currency must match the workspace; currency conversion is not supported")
    return account


def _invoice_out(row: Invoice) -> dict:
    remaining = _decimal(row.amount - row.amount_paid)
    status = row.status
    if status != "paid" and row.due_date < date.today():
        status = "overdue"
    return {"id": row.id, "business_id": row.business_id, "direction": row.direction,
            "invoice_number": row.invoice_number, "counterparty": row.counterparty,
            "issue_date": row.issue_date.isoformat(), "due_date": row.due_date.isoformat(),
            "amount": float(row.amount), "amount_paid": float(row.amount_paid), "amount_due": float(remaining),
            "currency": row.currency, "category": row.category, "account_id": row.account_id,
            "status": status, "description": row.description,
            "created_at": row.created_at.isoformat() if row.created_at else None}


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
            "account_id": t.account_id, "to_account_id": getattr(t, "to_account_id", None),
            "category_id": t.category_id, "invoice_id": t.invoice_id,
            "created_at": t.created_at.isoformat() if t.created_at else None}


def _record_sync_change(db: Session, business: Business, entity_type: str, entity_id: int, action: str, detail: dict, client_mutation_id: str | None = None) -> SyncChange:
    seq = db.execute(update(Business).where(Business.id == business.id)
                     .values(sync_seq=Business.sync_seq + 1).returning(Business.sync_seq)).scalar_one()
    change = SyncChange(
        business_id=business.id,
        seq_num=seq,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        client_mutation_id=client_mutation_id,
        data_json=json.dumps(detail, default=str),
    )
    db.add(change)
    db.flush()
    return change


def _audit(db: Session, user: User, business: Business, action: str, entity: str, entity_id: int | None, detail: dict, client_mutation_id: str | None = None) -> None:
    db.add(AuditLog(business_id=business.id, user_id=user.id, action=action, entity=entity, entity_id=entity_id,
                    detail_json=json.dumps(detail, default=str)))
    if entity_id is not None:
        _record_sync_change(db, business, entity, entity_id, action, detail, client_mutation_id)


def _business_out(business: Business) -> dict:
    return {"id": business.id, "name": business.name, "currency": business.currency,
            "opening_cash": float(business.opening_cash), "minimum_reserve": float(business.minimum_reserve), "is_demo": business.is_demo}


def _account_out(account: Account) -> dict:
    return {"id": account.id, "name": account.name, "account_type": account.account_type,
            "currency": account.currency, "opening_balance": float(account.opening_balance), "is_active": account.is_active}


def _validated(model, data):
    try:
        return model.model_validate(data)
    except ValidationError as error:
        raise HTTPException(422, error.errors()[0]["msg"]) from None


def _update_business_data(db: Session, user: User, business: Business, data: dict, mutation_id: str | None = None) -> dict:
    if _membership_role(user, db, business) != "owner":
        raise HTTPException(403, "Only workspace owners can change business settings")
    payload = _validated(BusinessIn, {**_business_out(business), **data})
    if payload.currency != business.currency and any(db.scalar(select(model.id).where(model.business_id == business.id).limit(1))
                                                    for model in (Transaction, Invoice, Account)):
        raise HTTPException(409, "Currency cannot change after accounts or financial records have been created")
    for key, value in payload.model_dump().items():
        setattr(business, key, value)
    db.flush()
    record = _business_out(business)
    _audit(db, user, business, "update", "business", business.id, record, mutation_id)
    return record


def _save_transaction(db: Session, user: User, business: Business, payload: TransactionIn,
                      row: Transaction | None = None, mutation_id: str | None = None) -> Transaction:
    if row and db.scalar(select(Payment.id).where(Payment.transaction_id == row.id)):
        raise HTTPException(409, "Invoice payments cannot be edited as ordinary ledger entries")
    if payload.status == "completed" and payload.date > date.today():
        raise HTTPException(422, "Use scheduled status for future transactions")
    _owned_account(db, business, payload.account_id)
    _owned_account(db, business, payload.to_account_id)
    if payload.kind == "transfer" and (payload.account_id is None or payload.to_account_id is None or payload.account_id == payload.to_account_id):
        raise HTTPException(422, "A transfer requires two different accounts in this workspace")
    if payload.kind != "transfer" and payload.to_account_id is not None:
        raise HTTPException(422, "A destination account is only valid for transfers")
    category = _ensure_category(db, business, payload.kind, payload.category)
    before = _serialize_transaction(row) if row else None
    if row is None:
        row = Transaction(business_id=business.id, category_id=category.id, **payload.model_dump())
        db.add(row)
    else:
        for key, value in payload.model_dump().items():
            setattr(row, key, value)
        row.category_id = category.id
    db.flush()
    after = _serialize_transaction(row)
    _audit(db, user, business, "update" if before else "create", "transaction", row.id,
           {"before": before, "after": after} if before else after, mutation_id)
    return row


def _save_invoice(db: Session, user: User, business: Business, payload: InvoiceIn,
                  row: Invoice | None = None, mutation_id: str | None = None) -> Invoice:
    duplicate = db.scalar(select(Invoice.id).where(Invoice.business_id == business.id,
                          func.lower(Invoice.invoice_number) == payload.invoice_number.lower(), Invoice.id != (row.id if row else -1)))
    if duplicate:
        raise HTTPException(409, "This invoice number already exists in the workspace")
    _owned_account(db, business, payload.account_id)
    if (payload.currency or business.currency).upper() != business.currency:
        raise HTTPException(422, "Invoice currency must match the workspace; currency conversion is not supported")
    previous_direction = row.direction if row else None
    if row and (payload.amount < row.amount_paid or (row.amount_paid > 0 and payload.direction != row.direction)):
        raise HTTPException(409, "A paid invoice cannot change direction or be reduced below its payments")
    kind = "income" if payload.direction == "receivable" else "expense"
    category = payload.category or ("Other Income" if kind == "income" else "Other Expenses")
    _ensure_category(db, business, kind, category)
    created = row is None
    if created:
        row = Invoice(business_id=business.id, amount_paid=Decimal("0"))
        db.add(row)
    for key, value in payload.model_dump(exclude={"currency", "category"}).items():
        setattr(row, key, value)
    row.currency = business.currency
    row.category = category
    row.status = "paid" if row.amount_paid == row.amount else "partially_paid" if row.amount_paid > 0 else "open"
    db.flush()
    if previous_direction and previous_direction != row.direction:
        old_model = Receivable if previous_direction == "receivable" else Payable
        old_detail = db.scalar(select(old_model).where(old_model.invoice_id == row.id))
        if old_detail:
            db.delete(old_detail)
    model = Receivable if row.direction == "receivable" else Payable
    detail = db.scalar(select(model).where(model.invoice_id == row.id))
    if detail is None:
        detail = model(business_id=business.id, invoice_id=row.id)
        db.add(detail)
    detail.amount, detail.amount_paid, detail.due_date, detail.status = row.amount, row.amount_paid, row.due_date, row.status
    _audit(db, user, business, "create" if created else "update", "invoice", row.id, _invoice_out(row), mutation_id)
    return row


def _delete_invoice(db: Session, user: User, business: Business, row: Invoice, mutation_id: str | None = None) -> None:
    if row.amount_paid > 0 or db.scalar(select(Payment.id).where(Payment.invoice_id == row.id)):
        raise HTTPException(409, "An invoice with payments cannot be deleted")
    _audit(db, user, business, "delete", "invoice", row.id, _invoice_out(row), mutation_id)
    for model in (Receivable, Payable):
        detail = db.scalar(select(model).where(model.invoice_id == row.id))
        if detail:
            db.delete(detail)
    db.delete(row)
    db.flush()


def _settle_invoice(db: Session, user: User, business: Business, invoice_id: int, payload: InvoicePaymentIn,
                    mutation_id: str | None = None) -> dict:
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.business_id == business.id))
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if payload.paid_on > date.today():
        raise HTTPException(422, "A settled payment date cannot be in the future")
    if invoice.currency != business.currency:
        raise HTTPException(422, "Foreign-currency settlement is not supported")
    if payload.amount > _decimal(invoice.amount - invoice.amount_paid):
        raise HTTPException(422, "Payment exceeds the outstanding invoice balance")
    account_id = payload.account_id if payload.account_id is not None else invoice.account_id
    _owned_account(db, business, account_id)
    kind = "income" if invoice.direction == "receivable" else "expense"
    category = _ensure_category(db, business, kind, invoice.category)
    transaction = Transaction(business_id=business.id, category_id=category.id, account_id=account_id, kind=kind,
        category=invoice.category, amount=payload.amount, date=payload.paid_on, description=f"Invoice {invoice.invoice_number}: {invoice.counterparty}",
        payment_method=payload.payment_method, status="completed", reference=payload.reference or invoice.invoice_number)
    db.add(transaction)
    db.flush()
    payment = Payment(business_id=business.id, invoice_id=invoice.id, transaction_id=transaction.id, account_id=account_id,
        amount=payload.amount, paid_on=payload.paid_on, payment_method=payload.payment_method, reference=payload.reference)
    db.add(payment)
    transaction.payment = payment
    invoice.amount_paid = _decimal(invoice.amount_paid + payload.amount)
    invoice.status = "paid" if invoice.amount_paid == invoice.amount else "partially_paid"
    model = Receivable if invoice.direction == "receivable" else Payable
    detail = db.scalar(select(model).where(model.invoice_id == invoice.id))
    if detail is None:
        detail = model(business_id=business.id, invoice_id=invoice.id, amount=invoice.amount, due_date=invoice.due_date)
        db.add(detail)
    detail.amount_paid, detail.status = invoice.amount_paid, invoice.status
    db.flush()
    record = {"id": payment.id, "invoice_id": invoice.id, "transaction_id": transaction.id, "amount": float(payment.amount),
              "paid_on": payment.paid_on.isoformat(), "account_id": account_id, "payment_method": payment.payment_method, "reference": payment.reference}
    _audit(db, user, business, "create", "transaction", transaction.id, _serialize_transaction(transaction))
    _audit(db, user, business, "update", "invoice", invoice.id, _invoice_out(invoice))
    _audit(db, user, business, "create", "payment", payment.id, record, mutation_id)
    return {"invoice": _invoice_out(invoice), "payment": record, "transaction": _serialize_transaction(transaction)}


def _apply_sync_mutation(db: Session, user: User, business: Business, mutation: SyncMutation) -> dict:
    entity_id = mutation.entity_id
    if mutation.action == "create" and entity_id is not None:
        raise HTTPException(422, "Create mutations must not specify a saved entity ID")
    if mutation.action != "create" and (entity_id is None or entity_id <= 0):
        raise HTTPException(422, "A saved server entity ID is required")
    record = None
    extra = {}
    if mutation.entity_type == "transaction":
        row = db.scalar(select(Transaction).where(Transaction.id == entity_id, Transaction.business_id == business.id)) if entity_id else None
        if mutation.action == "delete":
            if row and db.scalar(select(Payment.id).where(Payment.transaction_id == row.id)):
                raise HTTPException(409, "Invoice payments cannot be deleted as ordinary ledger entries")
            _audit(db, user, business, "delete", "transaction", entity_id, {"id": entity_id}, mutation.client_mutation_id)
            if row:
                db.delete(row)
                db.flush()
        else:
            if mutation.action == "update" and row is None:
                raise HTTPException(404, "Transaction not found")
            payload = _validated(TransactionIn, {**(_serialize_transaction(row) if row else {}), **mutation.data})
            row = _save_transaction(db, user, business, payload, row, mutation.client_mutation_id)
            entity_id, record = row.id, _serialize_transaction(row)
    elif mutation.entity_type == "invoice":
        row = db.scalar(select(Invoice).where(Invoice.id == entity_id, Invoice.business_id == business.id)) if entity_id else None
        if mutation.action == "delete":
            if row:
                _delete_invoice(db, user, business, row, mutation.client_mutation_id)
            else:
                _audit(db, user, business, "delete", "invoice", entity_id, {"id": entity_id}, mutation.client_mutation_id)
        else:
            if mutation.action == "update" and row is None:
                raise HTTPException(404, "Invoice not found")
            payload = _validated(InvoiceIn, {**(_invoice_out(row) if row else {}), **mutation.data})
            row = _save_invoice(db, user, business, payload, row, mutation.client_mutation_id)
            entity_id, record = row.id, _invoice_out(row)
    elif mutation.entity_type == "account":
        row = db.scalar(select(Account).where(Account.id == entity_id, Account.business_id == business.id)) if entity_id else None
        if mutation.action != "create" and row is None:
            raise HTTPException(404, "Account not found")
        if mutation.action == "delete":
            if any(db.scalar(select(model.id).where(model.account_id == row.id).limit(1)) for model in (Transaction, Invoice, Payment)) or db.scalar(select(Transaction.id).where(Transaction.to_account_id == row.id).limit(1)):
                raise HTTPException(409, "An account with financial records cannot be deleted; deactivate it instead")
            _audit(db, user, business, "delete", "account", row.id, _account_out(row), mutation.client_mutation_id)
            db.delete(row)
        else:
            payload = _validated(AccountIn, {**(_account_out(row) if row else {}), **mutation.data})
            if (payload.currency or business.currency).upper() != business.currency:
                raise HTTPException(422, "Account currency must match the workspace")
            if db.scalar(select(Account.id).where(Account.business_id == business.id, func.lower(Account.name) == payload.name.lower(), Account.id != (row.id if row else -1))):
                raise HTTPException(409, "An account with this name already exists")
            if row is None:
                row = Account(business_id=business.id)
                db.add(row)
            for key, value in payload.model_dump().items():
                setattr(row, key, value)
            row.currency = business.currency
            active = mutation.data.get("is_active", row.is_active if row.is_active is not None else True)
            if not isinstance(active, bool):
                raise HTTPException(422, "is_active must be true or false")
            row.is_active = active
            db.flush()
            entity_id, record = row.id, _account_out(row)
            _audit(db, user, business, mutation.action, "account", row.id, record, mutation.client_mutation_id)
    elif mutation.entity_type == "payment":
        if mutation.action != "create":
            raise HTTPException(422, "Payments support create only")
        invoice_id = mutation.data.get("invoice_id")
        if not isinstance(invoice_id, int) or invoice_id <= 0:
            raise HTTPException(422, "A saved invoice ID is required")
        settled = _settle_invoice(db, user, business, invoice_id, _validated(InvoicePaymentIn, mutation.data), mutation.client_mutation_id)
        entity_id, record = settled["payment"]["id"], settled["payment"]
        extra = {"invoice": settled["invoice"], "transaction": settled["transaction"]}
    elif mutation.entity_type == "business":
        if mutation.action != "update" or entity_id != business.id:
            raise HTTPException(422, "Workspace settings support update for the selected workspace only")
        record = _update_business_data(db, user, business, mutation.data, mutation.client_mutation_id)
    else:
        raise HTTPException(422, f"Offline sync does not support {mutation.entity_type} mutations")
    return {"client_mutation_id": mutation.client_mutation_id, "entity_type": mutation.entity_type, "entity_id": entity_id,
            "status": {"create": "created", "update": "updated", "delete": "deleted"}[mutation.action], "record": record, **extra}


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
        if key in totals and row.kind in totals[key] and (kind is None or row.kind == kind):
            totals[key][row.kind] += row.amount
    return [{"month": key, "revenue": float(v["income"]), "expenses": float(v["expense"]),
             "net_cash_flow": float(v["income"] - v["expense"])} for key, v in totals.items()]


def _forecast_for(db: Session, business: Business, kind: str, horizon: int) -> dict:
    rows = _transactions(db, business, end=date.today(), statuses=("completed",))
    points = [(t.date, float(t.amount)) for t in rows if t.kind == kind]
    return forecast_daily(points, horizon)


def _persist_forecast(db: Session, business: Business, target: str, result: dict) -> ForecastRun:
    forecast_total = sum((_decimal(point["value"]) for point in result["predictions"]), Decimal("0"))
    previous_runs = db.scalars(select(ForecastRun).where(ForecastRun.business_id == business.id,
                                                        ForecastRun.target == target)
                               .order_by(ForecastRun.created_at.desc(), ForecastRun.id.desc()).limit(10)).all()
    for previous in previous_runs:
        previous_points = db.scalars(select(FinancialForecast.predicted_value).where(
            FinancialForecast.forecast_run_id == previous.id).order_by(FinancialForecast.forecast_date)).all()
        if len(previous_points) != len(result["predictions"]) or not previous_points:
            continue
        previous_total = sum(previous_points, Decimal("0"))
        if previous_total <= 0:
            continue
        change_pct = (forecast_total / previous_total - 1) * 100
        if abs(change_pct) >= 25 and abs(forecast_total - previous_total) >= Decimal("1000"):
            title = f"{target.title()} forecast changed significantly"
            exists = db.scalar(select(Notification.id).where(Notification.business_id == business.id,
                                                               Notification.title == title,
                                                               Notification.is_read.is_(False)))
            if not exists:
                direction = "increased" if change_pct > 0 else "decreased"
                db.add(Notification(business_id=business.id, title=title,
                                    message=f"The next {len(result['predictions'])}-day {target} forecast {direction} by {abs(float(change_pct)):.1f}% compared with the prior forecast.",
                                    severity="warning" if change_pct < 0 else "info"))
            break
    run = ForecastRun(business_id=business.id, target=target, selected_model=result["selected_model"],
                      training_start=date.fromisoformat(result["training_start"]) if result["training_start"] else None,
                      training_end=date.fromisoformat(result["training_end"]) if result["training_end"] else None,
                      metrics_json=json.dumps(result["metrics"]))
    db.add(run)
    db.flush()
    for metric in result["metrics"]:
        db.add(ForecastMetric(business_id=business.id, forecast_run_id=run.id, model=metric["model"],
                              mae=_metric_decimal(metric["mae"]) if metric.get("mae") is not None else None,
                              rmse=_metric_decimal(metric["rmse"]) if metric.get("rmse") is not None else None,
                              mape=_metric_decimal(metric["mape"]) if metric.get("mape") is not None else None,
                              wape=_metric_decimal(metric["wape"]) if metric.get("wape") is not None else None,
                              status="available", selected=bool(metric.get("selected"))))
    for prediction in result["predictions"]:
        db.add(FinancialForecast(business_id=business.id, forecast_run_id=run.id, target=target,
                                 forecast_date=date.fromisoformat(prediction["date"]),
                                 predicted_value=_decimal(prediction["value"]),
                                 lower_bound=_decimal(prediction["lower"]), upper_bound=_decimal(prediction["upper"])))
    return run


def _current_cash(db: Session, business: Business) -> Decimal:
    rows = _transactions(db, business, end=date.today())
    net = sum((t.amount if t.kind == "income" else (-t.amount if t.kind == "expense" else Decimal("0")) for t in rows), Decimal("0"))
    return _decimal(business.opening_cash + net)


def _cash_projection(db: Session, business: Business, horizon: int = 90) -> dict:
    inc = _forecast_for(db, business, "income", horizon)
    out = _forecast_for(db, business, "expense", horizon)
    inflows = {p["date"]: p["value"] for p in inc["predictions"]}
    outflows = {p["date"]: p["value"] for p in out["predictions"]}
    future = _transactions(db, business, statuses=("scheduled", "pending"))
    obligation_inflows: dict[str, float] = {}
    obligation_outflows: dict[str, float] = {}
    known_items: set[tuple[str, str, str, str]] = set()
    for t in future:
        due = max(t.date, date.today() + timedelta(days=1))
        due_key = due.isoformat()
        target = obligation_inflows if t.kind == "income" else obligation_outflows
        target[due_key] = target.get(due_key, 0.0) + float(t.amount)
        known_items.add((due_key, t.kind, str(_decimal(t.amount)), t.category.lower()))
    known_references = {t.reference.strip().lower() for t in future if t.reference}
    open_invoices = db.scalars(select(Invoice).where(Invoice.business_id == business.id, Invoice.status != "paid")).all()
    confirmed_invoice_count = 0
    for invoice in open_invoices:
        amount_due = _decimal(invoice.amount - invoice.amount_paid)
        if amount_due <= 0:
            continue
        if invoice.invoice_number.strip().lower() in known_references:
            continue
        kind = "income" if invoice.direction == "receivable" else "expense"
        due = max(invoice.due_date, date.today() + timedelta(days=1))
        key = due.isoformat()
        duplicate_key = (key, kind, str(amount_due), invoice.category.lower())
        if duplicate_key in known_items:
            continue
        target = obligation_inflows if kind == "income" else obligation_outflows
        target[key] = target.get(key, 0.0) + float(amount_due)
        known_items.add(duplicate_key)
        confirmed_invoice_count += 1
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
                target = obligation_inflows if item.kind == "income" else obligation_outflows
                target[key] = target.get(key, 0.0) + float(item.amount)
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
        scheduled_inflow = obligation_inflows.get(key, 0.0)
        scheduled_outflow = obligation_outflows.get(key, 0.0)
        scheduled_net = scheduled_inflow - scheduled_outflow
        balance += inflow - outflow + scheduled_net
        lower_balance += income_points.get(key, {}).get("lower", inflow) - expense_points.get(key, {}).get("upper", outflow) + scheduled_net
        upper_balance += income_points.get(key, {}).get("upper", inflow) - expense_points.get(key, {}).get("lower", outflow) + scheduled_net
        min_balance = min(min_balance, balance)
        if shortfall is None and balance < float(business.minimum_reserve):
            shortfall = {"date": key, "amount_below_reserve": round(float(business.minimum_reserve) - balance, 2)}
        points.append({"date": key, "inflows": round(inflow + scheduled_inflow, 2),
                       "outflows": round(outflow + scheduled_outflow, 2), "balance": round(balance, 2),
                       "lower_balance": round(lower_balance, 2), "upper_balance": round(upper_balance, 2)})
    return {"opening_balance": round(current, 2), "minimum_reserve": float(business.minimum_reserve),
            "minimum_expected_balance": round(min_balance, 2), "shortfall": shortfall, "days": points,
            "revenue_model": inc["selected_model"], "expense_model": out["selected_model"],
            "confirmed_obligations": len(future) + confirmed_invoice_count, "recurring_occurrences": recurring_occurrences}


def _insights(db: Session, business: Business) -> list[dict]:
    monthly = _monthly(db, business, 6)
    insights = []
    latest_index = len(monthly) - 1
    if latest_index > 0 and date.today().day < monthrange(date.today().year, date.today().month)[1]:
        latest_index -= 1
    if latest_index > 0:
        prev, latest = monthly[latest_index - 1], monthly[latest_index]
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
            "period": "Last 90 days", "severity": "warning" if share >= 45 else "info", "recommended_action": "Review this category for supplier or usage savings.",
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
    week_end = date.today() + timedelta(days=7)
    upcoming = [row for row in _transactions(db, business, start=date.today(), end=week_end,
                                               statuses=("pending", "scheduled"))]
    invoice_refs = {row.reference.strip().lower() for row in upcoming if row.reference}
    open_invoices = db.scalars(select(Invoice).where(Invoice.business_id == business.id, Invoice.status != "paid")).all()
    upcoming_invoices = [row for row in open_invoices if date.today() <= row.due_date <= week_end
                         and row.invoice_number.strip().lower() not in invoice_refs]
    due_receivables = sum((row.amount for row in upcoming if row.kind == "income"), Decimal("0")) + sum(
        (row.amount - row.amount_paid for row in upcoming_invoices if row.direction == "receivable"), Decimal("0"))
    due_payables = sum((row.amount for row in upcoming if row.kind == "expense"), Decimal("0")) + sum(
        (row.amount - row.amount_paid for row in upcoming_invoices if row.direction == "payable"), Decimal("0"))
    if due_receivables or due_payables:
        insights.append({"title": "Financial items due in the next 7 days",
            "description": f"{business.currency} {float(due_receivables):,.2f} in expected receipts and {business.currency} {float(due_payables):,.2f} in expected payments are scheduled.",
            "supporting_figures": {"receivables": float(due_receivables), "payables": float(due_payables),
                                   "transaction_count": len(upcoming) + len(upcoming_invoices)},
            "period": f"{date.today().isoformat()}–{week_end.isoformat()}", "severity": "warning" if due_payables else "info",
            "recommended_action": "Confirm available cash and follow up on customer collections before due dates.",
            "reference": "Open pending / scheduled transactions and unpaid invoices due within seven calendar days."})
    overdue_receivables = [row for row in open_invoices if row.direction == "receivable" and row.due_date < date.today() and row.amount > row.amount_paid]
    overdue_payables = [row for row in open_invoices if row.direction == "payable" and row.due_date < date.today() and row.amount > row.amount_paid]
    if overdue_receivables:
        amount = sum((row.amount - row.amount_paid for row in overdue_receivables), Decimal("0"))
        insights.append({"title": "Customer invoices are overdue", "description": f"{len(overdue_receivables)} customer invoices have {business.currency} {float(amount):,.2f} outstanding past their due dates.",
            "supporting_figures": {"invoice_count": len(overdue_receivables), "amount_overdue": float(amount)},
            "period": "As of today", "severity": "warning", "recommended_action": "Contact customers, confirm payment dates, and review collection terms.",
            "reference": "Unpaid receivable invoice balances with due dates before today."})
    if overdue_payables:
        amount = sum((row.amount - row.amount_paid for row in overdue_payables), Decimal("0"))
        insights.append({"title": "Supplier bills are overdue", "description": f"{len(overdue_payables)} supplier bills have {business.currency} {float(amount):,.2f} outstanding past their due dates.",
            "supporting_figures": {"invoice_count": len(overdue_payables), "amount_overdue": float(amount)},
            "period": "As of today", "severity": "warning", "recommended_action": "Confirm payment status with suppliers and review cash priorities.",
            "reference": "Unpaid payable invoice balances with due dates before today."})
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
    _ensure_default_categories(db, business)
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
    _ensure_default_categories(db, business)
    db.commit()
    db.refresh(business)
    return business


@router.get("/businesses/current/members")
def list_business_members(user: User = Depends(current_user), db: Session = Depends(get_db),
                          x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    if _membership_role(user, db, business) not in {"owner", "admin"}:
        raise HTTPException(403, "Only workspace owners and admins can view team access")
    rows = db.execute(select(BusinessMember, User).join(User, User.id == BusinessMember.user_id)
                      .where(BusinessMember.business_id == business.id).order_by(BusinessMember.id)).all()
    return {"can_manage": _membership_role(user, db, business) == "owner",
            "members": [{"id": member.id, "user_id": member.user_id, "name": person.name,
                         "email": person.email, "role": member.role} for member, person in rows]}


@router.post("/businesses/current/members")
def add_business_member(payload: BusinessMemberIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                        x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_owner(user, db, business)
    invited = db.scalar(select(User).where(User.email == payload.email.lower().strip()))
    if not invited:
        raise HTTPException(404, "Ask this person to create a FinSight account before adding them")
    if db.scalar(select(BusinessMember.id).where(BusinessMember.business_id == business.id,
                                                BusinessMember.user_id == invited.id)):
        raise HTTPException(409, "This user is already a member of the workspace")
    row = BusinessMember(user_id=invited.id, business_id=business.id, role=payload.role)
    db.add(row)
    db.flush()
    _audit(db, user, business, "create", "business_member", row.id,
           {"email": invited.email, "role": row.role})
    db.commit()
    return {"id": row.id, "user_id": invited.id, "name": invited.name, "email": invited.email, "role": row.role}


@router.patch("/businesses/current/members/{member_id}")
def update_business_member(member_id: int, payload: BusinessMemberRoleIn, user: User = Depends(current_user),
                           db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_owner(user, db, business)
    row = db.scalar(select(BusinessMember).where(BusinessMember.id == member_id,
                                                  BusinessMember.business_id == business.id))
    if not row:
        raise HTTPException(404, "Workspace member not found")
    if row.role == "owner":
        raise HTTPException(409, "The workspace owner role cannot be changed here")
    previous = row.role
    row.role = payload.role
    _audit(db, user, business, "update", "business_member", row.id,
           {"user_id": row.user_id, "from_role": previous, "to_role": row.role})
    db.commit()
    return {"id": row.id, "user_id": row.user_id, "role": row.role}


@router.delete("/businesses/current/members/{member_id}")
def remove_business_member(member_id: int, user: User = Depends(current_user), db: Session = Depends(get_db),
                           x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_owner(user, db, business)
    row = db.scalar(select(BusinessMember).where(BusinessMember.id == member_id,
                                                  BusinessMember.business_id == business.id))
    if not row:
        raise HTTPException(404, "Workspace member not found")
    if row.role == "owner":
        raise HTTPException(409, "The workspace owner cannot be removed")
    _audit(db, user, business, "delete", "business_member", row.id, {"user_id": row.user_id, "role": row.role})
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.patch("/businesses/current", response_model=BusinessOut)
def update_business(payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    _update_business_data(db, user, business, payload)
    db.commit()
    db.refresh(business)
    return business


@router.get("/categories")
def list_categories(kind: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db),
                    x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _ensure_default_categories(db, business)
    stmt = select(TransactionCategory).where(TransactionCategory.business_id == business.id)
    if kind in ("income", "expense"):
        stmt = stmt.where(TransactionCategory.kind == kind)
    rows = db.scalars(stmt.order_by(TransactionCategory.kind, TransactionCategory.name)).all()
    db.commit()
    return [{"id": row.id, "kind": row.kind, "name": row.name, "is_system": row.is_system} for row in rows]


@router.post("/categories")
def create_category(payload: CategoryIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                    x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    existing = db.scalar(select(TransactionCategory).where(TransactionCategory.business_id == business.id,
                                                              TransactionCategory.kind == payload.kind,
                                                              func.lower(TransactionCategory.name) == payload.name.strip().lower()))
    if existing:
        raise HTTPException(409, "This category already exists")
    row = _ensure_category(db, business, payload.kind, payload.name)
    db.commit()
    return {"id": row.id, "kind": row.kind, "name": row.name, "is_system": row.is_system}


@router.get("/accounts")
def list_accounts(user: User = Depends(current_user), db: Session = Depends(get_db),
                  x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    accounts = db.scalars(select(Account).where(Account.business_id == business.id).order_by(Account.name)).all()
    results = []
    for account in accounts:
        net_direct = db.scalar(select(func.coalesce(func.sum(Transaction.amount * case(
            (Transaction.kind == "income", 1),
            (Transaction.kind == "expense", -1),
            else_=0)), 0)).where(
                Transaction.business_id == business.id, Transaction.account_id == account.id,
                 Transaction.status == "completed", Transaction.date <= date.today())) or 0
        transfers_in = db.scalar(select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.business_id == business.id, Transaction.to_account_id == account.id,
            Transaction.kind == "transfer", Transaction.status == "completed", Transaction.date <= date.today())) or 0
        transfers_out = db.scalar(select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.business_id == business.id, Transaction.account_id == account.id,
            Transaction.kind == "transfer", Transaction.status == "completed", Transaction.date <= date.today())) or 0
        current_bal = account.opening_balance + Decimal(str(net_direct)) + Decimal(str(transfers_in)) - Decimal(str(transfers_out))
        results.append({"id": account.id, "name": account.name, "account_type": account.account_type,
                        "currency": account.currency, "opening_balance": float(account.opening_balance),
                        "current_balance": float(current_bal),
                        "is_active": account.is_active})
    return results


@router.post("/accounts")
def create_account(payload: AccountIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                   x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    currency = (payload.currency or business.currency).upper()
    if currency != business.currency:
        raise HTTPException(422, "Account currency must match the workspace")
    if db.scalar(select(Account.id).where(Account.business_id == business.id, func.lower(Account.name) == payload.name.strip().lower())):
        raise HTTPException(409, "An account with this name already exists")
    account = Account(business_id=business.id, name=payload.name.strip(), account_type=payload.account_type,
                      currency=currency, opening_balance=payload.opening_balance)
    db.add(account)
    db.flush()
    _audit(db, user, business, "create", "account", account.id, _account_out(account))
    db.commit()
    db.refresh(account)
    return {"id": account.id, "name": account.name, "account_type": account.account_type,
            "currency": account.currency, "opening_balance": float(account.opening_balance),
            "current_balance": float(account.opening_balance), "is_active": account.is_active}


@router.patch("/accounts/{account_id}")
def update_account(account_id: int, payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db),
                   x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    account = db.scalar(select(Account).where(Account.id == account_id, Account.business_id == business.id))
    if not account:
        raise HTTPException(404, "Account not found")
    if "is_active" in payload:
        if not isinstance(payload["is_active"], bool):
            raise HTTPException(422, "is_active must be true or false")
        account.is_active = payload["is_active"]
    db.flush()
    _audit(db, user, business, "update", "account", account.id, _account_out(account))
    db.commit()
    return {"id": account.id, "name": account.name, "account_type": account.account_type,
            "currency": account.currency, "opening_balance": float(account.opening_balance), "is_active": account.is_active}


@router.get("/invoices")
def list_invoices(direction: str | None = None, status: str | None = None, page: int = Query(1, ge=1),
                  limit: int = Query(50, ge=1, le=200), user: User = Depends(current_user),
                  db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    stmt = select(Invoice).where(Invoice.business_id == business.id)
    if direction in ("receivable", "payable"):
        stmt = stmt.where(Invoice.direction == direction)
    if status == "overdue":
        stmt = stmt.where(Invoice.status != "paid", Invoice.due_date < date.today())
    elif status in ("open", "partially_paid", "paid"):
        stmt = stmt.where(Invoice.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Invoice.due_date, Invoice.id).offset((page - 1) * limit).limit(limit)).all()
    return {"items": [_invoice_out(row) for row in rows], "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit}


@router.post("/invoices")
def create_invoice(payload: InvoiceIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                   x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    invoice = _save_invoice(db, user, business, payload)
    db.commit()
    db.refresh(invoice)
    return _invoice_out(invoice)


@router.put("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, payload: InvoiceIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                   x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.business_id == business.id))
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    invoice = _save_invoice(db, user, business, payload, invoice)
    db.commit()
    return _invoice_out(invoice)


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: int, user: User = Depends(current_user), db: Session = Depends(get_db),
                   x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.business_id == business.id))
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    _delete_invoice(db, user, business, invoice)
    db.commit()
    return {"deleted": True}


@router.get("/invoices/{invoice_id}/payments")
def list_invoice_payments(invoice_id: int, user: User = Depends(current_user), db: Session = Depends(get_db),
                          x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.business_id == business.id))
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    rows = db.scalars(select(Payment).where(Payment.invoice_id == invoice.id).order_by(Payment.paid_on, Payment.id)).all()
    return [{"id": row.id, "amount": float(row.amount), "paid_on": row.paid_on.isoformat(),
             "payment_method": row.payment_method, "account_id": row.account_id,
             "reference": row.reference, "transaction_id": row.transaction_id} for row in rows]


@router.post("/invoices/{invoice_id}/payments")
def record_invoice_payment(invoice_id: int, payload: InvoicePaymentIn, user: User = Depends(current_user),
                           db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    result = _settle_invoice(db, user, business, invoice_id, payload)
    db.commit()
    return result


@router.get("/transactions")
def list_transactions(user: User = Depends(current_user), db: Session = Depends(get_db),
                      x_business_id: int | None = Header(default=None), search: str = "", kind: str | None = None,
                      category: str | None = None, status: str | None = None, start: date | None = None, end: date | None = None,
                      sort: str = "date", direction: str = "desc", page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200)):
    business = _business(user, db, x_business_id)
    stmt = select(Transaction).where(Transaction.business_id == business.id)
    if kind in ("income", "expense", "transfer"):
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
    _require_write_access(user, db, business)
    row = _save_transaction(db, user, business, payload)
    db.commit()
    db.refresh(row)
    return _serialize_transaction(row)


@router.put("/transactions/{transaction_id}")
def update_transaction(transaction_id: int, payload: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    row = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    row = _save_transaction(db, user, business, payload, row)
    db.commit()
    db.refresh(row)
    return _serialize_transaction(row)


@router.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    row = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Transaction not found")
    if db.scalar(select(Payment.id).where(Payment.transaction_id == row.id)):
        raise HTTPException(409, "This transaction is linked to an invoice payment and cannot be deleted directly")
    _audit(db, user, business, "delete", "transaction", row.id, _serialize_transaction(row))
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.post("/transactions/bulk")
def bulk_transactions(payload: BulkTransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    rows = list(db.scalars(select(Transaction).where(Transaction.id.in_(payload.transaction_ids), Transaction.business_id == business.id)))
    protected_ids = set(db.scalars(select(Payment.transaction_id).where(Payment.transaction_id.in_([row.id for row in rows]))))
    skipped = len([row for row in rows if row.id in protected_ids])
    if payload.action != "delete":
        rows = [row for row in rows if row.id not in protected_ids]
    if payload.action == "delete":
        payment_tx_ids = set(db.scalars(select(Payment.transaction_id).where(Payment.transaction_id.in_([r.id for r in rows]))))
        deleted_count = 0
        skipped = 0
        for r in rows:
            if r.id in payment_tx_ids:
                skipped += 1
                continue
            _audit(db, user, business, "delete", "transaction", r.id, _serialize_transaction(r))
            db.delete(r)
            deleted_count += 1
        db.commit()
        return {"action": "delete", "affected": deleted_count, "skipped": skipped}
    elif payload.action == "update_category":
        if not payload.category:
            raise HTTPException(422, "Category must be provided for update_category action")
        updated_count = 0
        for r in rows:
            cat = _ensure_category(db, business, r.kind, payload.category)
            r.category = cat.name
            r.category_id = cat.id
            _audit(db, user, business, "update", "transaction", r.id, _serialize_transaction(r))
            updated_count += 1
        db.commit()
        return {"action": "update_category", "affected": updated_count, "skipped": skipped}
    elif payload.action == "update_status":
        if not payload.status:
            raise HTTPException(422, "Status must be provided for update_status action")
        updated_count = 0
        for r in rows:
            r.status = payload.status
            _audit(db, user, business, "update", "transaction", r.id, _serialize_transaction(r))
            updated_count += 1
        db.commit()
        return {"action": "update_status", "affected": updated_count}


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
    _require_write_access(user, db, business)
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
    _require_write_access(user, db, business)
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
    _require_write_access(user, db, business)
    row = db.scalar(select(RecurringTransaction).where(RecurringTransaction.id == recurring_id, RecurringTransaction.business_id == business.id))
    if not row:
        raise HTTPException(404, "Recurring transaction not found")
    _audit(db, user, business, "delete", "recurring_transaction", row.id, {"category": row.category, "amount": str(row.amount)})
    db.delete(row)
    db.commit()
    return {"deleted": True}


def _read_upload(file: UploadFile, mapping: dict[str, str] | None = None) -> dict:
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
    resolved = {"date": col("date", "transaction_date"), "amount": col("amount", "value"),
                "kind": col("type", "kind"), "category": col("category"),
                "description": col("description", "memo", "note")}
    resolved.update(mapping or {})
    for target, column in resolved.items():
        if column and column not in frame.columns:
            raise HTTPException(422, f"Mapped {target} column {column!r} does not exist in this file")
    date_col, amount_col = resolved["date"], resolved["amount"]
    kind_col, cat_col, desc_col = resolved["kind"], resolved["category"], resolved["description"]
    if not date_col or not amount_col:
        raise HTTPException(422, "Map date and amount to columns in the uploaded file")
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
            rows.append({"date": when.isoformat(), "amount": str(amount), "kind": typ, "category": category,
                         "description": str(record.get(desc_col, "") or "")[:240], "status": "completed", "payment_method": "Imported"})
        except Exception as exc:
            errors.append({"line": line, "error": str(exc)})
    return {"rows": rows, "errors": errors, "valid_count": len(rows), "invalid_count": len(errors),
            "columns": [str(column) for column in frame.columns], "mapping": resolved}


@router.post("/transactions/import/preview")
@router.post("/transactions/import")
def preview_import(file: UploadFile = File(...), mapping: str | None = Form(default=None), user: User = Depends(current_user)):
    try:
        mapped_columns = json.loads(mapping) if mapping else None
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "Column mapping must be valid JSON") from exc
    if mapped_columns is not None and (not isinstance(mapped_columns, dict) or any(
            key not in {"date", "amount", "kind", "category", "description"} or
            (value is not None and not isinstance(value, str)) for key, value in mapped_columns.items())):
        raise HTTPException(422, "Column mapping contains an unsupported field")
    return _read_upload(file, mapped_columns)


@router.post("/transactions/import/confirm")
def confirm_import(payload: dict, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
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
            _owned_account(db, business, item.account_id)
            category = _ensure_category(db, business, item.kind, item.category)
            db.add(Transaction(business_id=business.id, category_id=category.id, account_id=item.account_id,
                               **item.model_dump(exclude={"account_id"})))
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
def overview(months: int = Query(6, ge=1, le=36),
             start: date | None = Query(None),
             end: date | None = Query(None),
             preset: str | None = Query(None),
             user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    series = _monthly(db, business, months)
    all_rows = _transactions(db, business, end=date.today())
    now = date.today()

    if preset == "today":
        period_start = now
        period_end = now
    elif preset == "last_7_days":
        period_start = now - timedelta(days=6)
        period_end = now
    elif preset == "last_30_days":
        period_start = now - timedelta(days=29)
        period_end = now
    elif preset == "this_month":
        period_start = date(now.year, now.month, 1)
        period_end = now
    elif preset == "last_month":
        prev_month_end = date(now.year, now.month, 1) - timedelta(days=1)
        period_start = date(prev_month_end.year, prev_month_end.month, 1)
        period_end = prev_month_end
    elif preset == "this_quarter":
        quarter_start_month = ((now.month - 1) // 3) * 3 + 1
        period_start = date(now.year, quarter_start_month, 1)
        period_end = now
    elif preset == "this_year":
        period_start = date(now.year, 1, 1)
        period_end = now
    elif start and end:
        period_start = start
        period_end = end
    else:
        period_start = _month_start(months)
        period_end = now

    selected = [t for t in all_rows if period_start <= t.date <= period_end]
    rev = sum((t.amount for t in selected if t.kind == "income"), Decimal("0"))
    exp = sum((t.amount for t in selected if t.kind == "expense"), Decimal("0"))
    cash = _current_cash(db, business)

    period_days = max(1, (period_end - period_start).days + 1)
    prior_end = period_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=period_days - 1)
    prior_selected = [t for t in all_rows if prior_start <= t.date <= prior_end]
    prior_rev = sum((t.amount for t in prior_selected if t.kind == "income"), Decimal("0"))
    prior_exp = sum((t.amount for t in prior_selected if t.kind == "expense"), Decimal("0"))
    prior_net = prior_rev - prior_exp

    period_rev_growth = float((rev / prior_rev - 1) * 100) if prior_rev else (100.0 if rev > 0 else 0.0)
    period_exp_growth = float((exp / prior_exp - 1) * 100) if prior_exp else (100.0 if exp > 0 else 0.0)
    period_net_growth = float((((rev - exp) - prior_net) / abs(prior_net)) * 100) if prior_net != 0 else None

    recent90 = [t for t in all_rows if t.date >= now - timedelta(days=90)]
    burn = (sum((t.amount for t in recent90 if t.kind == "expense"), Decimal("0")) - sum((t.amount for t in recent90 if t.kind == "income"), Decimal("0"))) / Decimal("90")
    runway = float(cash / burn) if burn > 0 else None
    pending = _transactions(db, business, statuses=("pending", "scheduled"))
    open_invoices = db.scalars(select(Invoice).where(Invoice.business_id == business.id, Invoice.status != "paid")).all()
    receivables = sum((t.amount for t in pending if t.kind == "income"), Decimal("0")) + sum(
        (row.amount - row.amount_paid for row in open_invoices if row.direction == "receivable"), Decimal("0"))
    payables = sum((t.amount for t in pending if t.kind == "expense"), Decimal("0")) + sum(
        (row.amount - row.amount_paid for row in open_invoices if row.direction == "payable"), Decimal("0"))
    categories: dict[str, Decimal] = {}
    for t in selected:
        if t.kind == "expense":
            categories[t.category] = categories.get(t.category, Decimal("0")) + t.amount
    prev = series[-2] if len(series) > 1 else None
    last = series[-1] if series else None
    growth = ((last["revenue"] / prev["revenue"] - 1) * 100) if prev and prev["revenue"] else 0
    expenses_growth = ((last["expenses"] / prev["expenses"] - 1) * 100) if prev and prev["expenses"] else 0
    known_invoice_refs = {t.reference.strip().lower() for t in pending if t.reference}
    invoice_obligations = [{"id": -row.id, "business_id": business.id,
                            "kind": "income" if row.direction == "receivable" else "expense",
                            "category": row.category, "amount": float(row.amount - row.amount_paid),
                            "date": row.due_date.isoformat(), "description": f"Invoice {row.invoice_number} · {row.counterparty}",
                            "payment_method": "Invoice", "status": "overdue" if row.due_date < now else "pending",
                            "reference": row.invoice_number, "account_id": row.account_id}
                           for row in open_invoices if row.amount > row.amount_paid
                           and row.invoice_number.strip().lower() not in known_invoice_refs]
    upcoming_items = [_serialize_transaction(row) for row in pending] + invoice_obligations
    return {"business": {"id": business.id, "name": business.name, "currency": business.currency, "is_demo": business.is_demo,
                          "minimum_reserve": str(business.minimum_reserve), "opening_cash": str(business.opening_cash)},
        "period": {"months": months, "start": period_start.isoformat(), "end": period_end.isoformat(), "preset": preset},
        "kpis": {"revenue": float(rev), "expenses": float(exp), "net_cash_flow": float(rev-exp), "current_cash": float(cash),
                 "profit_margin_pct": None, "cash_margin_pct": float((rev-exp) / rev * 100) if rev else 0, "cash_runway_days": runway,
                 "monthly_revenue_growth_pct": growth, "monthly_expense_growth_pct": expenses_growth,
                 "period_revenue_growth_pct": period_rev_growth, "period_expense_growth_pct": period_exp_growth,
                 "period_net_growth_pct": period_net_growth, "previous_period_revenue": float(prior_rev),
                 "previous_period_expenses": float(prior_exp), "previous_period_net_cash_flow": float(prior_net),
                 "expense_to_revenue_pct": float(exp / rev * 100) if rev else 0, "accounts_receivable": float(receivables),
                 "accounts_payable": float(payables), "working_capital": float(cash + receivables - payables),
                 "average_monthly_burn": float(max(Decimal("0"), burn) * Decimal("30"))},
        "monthly": series, "expense_categories": [{"category": k, "amount": float(v), "share_pct": float(v / exp * 100) if exp else 0} for k, v in sorted(categories.items(), key=lambda x: x[1], reverse=True)],
        "recent_transactions": [_serialize_transaction(t) for t in sorted(all_rows, key=lambda r: (r.date, r.id), reverse=True)[:8]],
        "upcoming_obligations": sorted(upcoming_items, key=lambda item: item["date"])[:8], "insights": _insights(db, business)}


@router.get("/invoices/receivables/ageing")
def receivables_ageing(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    today = date.today()
    invoices = db.scalars(
        select(Invoice).where(Invoice.business_id == business.id, Invoice.direction == "receivable", Invoice.status != "paid")
    ).all()
    buckets = {"current": Decimal("0"), "days_1_30": Decimal("0"), "days_31_60": Decimal("0"), "days_61_90": Decimal("0"), "days_90_plus": Decimal("0")}
    by_customer: dict[str, dict[str, Decimal | int]] = {}
    total_due = Decimal("0")
    total_overdue = Decimal("0")
    for inv in invoices:
        due = inv.amount - inv.amount_paid
        if due <= 0:
            continue
        total_due += due
        cust = inv.counterparty
        if cust not in by_customer:
            by_customer[cust] = {"customer": cust, "total_invoiced": Decimal("0"), "total_paid": Decimal("0"), "amount_due": Decimal("0"), "overdue_amount": Decimal("0"), "invoice_count": 0}
        by_customer[cust]["total_invoiced"] += inv.amount
        by_customer[cust]["total_paid"] += inv.amount_paid
        by_customer[cust]["amount_due"] += due
        by_customer[cust]["invoice_count"] += 1

        days_past = (today - inv.due_date).days
        if days_past <= 0:
            buckets["current"] += due
        else:
            total_overdue += due
            by_customer[cust]["overdue_amount"] += due
            if days_past <= 30:
                buckets["days_1_30"] += due
            elif days_past <= 60:
                buckets["days_31_60"] += due
            elif days_past <= 90:
                buckets["days_61_90"] += due
            else:
                buckets["days_90_plus"] += due

    customers_list = [
        {"customer": k, "total_invoiced": float(v["total_invoiced"]), "total_paid": float(v["total_paid"]),
         "amount_due": float(v["amount_due"]), "overdue_amount": float(v["overdue_amount"]), "invoice_count": int(v["invoice_count"])}
        for k, v in sorted(by_customer.items(), key=lambda item: item[1]["amount_due"], reverse=True)
    ]
    return {
        "total_outstanding": float(total_due),
        "total_overdue": float(total_overdue),
        "buckets": {k: float(v) for k, v in buckets.items()},
        "customers": customers_list,
    }


@router.get("/invoices/payables/ageing")
def payables_ageing(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    today = date.today()
    invoices = db.scalars(
        select(Invoice).where(Invoice.business_id == business.id, Invoice.direction == "payable", Invoice.status != "paid")
    ).all()
    buckets = {"current": Decimal("0"), "days_1_30": Decimal("0"), "days_31_60": Decimal("0"), "days_61_90": Decimal("0"), "days_90_plus": Decimal("0")}
    by_supplier: dict[str, dict[str, Decimal | int]] = {}
    total_due = Decimal("0")
    total_overdue = Decimal("0")
    for inv in invoices:
        due = inv.amount - inv.amount_paid
        if due <= 0:
            continue
        total_due += due
        sup = inv.counterparty
        if sup not in by_supplier:
            by_supplier[sup] = {"supplier": sup, "total_billed": Decimal("0"), "total_paid": Decimal("0"), "amount_due": Decimal("0"), "overdue_amount": Decimal("0"), "bill_count": 0}
        by_supplier[sup]["total_billed"] += inv.amount
        by_supplier[sup]["total_paid"] += inv.amount_paid
        by_supplier[sup]["amount_due"] += due
        by_supplier[sup]["bill_count"] += 1

        days_past = (today - inv.due_date).days
        if days_past <= 0:
            buckets["current"] += due
        else:
            total_overdue += due
            by_supplier[sup]["overdue_amount"] += due
            if days_past <= 30:
                buckets["days_1_30"] += due
            elif days_past <= 60:
                buckets["days_31_60"] += due
            elif days_past <= 90:
                buckets["days_61_90"] += due
            else:
                buckets["days_90_plus"] += due

    suppliers_list = [
        {"supplier": k, "total_billed": float(v["total_billed"]), "total_paid": float(v["total_paid"]),
         "amount_due": float(v["amount_due"]), "overdue_amount": float(v["overdue_amount"]), "bill_count": int(v["bill_count"])}
        for k, v in sorted(by_supplier.items(), key=lambda item: item[1]["amount_due"], reverse=True)
    ]
    return {
        "total_outstanding": float(total_due),
        "total_overdue": float(total_overdue),
        "buckets": {k: float(v) for k, v in buckets.items()},
        "suppliers": suppliers_list,
    }


@router.post("/sync/pull")
def sync_pull(payload: SyncPullIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _lock_business(db, business)
    role = _membership_role(user, db, business)
    if not role:
        raise HTTPException(404, "Workspace access is no longer available")
    latest_seq = business.sync_seq
    metadata = {"business": _business_out(business), "role": role, "protocol_version": 2}
    if payload.since_seq == 0 or payload.since_seq > latest_seq:
        txs = _transactions(db, business, statuses=("completed", "pending", "scheduled"))
        accounts = db.scalars(select(Account).where(Account.business_id == business.id)).all()
        categories = db.scalars(select(TransactionCategory).where(TransactionCategory.business_id == business.id)).all()
        invoices = db.scalars(select(Invoice).where(Invoice.business_id == business.id)).all()
        recurring = db.scalars(select(RecurringTransaction).where(RecurringTransaction.business_id == business.id)).all()
        scenarios = db.scalars(select(FinancialScenario).where(FinancialScenario.business_id == business.id)).all()
        return {
            **metadata,
            "mode": "baseline",
            "latest_seq": latest_seq,
            "has_more": False,
            "server_time": datetime.now().isoformat(),
            "data": {
                "transactions": [_serialize_transaction(t) for t in txs],
                "accounts": [{"id": a.id, "name": a.name, "account_type": a.account_type, "currency": a.currency, "opening_balance": float(a.opening_balance), "is_active": a.is_active} for a in accounts],
                "categories": [{"id": c.id, "kind": c.kind, "name": c.name, "is_system": c.is_system} for c in categories],
                "invoices": [_invoice_out(inv) for inv in invoices],
                "recurring": [{"id": r.id, "kind": r.kind, "category": r.category, "amount": float(r.amount), "frequency": r.frequency, "next_date": r.next_date.isoformat(), "end_date": r.end_date.isoformat() if r.end_date else None, "description": r.description, "payment_method": r.payment_method, "enabled": r.enabled} for r in recurring],
                "scenarios": [{"id": s.id, "name": s.name, "assumptions": json.loads(s.assumptions)} for s in scenarios],
            }
        }
    stmt = (select(SyncChange)
            .where(SyncChange.business_id == business.id, SyncChange.seq_num > payload.since_seq)
            .order_by(SyncChange.seq_num.asc())
            .limit(payload.limit + 1))
    changes = list(db.scalars(stmt))
    has_more = len(changes) > payload.limit
    items = changes[:payload.limit]
    new_seq = items[-1].seq_num if items else payload.since_seq
    return {
        **metadata,
        "mode": "delta",
        "latest_seq": latest_seq,
        "has_more": has_more,
        "new_seq": new_seq,
        "server_time": datetime.now().isoformat(),
        "changes": [
            {
                "id": c.id,
                "seq_num": c.seq_num,
                "entity_type": c.entity_type,
                "entity_id": c.entity_id,
                "action": c.action,
                "client_mutation_id": c.client_mutation_id,
                "data": json.loads(c.data_json) if c.data_json else {},
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in items
        ]
    }


@router.post("/sync/push")
def sync_push(payload: SyncPushIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    applied = []
    conflicts = []
    for mutation in payload.mutations:
        try:
            # Each change is atomic; a rejected row cannot poison the rest of a
            # batch. The tenant lock serializes duplicate retries across workers.
            with db.begin_nested():
                digest = hashlib.sha256(json.dumps(mutation.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                existing = db.scalar(select(SyncChange).where(SyncChange.business_id == business.id,
                                     SyncChange.client_mutation_id == mutation.client_mutation_id))
                if existing:
                    if existing.request_hash and existing.request_hash != digest:
                        raise HTTPException(409, "This mutation ID was already used for a different change")
                    record = json.loads(existing.data_json)
                    acknowledgement = json.loads(existing.ack_json) if existing.ack_json else {
                        "client_mutation_id": mutation.client_mutation_id, "entity_type": existing.entity_type,
                        "entity_id": existing.entity_id, "record": record.get("after", record), "seq_num": existing.seq_num}
                    acknowledgement["status"] = "already_applied"
                else:
                    acknowledgement = _apply_sync_mutation(db, user, business, mutation)
                    change = db.scalar(select(SyncChange).where(SyncChange.business_id == business.id,
                                       SyncChange.client_mutation_id == mutation.client_mutation_id))
                    acknowledgement["seq_num"] = change.seq_num
                    change.request_hash = digest
                    change.ack_json = json.dumps(acknowledgement)
                    db.flush()
            applied.append(acknowledgement)
        except HTTPException as error:
            conflicts.append({"client_mutation_id": mutation.client_mutation_id, "error": str(error.detail)})
        except IntegrityError:
            conflicts.append({"client_mutation_id": mutation.client_mutation_id, "error": "A conflicting record already exists or a referenced record is unavailable"})
    db.commit()
    return {"applied": applied, "conflicts": conflicts, "latest_seq": business.sync_seq}


@router.get("/sync/status")
def sync_status(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    latest_seq = db.scalar(select(func.coalesce(func.max(SyncChange.seq_num), 0)).where(SyncChange.business_id == business.id)) or 0
    tx_count = db.scalar(select(func.count(Transaction.id)).where(Transaction.business_id == business.id)) or 0
    inv_count = db.scalar(select(func.count(Invoice.id)).where(Invoice.business_id == business.id)) or 0
    return {
        "business_id": business.id,
        "business_name": business.name,
        "latest_seq": latest_seq,
        "transactions_count": tx_count,
        "invoices_count": inv_count,
        "server_time": datetime.now().isoformat(),
    }


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
    _require_write_access(user, db, business)
    results = {}
    for kind, label in (("income", "revenue"), ("expense", "expenses")):
        result = _forecast_for(db, business, kind, 30)
        _persist_forecast(db, business, label, result)
        results[label] = result
    db.commit()
    return {"revenue": results["revenue"], "expenses": results["expenses"], "generated_at": datetime.utcnow().isoformat() + "Z"}


@router.post("/forecasts/train/async", status_code=202)
def train_forecasts_async(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
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


@router.get("/forecasts/history")
def forecast_history(target: str | None = None, limit: int = Query(10, ge=1, le=50),
                     user: User = Depends(current_user), db: Session = Depends(get_db),
                     x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    stmt = select(ForecastRun).where(ForecastRun.business_id == business.id)
    if target in ("revenue", "expenses"):
        stmt = stmt.where(ForecastRun.target == target)
    rows = db.scalars(stmt.order_by(ForecastRun.created_at.desc(), ForecastRun.id.desc()).limit(limit)).all()
    results = []
    for run in rows:
        metrics = db.scalars(select(ForecastMetric).where(ForecastMetric.forecast_run_id == run.id).order_by(ForecastMetric.model)).all()
        predictions = db.scalars(select(FinancialForecast).where(FinancialForecast.forecast_run_id == run.id)
                                 .order_by(FinancialForecast.forecast_date)).all()
        results.append({"id": run.id, "target": run.target, "selected_model": run.selected_model,
                        "training_start": run.training_start.isoformat() if run.training_start else None,
                        "training_end": run.training_end.isoformat() if run.training_end else None,
                        "generated_at": run.created_at.isoformat() if run.created_at else None,
                        "metrics": [{"model": metric.model, "mae": float(metric.mae) if metric.mae is not None else None,
                                     "rmse": float(metric.rmse) if metric.rmse is not None else None,
                                     "mape": float(metric.mape) if metric.mape is not None else None,
                                     "wape": float(metric.wape) if metric.wape is not None else None,
                                     "status": metric.status, "selected": metric.selected} for metric in metrics],
                        "predictions": [{"date": point.forecast_date.isoformat(), "value": float(point.predicted_value),
                                         "lower": float(point.lower_bound), "upper": float(point.upper_bound)} for point in predictions]})
    return results


@router.post("/forecasts/generate")
def generate_forecast(payload: ForecastGenerateIn, user: User = Depends(current_user), db: Session = Depends(get_db),
                      x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    kind = "income" if payload.target == "revenue" else "expense"
    result = _forecast_for(db, business, kind, payload.horizon)
    _persist_forecast(db, business, payload.target, result)
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


@router.get("/forecasts/{target}")
def forecast_target(target: str, horizon: int = Query(30, ge=7, le=365), user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    if target not in ("revenue", "expenses"):
        raise HTTPException(404, "Forecast target must be revenue or expenses")
    business = _business(user, db, x_business_id)
    kind = "income" if target == "revenue" else "expense"
    result = _forecast_for(db, business, kind, horizon)
    _persist_forecast(db, business, target, result)
    db.commit()
    return result


@router.post("/scenarios")
def save_scenario(payload: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    values = payload.model_dump()
    row = FinancialScenario(business_id=business.id, name=values.pop("name"), assumptions=json.dumps(values, default=str))
    db.add(row)
    db.flush()
    for key, value in values.items():
        db.add(ScenarioAssumption(business_id=business.id, scenario_id=row.id, key=key,
                                  value=Decimal(str(value)).quantize(Decimal("0.0001"))))
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
    categories: dict[str, Decimal] = {}
    for transaction in recent:
        if transaction.kind == "expense":
            key = transaction.category.lower()
            categories[key] = categories.get(key, Decimal("0")) + transaction.amount
    revenue = _decimal(Decimal(str(latest["revenue"])) * (Decimal("1") + Decimal(str(values.get("revenue_change_pct", 0))) / 100)
                       + Decimal(str(values.get("new_monthly_revenue", 0))))
    expenses = _decimal(Decimal(str(latest["expenses"])) * (Decimal("1") + Decimal(str(values.get("expense_change_pct", 0))) / 100))
    expenses -= categories.get("marketing", Decimal("0")) * Decimal(str(values.get("marketing_reduction_pct", 0))) / 100
    expenses += categories.get("salaries", Decimal("0")) * Decimal(str(values.get("salary_increase_pct", 0))) / 100
    expenses += categories.get("inventory", Decimal("0")) * Decimal(str(values.get("inventory_increase_pct", 0))) / 100
    expenses += sum((Decimal(str(values.get(key, 0))) for key in
                     ("new_hire_monthly_cost", "campaign_monthly_cost", "additional_loan_payment")), Decimal("0"))
    expenses = max(Decimal("0"), _decimal(expenses))
    one_time = _decimal(Decimal(str(values.get("one_time_cost", 0))) + Decimal(str(values.get("capital_investment", 0))))
    loan_proceeds = _decimal(values.get("loan_proceeds", 0))
    horizon = int(values.get("horizon_months", 6))
    net = _decimal(revenue - expenses)
    cash = _current_cash(db, business) + loan_proceeds
    closing = _decimal(cash + net * horizon - one_time)
    burn = expenses - revenue
    runway = float(cash / burn * 30) if burn > 0 else None
    return {"name": name, "monthly_revenue": float(revenue), "monthly_expenses": float(expenses), "monthly_net_cash_flow": float(net),
            "closing_cash": float(closing), "cash_runway_days": round(runway, 1) if runway else None,
            "risk": "high" if closing < business.minimum_reserve else "moderate" if closing < business.minimum_reserve * Decimal("1.5") else "low",
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
    return {"scenarios": _scenario_comparison(db, business)}


def _scenario_comparison(db: Session, business: Business) -> list[dict]:
    presets = [("Baseline", 0, 0), ("Optimistic", 15, -5), ("Pessimistic", -20, 12)]
    results = [_simulate(db, business, {"revenue_change_pct": revenue, "expense_change_pct": expense, "horizon_months": 6}, name)
               for name, revenue, expense in presets]
    saved = db.scalars(select(FinancialScenario).where(FinancialScenario.business_id == business.id).order_by(FinancialScenario.created_at.desc())).all()
    results.extend(_simulate(db, business, json.loads(row.assumptions), row.name) for row in saved)
    return results


@router.get("/insights")
def get_insights(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    return _insights(db, _business(user, db, x_business_id))


@router.get("/insights/history")
def insight_history(user: User = Depends(current_user), db: Session = Depends(get_db),
                    x_business_id: int | None = Header(default=None), limit: int = Query(50, ge=1, le=200)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(FinancialInsight).where(FinancialInsight.business_id == business.id)
                      .order_by(FinancialInsight.created_at.desc(), FinancialInsight.id.desc()).limit(limit)).all()
    return [{"id": row.id, "title": row.title, "description": row.description,
             "supporting_figures": json.loads(row.supporting_figures_json), "period": row.period,
             "severity": row.severity, "recommended_action": row.recommended_action,
             "reference": row.reference, "created_at": row.created_at.isoformat() if row.created_at else None}
            for row in rows]


@router.post("/insights/generate")
def generate_insights(user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    business = _business(user, db, x_business_id)
    _require_write_access(user, db, business)
    items = _insights(db, business)
    for item in items:
        db.add(FinancialInsight(business_id=business.id, title=item["title"], description=item["description"],
                                supporting_figures_json=json.dumps(item["supporting_figures"], default=str),
                                period=item["period"], severity=item["severity"],
                                recommended_action=item["recommended_action"], reference=item["reference"]))
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


@router.get("/reports")
def list_reports(user: User = Depends(current_user), db: Session = Depends(get_db),
                 x_business_id: int | None = Header(default=None), limit: int = Query(20, ge=1, le=100)):
    business = _business(user, db, x_business_id)
    rows = db.scalars(select(ReportRun).where(ReportRun.business_id == business.id)
                      .order_by(ReportRun.generated_at.desc(), ReportRun.id.desc()).limit(limit)).all()
    return [{"id": row.id, "report_type": row.report_type, "format": row.format,
             "period_months": row.period_months, "file_name": row.file_name,
             "generated_at": row.generated_at.isoformat() if row.generated_at else None} for row in rows]


@router.post("/reports/generate")
def generate_report(payload: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db), x_business_id: int | None = Header(default=None)):
    from xml.sax.saxutils import escape

    business = _business(user, db, x_business_id)
    fmt, months, report_type = payload.format, payload.months, payload.report_type
    today = date.today()
    start = _month_start(months)
    rows = _transactions(db, business, start, today)
    rows.extend(_transactions(db, business, start, today + timedelta(days=365), statuses=("pending", "scheduled")))
    rows.sort(key=lambda row: (row.date, row.id))
    completed = [row for row in rows if row.status == "completed"]
    pending = [row for row in rows if row.status in ("pending", "scheduled")]
    monthly = _monthly(db, business, months)
    revenue = sum((row.amount for row in completed if row.kind == "income"), Decimal("0"))
    expenses = sum((row.amount for row in completed if row.kind == "expense"), Decimal("0"))
    net_cash_flow = revenue - expenses
    current_cash = _current_cash(db, business)
    receivables = sum((row.amount for row in pending if row.kind == "income"), Decimal("0"))
    payables = sum((row.amount for row in pending if row.kind == "expense"), Decimal("0"))
    recent90 = _transactions(db, business, today - timedelta(days=90), today)
    burn = (sum((row.amount for row in recent90 if row.kind == "expense"), Decimal("0"))
            - sum((row.amount for row in recent90 if row.kind == "income"), Decimal("0"))) / Decimal("90")
    runway_days = float(current_cash / burn) if burn > 0 else None
    cash_margin = float(net_cash_flow / revenue * 100) if revenue else 0.0
    categories: dict[str, Decimal] = {}
    for row in completed:
        if row.kind == "expense":
            categories[row.category] = categories.get(row.category, Decimal("0")) + row.amount
    category_rows = sorted(categories.items(), key=lambda item: item[1], reverse=True)
    forecast_context = fmt in ("pdf", "xlsx")
    revenue_forecast = _forecast_for(db, business, "income", 90) if forecast_context else None
    expense_forecast = _forecast_for(db, business, "expense", 90) if forecast_context else None
    projection = _cash_projection(db, business, 90) if forecast_context else None
    insights = _insights(db, business) if forecast_context else []
    scenarios = _scenario_comparison(db, business) if report_type == "scenario_comparison" else []
    report_titles = {"financial_summary": "Financial summary", "cash_flow": "Cash flow statement",
                     "revenue_analysis": "Revenue analysis", "expense_analysis": "Expense analysis",
                     "forecast": "Forecast report", "risk": "Cash shortage risk report",
                     "scenario_comparison": "Scenario comparison report"}
    report_title = report_titles[report_type]
    currency_code = business.currency
    amount_text = lambda value: f"{currency_code} {float(value):,.2f}"
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
        from openpyxl.chart import LineChart, Reference

        frame = pd.DataFrame([{"Date": t.date.isoformat(), "Type": t.kind, "Category": t.category, "Description": t.description, "Amount": float(t.amount), "Status": t.status, "Payment method": t.payment_method} for t in rows],
                             columns=["Date", "Type", "Category", "Description", "Amount", "Status", "Payment method"])
        monthly_frame = pd.DataFrame(monthly, columns=["month", "revenue", "expenses", "net_cash_flow"])
        summary_frame = pd.DataFrame([
            {"Metric": "Business", "Value": business.name}, {"Metric": "Report", "Value": report_title},
            {"Metric": "Period start", "Value": start.isoformat()}, {"Metric": "Period end", "Value": today.isoformat()},
            {"Metric": "Currency", "Value": currency_code}, {"Metric": "Revenue", "Value": float(revenue)},
            {"Metric": "Expenses", "Value": float(expenses)}, {"Metric": "Net cash flow", "Value": float(net_cash_flow)},
            {"Metric": "Cash margin (%)", "Value": round(cash_margin, 2)}, {"Metric": "Current cash", "Value": float(current_cash)},
            {"Metric": "Accounts receivable", "Value": float(receivables)}, {"Metric": "Accounts payable", "Value": float(payables)},
            {"Metric": "Working capital", "Value": float(current_cash + receivables - payables)},
            {"Metric": "Cash runway (days)", "Value": round(runway_days, 1) if runway_days is not None else "No net burn"},
            {"Metric": "Revenue forecasting model", "Value": projection["revenue_model"]},
            {"Metric": "Expense forecasting model", "Value": projection["expense_model"]},
        ])
        forecast_frame = pd.DataFrame([{"Date": point["date"], "Forecast inflows": point["inflows"],
                                       "Forecast outflows": point["outflows"], "Projected balance": point["balance"],
                                       "Lower balance": point["lower_balance"], "Upper balance": point["upper_balance"]}
                                      for point in projection["days"]],
                                     columns=["Date", "Forecast inflows", "Forecast outflows", "Projected balance", "Lower balance", "Upper balance"])
        insights_frame = pd.DataFrame([{"Title": item["title"], "Severity": item["severity"], "Description": item["description"],
                                        "Recommended action": item["recommended_action"], "Evidence": item["reference"]}
                                       for item in insights],
                                      columns=["Title", "Severity", "Description", "Recommended action", "Evidence"])
        metric_rows = [{"Target": target, "Model": item["model"], "Selected": item["selected"], "MAE": item["mae"],
                        "RMSE": item["rmse"], "MAPE (%)": item["mape"], "WAPE (%)": item["wape"]}
                       for target, result in (("Revenue", revenue_forecast), ("Expenses", expense_forecast))
                       for item in result["metrics"]]
        metrics_frame = pd.DataFrame(metric_rows, columns=["Target", "Model", "Selected", "MAE", "RMSE", "MAPE (%)", "WAPE (%)"])
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            summary_frame.to_excel(writer, index=False, sheet_name="Financial summary")
            frame.to_excel(writer, index=False, sheet_name="Transactions")
            monthly_frame.to_excel(writer, index=False, sheet_name="Monthly summary")
            forecast_frame.to_excel(writer, index=False, sheet_name="90-day forecast")
            metrics_frame.to_excel(writer, index=False, sheet_name="Forecast model metrics")
            insights_frame.to_excel(writer, index=False, sheet_name="Insights")
            pd.DataFrame([{"Category": category, "Expense": float(value), "Share (%)": float(value / expenses * 100) if expenses else 0}
                          for category, value in category_rows]).to_excel(writer, index=False, sheet_name="Expense categories")
            if scenarios:
                pd.DataFrame(scenarios).to_excel(writer, index=False, sheet_name="Scenarios")
            pd.DataFrame([{"Assumption": "Forecasts use completed transaction history and chronological holdout validation."},
                          {"Assumption": "Pending and scheduled items are applied to cash flow on their due dates."},
                          {"Assumption": "Forecast intervals use historical validation errors and are not guarantees."},
                          {"Assumption": "Cash margin is net cash flow divided by cash revenue; it is not accrual profit margin."}]).to_excel(writer, index=False, sheet_name="Methodology")
            worksheet = writer.sheets["Monthly summary"]
            if len(monthly_frame) > 0:
                chart = LineChart()
                chart.title = "Revenue and expenses"
                chart.y_axis.title = f"Amount ({currency_code})"
                chart.x_axis.title = "Month"
                chart.style = 13
                chart.add_data(Reference(worksheet, min_col=2, max_col=3, min_row=1, max_row=worksheet.max_row), titles_from_data=True)
                chart.set_categories(Reference(worksheet, min_col=1, min_row=2, max_row=worksheet.max_row))
                worksheet.add_chart(chart, "F2")
        mime, extension = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    elif fmt == "pdf":
        from reportlab.graphics.charts.barcharts import VerticalBarChart
        from reportlab.graphics.shapes import Drawing, String
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet
        styles = getSampleStyleSheet()
        doc = SimpleDocTemplate(output, pagesize=landscape(A4), rightMargin=36, leftMargin=36, topMargin=32, bottomMargin=32)

        def make_table(data):
            result = Table(data, repeatRows=1, hAlign="LEFT")
            result.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#102d25")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), .3, colors.HexColor("#dbe4df")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7f5")]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 6),
            ]))
            return result

        story = [Paragraph(escape(f"{business.name} · {report_title}"), styles["Title"]),
                 Paragraph(escape(f"Period: {start.isoformat()} to {today.isoformat()} · Currency: {currency_code}"), styles["Normal"]),
                 Spacer(1, 12), Paragraph("Financial KPIs", styles["Heading2"])]
        story.append(make_table([["Metric", "Value"], ["Revenue", amount_text(revenue)], ["Expenses", amount_text(expenses)],
                                 ["Net cash flow", amount_text(net_cash_flow)], ["Cash margin", f"{cash_margin:.2f}%"],
                                 ["Current cash", amount_text(current_cash)], ["Accounts receivable", amount_text(receivables)],
                                 ["Accounts payable", amount_text(payables)], ["Working capital", amount_text(current_cash + receivables - payables)],
                                 ["Cash runway", f"{runway_days:.1f} days" if runway_days is not None else "No net burn"]]))

        chart_data = [[item["revenue"] for item in monthly], [item["expenses"] for item in monthly]]
        chart = VerticalBarChart()
        chart.x, chart.y, chart.width, chart.height = 45, 28, 480, 150
        chart.data = chart_data
        chart.categoryAxis.categoryNames = [item["month"] for item in monthly]
        chart.categoryAxis.labels.fontSize = 6
        chart.categoryAxis.labels.angle = 35
        chart.valueAxis.valueMin = 0
        chart.valueAxis.valueMax = max(1.0, max((max(series) for series in chart_data), default=0.0) * 1.15)
        chart.valueAxis.valueStep = max(1.0, chart.valueAxis.valueMax / 5)
        chart.bars[0].fillColor = colors.HexColor("#147354")
        chart.bars[1].fillColor = colors.HexColor("#db6b5c")
        drawing = Drawing(550, 210)
        drawing.add(String(0, 195, "Monthly revenue vs expenses · green = revenue · red = expenses", fontSize=9))
        drawing.add(chart)
        story.extend([Spacer(1, 8), drawing, Paragraph("Monthly actuals", styles["Heading2"])])
        monthly_data = [["Month", "Revenue", "Expenses", "Net cash flow"]]
        monthly_data.extend([[item["month"], amount_text(item["revenue"]), amount_text(item["expenses"]), amount_text(item["net_cash_flow"])] for item in monthly])
        story.extend([make_table(monthly_data), Spacer(1, 10), Paragraph("Expense categories", styles["Heading2"])])
        category_data = [["Category", "Expense", "Share"]]
        category_data.extend([[escape(category), amount_text(value), f"{float(value / expenses * 100):.1f}%" if expenses else "0.0%"] for category, value in category_rows])
        story.extend([make_table(category_data), Spacer(1, 10), Paragraph("90-day cash outlook", styles["Heading2"])])
        story.append(Paragraph(escape(f"Revenue model: {projection['revenue_model']} · Expense model: {projection['expense_model']} · Confirmed obligations: {projection['confirmed_obligations']} · Recurring assumptions: {projection['recurring_occurrences']}"), styles["Normal"]))
        if projection["shortfall"]:
            shortfall = projection["shortfall"]
            story.append(Paragraph(escape(f"Reserve warning: projected cash first falls below {amount_text(business.minimum_reserve)} on {shortfall['date']}, by {amount_text(shortfall['amount_below_reserve'])}."), styles["Normal"]))
        else:
            story.append(Paragraph(escape(f"No reserve breach is projected in the next 90 days. Lowest projected cash: {amount_text(projection['minimum_expected_balance'])}."), styles["Normal"]))
        model_data = [["Target", "Model", "Selected", "MAE", "RMSE", "MAPE", "WAPE"]]
        for target, result in (("Revenue", revenue_forecast), ("Expenses", expense_forecast)):
            for metric in result["metrics"]:
                model_data.append([target, escape(metric["model"]), "Yes" if metric["selected"] else "No",
                                   amount_text(metric["mae"]), amount_text(metric["rmse"]),
                                   f"{metric['mape']:.2f}%" if metric["mape"] is not None else "—",
                                   f"{metric['wape']:.2f}%" if metric["wape"] is not None else "—"])
        story.extend([Paragraph("Forecast model comparison · chronological validation", styles["Heading3"]), make_table(model_data)])
        forecast_data = [["Week ending", "Forecast inflows", "Forecast outflows", "Projected cash"]]
        for offset in range(0, len(projection["days"]), 7):
            week = projection["days"][offset:offset + 7]
            forecast_data.append([week[-1]["date"], amount_text(sum(day["inflows"] for day in week)),
                                  amount_text(sum(day["outflows"] for day in week)), amount_text(week[-1]["balance"])])
        story.extend([make_table(forecast_data), Spacer(1, 10), Paragraph("Explainable business insights", styles["Heading2"])])
        for item in insights:
            story.extend([Paragraph(escape(f"{item['title']} · {item['severity']}"), styles["Heading3"]),
                          Paragraph(escape(item["description"]), styles["Normal"]),
                          Paragraph(escape(f"Recommended action: {item['recommended_action']}"), styles["Normal"]),
                          Paragraph(escape(f"Evidence: {item['reference']}"), styles["Italic"]), Spacer(1, 4)])
        if scenarios:
            scenario_data = [["Scenario", "Revenue / month", "Expenses / month", "Net / month", "Closing cash", "Risk"]]
            scenario_data.extend([[escape(item["name"]), amount_text(item["monthly_revenue"]), amount_text(item["monthly_expenses"]),
                                   amount_text(item["monthly_net_cash_flow"]), amount_text(item["closing_cash"]), item["risk"]]
                                  for item in scenarios])
            story.extend([Paragraph("Scenario comparison", styles["Heading2"]), make_table(scenario_data)])
        story.extend([Spacer(1, 10), Paragraph("Methodology and assumptions", styles["Heading2"]),
                      Paragraph("Revenue and expenses use completed transaction dates. Open transactions are shown separately and applied to cash projections on due dates. Cash margin is net cash flow divided by cash revenue; it is not accrual profit margin. Forecasts use chronological holdout model selection and historical validation errors for descriptive intervals. Forecasts are estimates, not guarantees.", styles["Normal"])])
        doc.build(story)
        mime, extension = "application/pdf", "pdf"
    else:
        raise HTTPException(422, "format must be csv, xlsx, or pdf")
    output.seek(0)
    file_name = f"finsight-{business.id}-{report_type}-{start.isoformat()}-{today.isoformat()}.{extension}"
    db.add(ReportRun(business_id=business.id, user_id=user.id, report_type=report_type, format=extension,
                     period_months=months, file_name=file_name))
    db.commit()
    return StreamingResponse(output, media_type=mime, headers={"Content-Disposition": f"attachment; filename={file_name}"})


@router.get("/health")
def api_health():
    return {"status": "ok", "service": "finsight-api"}
