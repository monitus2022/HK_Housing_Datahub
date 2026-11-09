"""CLI for running data-quality checks.

Examples:
    PYTHONPATH=src python -m quality.run --db data/agency/agency_data.db
    python scripts/run_quality.py --fail-on critical
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

from logger import housing_logger

from .checks import run_checks
from .report import write_reports


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run data-quality checks.")
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Path to the SQLite database (opened read-only).",
    )
    parser.add_argument(
        "--output-dir",
        default="data/quality",
        help="Directory for latest.json, {run_id}.json, and latest.md.",
    )
    parser.add_argument(
        "--fail-on",
        choices=["critical", "warning", "none"],
        default="critical",
        help="Exit non-zero on critical failures, any failure, or never.",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Override the generated run ID (useful for tests).",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    db_path = Path(args.db)
    if not db_path.exists():
        housing_logger.error(f"Quality database not found: {db_path}")
        return 2

    report = run_checks(
        db_path,
        run_id=args.run_id,
    )
    paths = write_reports(report, args.output_dir)

    for check in report.critical_failures:
        housing_logger.error(f"CRITICAL {check.name}: {check.message}")
    for check in report.warning_failures:
        housing_logger.warning(f"WARNING {check.name}: {check.message}")

    housing_logger.info(
        "Quality status=%s critical=%d warnings=%d checks=%d",
        report.status,
        len(report.critical_failures),
        len(report.warning_failures),
        len(report.checks),
    )
    housing_logger.info(
        "Quality reports: %s, %s, %s",
        paths["latest_json"],
        paths["run_json"],
        paths["latest_md"],
    )

    if args.fail_on == "critical":
        return 1 if report.critical_failures else 0
    if args.fail_on == "warning":
        return (
            1
            if report.critical_failures or report.warning_failures
            else 0
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
