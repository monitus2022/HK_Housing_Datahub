#!/usr/bin/env python3
"""Build the natural-language gazetteer vocabulary.

Complements ``geo.json`` (the region -> subregion -> district hierarchy) with
the vocabularies place resolution also needs: MTR lines, school nets, curated
abbreviations, curated direction cells and an out-of-scope place list.

Keeping this separate from ``geo.json`` means the hierarchy artifact P1 ships
stays untouched, and this file only carries what is added on top of it.

Usage:
    python scripts/build_gazetteer.py
    python scripts/build_gazetteer.py --check          # fail on drift
    python scripts/build_gazetteer.py --out /tmp/g.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

DEFAULT_DB = Path("data/agency/agency_data.db")
DEFAULT_OUT = Path("frontend/src/lib/gazetteer.json")

# Curated: abbreviations are candidate *sets*, never a single winner. A set with
# more than one member is surfaced as a hint instead of being resolved.
# Verified against the mart on 2026-11-22: KT is the only genuine collision.
# "TW" is listed because the abbreviation is common, but it is not ambiguous —
# Tai Wai is not a district label in this dataset, so it has a single candidate.
ABBREVIATIONS: dict[str, list[dict[str, str]]] = {
    "kt": [
        {"level": "subregion", "id": "2007"},  # Kwun Tong
        {"level": "district", "id": "200903"},  # Kowloon Tong / Beacon Hill
    ],
    "tko": [{"level": "subregion", "id": "2010"}],
    "tw": [{"level": "subregion", "id": "3011"}],
    "hki": [{"level": "region", "id": "10"}],
    "kl": [{"level": "region", "id": "20"}],
    "kln": [{"level": "region", "id": "20"}],
    "nt": [{"level": "region", "id": "30"}],
}

# Curated: direction x region -> subregion ids.
#
# The subregion level is the 18 official HAD districts plus Kai Tak (carved from
# Kowloon City) and Tseung Kwan O (carved from Sai Kung), so a cell is a set of
# existing subregions. An empty list means the direction has no mapping; a set
# with more than one member is ambiguous by nature and becomes a hint.
#
# Note: the mart groups Tseung Kwan O under Kowloon, so it belongs to the
# Kowloon East cell, not New Territories East. Mirror the data.
DIRECTIONS: list[dict[str, Any]] = [
    {"direction": "east", "regionId": "10", "subregionIds": ["1004"]},
    {"direction": "west", "regionId": "10", "subregionIds": ["1001"]},
    {"direction": "south", "regionId": "10", "subregionIds": ["1003"]},
    {"direction": "north", "regionId": "10", "subregionIds": []},
    {"direction": "east", "regionId": "20", "subregionIds": ["2007", "2011", "2010"]},
    {"direction": "west", "regionId": "20", "subregionIds": ["2005", "2006"]},
    {"direction": "north", "regionId": "20", "subregionIds": ["2008"]},
    {"direction": "south", "regionId": "20", "subregionIds": ["2005"]},
    {"direction": "east", "regionId": "30", "subregionIds": ["3017", "3010"]},
    {"direction": "west", "regionId": "30", "subregionIds": ["3013", "3014", "3011", "3012"]},
    {"direction": "north", "regionId": "30", "subregionIds": ["3015"]},
    {"direction": "south", "regionId": "30", "subregionIds": ["3018"]},
]

# Curated: terms that are recognisably outside Hong Kong's housing market.
# Without this list the resolver could only say "I don't understand"; with it,
# it can REFUSE and explain, which is the honest answer for "3 bed in Shenzhen".
OUT_OF_SCOPE = [
    "dongguan",
    "foshan",
    "guangdong",
    "guangzhou",
    "huizhou",
    "london",
    "macao",
    "macau",
    "singapore",
    "shenzhen",
    "taipei",
    "taiwan",
    "tokyo",
    "zhuhai",
    "中山",
    "佛山",
    "倫敦",
    "東京",
    "台北",
    "台灣",
    "廣州",
    "廣東",
    "東莞",
    "惠州",
    "新加坡",
    "深圳",
    "澳門",
    "珠海",
]

MTR_QUERY = """
SELECT mtr_line_name_en, mtr_line_name_zh, COUNT(DISTINCT estate_id)
FROM estate_mtr_lines
GROUP BY 1, 2
"""

SCHOOL_QUERY = """
SELECT school_net_id, school_net_name_en, school_net_name_zh,
       COUNT(DISTINCT estate_id)
