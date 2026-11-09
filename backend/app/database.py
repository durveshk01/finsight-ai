import os
import re
from collections.abc import Generator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./finsight.db")
DATABASE_SCHEMA = os.getenv("DATABASE_SCHEMA", "").strip()


def database_url_for_schema(database_url: str) -> str:
    if not DATABASE_SCHEMA or database_url.startswith("sqlite"):
        return database_url
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", DATABASE_SCHEMA):
        raise ValueError("DATABASE_SCHEMA must be a lowercase PostgreSQL identifier")
    url = make_url(database_url)
    query = dict(url.query)
    options = query.get("options", "")
    search_path = f"-csearch_path={DATABASE_SCHEMA}"
    query["options"] = f"{options} {search_path}".strip()
    return url.set(query=query).render_as_string(hide_password=False)


ENGINE_DATABASE_URL = database_url_for_schema(DATABASE_URL)
connect_args = {"check_same_thread": False} if ENGINE_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(ENGINE_DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _adopt_legacy_database(database_url: str) -> bool:
    from decimal import Decimal, InvalidOperation
    import json

    from . import models as _models

    legacy_connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    legacy_engine = create_engine(database_url, pool_pre_ping=True, connect_args=legacy_connect_args)
    try:
        tables = set(inspect(legacy_engine).get_table_names())
        if "alembic_version" in tables or not {"users", "businesses", "transactions"}.issubset(tables):
            return False

        with legacy_engine.begin() as connection:
            metadata_tables = Base.metadata.tables
            metadata_tables["transaction_categories"].create(connection, checkfirst=True)
            metadata_tables["accounts"].create(connection, checkfirst=True)
            business_columns = {column["name"] for column in inspect(connection).get_columns("businesses")}
            if "sync_seq" not in business_columns:
                connection.exec_driver_sql("ALTER TABLE businesses ADD COLUMN sync_seq BIGINT NOT NULL DEFAULT 0")
            transaction_columns = {column["name"] for column in inspect(connection).get_columns("transactions")}
            if "category_id" not in transaction_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE transactions ADD COLUMN category_id INTEGER "
                    "REFERENCES transaction_categories(id) ON DELETE SET NULL"
                )
            if "account_id" not in transaction_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE transactions ADD COLUMN account_id INTEGER "
                    "REFERENCES accounts(id) ON DELETE SET NULL"
                )
            if "to_account_id" not in transaction_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE transactions ADD COLUMN to_account_id INTEGER "
                    "REFERENCES accounts(id) ON DELETE SET NULL"
                )

            Base.metadata.create_all(bind=connection)
            for table in metadata_tables.values():
                for index in table.indexes:
                    index.create(bind=connection, checkfirst=True)

            default_names = {
                "income": {"Sales Revenue", "Service Revenue", "Interest Income", "Investment Income", "Other Income"},
                "expense": {"Salaries", "Rent", "Utilities", "Marketing", "Inventory", "Transportation",
                            "Software Subscriptions", "Taxes", "Loan Repayments", "Maintenance", "Other Expenses"},
            }
            category_rows = connection.execute(text(
                "SELECT DISTINCT business_id, kind, category FROM transactions WHERE category IS NOT NULL"
            )).mappings().all()
            for row in category_rows:
                category_id = connection.execute(text(
                    "SELECT id FROM transaction_categories WHERE business_id = :business_id "
                    "AND kind = :kind AND lower(name) = lower(:name)"
                ), {"business_id": row["business_id"], "kind": row["kind"], "name": row["category"]}).scalar()
                if category_id is None:
                    category_id = connection.execute(text(
                        "INSERT INTO transaction_categories (business_id, kind, name, is_system) "
                        "VALUES (:business_id, :kind, :name, :is_system) RETURNING id"
                    ), {"business_id": row["business_id"], "kind": row["kind"], "name": row["category"],
                        "is_system": row["category"] in default_names.get(row["kind"], set())}).scalar_one()
            connection.execute(text(
                "UPDATE transactions SET category_id = (SELECT id FROM transaction_categories "
                "WHERE transaction_categories.business_id = transactions.business_id "
                "AND transaction_categories.kind = transactions.kind "
                "AND lower(transaction_categories.name) = lower(transactions.category)) "
                "WHERE category_id IS NULL"
            ))

            if "financial_scenarios" in set(inspect(connection).get_table_names()):
                scenario_columns = {column["name"] for column in inspect(connection).get_columns("financial_scenarios")}
                if "assumptions" in scenario_columns:
                    scenarios = connection.execute(text(
                        "SELECT id, business_id, assumptions FROM financial_scenarios"
                    )).mappings().all()
                    for scenario in scenarios:
                        try:
                            assumptions = json.loads(scenario["assumptions"])
                        except (TypeError, ValueError):
                            continue
                        for key, value in assumptions.items():
                            if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                                continue
                            try:
                                numeric_value = Decimal(str(value))
                            except InvalidOperation:
                                continue
                            if not numeric_value.is_finite():
                                continue
                            exists = connection.execute(text(
                                "SELECT 1 FROM scenario_assumptions WHERE scenario_id = :scenario_id AND \"key\" = :key"
                            ), {"scenario_id": scenario["id"], "key": key}).first()
                            if not exists:
                                connection.execute(text(
                                    "INSERT INTO scenario_assumptions (business_id, scenario_id, \"key\", value) "
                                    "VALUES (:business_id, :scenario_id, :key, :value)"
                                ), {"business_id": scenario["business_id"], "scenario_id": scenario["id"],
                                    "key": key, "value": str(numeric_value)})
        return True
    finally:
        legacy_engine.dispose()


def migrate_database() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    database_url = os.getenv("DATABASE_URL", DATABASE_URL)
    engine_url = database_url_for_schema(database_url)
    if DATABASE_SCHEMA and not engine_url.startswith("sqlite"):
        with engine.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{DATABASE_SCHEMA}"')
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "migrations").replace("%", "%%"))
    config.set_main_option("sqlalchemy.url", engine_url.replace("%", "%%"))
    if _adopt_legacy_database(engine_url):
        command.stamp(config, "f3dd8e733358")
    command.upgrade(config, "head")


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
