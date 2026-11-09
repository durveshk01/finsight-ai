"""Versioned sync journal, atomic tenant cursor, and transfer indexes.

Revision ID: 0003_mobile_sync
Revises: f3dd8e733358
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_mobile_sync"
down_revision = "f3dd8e733358"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if "sync_seq" not in {column["name"] for column in sa.inspect(connection).get_columns("businesses")}:
        op.add_column("businesses", sa.Column("sync_seq", sa.BigInteger(), nullable=False, server_default="0"))
    if "to_account_id" not in {column["name"] for column in sa.inspect(connection).get_columns("transactions")}:
        with op.batch_alter_table("transactions") as batch:
            batch.add_column(sa.Column("to_account_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_transactions_to_account_id_accounts", "accounts", ["to_account_id"], ["id"], ondelete="SET NULL")
    for table, column in [("transactions", "to_account_id"), ("invoices", "account_id"), ("payments", "account_id")]:
        name = f"ix_{table}_{column}"
        if name not in {index["name"] for index in sa.inspect(connection).get_indexes(table)}:
            op.create_index(name, table, [column])

    if "sync_changes" not in sa.inspect(connection).get_table_names():
        op.create_table("sync_changes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
            sa.Column("seq_num", sa.BigInteger(), nullable=False),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(16), nullable=False),
            sa.Column("client_mutation_id", sa.String(80), nullable=True),
            sa.Column("data_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("ack_json", sa.Text(), nullable=True),
            sa.Column("request_hash", sa.String(64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("business_id", "seq_num", name="uq_sync_changes_business_seq"),
            sa.UniqueConstraint("business_id", "client_mutation_id", name="uq_sync_changes_business_mutation"),
        )
    else:
        columns = {column["name"] for column in sa.inspect(connection).get_columns("sync_changes")}
        if "ack_json" not in columns:
            op.add_column("sync_changes", sa.Column("ack_json", sa.Text(), nullable=True))
        if "request_hash" not in columns:
            op.add_column("sync_changes", sa.Column("request_hash", sa.String(64), nullable=True))
        constraints = {item["name"] for item in sa.inspect(connection).get_unique_constraints("sync_changes")}
        required = {"uq_sync_changes_business_seq", "uq_sync_changes_business_mutation"}
        if not required.issubset(constraints):
            # Adopt journals created outside Alembic, retaining every event. Earlier
            # MAX()+1 writers could assign duplicate sequence/mutation identifiers.
            journal = sa.Table("sync_changes", sa.MetaData(), autoload_with=connection)
            previous = {}
            mutation_ids = set()
            updates = []
            for row in connection.execute(sa.select(journal).order_by(journal.c.business_id, journal.c.seq_num, journal.c.id)).mappings():
                seq = max(row["seq_num"], previous.get(row["business_id"], 0) + 1)
                previous[row["business_id"]] = seq
                key = (row["business_id"], row["client_mutation_id"])
                mutation_id = row["client_mutation_id"] if key not in mutation_ids else None
                mutation_ids.add(key)
                updates.append({"record_id": row["id"], "new_seq": seq, "new_mutation": mutation_id})
            if updates:
                connection.execute(journal.update().where(journal.c.id == sa.bindparam("record_id")).values(seq_num=sa.bindparam("new_seq"), client_mutation_id=sa.bindparam("new_mutation")), updates)
            with op.batch_alter_table("sync_changes") as batch:
                for name, columns in [("uq_sync_changes_business_seq", ["business_id", "seq_num"]), ("uq_sync_changes_business_mutation", ["business_id", "client_mutation_id"])]:
                    if name not in constraints:
                        batch.create_unique_constraint(name, columns)
                batch.alter_column("seq_num", existing_type=sa.Integer(), type_=sa.BigInteger())
        for index in sa.inspect(connection).get_indexes("sync_changes"):
            if index["name"] in {"ix_sync_changes_business_seq", "ix_sync_changes_client_mutation", "ix_sync_changes_seq_num", "ix_sync_changes_business_id"}:
                op.drop_index(index["name"], table_name="sync_changes")
    connection.execute(sa.text("UPDATE businesses SET sync_seq = COALESCE((SELECT MAX(seq_num) FROM sync_changes WHERE sync_changes.business_id = businesses.id), 0)"))


def downgrade() -> None:
    connection = op.get_bind()
    op.drop_table("sync_changes")
    for table, column in [("invoices", "account_id"), ("payments", "account_id")]:
        op.drop_index(f"ix_{table}_{column}", table_name=table)
    foreign_key = next((key for key in sa.inspect(connection).get_foreign_keys("transactions") if key["constrained_columns"] == ["to_account_id"]), None)
    with op.batch_alter_table("transactions", naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}) as batch:
        if foreign_key:
            batch.drop_constraint(foreign_key["name"] or "fk_transactions_to_account_id_accounts", type_="foreignkey")
        batch.drop_index("ix_transactions_to_account_id")
        batch.drop_column("to_account_id")
    with op.batch_alter_table("businesses") as batch:
        batch.drop_column("sync_seq")