FROM estate_school_nets
GROUP BY 1, 2, 3
"""


def _connect(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def validate_refs(conn: sqlite3.Connection) -> None:
    """Fail loudly when a curated id does not exist in the mart.

    Curation is hand-written, so a typo would otherwise ship as a hint that
    resolves to nothing.
    """
    regions = {row[0] for row in conn.execute(
        "SELECT DISTINCT region_id FROM mart_estate_summary"
    )}
    subregions = {row[0] for row in conn.execute(
        "SELECT DISTINCT subregion_id FROM mart_estate_summary"
    )}
    districts = {row[0] for row in conn.execute(
        "SELECT DISTINCT district_id FROM mart_estate_summary"
    )}
    pairs = {tuple(row) for row in conn.execute(
        "SELECT DISTINCT region_id, subregion_id FROM mart_estate_summary"
    )}
    known = {"region": regions, "subregion": subregions, "district": districts}

    problems: list[str] = []
    for term, candidates in ABBREVIATIONS.items():
        for candidate in candidates:
            if candidate["id"] not in known[candidate["level"]]:
                problems.append(f"abbreviation {term!r}: {candidate}")
    for cell in DIRECTIONS:
        if cell["regionId"] not in regions:
            problems.append(f"direction {cell['direction']!r}: region {cell['regionId']}")
        for subregion_id in cell["subregionIds"]:
            if subregion_id not in subregions:
                problems.append(
                    f"direction {cell['direction']!r}/{cell['regionId']}: "
                    f"subregion {subregion_id}"
                )
            elif (cell["regionId"], subregion_id) not in pairs:
                # A real id in the wrong region would pass an existence check
                # but produce a cell that can never match.
                problems.append(
                    f"direction {cell['direction']!r}/{cell['regionId']}: "
                    f"subregion {subregion_id} belongs to another region"
                )
    if problems:
        raise SystemExit("unknown curated ids:\n  " + "\n  ".join(problems))


def build(db_path: Path) -> dict[str, Any]:
    conn = _connect(db_path)
    try:
        validate_refs(conn)
        mtr_rows = conn.execute(MTR_QUERY).fetchall()
        school_rows = conn.execute(SCHOOL_QUERY).fetchall()
    finally:
        conn.close()

    mtr_lines = sorted(
        (
            {"en": en, "zh": zh, "estates": estates}
            for en, zh, estates in mtr_rows
            if en
        ),
        key=lambda row: row["en"],
    )
    # One row in the snapshot has a net id with no name at all (net 34, 1
    # estate). It would publish as an unlabelled entry, so drop it.
    school_nets = sorted(
        (
            {"id": str(net_id), "en": en or "", "zh": zh or "", "estates": estates}
            for net_id, en, zh, estates in school_rows
            if en or zh
        ),
        key=lambda row: (row["en"] or row["zh"], row["id"]),
    )

    abbreviations = sorted(
        (
            {"term": term, "candidates": candidates}
            for term, candidates in ABBREVIATIONS.items()
        ),
        key=lambda row: row["term"],
    )
    directions = sorted(
        DIRECTIONS, key=lambda row: (row["direction"], row["regionId"])
    )

    return {
        "_meta": {
            "schema": 1,
            "source": "mart_estate_summary + estate_mtr_lines + estate_school_nets",
            "mtr_lines": len(mtr_lines),
            "school_nets": len(school_nets),
            "abbreviations": len(abbreviations),
            "direction_cells": len(directions),
            "out_of_scope": len(OUT_OF_SCOPE),
        },
        "mtrLines": mtr_lines,
        "schoolNets": school_nets,
        "abbreviations": abbreviations,
        "directions": directions,
        "outOfScope": OUT_OF_SCOPE,
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
        f"{meta['mtr_lines']} MTR lines, {meta['school_nets']} school nets, "
        f"{meta['abbreviations']} abbreviations, "
        f"{meta['direction_cells']} direction cells, "
        f"{meta['out_of_scope']} out-of-scope terms"
    )

    if args.check:
        if not args.out.exists():
            print(f"missing artifact: {args.out}", file=sys.stderr)
            return 1
        if args.out.read_text(encoding="utf-8") != rendered:
            print(
                f"stale artifact: {args.out} (run without --check)",
                file=sys.stderr,
            )
            return 1
        print("artifact is up to date")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
