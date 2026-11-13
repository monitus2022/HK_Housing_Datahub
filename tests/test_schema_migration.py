"""Additive schema migration tests (offline, temporary SQLite only)."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text

from processors.agency.agency_base import ensure_additive_columns


def test_transaction_sale_type_columns_are_added_once(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE transactions (tx_id TEXT PRIMARY KEY)")
        )

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
