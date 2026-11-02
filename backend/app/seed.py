import random
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Business, BusinessMember, RecurringTransaction, Transaction, User
from .security import hash_password


def seed_demo(db: Session) -> None:
    if db.scalar(select(User).where(User.email == "demo@finsight.ai")):
        return
    rng = random.Random(641928)
    user = User(email="demo@finsight.ai", name="Demo Owner", password_hash=hash_password("Demo1234!"))
    db.add(user)
    db.flush()
    business = Business(name="Northstar Studio", currency="INR", opening_cash=Decimal("1250000.00"), minimum_reserve=Decimal("500000.00"), is_demo=True)
    db.add(business)
    db.flush()
    db.add(BusinessMember(user_id=user.id, business_id=business.id, role="owner"))
    today = date.today()
    first = (today.replace(day=1) - timedelta(days=23 * 31)).replace(day=1)
    current = first
    months = []
    while current <= today.replace(day=1):
        months.append(current)
        current = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    transactions = []
    for index, month in enumerate(months):
        days = monthrange(month.year, month.month)[1]
        latest_day = min(days, today.day) if month.year == today.year and month.month == today.month else days
        trend = 480000 * (1 + index * 0.017)
        if index in (9, 10):
            trend *= 1.20
        if index in (14, 15):
            trend *= 0.82
        if index in (len(months) - 2, len(months) - 1):
            trend *= 0.91
        seasonal = 1 + 0.10 * __import__("math").sin((month.month - 1) * 2 * __import__("math").pi / 12)
        revenue_total = trend * seasonal * rng.uniform(.90, 1.13)
        weights = [rng.uniform(.65, 1.35) for _ in range(7)]
        weight_sum = sum(weights)
        for order, weight in enumerate(weights):
            when = date(month.year, month.month, min(rng.randint(2, 27), latest_day))
            amount = revenue_total * weight / weight_sum
            if index == len(months) - 1 and order == 0:
                when = today - timedelta(days=min(2, today.day - 1))
            transactions.append(Transaction(business_id=business.id, kind="income", category="Sales Revenue" if order < 5 else "Service Revenue",
                amount=Decimal(str(round(amount, 2))), date=when, description=rng.choice(["Customer invoice settled", "Retail sales batch", "Project milestone payment", "Online sales settlement"]),
                payment_method=rng.choice(["Bank transfer", "UPI", "Card settlement"]), status="completed", reference=f"DEMO-IN-{month:%Y%m}-{order+1:02d}"))
        fixed_expenses = [
            ("Salaries", 245000, 5, "Monthly payroll"), ("Rent", 62000, 2, "Studio rent"),
            ("Utilities", 13500, 8, "Electricity and internet"), ("Marketing", 26000 + 25000 * (index % 5 == 2), 11, "Campaign spend"),
            ("Inventory", 85000 + index * 900, 14, "Supplier stock purchase"), ("Transportation", 18000, 17, "Delivery and travel"),
            ("Software Subscriptions", 14500, 20, "Business software subscriptions"), ("Taxes", 22000 if month.month in (3, 6, 9, 12) else 8000, 23, "Tax provision"),
            ("Loan Repayments", 28000, 25, "Equipment finance repayment"),
        ]
        for category, amount, day, description in fixed_expenses:
            actual = amount * rng.uniform(.92, 1.09)
            if category == "Inventory" and index in (7, 18):
                actual *= 1.7
            transactions.append(Transaction(business_id=business.id, kind="expense", category=category,
                amount=Decimal(str(round(actual, 2))), date=date(month.year, month.month, min(day, latest_day)), description=description,
                payment_method="Bank transfer", status="completed", reference=f"DEMO-OUT-{month:%Y%m}-{category[:3].upper()}"))
        if index in (5, 17):
            transactions.append(Transaction(business_id=business.id, kind="expense", category="Maintenance", amount=Decimal("68500.00"),
                date=date(month.year, month.month, min(19, days)), description="Unexpected equipment repair", payment_method="Card", status="completed"))
    db.add_all(transactions)
    # Confirmed and pending items stay separate from historical actuals and enter forecasts on their due date.
    db.add_all([
        Transaction(business_id=business.id, kind="expense", category="Salaries", amount=Decimal("251000.00"), date=today + timedelta(days=5), description="Next payroll", payment_method="Bank transfer", status="scheduled", reference="DEMO-SCHED-PAYROLL"),
        Transaction(business_id=business.id, kind="expense", category="Rent", amount=Decimal("62000.00"), date=today + timedelta(days=8), description="Next month rent", payment_method="Bank transfer", status="scheduled", reference="DEMO-SCHED-RENT"),
        Transaction(business_id=business.id, kind="income", category="Service Revenue", amount=Decimal("145000.00"), date=today + timedelta(days=14), description="Customer invoice due", payment_method="Bank transfer", status="pending", reference="DEMO-AR-001"),
        Transaction(business_id=business.id, kind="expense", category="Inventory", amount=Decimal("78000.00"), date=today + timedelta(days=19), description="Supplier payment due", payment_method="Bank transfer", status="pending", reference="DEMO-AP-001"),
    ])
    db.add_all([
        RecurringTransaction(business_id=business.id, kind="expense", category="Salaries", amount=Decimal("251000.00"), frequency="monthly", next_date=today + timedelta(days=5), description="Monthly payroll", payment_method="Bank transfer"),
        RecurringTransaction(business_id=business.id, kind="expense", category="Rent", amount=Decimal("62000.00"), frequency="monthly", next_date=today + timedelta(days=8), description="Studio rent", payment_method="Bank transfer"),
        RecurringTransaction(business_id=business.id, kind="expense", category="Software Subscriptions", amount=Decimal("14500.00"), frequency="monthly", next_date=today + timedelta(days=22), description="Monthly software subscriptions", payment_method="Card"),
    ])
    db.commit()

