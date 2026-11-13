"""Additive schema migration tests (offline, temporary SQLite only)."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from models.agency.migrations import ensure_additive_columns
from processors.agency.buildings import BuildingsProcessor


def test_transaction_sale_type_columns_are_added_once(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE transactions (tx_id TEXT PRIMARY KEY)")
        )
        connection.execute(text("INSERT INTO transactions VALUES ('T1')"))

    assert ensure_additive_columns(engine) == [
        "mkt_type",
        "transaction_type",
    ]
    assert ensure_additive_columns(engine) == []

    with engine.connect() as connection:
        columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(transactions)"))
        }
    assert {"mkt_type", "transaction_type"} <= columns
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT tx_id, mkt_type, transaction_type "
                "FROM transactions WHERE tx_id='T1'"
            )
        ).fetchone()
    assert row == ("T1", None, None)


def test_processor_init_applies_additive_migration(tmp_path: Path):
    db = tmp_path / "legacy-init.db"
    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE transactions (tx_id TEXT PRIMARY KEY)")
        )
    engine.dispose()

    processor = BuildingsProcessor(db_path=str(db))
    try:
        with processor.engine.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute(
                    text("PRAGMA table_info(transactions)")
                )
            }
        assert {"mkt_type", "transaction_type"} <= columns
    finally:
        processor.close_session()
