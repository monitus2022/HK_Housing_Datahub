"""Build a small, versioned dashboard snapshot from the analytics marts.

The snapshot is written under ``data/serving/{build_id}/`` and contains the
JSON aggregates the static frontend needs: estate summaries, district monthly
trends, compact estate-monthly history, recent transactions, and coverage.
"""

from __future__ import annotations

import gzip
import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Sequence

from catalog import DEFAULT_METADATA, DEFAULT_QUALITY, build_catalog

SCHEMA_VERSION = 7
FILE_NAMES = {
    "overview": "overview.json",
    "district_monthly": "district_monthly.json.gz",
    "estate_summary": "estate_summary.json.gz",
    "transaction_recent": "transaction_recent.json.gz",
    "estate_monthly": "estate_monthly.json.gz",
    "district_bands": "district_price_bands.json.gz",
    "segment_summary": "segment_summary.json",
    "rvd_benchmarks": "rvd_benchmarks.json.gz",
    "catalog": "catalog.json",
    "coverage": "coverage.json.gz",
}
MART_TABLES = [
    "mart_estate_summary",
    "mart_district_monthly",
    "mart_estate_monthly",
    "mart_transaction_recent",
    "mart_coverage",
    "mart_district_price_bands",
    "mart_segment_summary",
]
REQUIRED_MARTS = [
    "mart_estate_summary",
    "mart_district_monthly",
    "mart_estate_monthly",
    "mart_transaction_recent",
    "mart_coverage",
    "mart_district_price_bands",
    "mart_segment_summary",
]
# Only display columns are exported. Internal join keys (tx_id, building_id,
# unit_id) stay in SQLite: the frontend identifies rows by index and links to an
# estate via estate_id.
TRANSACTION_RECENT_COLUMNS = (
    "tx_date",
    "price",
    "net_ft_price",
    "mkt_type",
    "estate_id",
    "estate_name_en",
    "district_id",
    "district_name_en",
    "area",
    "net_area",
    "bedroom",
)


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


def fetch_rows(
    con: sqlite3.Connection,
    table: str,
    columns: Optional[Sequence[str]] = None,
) -> list[dict[str, Any]]:
    con.row_factory = sqlite3.Row
    projection = "*" if columns is None else ", ".join(f'"{name}"' for name in columns)
    cursor = con.execute(f'SELECT {projection} FROM "{table}"')
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


def compact_estate_monthly(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Group estate-month rows into a compact, month-indexed payload.

    Months with at least one sale or rental are kept. A missing or non-positive
    price/rent is stored as ``0``; the frontend drops zero values from the
    matching series and keeps them out of the sale-volume series. Each point is
    ``[month_index, tx_count, avg_net_ft_price, rent_tx_count, avg_net_ft_rent]``
    so repeated estate ids and month strings do not dominate the file.
    """
    usable = [
        row
        for row in rows
        if int(row.get("tx_count") or 0) > 0
        or int(row.get("rent_tx_count") or 0) > 0
    ]
    usable.sort(key=lambda row: (row["estate_id"], row["month"]))
    months = sorted({row["month"] for row in usable})
    month_index = {month: index for index, month in enumerate(months)}
    estates: dict[str, list[list[Any]]] = {}
    for row in usable:
        price = row.get("avg_net_ft_price")
        rent = row.get("avg_net_ft_rent")
        estates.setdefault(row["estate_id"], []).append(
            [
                month_index[row["month"]],
                int(row.get("tx_count") or 0),
                round(float(price), 1) if price and float(price) > 0 else 0.0,
                int(row.get("rent_tx_count") or 0),
                round(float(rent), 1) if rent and float(rent) > 0 else 0.0,
            ]
        )
    return {"months": months, "estates": estates}


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
        estate_monthly_rows = fetch_rows(
            connection,
            "mart_estate_monthly",
            (
                "estate_id",
                "month",
                "tx_count",
                "avg_net_ft_price",
                "rent_tx_count",
                "avg_net_ft_rent",
            ),
        )
        transaction_recent = fetch_rows(
            connection,
            "mart_transaction_recent",
            TRANSACTION_RECENT_COLUMNS,
        )
        coverage_rows = fetch_rows(connection, "mart_coverage")
        district_bands = fetch_rows(
            connection,
            "mart_district_price_bands",
        )
        segment_summary = fetch_rows(connection, "mart_segment_summary")
        rvd_benchmarks = {
            "rents": (
                fetch_rows(connection, "rvd_rents")
                if table_exists(connection, "rvd_rents")
                else []
            ),
            "prices": (
                fetch_rows(connection, "rvd_prices")
                if table_exists(connection, "rvd_prices")
                else []
            ),
            "indices": (
                fetch_rows(connection, "rvd_indices")
                if table_exists(connection, "rvd_indices")
                else []
            ),
            "yields": (
                fetch_rows(connection, "rvd_yields")
                if table_exists(connection, "rvd_yields")
                else []
            ),
        }

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
        snapshot_dir / FILE_NAMES["estate_monthly"],
        compact_estate_monthly(estate_monthly_rows),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["transaction_recent"],
        clean_value(transaction_recent),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["coverage"],
        clean_value(coverage_rows),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["district_bands"],
        clean_value(district_bands),
    )
    write_json(
        snapshot_dir / FILE_NAMES["segment_summary"],
        clean_value(segment_summary),
    )
    write_gzip_json(
        snapshot_dir / FILE_NAMES["rvd_benchmarks"],
        clean_value(rvd_benchmarks),
    )
    write_json(
        snapshot_dir / FILE_NAMES["catalog"],
        build_catalog(
            database,
            metadata_path=DEFAULT_METADATA,
            quality_path=DEFAULT_QUALITY,
            manifest_data=manifest,
            generated_at=generated_at,
        ),
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
