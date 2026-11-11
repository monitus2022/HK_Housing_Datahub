#!/usr/bin/env python3
"""Build the JSON catalogue and generated data-card Markdown."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from catalog import DEFAULT_METADATA, build_catalog, render_markdown  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build the data catalogue.")
    parser.add_argument(
        "--db",
        default="data/agency/agency_data.db",
        help="Agency SQLite database.",
    )
    parser.add_argument(
        "--metadata",
        default=str(DEFAULT_METADATA),
        help="Curated catalogue metadata YAML.",
    )
    parser.add_argument(
        "--quality",
        default="data/quality/latest.json",
        help="Optional quality report JSON.",
    )
    parser.add_argument(
        "--manifest",
        default=None,
        help="Optional serving manifest JSON.",
    )
    parser.add_argument(
        "--json-out",
        default="data/catalog/catalog.json",
        help="Catalogue JSON output.",
    )
    parser.add_argument(
        "--markdown-out",
        default="docs/data-catalog.md",
        help="Generated Markdown output.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        catalog = build_catalog(
            args.db,
            metadata_path=args.metadata,
            quality_path=args.quality,
            manifest_path=args.manifest,
        )
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    json_path = Path(args.json_out)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )

    markdown_path = Path(args.markdown_out)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.write_text(render_markdown(catalog), encoding="utf-8")

    print(
        f"Wrote {json_path} and {markdown_path} "
        f"({catalog['database']['table_count']} tables, "
        f"{catalog['database']['row_count']:,} rows)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
