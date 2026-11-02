from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class AuthIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterIn(AuthIn):
    name: str = Field(min_length=2, max_length=120)
    business_name: str = Field(min_length=2, max_length=180)
    currency: str = Field(default="INR", min_length=3, max_length=3)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    model_config = ConfigDict(from_attributes=True)


class BusinessIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    opening_cash: Decimal = Decimal("0")
    minimum_reserve: Decimal = Decimal("100000")


class BusinessOut(BusinessIn):
    id: int
    is_demo: bool
    model_config = ConfigDict(from_attributes=True)


class TransactionIn(BaseModel):
    kind: Literal["income", "expense"]
    category: str = Field(min_length=2, max_length=80)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    date: date
    description: str = Field(default="", max_length=240)
    payment_method: str = Field(default="Bank transfer", max_length=48)
    status: Literal["completed", "pending", "scheduled"] = "completed"
    reference: str | None = Field(default=None, max_length=100)

    @field_validator("category")
    @classmethod
    def clean_category(cls, value: str) -> str:
        return value.strip()


class TransactionOut(TransactionIn):
    id: int
    business_id: int
    created_at: str | None = None
    model_config = ConfigDict(from_attributes=True)


class RecurringTransactionIn(BaseModel):
    kind: Literal["income", "expense"]
    category: str = Field(min_length=2, max_length=80)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    frequency: Literal["weekly", "monthly", "quarterly"] = "monthly"
    next_date: date
    end_date: date | None = None
    description: str = Field(default="", max_length=240)
    payment_method: str = Field(default="Bank transfer", max_length=48)


class ScenarioIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    revenue_change_pct: float = Field(default=0, ge=-100, le=500)
    expense_change_pct: float = Field(default=0, ge=-100, le=500)
    one_time_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    new_monthly_revenue: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    marketing_reduction_pct: float = Field(default=0, ge=0, le=100)
    salary_increase_pct: float = Field(default=0, ge=0, le=200)
    inventory_increase_pct: float = Field(default=0, ge=0, le=300)
    new_hire_monthly_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    campaign_monthly_cost: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    additional_loan_payment: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    loan_proceeds: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    capital_investment: Decimal = Field(default=Decimal("0"), ge=0, max_digits=16, decimal_places=2)
    horizon_months: int = Field(default=6, ge=1, le=24)

