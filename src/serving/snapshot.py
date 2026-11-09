"""Build a small, versioned dashboard snapshot from the analytics marts.

The snapshot is written under ``data/serving/{build_id}/`` and contains only
small JSON aggregates. Large marts (estate-monthly, recent transactions) stay
in SQLite for now; a future Parquet export can add them without changing the
manifest contract.
"""

from __future__ import annotations

import gzip
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA_VERSION = 1
FILE_NAMES = {
    "overview": "overview.json",
    "district_monthly": "district_monthly.json.gz",
    "estate_summary": "estate_summary.json.gz",
    "coverage": "coverage.json.gz",
}
MART_TABLES = [
    "mart_estate_summary",
    "mart_district_monthly",
    "mart_estate_monthly",
    "mart_transaction_recent",
    "mart_coverage",
]
REQUIRED_MARTS = [
    "mart_estate_summary",
    "mart_district_monthly",
    "mart_coverage",
]


def safe_build_id(build_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", build_id).strip("._")
    return safe or "build"


def default_build_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{uuid.uuid4().hex[:6]}"


def connect_read_only(db_path: Path | str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True)


def table_exists(con: sqlite3.Connection, table: str) -> bool:
    return (
        con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        is not None
    )


def scalar(con: sqlite3.Connection, sql: str) -> Any:
    row = con.execute(sql).fetchone()
    return row[0] if row else None


def fetch_rows(con: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    con.row_factory = sqlite3.Row
    cursor = con.execute(f'SELECT * FROM "{table}"')
    return [dict(row) for row in cursor.fetchall()]


def clean_value(value: Any, ndigits: int = 4) -> Any:
    if isinstance(value, float):
        return round(value, ndigits)
    if isinstance(value, dict):
        return {key: clean_value(item, ndigits) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_value(item, ndigits) for item in value]
    return value


def _serialize(payload: Any) -> bytes:
    return (
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.write_bytes(_serialize(payload))


def write_gzip_json(path: Path, payload: Any) -> None:
    with gzip.open(path, "wb") as handle:
        handle.write(_serialize(payload))


def build_snapshot(
    db_path: Path | str,
    output_root: Path | str = Path("data/serving"),
    build_id: Optional[str] = None,
) -> dict[str, Any]:
    """Build the local snapshot and return its manifest."""
    database = Path(db_path)
    if not database.exists():
        raise FileNotFoundError(f"Database not found: {database}")

    connection = connect_read_only(database)
    try:
        missing = [
            table for table in REQUIRED_MARTS if not table_exists(connection, table)
        ]
        if missing:
            raise RuntimeError(
                "Missing analytics marts: "
                + ", ".join(missing)
                + ". Run scripts/build_marts.py first."
            )

        estate_summary = fetch_rows(connection, "mart_estate_summary")
        district_monthly = fetch_rows(connection, "mart_district_monthly")
        coverage_rows = fetch_rows(connection, "mart_coverage")

        data_through = {
            "transactions": scalar(
                connection, "SELECT date(max(tx_date)) FROM transactions"
            ),
            "market": scalar(
                connection,
                "SELECT date(max(record_date)) FROM estate_monthly_market_info",
            ),
        }
        coverage = connection.execute(
            """
            SELECT
                count(*) AS estates,
                coalesce(sum(has_transactions), 0) AS with_transactions,
                coalesce(sum(has_market), 0) AS with_market,
                coalesce(sum(has_wiki), 0) AS with_wiki
            FROM mart_coverage
            """
        ).fetchone()
        row_counts = {
            table: scalar(connection, f'SELECT count(*) FROM "{table}"')
            for table in MART_TABLES
            if table_exists(connection, table)
        }
    finally:
        connection.close()

    generated_at = datetime.now(timezone.utc).isoformat()
    resolved_build_id = safe_build_id(build_id or default_build_id())
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "build_id": resolved_build_id,
        "generated_at": generated_at,
        "data_through": data_through,
        "coverage": {
            "estates": coverage[0],
            "with_transactions": coverage[1],
            "with_market": coverage[2],
            "with_wiki": coverage[3],
        },
        "row_counts": row_counts,
        "files": FILE_NAMES,
        "source": ["HKP", "Wikipedia"],
    }

    snapshot_dir = Path(output_root) / resolved_build_id
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    write_gzip_json(
        snapshot_dir / FILE_NAMES["estate_summary"],
        clean_value(estate_summary),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["district_monthly"],
        clean_value(district_monthly),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["coverage"],
        clean_value(coverage_rows),
    )
    write_json(
        snapshot_dir / "overview.json",
        {
            "build_id": resolved_build_id,
            "schema_version": SCHEMA_VERSION,
            "generated_at": generated_at,
            "data_through": data_through,
            "coverage": manifest["coverage"],
            "row_counts": row_counts,
            "source": manifest["source"],
        },
    )
    write_json(snapshot_dir / "manifest.json", manifest)
    return manifest
