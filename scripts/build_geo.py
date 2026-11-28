#!/usr/bin/env python3
"""Build the Hong Kong housing geography model (region -> subregion -> district).

Reads the estate mart and writes a deterministic JSON artifact consumed by the
dashboard filters and, later, the natural-language search gazetteer.

The published snapshot already carries every identifier and English name this
needs, so this is a frontend-side upgrade: no snapshot, mart or schema change.

Regions and subregions have no Chinese names in the source data, so the 23
labels below are curated. District Chinese names come from the mart.

Usage:
    python scripts/build_geo.py
    python scripts/build_geo.py --check          # fail on drift
    python scripts/build_geo.py --out /tmp/geo.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

DEFAULT_DB = Path("data/agency/agency_data.db")
DEFAULT_OUT = Path("frontend/src/lib/geo.json")

# Curated: the source data has no Chinese names at region or subregion level.
REGION_ZH = {
    "Hong Kong Island": "香港島",
    "Kowloon": "九龍",
    "New Territories": "新界",
}

SUBREGION_ZH = {
    "Central And Western": "中西區",
    "Eastern": "東區",
    "Islands": "離島區",
    "Kai Tak": "啟德",
    "Kowloon City": "九龍城",
    "Kwai Tsing": "葵青",
    "Kwun Tong": "觀塘",
    "North": "北區",
    "Sai Kung": "西貢",
    "Sha Tin": "沙田",
    "Sham Shui Po": "深水埗",
    "Southern": "南區",
    "Tai Po": "大埔",
    "Tseung Kwan O": "將軍澳",
    "Tsuen Wan": "荃灣",
    "Tuen Mun": "屯門",
    "Wan Chai": "灣仔",
    "Wong Tai Sin": "黃大仙",
    "Yau Tsim Mong": "油尖旺",
    "Yuen Long": "元朗",
}

QUERY = """
SELECT region_id, region_name_en,
       subregion_id, subregion_name_en,
       district_id, district_name_en, district_name_zh,
       COUNT(*) AS estates
FROM mart_estate_summary
GROUP BY 1, 2, 3, 4, 5, 6, 7
"""


# The Chinese label sometimes merges areas that are separate in English, so the
# "/" split cannot recover them. 中上環 covers both 中環 and 上環.
CURATED_ALIASES: dict[str, list[str]] = {
    "100104": ["中環", "上環"],
}


def split_aliases(*labels: str | None) -> list[str]:
    """Split compound labels such as "Happy Valley / Jardine's Lookout".

    The mart stores 23 of the 60 district labels this way. Splitting them on
    "/" in both English and Chinese adds 55 alias strings beyond the canonical
    pair, for 175 in total, which is what makes "Happy Valley" match without
    a hand-written synonym list.
    """
    seen: list[str] = []
    for label in labels:
        if not label:
            continue
        for part in label.split("/"):
            alias = " ".join(part.split())
            if alias and alias not in seen:
                seen.append(alias)
    return sorted(seen)


def build(db_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(QUERY).fetchall()
    finally:
        conn.close()

    regions: dict[str, dict[str, Any]] = {}
    subregions: dict[str, dict[str, Any]] = {}
    districts: dict[str, dict[str, Any]] = {}
    missing_zh: set[str] = set()

    for (
        region_id,
        region_en,
        subregion_id,
        subregion_en,
        district_id,
        district_en,
        district_zh,
        estates,
    ) in rows:
        region = regions.setdefault(
            region_id,
            {
                "id": region_id,
                "en": region_en,
                "zh": REGION_ZH.get(region_en),
                "estates": 0,
            },
        )
        if region["zh"] is None:
            missing_zh.add(f"region:{region_en}")
        region["estates"] += estates

        subregion = subregions.setdefault(
            subregion_id,
            {
                "id": subregion_id,
                "en": subregion_en,
                "zh": SUBREGION_ZH.get(subregion_en),
                "regionId": region_id,
                "estates": 0,
            },
        )
        if subregion["zh"] is None:
            missing_zh.add(f"subregion:{subregion_en}")
        subregion["estates"] += estates

        district = districts.setdefault(
            district_id,
            {
                "id": district_id,
                "en": district_en,
                "zh": district_zh,
                "subregionId": subregion_id,
                "estates": 0,
                "aliases": [
                    *split_aliases(district_en, district_zh),
                    *CURATED_ALIASES.get(district_id, []),
                ],
            },
        )
        district["estates"] += estates

    return {
        "_meta": {
            "schema": 1,
            "source": "mart_estate_summary",
            "estates": sum(d["estates"] for d in districts.values()),
            "regions": len(regions),
            "subregions": len(subregions),
            "districts": len(districts),
            "district_aliases": sum(len(d["aliases"]) for d in districts.values()),
            "missing_zh": sorted(missing_zh),
        },
        "regions": sorted(regions.values(), key=lambda row: row["en"]),
        "subregions": sorted(subregions.values(), key=lambda row: row["en"]),
        "districts": sorted(districts.values(), key=lambda row: row["en"]),
    }


def render(model: dict[str, Any]) -> str:
    return json.dumps(model, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero when the checked-in artifact is stale",
    )
    args = parser.parse_args(argv)

    if not args.db.exists():
        print(f"database not found: {args.db}", file=sys.stderr)
        return 2

    rendered = render(build(args.db))
    meta = json.loads(rendered)["_meta"]
    print(
        f"{meta['regions']} regions, {meta['subregions']} subregions, "
        f"{meta['districts']} districts, {meta['district_aliases']} aliases, "
        f"{meta['estates']} estates"
    )
    if meta["missing_zh"]:
        print(f"warning: missing zh for {len(meta['missing_zh'])} labels", file=sys.stderr)

    if args.check:
        if not args.out.exists():
            print(f"missing artifact: {args.out}", file=sys.stderr)
            return 1
        if args.out.read_text(encoding="utf-8") != rendered:
            print(f"stale artifact: {args.out} (run without --check)", file=sys.stderr)
            return 1
        print("artifact is up to date")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
