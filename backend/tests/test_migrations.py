from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.database import migrate_database


def test_application_migrates_a_fresh_database_and_is_idempotent(tmp_path, monkeypatch):
    db_path = (tmp_path / "fresh.db").as_posix()
    database_url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    migrate_database()
    migrate_database()

    engine = create_engine(database_url)
    try:
        required_tables = {
            "users", "businesses", "business_members", "transactions", "transaction_categories",
            "recurring_transactions", "accounts", "invoices", "receivables", "payables", "payments",
            "financial_forecasts", "forecast_runs", "forecast_metrics", "financial_scenarios",
            "scenario_assumptions", "financial_insights", "notifications", "audit_logs", "report_runs",
        }
        assert required_tables.issubset(set(inspect(engine).get_table_names()))
        with engine.connect() as connection:
            revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
        assert revision == "f3dd8e733358"
    finally:
        engine.dispose()


def test_application_adopts_unversioned_legacy_database_without_losing_transactions(tmp_path, monkeypatch):
    db_path = (tmp_path / "legacy.db").as_posix()
    database_url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE businesses (id INTEGER PRIMARY KEY, name VARCHAR(180) NOT NULL, "
                "currency VARCHAR(3) NOT NULL, opening_cash NUMERIC(16,2) NOT NULL, "
                "minimum_reserve NUMERIC(16,2) NOT NULL, is_demo BOOLEAN NOT NULL, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
            )
            connection.exec_driver_sql(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, "
                "name VARCHAR(120) NOT NULL, password_hash VARCHAR(255) NOT NULL, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"
            )
            connection.exec_driver_sql(
                "CREATE TABLE transactions (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, "
                "kind VARCHAR(12) NOT NULL, category VARCHAR(80) NOT NULL, amount NUMERIC(16,2) NOT NULL, "
                "date DATE NOT NULL, description VARCHAR(240) NOT NULL, payment_method VARCHAR(48) NOT NULL, "
                "status VARCHAR(16) NOT NULL, reference VARCHAR(100), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, "
                "FOREIGN KEY(business_id) REFERENCES businesses(id))"
            )
            connection.exec_driver_sql(
                "INSERT INTO businesses (id, name, currency, opening_cash, minimum_reserve, is_demo) "
                "VALUES (1, 'Legacy Studio', 'INR', 12500, 2500, 1)"
            )
            connection.exec_driver_sql(
                "INSERT INTO users (id, email, name, password_hash) "
                "VALUES (1, 'legacy@example.com', 'Legacy Owner', 'hashed')"
            )
            connection.exec_driver_sql(
                "INSERT INTO transactions (id, business_id, kind, category, amount, date, description, "
                "payment_method, status, reference) VALUES "
                "(1, 1, 'income', 'Sales Revenue', 900.25, '2026-01-05', 'Existing sale', "
                "'Bank transfer', 'completed', 'LEGACY-1')"
            )
    finally:
        engine.dispose()

    migrate_database()

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "f3dd8e733358"
            row = connection.execute(text(
                "SELECT t.amount, t.category_id, c.name FROM transactions t "
                "JOIN transaction_categories c ON c.id = t.category_id WHERE t.id = 1"
            )).one()
        assert float(row.amount) == 900.25
        assert row.name == "Sales Revenue"
        assert "accounts" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_migration_normalizes_decimal_scenario_assumptions(tmp_path, monkeypatch):
    db_path = (tmp_path / "scenario-migration.db").as_posix()
    database_url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "migrations"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "0002_report_runs")

    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "INSERT INTO businesses (id, name, currency, opening_cash, minimum_reserve, is_demo) "
                "VALUES (1, 'Scenario Studio', 'INR', 10000, 1000, 0)"
            ))
            connection.execute(text(
                "INSERT INTO financial_scenarios (id, business_id, name, assumptions) "
                "VALUES (1, 1, 'Legacy scenario', :assumptions)"
            ), {"assumptions": '{"one_time_cost":"500.25","revenue_change_pct":15,"name":"ignored"}'})
    finally:
        engine.dispose()

    migrate_database()

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT \"key\", value FROM scenario_assumptions WHERE scenario_id = 1 ORDER BY \"key\""
            )).all()
        assert [(row[0], float(row[1])) for row in rows] == [
            ("one_time_cost", 500.25), ("revenue_change_pct", 15.0),
        ]
    finally:
        engine.dispose()
