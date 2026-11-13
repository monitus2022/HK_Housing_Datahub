"""Offline tests for the targeted sale-type backfill."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from models.agency.responses import BuildingInfoResponse
from processors.agency.sale_type_backfill import (
    apply_sale_type_updates,
    extract_sale_types,
)


def test_extract_sale_types_from_building_payload(transactions_payload):
    response = BuildingInfoResponse.model_validate(transactions_payload)

    assert extract_sale_types(response) == {
        "I20250300653": ("2", "NORM"),
    }


def test_apply_updates_existing_rows_and_reports_coverage(tmp_path: Path):
    db = tmp_path / "backfill.db"
    connection = sqlite3.connect(db)
    try:
        connection.execute("CREATE TABLE transactions (tx_id TEXT PRIMARY KEY)")
        connection.executemany(
            "INSERT INTO transactions VALUES (?)",
            [("T1",), ("T2",)],
        )
        connection.commit()
    finally:
        connection.close()

    first = apply_sale_type_updates(
        db,
        {
            "T1": ("2", "NORM"),
            "missing": ("2", "NORM"),
        },
    )
    second = apply_sale_type_updates(
        db,
        {
            "T1": ("2", "NORM"),
            "missing": ("2", "NORM"),
        },
    )

    assert first["matched"] == 1
    assert first["updated"] == 1
    assert first["unmatched"] == 1
    assert first["remaining_null"] == 1
    assert second["updated"] == 1

    connection = sqlite3.connect(db)
    try:
        assert connection.execute(
            "SELECT tx_id, mkt_type, transaction_type "
            "FROM transactions ORDER BY tx_id"
        ).fetchall() == [
            ("T1", "2", "NORM"),
            ("T2", None, None),
        ]
    finally:
        connection.close()


def test_dry_run_does_not_update(tmp_path: Path):
    db = tmp_path / "backfill.db"
    connection = sqlite3.connect(db)
    try:
        connection.execute(
            "CREATE TABLE transactions ("
            "tx_id TEXT PRIMARY KEY, mkt_type TEXT, transaction_type TEXT)"
        )
        connection.execute("INSERT INTO transactions VALUES ('T1', NULL, NULL)")
        connection.commit()
    finally:
        connection.close()

    result = apply_sale_type_updates(
        db,
        {"T1": ("2", "NORM")},
        dry_run=True,
    )

    assert result["matched"] == 1
    assert result["updated"] == 0
    connection = sqlite3.connect(db)
    try:
        assert connection.execute(
            "SELECT mkt_type FROM transactions WHERE tx_id='T1'"
        ).fetchone()[0] is None
    finally:
        connection.close()


def test_coalesce_preserves_existing_sale_type(tmp_path: Path):
    db = tmp_path / "backfill.db"
    connection = sqlite3.connect(db)
    try:
        connection.execute(
            "CREATE TABLE transactions ("
            "tx_id TEXT PRIMARY KEY, mkt_type TEXT, transaction_type TEXT)"
        )
        connection.execute(
            "INSERT INTO transactions VALUES ('T1', '2', 'NORM')"
        )
        connection.commit()
    finally:
        connection.close()

    apply_sale_type_updates(db, {"T1": (None, "OTHER")})

    connection = sqlite3.connect(db)
    try:
        assert connection.execute(
            "SELECT mkt_type, transaction_type FROM transactions WHERE tx_id='T1'"
        ).fetchone() == ("2", "OTHER")
    finally:
        connection.close()


def test_dry_run_does_not_alter_a_legacy_schema(tmp_path: Path):
    db = tmp_path / "legacy.db"
    connection = sqlite3.connect(db)
    try:
        connection.execute("CREATE TABLE transactions (tx_id TEXT PRIMARY KEY)")
        connection.execute("INSERT INTO transactions VALUES ('T1')")
        connection.commit()
    finally:
        connection.close()

    result = apply_sale_type_updates(
        db,
        {"T1": ("2", "NORM")},
        dry_run=True,
    )

    assert result["matched"] == 1
    assert result["remaining_null"] == 1
    connection = sqlite3.connect(db)
    try:
        columns = [
            row[1]
            for row in connection.execute("PRAGMA table_info(transactions)")
        ]
    finally:
        connection.close()
    assert columns == ["tx_id"]
