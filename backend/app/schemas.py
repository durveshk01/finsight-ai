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


class BusinessMemberIn(BaseModel):
    email: EmailStr
    role: Literal["admin", "accountant", "viewer"] = "viewer"


class BusinessMemberRoleIn(BaseModel):
    role: Literal["admin", "accountant", "viewer"]


class TransactionIn(BaseModel):
    kind: Literal["income", "expense"]
    category: str = Field(min_length=2, max_length=80)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    date: date
    description: str = Field(default="", max_length=240)
    payment_method: str = Field(default="Bank transfer", max_length=48)
    status: Literal["completed", "pending", "scheduled"] = "completed"
    reference: str | None = Field(default=None, max_length=100)
    account_id: int | None = None

    @field_validator("category")
    @classmethod
    def clean_category(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("category must contain at least two non-space characters")
        return cleaned


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


class AccountIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    account_type: Literal["bank", "cash", "card", "wallet"] = "bank"
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    opening_balance: Decimal = Field(default=Decimal("0"), max_digits=16, decimal_places=2)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("account name must contain at least two non-space characters")
        return cleaned


class CategoryIn(BaseModel):
    kind: Literal["income", "expense"]
    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("category name must contain at least two non-space characters")
        return cleaned


class InvoiceIn(BaseModel):
    direction: Literal["receivable", "payable"]
    invoice_number: str = Field(min_length=1, max_length=80)
    counterparty: str = Field(min_length=2, max_length=180)
    issue_date: date
    due_date: date
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    account_id: int | None = None
    description: str = Field(default="", max_length=240)

    @field_validator("due_date")
    @classmethod
    def due_after_issue(cls, value: date, info):
        issue_date = info.data.get("issue_date")
        if issue_date and value < issue_date:
            raise ValueError("Due date must be on or after issue date")
        return value

    @field_validator("invoice_number", "counterparty")
    @classmethod
    def clean_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value cannot contain only whitespace")
        return cleaned


class InvoicePaymentIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    paid_on: date
    payment_method: str = Field(default="Bank transfer", max_length=48)
    account_id: int | None = None
    reference: str | None = Field(default=None, max_length=100)


class ForecastGenerateIn(BaseModel):
    target: Literal["revenue", "expenses"] = "revenue"
    horizon: int = Field(default=30, ge=7, le=365)


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


class ReportIn(BaseModel):
    report_type: Literal["financial_summary", "cash_flow", "revenue_analysis", "expense_analysis", "forecast", "risk", "scenario_comparison"] = "financial_summary"
    format: Literal["pdf", "xlsx", "csv"] = "pdf"
    months: int = Field(default=12, ge=1, le=36)

