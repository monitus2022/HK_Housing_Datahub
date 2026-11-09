"""Data-quality checks for the agency SQLite database.

The checks open the database read-only and never modify it. Critical checks
catch corruption or broken relationships; warning checks surface known data
limitations and coverage gaps.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from models.agency.sql_db import Base

REQUIRED_TABLES = [
    "regions",
    "subregions",
    "districts",
    "estates",
    "buildings",
    "units",
    "transactions",
    "estate_monthly_market_info",
]

# The schema normally enforces these keys. The fallback lets the duplicate
# check still detect duplicates if a table was loaded without its constraint.
KNOWN_PRIMARY_KEYS: dict[str, list[str]] = {
    table.name: [column.name for column in table.primary_key.columns]
    for table in Base.metadata.sorted_tables
}

RELATIONSHIPS = [
    ("subregions", "region_id", "regions", "region_id"),
    ("districts", "subregion_id", "subregions", "subregion_id"),
    ("estates", "region_id", "regions", "region_id"),
    ("estates", "subregion_id", "subregions", "subregion_id"),
    ("estates", "district_id", "districts", "district_id"),
    ("estate_school_nets", "estate_id", "estates", "estate_id"),
    ("estate_facilities", "estate_id", "estates", "estate_id"),
    ("estate_facilities", "facility_id", "facilities", "facility_id"),
    ("estate_mtr_lines", "estate_id", "estates", "estate_id"),
    ("estate_monthly_market_info", "estate_id", "estates", "estate_id"),
    ("phases", "estate_id", "estates", "estate_id"),
    ("buildings", "estate_id", "estates", "estate_id"),
    ("buildings", "phase_id", "phases", "phase_id"),
    ("units", "building_id", "buildings", "building_id"),
    ("unit_features", "unit_id", "units", "unit_id"),
    ("transactions", "unit_id", "units", "unit_id"),
]

DEFAULT_THRESHOLDS: dict[str, Any] = {
    "non_positive_net_area_share": 0.20,
    "non_positive_area_share": 0.30,
    "estate_transaction_coverage": 0.50,
    "estate_market_coverage": 0.60,
    "transactions_without_market_share": 0.10,
    "max_transaction_date_gap_days": 30,
    "null_rates": {
        "units.net_area": 0.05,
        "units.bedroom": 0.50,
        "estates.first_op_date": 0.10,
        "estates.coordinates": 0.10,
        "transactions.net_ft_price": 0.10,
    },
}


@dataclass
class CheckResult:
    name: str
    severity: str  # "critical" or "warning"
    passed: bool
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "severity": self.severity,
            "passed": self.passed,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class QualityReport:
    run_id: str
    generated_at: str
    database: str
    checks: list[CheckResult]

    @property
    def critical_failures(self) -> list[CheckResult]:
        return [
            check
            for check in self.checks
            if check.severity == "critical" and not check.passed
        ]

    @property
    def warning_failures(self) -> list[CheckResult]:
        return [
            check
            for check in self.checks
            if check.severity == "warning" and not check.passed
        ]

    @property
    def status(self) -> str:
        if self.critical_failures:
            return "fail"
        if self.warning_failures:
            return "warn"
        return "pass"

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "generated_at": self.generated_at,
            "database": self.database,
            "summary": {
                "status": self.status,
                "critical_failures": len(self.critical_failures),
                "warning_failures": len(self.warning_failures),
                "checks_total": len(self.checks),
            },
            "checks": [check.to_dict() for check in self.checks],
        }


def connect_read_only(db_path: Path | str) -> sqlite3.Connection:
    path = Path(db_path).resolve()
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def table_exists(con: sqlite3.Connection, table: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def table_columns(con: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in con.execute(f'PRAGMA table_info("{table}")')]


def primary_key_columns(con: sqlite3.Connection, table: str) -> list[str]:
    rows = list(con.execute(f'PRAGMA table_info("{table}")'))
    keys = sorted(
        ((row[5], row[1]) for row in rows if row[5]),
        key=lambda item: item[0],
    )
    if keys:
        return [name for _, name in keys]
    return KNOWN_PRIMARY_KEYS.get(table, [])


def scalar(con: sqlite3.Connection, sql: str, params: tuple = ()) -> Any:
    row = con.execute(sql, params).fetchone()
    return row[0] if row else None


def _skipped(name: str, severity: str, reason: str) -> CheckResult:
    return CheckResult(
        name=name,
        severity=severity,
        passed=True,
        message=f"Skipped: {reason}",
        details={"skipped": reason},
    )


def _check_required_tables(con: sqlite3.Connection) -> CheckResult:
    counts: dict[str, Optional[int]] = {}
    missing: list[str] = []
    empty: list[str] = []
    for table in REQUIRED_TABLES:
        if not table_exists(con, table):
            missing.append(table)
            counts[table] = None
            continue
        count = scalar(con, f'SELECT count(*) FROM "{table}"')
        counts[table] = count
        if count == 0:
            empty.append(table)

    failed = bool(missing or empty)
    if failed:
        message = (
            f"Missing tables: {missing or 'none'}; empty tables: "
            f"{empty or 'none'}."
        )
    else:
        message = "All required tables exist and are non-empty."
    return CheckResult(
        "required_tables_nonempty",
        "critical",
        not failed,
        message,
        {"counts": counts, "missing": missing, "empty": empty},
    )


def _check_duplicate_primary_keys(con: sqlite3.Connection) -> CheckResult:
    duplicates: dict[str, int] = {}
    skipped: list[str] = []
    for table in sorted(KNOWN_PRIMARY_KEYS):
        if not table_exists(con, table):
            skipped.append(table)
            continue
        keys = primary_key_columns(con, table)
        if not keys:
            skipped.append(table)
            continue
        columns = table_columns(con, table)
        if any(key not in columns for key in keys):
            skipped.append(table)
            continue
        key_list = ", ".join(f'"{key}"' for key in keys)
        duplicate_groups = scalar(
            con,
            f'SELECT count(*) FROM (SELECT {key_list} FROM "{table}" '
            f"GROUP BY {key_list} HAVING count(*) > 1)",
        )
        if duplicate_groups:
            duplicates[table] = duplicate_groups

    failed = bool(duplicates)
    message = (
        f"Duplicate primary-key groups: {duplicates}."
        if failed
        else "No duplicate primary-key groups found."
    )
    return CheckResult(
        "duplicate_primary_keys",
        "critical",
        not failed,
        message,
        {"duplicates": duplicates, "skipped": skipped},
    )


def _check_foreign_key_orphans(con: sqlite3.Connection) -> CheckResult:
    orphans: dict[str, int] = {}
    skipped: list[str] = []
    for child, child_key, parent, parent_key in RELATIONSHIPS:
        if not table_exists(con, child) or not table_exists(con, parent):
            skipped.append(f"{child}.{child_key} -> {parent}.{parent_key}")
            continue
        child_columns = table_columns(con, child)
        parent_columns = table_columns(con, parent)
        if child_key not in child_columns or parent_key not in parent_columns:
            skipped.append(f"{child}.{child_key} -> {parent}.{parent_key}")
            continue
        count = scalar(
            con,
            f'SELECT count(*) FROM "{child}" c '
            f'LEFT JOIN "{parent}" p ON c."{child_key}" = p."{parent_key}" '
            f'WHERE c."{child_key}" IS NOT NULL AND p."{parent_key}" IS NULL',
        )
        if count:
            orphans[f"{child}.{child_key} -> {parent}.{parent_key}"] = count

    failed = bool(orphans)
    message = (
        f"Foreign-key orphans: {orphans}."
        if failed
        else "No foreign-key orphans found."
    )
    return CheckResult(
        "foreign_key_orphans",
        "critical",
        not failed,
        message,
        {"orphans": orphans, "skipped": skipped},
    )


def _check_negative_prices(con: sqlite3.Connection) -> CheckResult:
    if not table_exists(con, "transactions"):
        return _skipped("negative_prices", "critical", "transactions missing")
    negative = scalar(
        con, "SELECT count(*) FROM transactions WHERE price < 0"
    )
    failed = negative > 0
    message = (
        f"{negative} transactions have a negative price."
        if failed
        else "No negative transaction prices."
    )
    return CheckResult(
        "negative_prices",
        "critical",
        not failed,
        message,
        {"negative_price_rows": negative},
    )


def _check_negative_areas(con: sqlite3.Connection) -> CheckResult:
    if not table_exists(con, "units"):
        return _skipped("negative_areas", "critical", "units missing")
    negative_area = scalar(
        con, "SELECT count(*) FROM units WHERE area < 0"
    )
    negative_net_area = scalar(
        con, "SELECT count(*) FROM units WHERE net_area < 0"
    )
    failed = negative_area > 0 or negative_net_area > 0
    message = (
        f"Negative area rows: area={negative_area}, "
        f"net_area={negative_net_area}."
        if failed
        else "No negative unit areas."
    )
    return CheckResult(
        "negative_areas",
        "critical",
        not failed,
        message,
        {
            "negative_area_rows": negative_area,
            "negative_net_area_rows": negative_net_area,
        },
    )


def _check_transaction_dates(con: sqlite3.Connection) -> CheckResult:
    if not table_exists(con, "transactions"):
        return _skipped(
            "transaction_dates_sane", "critical", "transactions missing"
        )
    lower = "1990-01-01"
    upper = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    invalid = scalar(
        con,
        "SELECT count(*) FROM transactions "
        "WHERE tx_date IS NULL "
        "OR (tx_date IS NOT NULL AND date(tx_date) IS NULL) "
        "OR date(tx_date) < ? OR date(tx_date) > ?",
        (lower, upper),
    )
    minimum, maximum = con.execute(
        "SELECT min(tx_date), max(tx_date) FROM transactions"
    ).fetchone()
    failed = invalid > 0
    message = (
        f"{invalid} transactions have null or out-of-range dates."
        if failed
        else "All transaction dates are within the sane range."
    )
    return CheckResult(
        "transaction_dates_sane",
        "critical",
        not failed,
        message,
        {
            "invalid_rows": invalid,
            "min": minimum,
            "max": maximum,
            "allowed_range": [lower, upper],
        },
    )


def _check_non_positive_areas(
    con: sqlite3.Connection, thresholds: dict[str, Any]
) -> CheckResult:
    if not table_exists(con, "units"):
        return _skipped("non_positive_areas", "warning", "units missing")
    total = scalar(con, "SELECT count(*) FROM units")
    if not total:
        return _skipped("non_positive_areas", "warning", "units empty")
    non_positive_area = scalar(
        con, "SELECT count(*) FROM units WHERE area IS NOT NULL AND area <= 0"
    )
    non_positive_net_area = scalar(
        con,
        "SELECT count(*) FROM units WHERE net_area IS NOT NULL AND net_area <= 0",
    )
    area_share = non_positive_area / total
    net_area_share = non_positive_net_area / total
    failed = (
        area_share > thresholds["non_positive_area_share"]
        or net_area_share > thresholds["non_positive_net_area_share"]
    )
    message = (
        f"Non-positive area share: area={area_share:.1%}, "
        f"net_area={net_area_share:.1%} (known source limitation)."
    )
    return CheckResult(
        "non_positive_areas",
        "warning",
        not failed,
        message,
        {
            "total_units": total,
            "non_positive_area_share": area_share,
            "non_positive_net_area_share": net_area_share,
            "thresholds": {
                "area": thresholds["non_positive_area_share"],
                "net_area": thresholds["non_positive_net_area_share"],
            },
        },
    )


def _check_estate_coverage(
    con: sqlite3.Connection, thresholds: dict[str, Any]
) -> CheckResult:
    if not table_exists(con, "estates"):
        return _skipped("estate_coverage", "warning", "estates missing")
    total = scalar(con, "SELECT count(*) FROM estates")
    if not total:
        return _skipped("estate_coverage", "warning", "estates empty")
    with_buildings = scalar(
        con, "SELECT count(DISTINCT estate_id) FROM buildings"
    ) if table_exists(con, "buildings") else 0
    with_transactions = scalar(
        con,
        """
        SELECT count(DISTINCT e.estate_id) FROM estates e
        JOIN buildings b ON e.estate_id = b.estate_id
        JOIN units u ON b.building_id = u.building_id
        JOIN transactions t ON u.unit_id = t.unit_id
        """,
    ) if all(
        table_exists(con, name)
        for name in ("buildings", "units", "transactions")
    ) else 0
    with_market = scalar(
        con, "SELECT count(DISTINCT estate_id) FROM estate_monthly_market_info"
    ) if table_exists(con, "estate_monthly_market_info") else 0

    transaction_share = with_transactions / total
    market_share = with_market / total
    failed = (
        transaction_share < thresholds["estate_transaction_coverage"]
        or market_share < thresholds["estate_market_coverage"]
    )
    message = (
        f"Estate coverage: buildings={with_buildings}/{total}, "
        f"transactions={with_transactions}/{total} "
        f"({transaction_share:.1%}), market={with_market}/{total} "
        f"({market_share:.1%})."
    )
    return CheckResult(
        "estate_coverage",
        "warning",
        not failed,
        message,
        {
            "estates": total,
            "with_buildings": with_buildings,
            "with_transactions": with_transactions,
            "with_market": with_market,
            "transaction_share": transaction_share,
            "market_share": market_share,
            "thresholds": {
                "transactions": thresholds["estate_transaction_coverage"],
                "market": thresholds["estate_market_coverage"],
            },
        },
    )


def _check_estates_without_buildings(con: sqlite3.Connection) -> CheckResult:
    if not table_exists(con, "estates") or not table_exists(con, "buildings"):
        return _skipped(
            "estates_without_buildings", "warning", "estates or buildings missing"
        )
    count = scalar(
        con,
        """
        SELECT count(*) FROM estates e
        WHERE NOT EXISTS (
            SELECT 1 FROM buildings b WHERE b.estate_id = e.estate_id
        )
        """,
    )
    failed = count > 0
    message = (
        f"{count} estates have no buildings."
        if failed
        else "Every estate has at least one building."
    )
    return CheckResult(
        "estates_without_buildings",
        "warning",
        not failed,
        message,
        {"estates_without_buildings": count},
    )


def _check_transactions_without_market(
    con: sqlite3.Connection, thresholds: dict[str, Any]
) -> CheckResult:
    required = ("estates", "buildings", "units", "transactions", "estate_monthly_market_info")
    if not all(table_exists(con, name) for name in required):
        return _skipped(
            "transactions_without_market", "warning", "required tables missing"
        )
    with_transactions = scalar(
        con,
        """
        SELECT count(DISTINCT e.estate_id) FROM estates e
        JOIN buildings b ON e.estate_id = b.estate_id
        JOIN units u ON b.building_id = u.building_id
        JOIN transactions t ON u.unit_id = t.unit_id
        """,
    )
    if not with_transactions:
        return _skipped(
            "transactions_without_market", "warning", "no transaction estates"
        )
    without_market = scalar(
        con,
        """
        SELECT count(*) FROM (
            SELECT DISTINCT e.estate_id FROM estates e
            JOIN buildings b ON e.estate_id = b.estate_id
            JOIN units u ON b.building_id = u.building_id
            JOIN transactions t ON u.unit_id = t.unit_id
        ) x
        WHERE NOT EXISTS (
            SELECT 1 FROM estate_monthly_market_info m
            WHERE m.estate_id = x.estate_id
        )
        """,
    )
    share = without_market / with_transactions
    failed = share > thresholds["transactions_without_market_share"]
    message = (
        f"{without_market}/{with_transactions} transaction estates "
        f"({share:.1%}) have no monthly market data."
    )
    return CheckResult(
        "transactions_without_market",
        "warning",
        not failed,
        message,
        {
            "with_transactions": with_transactions,
            "without_market": without_market,
            "share": share,
            "threshold": thresholds["transactions_without_market_share"],
        },
    )


def _check_date_gaps(
    con: sqlite3.Connection, thresholds: dict[str, Any]
) -> CheckResult:
    if not table_exists(con, "transactions"):
        return _skipped("transaction_date_gaps", "warning", "transactions missing")
    values = [
        row[0]
        for row in con.execute(
            "SELECT DISTINCT date(tx_date) FROM transactions "
            "WHERE tx_date IS NOT NULL AND date(tx_date) IS NOT NULL "
            "ORDER BY 1"
        )
    ]
    if len(values) < 2:
        return CheckResult(
            "transaction_date_gaps",
            "warning",
            True,
            "Not enough distinct dates to measure gaps.",
            {"max_gap_days": 0},
        )
    dates = [date.fromisoformat(value) for value in values]
    gaps = [
        ((right - left).days, left.isoformat(), right.isoformat())
        for left, right in zip(dates, dates[1:])
    ]
    max_gap, gap_start, gap_end = max(gaps)
    failed = max_gap > thresholds["max_transaction_date_gap_days"]
    message = (
        f"Largest transaction-date gap is {max_gap} days "
        f"({gap_start} to {gap_end})."
    )
    return CheckResult(
        "transaction_date_gaps",
        "warning",
        not failed,
        message,
        {
            "max_gap_days": max_gap,
            "gap_start": gap_start,
            "gap_end": gap_end,
            "threshold": thresholds["max_transaction_date_gap_days"],
        },
    )


def _check_null_rates(
    con: sqlite3.Connection, thresholds: dict[str, Any]
) -> CheckResult:
    results: dict[str, Any] = {}
    failed_columns: list[str] = []
    for qualified, threshold in thresholds["null_rates"].items():
        table, column = qualified.split(".", 1)
        if not table_exists(con, table):
            results[qualified] = {"skipped": "table missing"}
            continue
        columns = table_columns(con, table)
        if column == "coordinates":
            if "latitude" not in columns or "longitude" not in columns:
                results[qualified] = {"skipped": "coordinate columns missing"}
                continue
            condition = "latitude IS NULL OR longitude IS NULL"
        else:
            if column not in columns:
                results[qualified] = {"skipped": "column missing"}
                continue
            condition = f'"{column}" IS NULL'
        total = scalar(con, f'SELECT count(*) FROM "{table}"')
        if not total:
            results[qualified] = {"skipped": "table empty"}
            continue
        null_count = scalar(
            con, f'SELECT count(*) FROM "{table}" WHERE {condition}'
        )
        share = null_count / total
        results[qualified] = {
            "null_rows": null_count,
            "total_rows": total,
            "share": share,
            "threshold": threshold,
        }
        if share > threshold:
            failed_columns.append(qualified)

    failed = bool(failed_columns)
    message = (
        f"Null-rate thresholds exceeded: {failed_columns}."
        if failed
        else "All configured null rates are within thresholds."
    )
    return CheckResult(
        "null_rates",
        "warning",
        not failed,
        message,
        {"columns": results, "failed_columns": failed_columns},
    )


def _check_zero_prices(con: sqlite3.Connection) -> CheckResult:
    if not table_exists(con, "transactions"):
        return _skipped("zero_prices", "warning", "transactions missing")
    count = scalar(con, "SELECT count(*) FROM transactions WHERE price = 0")
    failed = count > 0
    message = (
        f"{count} transactions have a zero price."
        if failed
        else "No zero-price transactions."
    )
    return CheckResult(
        "zero_prices",
        "warning",
        not failed,
        message,
        {"zero_price_rows": count},
    )


def run_checks(
    db_path: Path | str,
    thresholds: Optional[dict[str, Any]] = None,
    run_id: Optional[str] = None,
) -> QualityReport:
    """Run all checks against a read-only SQLite database."""
    merged_thresholds = {**DEFAULT_THRESHOLDS}
    if thresholds:
        merged_thresholds.update(thresholds)
    if thresholds and "null_rates" in thresholds:
        merged_thresholds["null_rates"] = {
            **DEFAULT_THRESHOLDS["null_rates"],
            **thresholds["null_rates"],
        }

    run_id = run_id or (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + uuid.uuid4().hex[:8]
    )
    generated_at = datetime.now(timezone.utc).isoformat()

    connection = connect_read_only(db_path)
    try:
        checks = [
            _check_required_tables(connection),
            _check_duplicate_primary_keys(connection),
            _check_foreign_key_orphans(connection),
            _check_negative_prices(connection),
            _check_negative_areas(connection),
            _check_transaction_dates(connection),
            _check_non_positive_areas(connection, merged_thresholds),
            _check_estate_coverage(connection, merged_thresholds),
            _check_estates_without_buildings(connection),
            _check_transactions_without_market(connection, merged_thresholds),
            _check_date_gaps(connection, merged_thresholds),
            _check_null_rates(connection, merged_thresholds),
            _check_zero_prices(connection),
        ]
    finally:
        connection.close()

    return QualityReport(
        run_id=run_id,
        generated_at=generated_at,
        database=str(Path(db_path)),
        checks=checks,
    )
