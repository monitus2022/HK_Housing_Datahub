#!/usr/bin/env python3
"""Repair ``buildings.phase_id`` values that do not reference a real phase.

Older ingests copied the API's pseudo-phase id into ``buildings.phase_id`` even
when the entry was not a phase. For estates without real phases that id is often
the estate id, which leaves a foreign-key orphan and makes the quality gate
fail. The mapper no longer does this; this script repairs databases written
before the fix.

The default is a dry run. Pass ``--apply`` to null the orphan values.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import quote

ORPHAN_CLAUSE = """
    phase_id IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM phases p WHERE p.phase_id = buildings.phase_id
    )
"""


def _table_names(con: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def count_orphans(con: sqlite3.Connection) -> int:
    row = con.execute(
        f"SELECT count(*) FROM buildings WHERE {ORPHAN_CLAUSE}"
    ).fetchone()
    return int(row[0]) if row else 0


def orphan_groups(con: sqlite3.Connection) -> list[tuple[str, str, int]]:
    return [
        (row[0], row[1], int(row[2]))
        for row in con.execute(
            f"""
            SELECT phase_id, estate_id, count(*)
            FROM buildings
            WHERE {ORPHAN_CLAUSE}
            GROUP BY phase_id, estate_id
            ORDER BY count(*) DESC, estate_id
            """
        )
    ]


def repair_orphan_phase_ids(
    db_path: Path | str,
    *,
    apply: bool = False,
) -> dict[str, object]:
    """Null orphan ``buildings.phase_id`` values.

    Returns counts and, when not applying, the affected ``(phase_id, estate_id,
    count)`` groups. Raises ``FileNotFoundError`` or ``ValueError`` when the
    database or expected tables are missing.
    """
    path = Path(db_path)
    if not path.is_file():
        raise FileNotFoundError(f"Database not found: {path}")

    if apply:
        con = sqlite3.connect(path)
    else:
        uri = f"file:{quote(str(path), safe='/')}?mode=ro"
        con = sqlite3.connect(uri, uri=True)
    try:
        tables = _table_names(con)
        missing = {"buildings", "phases"} - tables
        if missing:
            raise ValueError(
                f"Database is missing required tables: {sorted(missing)}"
            )

        before = count_orphans(con)
        groups = orphan_groups(con) if not apply else []
        updated = 0
        if apply and before:
            with con:
                cursor = con.execute(
                    f"UPDATE buildings SET phase_id = NULL WHERE {ORPHAN_CLAUSE}"
                )
                updated = max(cursor.rowcount, 0)
        after = count_orphans(con)
        return {
            "applied": apply,
            "orphans_before": before,
            "orphans_after": after,
            "updated": updated,
            "groups": groups,
        }
    finally:
        con.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Null buildings.phase_id values that do not reference phases."
        )
    )
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Agency SQLite database to repair.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Write the repair. Without this flag the script only reports.",
    )
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Report only (default). Rejected together with --apply.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = repair_orphan_phase_ids(args.db, apply=args.apply)
    except (FileNotFoundError, ValueError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"orphans before: {result['orphans_before']}")
    if args.apply:
        print(f"rows updated: {result['updated']}")
    else:
        for phase_id, estate_id, count in result["groups"]:  # type: ignore[union-attr]
            print(f"  {phase_id} (estate {estate_id}): {count}")
        print("dry run: no rows changed; pass --apply to repair")
    print(f"orphans after: {result['orphans_after']}")
    return 0 if result["orphans_after"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
