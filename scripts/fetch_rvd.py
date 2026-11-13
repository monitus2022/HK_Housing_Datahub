#!/usr/bin/env python3
"""Download and ingest RVD private domestic benchmarks."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from processors.rvd import download_rvd, load_rvd  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ingest RVD benchmarks.")
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Agency SQLite database.",
    )
    parser.add_argument(
        "--source-dir",
        default="data/rvd",
        help="Directory containing the five RVD XLS workbooks.",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Parse existing files in --source-dir instead of downloading.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if not args.skip_download:
            download_rvd(args.source_dir)
        counts = load_rvd(args.db, args.source_dir)
    except (FileNotFoundError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    for name, count in counts.items():
        print(f"{name}: {count:,} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
