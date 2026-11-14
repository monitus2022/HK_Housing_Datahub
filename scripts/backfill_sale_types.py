#!/usr/bin/env python3
"""Backfill HKP sale types for existing transactions.

This is a targeted refetch of building transaction payloads, not a full crawl.
It updates existing rows by ``tx_id`` and never inserts transactions.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from crawlers.agency import AgencyCrawler, BuildingsCrawler  # noqa: E402
from logger import housing_logger  # noqa: E402
from processors.agency.sale_type_backfill import (  # noqa: E402
    apply_sale_type_updates,
    extract_sale_types,
    loading_buildings_missing_sale_type,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill HKP sale types for existing transactions."
    )
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Agency SQLite database.",
    )
    parser.add_argument(
        "--limit-buildings",
        type=int,
        default=None,
        help="Only process the first N buildings (for a trial run).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Skip this many buildings.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.1,
        help="Seconds to wait between building requests.",
    )
    parser.add_argument(
        "--flush-every",
        type=int,
        default=500,
        help="Apply updates after this many buildings.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and report coverage without updating the database.",
    )
    parser.add_argument(
        "--only-null",
        action="store_true",
        help=(
            "Only process buildings that still have transactions with a NULL "
            "sale type. Use this to retry failures from an earlier backfill."
        ),
    )
    return parser


def loading_building_ids(
    db_path: Path,
    limit: int | None,
    offset: int,
) -> list[str]:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        sql = "SELECT building_id FROM buildings ORDER BY building_id"
        params: tuple[int, ...] = ()
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params = (limit, offset)
        elif offset:
            sql += " LIMIT -1 OFFSET ?"
            params = (offset,)
        return [row[0] for row in connection.execute(sql, params)]
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    database = Path(args.db)
    if not database.exists():
        print(f"error: database not found: {database}", file=sys.stderr)
        return 2
    if (
        args.limit_buildings is not None
        and args.limit_buildings < 0
    ):
        print("error: --limit-buildings must be non-negative", file=sys.stderr)
        return 2
    if args.offset < 0:
        print("error: --offset must be non-negative", file=sys.stderr)
        return 2
    if args.flush_every < 1:
        print("error: --flush-every must be at least 1", file=sys.stderr)
        return 2
    if args.delay < 0:
        print("error: --delay must be non-negative", file=sys.stderr)
        return 2

    try:
        if args.only_null:
            building_ids = loading_buildings_missing_sale_type(
                database,
                limit=args.limit_buildings,
                offset=args.offset,
            )
        else:
            building_ids = loading_building_ids(
                database,
                args.limit_buildings,
                args.offset,
            )
    except sqlite3.Error as exc:
        print(f"error: could not read buildings: {exc}", file=sys.stderr)
        return 2
    if not building_ids:
        print("No buildings selected.", file=sys.stderr)
        return 2

    crawler = AgencyCrawler()
    buildings = BuildingsCrawler(agency_session=crawler.request_session)

    pending: dict[str, tuple[str | None, str | None]] = {}
    totals = {
        "source_updates": 0,
        "matched": 0,
        "updated": 0,
        "unmatched": 0,
        "remaining_null": 0,
    }
    fetched = 0
    failed = 0

    def flush() -> None:
        nonlocal pending
        if not pending:
            return
        result = apply_sale_type_updates(
            database,
            pending,
            dry_run=args.dry_run,
        )
        for key in ("source_updates", "matched", "updated", "unmatched"):
            totals[key] += result[key]
        totals["remaining_null"] = result["remaining_null"]
        pending = {}

    for index, building_id in enumerate(building_ids, start=1):
        try:
            response = buildings.fetch_building_by_id(building_id)
        except Exception as exc:  # noqa: BLE001 - one failure must not stop the run
            failed += 1
            housing_logger.warning(
                f"Building {building_id} failed: {exc}"
            )
        else:
            if response is None:
                failed += 1
            else:
                fetched += 1
                pending.update(extract_sale_types(response))

        if index % args.flush_every == 0:
            flush()
            housing_logger.info(
                f"Processed {index}/{len(building_ids)} buildings; "
                f"fetched={fetched}, failed={failed}, "
                f"matched={totals['matched']:,}, "
                f"remaining_null={totals['remaining_null']:,}"
            )

        if args.delay:
            time.sleep(args.delay)

    flush()
    final = apply_sale_type_updates(database, {}, dry_run=args.dry_run)
    totals["remaining_null"] = final["remaining_null"]
    print(
        "Backfill complete: "
        f"mode={'missing-only' if args.only_null else 'all-buildings'} "
        f"buildings={len(building_ids):,} fetched={fetched:,} failed={failed:,} "
        f"source_updates={totals['source_updates']:,} "
        f"matched={totals['matched']:,} updated={totals['updated']:,} "
        f"unmatched={totals['unmatched']:,} "
        f"remaining_null={totals['remaining_null']:,}"
        + (" (dry run)" if args.dry_run else "")
    )
    return 0 if fetched else 2


if __name__ == "__main__":
    sys.exit(main())
