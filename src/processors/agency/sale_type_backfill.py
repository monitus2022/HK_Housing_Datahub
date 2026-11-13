"""Targeted backfill of HKP sale types for existing transactions."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Mapping

from sqlalchemy import create_engine

from models.agency.migrations import ensure_additive_columns
from models.agency.responses import BuildingInfoResponse

SaleType = tuple[str | None, str | None]


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def extract_sale_types(
    response: BuildingInfoResponse,
) -> dict[str, SaleType]:
    """Collect ``tx_id -> (mkt_type, transaction_type)`` from one building."""
    updates: dict[str, SaleType] = {}
    for unit in response.data:
        for transaction in unit.transactions:
            mkt_type = _clean(transaction.mkt_type)
            transaction_type = _clean(transaction.transaction_type)
            if mkt_type is None and transaction_type is None:
                continue
            updates[transaction.id] = (mkt_type, transaction_type)
    return updates


def apply_sale_type_updates(
    db_path: Path | str,
    updates: Mapping[str, SaleType],
    *,
    dry_run: bool = False,
) -> dict[str, int]:
    """Update existing rows by ``tx_id`` and report coverage.

    Missing rows are reported as unmatched; existing rows are never created.
    """
    database = Path(db_path)
    engine = create_engine(f"sqlite:///{database}")
    ensure_additive_columns(engine)
    engine.dispose()

    matched = 0
    updated = 0
    connection = sqlite3.connect(database)
    try:
        for tx_id, (mkt_type, transaction_type) in updates.items():
            if dry_run:
                exists = connection.execute(
                    "SELECT 1 FROM transactions WHERE tx_id = ?",
                    (tx_id,),
                ).fetchone()
                if exists:
                    matched += 1
                continue

            cursor = connection.execute(
                "UPDATE transactions "
                "SET mkt_type = COALESCE(?, mkt_type), "
                "    transaction_type = COALESCE(?, transaction_type) "
                "WHERE tx_id = ?",
                (mkt_type, transaction_type, tx_id),
            )
            if cursor.rowcount:
                matched += 1
                updated += 1

        if not dry_run:
            connection.commit()

        remaining_null = connection.execute(
            "SELECT count(*) FROM transactions WHERE mkt_type IS NULL"
        ).fetchone()[0]
        return {
            "source_updates": len(updates),
            "matched": matched,
            "updated": updated,
            "unmatched": len(updates) - matched,
            "remaining_null": remaining_null,
        }
    finally:
        connection.close()
