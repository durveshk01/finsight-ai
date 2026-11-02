"""Persist generated report history.

Revision ID: 0002_report_runs
Revises: 0001_initial
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_report_runs"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("business_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("report_type", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=8), nullable=False),
        sa.Column("period_months", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=240), nullable=False),
        sa.Column("generated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_report_runs_business_generated", "report_runs", ["business_id", "generated_at"])
    op.create_index(op.f("ix_report_runs_business_id"), "report_runs", ["business_id"], unique=False)
    op.create_index(op.f("ix_report_runs_user_id"), "report_runs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_report_runs_user_id"), table_name="report_runs")
    op.drop_index(op.f("ix_report_runs_business_id"), table_name="report_runs")
    op.drop_index("ix_report_runs_business_generated", table_name="report_runs")
    op.drop_table("report_runs")
