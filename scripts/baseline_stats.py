#!/usr/bin/env python3
"""Print the read-only baseline statistics used by docs/baseline-stats.md.

The agency database is opened with SQLite's ``mode=ro`` URI so this script
cannot modify it. Chroma is also opened read-only when present.
"""

from __future__ import annotations

import argparse
import glob
import json
import sqlite3
from pathlib import Path

TABLES = [
    "regions",
    "subregions",
    "districts",
    "estates",
    "estate_school_nets",
    "estate_facilities",
    "estate_mtr_lines",
    "estate_monthly_market_info",
    "facilities",
    "phases",
    "buildings",
    "units",
    "unit_features",
    "transactions",
]


def connect_read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def scalar(con: sqlite3.Connection, sql: str):
    return con.execute(sql).fetchone()[0]


def table_counts(con: sqlite3.Connection) -> None:
    print("## Table counts")
    for table in TABLES:
        count = scalar(con, f'select count(*) from "{table}"')
        print(f"{table:30s} {count:>12,}")


def date_ranges(con: sqlite3.Connection) -> None:
    print("\n## Date ranges")
    for table, column in (
        ("transactions", "tx_date"),
        ("estate_monthly_market_info", "record_date"),
    ):
        low, high = con.execute(
            f'select min("{column}"), max("{column}") from "{table}"'
        ).fetchone()
        print(f"{table}.{column}: {low} .. {high}")


def coverage(con: sqlite3.Connection) -> None:
    print("\n## Estate coverage")
    total = scalar(con, "select count(*) from estates")
    checks = {
        "has_buildings": "select count(distinct estate_id) from buildings",
        "has_transactions": """
            select count(distinct e.estate_id) from estates e
            join buildings b on e.estate_id = b.estate_id
            join units u on b.building_id = u.building_id
            join transactions t on u.unit_id = t.unit_id
        """,
        "has_market": "select count(distinct estate_id) from estate_monthly_market_info",
        "has_school_nets": "select count(distinct estate_id) from estate_school_nets",
        "has_facilities": "select count(distinct estate_id) from estate_facilities",
        "has_mtr": "select count(distinct estate_id) from estate_mtr_lines",
        "has_first_op_date": "select count(*) from estates where first_op_date is not null",
        "has_coordinates": "select count(*) from estates where latitude is not null and longitude is not null",
    }
    print(f"estates_total {total:,}")
    for name, sql in checks.items():
        n = scalar(con, sql)
        print(f"{name:20s} {n:>8,}  {n / total:6.1%}")

    print("\n## Unit and transaction coverage")
    unit_checks = {
        "units_total": "select count(*) from units",
        "units_net_area_positive": "select count(*) from units where net_area > 0",
        "units_net_area_nonpositive": "select count(*) from units where net_area <= 0",
        "units_net_area_null": "select count(*) from units where net_area is null",
        "units_bedroom_present": "select count(*) from units where bedroom is not null",
        "units_with_features": "select count(distinct unit_id) from unit_features",
        "units_multiple_transactions": """
            select count(*) from (
                select unit_id from transactions group by unit_id having count(*) > 1
            )
        """,
        "transactions_total": "select count(*) from transactions",
        "transactions_positive_price_area": """
            select count(*) from transactions t join units u on t.unit_id = u.unit_id
            where t.price > 0 and u.net_area > 0
        """,
        "transactions_distinct_units": "select count(distinct unit_id) from transactions",
        "transactions_2024_plus": "select count(*) from transactions where tx_date >= '2024-01-01'",
        "transactions_2025": "select count(*) from transactions where tx_date >= '2025-01-01'",
    }
    for name, sql in unit_checks.items():
        print(f"{name:32s} {scalar(con, sql):>12,}")


def target_quantiles(con: sqlite3.Connection) -> None:
    print("\n## Target quantiles (price / net_area)")
    total = scalar(
        con,
        """
        select count(*) from transactions t join units u on t.unit_id = u.unit_id
        where t.price > 0 and u.net_area > 0
        """,
    )
    print(f"rows {total:,}")
    for label, fraction in (("p01", 0.01), ("p50", 0.50), ("p99", 0.99)):
        offset = int(total * fraction)
        value = con.execute(
            """
            select p from (
                select t.price / u.net_area as p
                from transactions t join units u on t.unit_id = u.unit_id
                where t.price > 0 and u.net_area > 0
                order by p
            ) limit 1 offset ?
            """,
            (offset,),
        ).fetchone()[0]
        print(f"{label} {value:,.2f}")
    maximum = con.execute(
        """
        select max(t.price / u.net_area)
        from transactions t join units u on t.unit_id = u.unit_id
        where t.price > 0 and u.net_area > 0
        """
    ).fetchone()[0]
    print(f"max {maximum:,.2f}")


def wiki_and_chroma(working_dir: Path) -> None:
    print("\n## Wiki and Chroma")
    total = 0
    for path in sorted(glob.glob(str(working_dir / "data" / "wiki" / "*.json"))):
        with open(path, "r", encoding="utf-8") as f:
            count = len(json.load(f))
        total += count
        print(f"{Path(path).name:30s} {count:>8,}")
    print(f"wiki_estates {total:,}")

    chroma_path = working_dir / "data" / "chroma_db" / "chroma.sqlite3"
    if chroma_path.exists():
        con = connect_read_only(chroma_path)
        try:
            print(f"chroma_embeddings {scalar(con, 'select count(*) from embeddings'):,}")
        finally:
            con.close()
    else:
        print("chroma_embeddings (not found)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("data/agency/agency_data.db"),
        help="Path to the agency SQLite database (opened read-only).",
    )
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f"Database not found: {args.db}")

    con = connect_read_only(args.db)
    try:
        table_counts(con)
        date_ranges(con)
        coverage(con)
        target_quantiles(con)
    finally:
        con.close()

    wiki_and_chroma(Path.cwd())


if __name__ == "__main__":
    main()
