"""Build the analytics marts from the raw agency SQLite database.

The builder writes only derived tables and indexes. Raw tables are never
modified. A temporary ``wiki_estates`` table supplies the ``has_wiki`` flag.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Optional

from logger import housing_logger

DEFAULT_SQL_DIR = Path(__file__).resolve().parent / "sql"
MART_NAMES = [
    "mart_estate_summary",
    "mart_district_monthly",
    "mart_estate_monthly",
    "mart_transaction_recent",
    "mart_coverage",
]


def load_wiki_estate_names(wiki_dir: Path) -> list[str]:
    """Read estate names from the committed/local wiki partition JSON files."""
    names: set[str] = set()
    if not wiki_dir.exists():
        housing_logger.warning(
            f"Wiki directory not found ({wiki_dir}); has_wiki will be 0."
        )
        return []
    for path in sorted(wiki_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            housing_logger.warning(f"Skipping wiki file {path}: {exc}")
            continue
        if isinstance(payload, dict):
            names.update(payload.keys())
    return sorted(names)


def setup_wiki_table(conn: sqlite3.Connection, wiki_dir: Path) -> int:
    """Create a connection-local temp table with wiki estate names."""
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS wiki_estates ("
        "estate_name TEXT PRIMARY KEY)"
    )
    conn.execute("DELETE FROM wiki_estates")
    names = load_wiki_estate_names(wiki_dir)
    conn.executemany(
        "INSERT OR IGNORE INTO wiki_estates (estate_name) VALUES (?)",
        [(name,) for name in names],
    )
    conn.commit()
    housing_logger.info(f"Loaded {len(names)} wiki estate names.")
    return len(names)


def sql_files(sql_dir: Path) -> list[Path]:
    return sorted(Path(sql_dir).glob("*.sql"))


def build_marts(
    db_path: Path | str,
    sql_dir: Path | str = DEFAULT_SQL_DIR,
    wiki_dir: Path | str = Path("data/wiki"),
) -> dict[str, int]:
    """Run every SQL file in order and return final mart row counts."""
    database = Path(db_path)
    if not database.exists():
        raise FileNotFoundError(f"Database not found: {database}")

    scripts = sql_files(Path(sql_dir))
    if not scripts:
        raise FileNotFoundError(f"No SQL files found in {sql_dir}")

    connection = sqlite3.connect(database)
    try:
        setup_wiki_table(connection, Path(wiki_dir))
        for script in scripts:
            housing_logger.info(f"Running {script.name} ...")
            connection.executescript(script.read_text(encoding="utf-8"))
            connection.commit()

        counts = {
            name: connection.execute(
                f'SELECT count(*) FROM "{name}"'
            ).fetchone()[0]
            for name in MART_NAMES
        }
        housing_logger.info(f"Mart row counts: {counts}")
        return counts
    finally:
        connection.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build analytics marts.")
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Path to the raw agency SQLite database.",
    )
    parser.add_argument(
        "--sql-dir",
        default=str(DEFAULT_SQL_DIR),
        help="Directory containing the ordered mart SQL files.",
    )
    parser.add_argument(
        "--wiki-dir",
        default="data/wiki",
        help="Directory containing wiki partition JSON files (for has_wiki).",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        build_marts(
            db_path=args.db,
            sql_dir=args.sql_dir,
            wiki_dir=args.wiki_dir,
        )
    except FileNotFoundError as exc:
        housing_logger.error(str(exc))
        return 2
    except Exception as exc:
        housing_logger.error(f"Mart build failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
