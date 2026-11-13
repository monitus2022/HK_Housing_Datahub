"""Additive SQLite schema migrations for existing agency databases."""

from sqlalchemy import text

TRANSACTION_ADDITIVE_COLUMNS = {
    "mkt_type": "VARCHAR",
    "transaction_type": "VARCHAR",
}


def ensure_additive_columns(engine) -> list[str]:
    """Add newer nullable transaction columns to an existing database.

    SQLAlchemy's ``create_all`` does not alter existing tables. This keeps
    older databases usable until the sale-type backfill runs.
    """
    with engine.begin() as connection:
        exists = connection.execute(
            text(
                "SELECT 1 FROM sqlite_master "
                "WHERE type='table' AND name='transactions'"
            )
        ).fetchone()
        if not exists:
            return []
        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(transactions)"))
        }
        added: list[str] = []
        for name, column_type in TRANSACTION_ADDITIVE_COLUMNS.items():
            if name in columns:
                continue
            connection.execute(
                text(f"ALTER TABLE transactions ADD COLUMN {name} {column_type}")
            )
            added.append(name)
        return added
