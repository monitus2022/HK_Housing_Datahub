#!/usr/bin/env python3
"""Fetch HKP rental transactions for every district and upsert them.

Rental data is available only through the district transaction search with
``tx_type=L`` and covers the last one or three years. The script is idempotent;
rerunning refreshes non-key columns.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from crawlers.agency import AgencyCrawler, RentalsCrawler  # noqa: E402
from logger import housing_logger  # noqa: E402
from processors.agency import RentalsProcessor  # noqa: E402

ALLOWED_SPANS = ("1year", "3year")


def district_ids(db_path: Path) -> list[str]:
    connection = sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True)
    try:
        return [
            row[0]
            for row in connection.execute(
                "SELECT DISTINCT district_id FROM estates "
                "WHERE district_id IS NOT NULL ORDER BY district_id"
            )
        ]
    finally:
        connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch HKP rental transactions by district."
    )
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Agency SQLite database to update.",
    )
    parser.add_argument(
        "--span",
        choices=ALLOWED_SPANS,
        default="3year",
        help="Lookback window accepted by HKP (default: 3year).",
    )
    parser.add_argument(
        "--district",
        action="append",
        default=None,
        help="Limit to a district id (repeatable).",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    db_path = Path(args.db)
    if not db_path.exists():
        housing_logger.error(f"Database not found: {db_path}")
        return 2

    districts = args.district or district_ids(db_path)
    if not districts:
        housing_logger.error("No districts found.")
        return 2

    agency = AgencyCrawler()
    crawler = RentalsCrawler(agency_session=agency.request_session)
    processor = RentalsProcessor(db_path=str(db_path))

    total = 0
    empty = 0
    errors = 0
    try:
        for index, district_id in enumerate(districts, start=1):
            housing_logger.info(
                f"Rental district {index}/{len(districts)}: {district_id}"
            )
            records = crawler.fetch_district_rentals(
                district_id=district_id, span=args.span
            )
            if records is None:
                errors += 1
                continue
            if not records:
                empty += 1
                continue
            processor.map_rental_transactions(records)
            total += processor.flush()
    finally:
        processor.close_session()

    housing_logger.info(
        f"Rental ingestion finished: {total} rows upserted across "
        f"{len(districts)} districts ({empty} without data, {errors} errors)."
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
