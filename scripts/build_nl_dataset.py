#!/usr/bin/env python3
"""Generate candidate natural-language utterances for the NL-search dataset.

The generator writes **inputs and planted slot values only**. It never writes
labels: the teacher labels the sentences, and the lexicon remains the baseline
that must be beaten (see ``docs/nl-search-development.md``).

Inputs are the two checked-in artifacts, so this runs offline:

- ``frontend/src/lib/geo.json``      region -> subregion -> district
- ``frontend/src/lib/gazetteer.json`` MTR lines, school nets, abbreviations,
                                      direction cells, out-of-scope places

Sampling is **least-used-first** per value pool, which keeps rare values (South
Island Line, net 99, "alphabetical") from being starved by uniform draws. Each
row records the values it planted so coverage can be reported and, later, the
teacher's per-slot recall audited.

Usage:
    python scripts/build_nl_dataset.py --count 6000
    python scripts/build_nl_dataset.py --count 6000 --report
    python scripts/build_nl_dataset.py --count 6000 --sample 50 --out-sample /tmp/nl-sample.jsonl
    python scripts/build_nl_dataset.py --count 6000 --out /tmp/c.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "frontend" / "src" / "lib" / "geo.json"
GAZETTEER = ROOT / "frontend" / "src" / "lib" / "gazetteer.json"
DEFAULT_OUT = ROOT / "data" / "nl" / "candidates.jsonl"
DEFAULT_DB = ROOT / "data" / "agency" / "agency_data.db"

# Family -> weight, slots, whole-sentence templates. Weights sum to 1.0.
FAMILIES: list[dict[str, Any]] = [
    {
        "name": "place",
        "weight": 0.15,
        "slots": ["place"],
        "templates": [
            "{place}",
            "in {place}",
            "flats in {place}",
            "{place} flats",
        ],
    },
    {
        "name": "place_bed",
        "weight": 0.14,
        "slots": ["place", "bedrooms"],
        "templates": [
            "{bedrooms} in {place}",
            "{bedrooms} flat in {place}",
            "{place} {bedrooms}",
            "looking for {bedrooms} in {place}",
        ],
    },
    {
        "name": "place_price",
        "weight": 0.08,
        "slots": ["place", "price"],
        "templates": [
            "{price} in {place}",
            "{place} {price}",
            "flats {price} in {place}",
        ],
    },
    {
        "name": "place_area",
        "weight": 0.07,
        "slots": ["place", "area"],
        "templates": [
            "{area} in {place}",
            "{area} flat in {place}",
            "looking for {area} in {place}",
        ],
    },
    {
        "name": "place_bed_price",
        "weight": 0.11,
        "slots": ["place", "bedrooms", "price"],
        "templates": [
            "{bedrooms} {price} in {place}",
            "{price} {bedrooms} in {place}",
            "{bedrooms} in {place} {price}",
        ],
    },
    {
        "name": "place_bed_area",
        "weight": 0.05,
        "slots": ["place", "bedrooms", "area"],
        "templates": [
            "{bedrooms} {area} in {place}",
            "{area} {bedrooms} in {place}",
        ],
    },
    {
        "name": "place_line",
        "weight": 0.07,
        "slots": ["place", "mtr"],
        "templates": [
            "near {mtr} in {place}",
            "{mtr} in {place}",
            "flats near {mtr} in {place}",
        ],
    },
    {
        "name": "place_net",
        "weight": 0.07,
        "slots": ["place", "net"],
        "templates": [
            "{net} in {place}",
            "{net} flats in {place}",
            "flats in {place} {net}",
        ],
    },
    {
        "name": "bed_price",
        "weight": 0.06,
        "slots": ["bedrooms", "price"],
        "templates": ["{bedrooms} {price}", "{price} {bedrooms} flat"],
    },
    {
        "name": "sort_place",
        "weight": 0.05,
        "slots": ["sort", "place"],
        "templates": ["{sort} in {place}", "{sort} flats in {place}"],
    },
    {
        "name": "direction",
        "weight": 0.03,
        "slots": ["direction"],
        "templates": [
            "{direction}",
            "flats in {direction}",
            "{direction} side",
            "flats on the {direction} side",
            "{direction} of the city",
        ],
    },
    {
        "name": "abbreviation",
        "weight": 0.04,
        "slots": ["abbr"],
        "templates": [
            "{abbr}",
            "flats in {abbr}",
            "{abbr} flats",
            "anything in {abbr}",
        ],
    },
    {
        "name": "out_of_scope",
        "weight": 0.02,
        "slots": ["out_of_scope"],
        "templates": [
            "{out_of_scope}",
            "flats in {out_of_scope}",
            "{out_of_scope} flats",
            "3 bed in {out_of_scope}",
        ],
    },
    {
        "name": "unsupported",
        "weight": 0.02,
        "slots": ["unsupported"],
        "templates": [
            "{unsupported}",
            "{unsupported} flat",
            "flats with {unsupported}",
            "show me {unsupported}",
        ],
    },
    {
        "name": "place_unsupported",
        "weight": 0.04,
        "slots": ["place", "unsupported"],
        "templates": [
            "{unsupported} in {place}",
            "{place} {unsupported}",
            "flats with {unsupported} in {place}",
        ],
    },
]

# Bedrooms -> bedrooms filter value.
BEDROOMS = [
    ("1 bed", "1"),
    ("2 bed", "2"),
    ("3 bed", "3"),
    ("4+ bed", "4+"),
    ("three bedroom", "3"),
    ("two bedrooms", "2"),
    ("3 room", "3"),
    ("兩房", "2"),
    ("三房", "3"),
]

# Area phrases -> (min, max). Vague words carry the shipped defaults.
AREAS = [
    ("small", "", "400"),
    ("small size", "", "400"),
    ("compact", "", "400"),
    ("middle size", "400", "700"),
    ("mid size", "400", "700"),
    ("medium sized", "400", "700"),
    ("large", "700", ""),
    ("big", "700", ""),
    ("spacious", "700", ""),
    ("500-700 sq ft", "500", "700"),
    ("under 600 ft", "", "600"),
    ("over 800 sq ft", "800", ""),
    ("大單位", "700", ""),
    ("細單位", "", "400"),
    ("中型單位", "400", "700"),
]

# Price phrases -> (min, max).
PRICES = [
    ("under 3m", "", "3000000"),
    ("under 5m", "", "5000000"),
    ("under 6m", "", "6000000"),
    ("below 8 million", "", "8000000"),
    ("under 600k", "", "600000"),
    ("up to 12m", "", "12000000"),
    ("over 10m", "10000000", ""),
    ("3m to 5m", "3000000", "5000000"),
    ("5m to 8m", "5000000", "8000000"),
    ("6.5m to 9m", "6500000", "9000000"),
]

# Sort phrases -> SortKey.
SORTS = [
    ("cheapest", "latest_price"),
    ("most active", "tx_count_12m"),
    ("newest", "latest_tx_date"),
    ("alphabetical", "name"),
    ("budget", "latest_price"),
]

UNSUPPORTED = [
    "sea view",
    "quiet",
    "pet friendly",
    "parking",
    "near mtr",
    "good schools",
    "furnished",
    "new build",
]

DIRECTIONS = ["east", "west", "north", "south"]

MTR_SHORTHANDS = {
    "Tseung Kwan O Line": "tko line",
    "East Rail Line": "east rail",
    "Tuen Ma Line": "tuen ma",
    "South Island Line": "south island",
}


def load_json(path: Path) -> Any:
    if not path.exists():
        raise SystemExit(f"missing artifact: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def normalise(text: str) -> str:
    """Match the frontend's place normalisation closely enough for dedupe."""
    text = text.lower()
    text = re.sub(r"[^\w\s\u4e00-\u9fff]+", " ", text)
    return " ".join(text.split())


def item(
    forms: list[str] | tuple[str, ...],
    planted: dict[str, Any],
    expect: str = "applied",
) -> dict[str, Any]:
    """One pool entry. Entries with the same planted value share a key.

    Balancing is per *value*, not per phrase: "2 bed", "two bedrooms" and "兩房"
    all count as the same coverage cell.
    """
    key = json.dumps({"planted": planted, "expect": expect}, sort_keys=True)
    return {"forms": list(forms), "planted": planted, "expect": expect, "key": key}


def build_places(geo: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """One entry per normalised label, at the broadest level that owns it.

    "Sha Tin" is both a subregion and a district label; production resolves it to
    the subregion, so the dataset must plant the same scope or the teacher's
    label would look wrong for a correct parse.
    """
    ranked = {"region": 0, "subregion": 1, "district": 2}
    by_label: dict[str, dict[str, Any]] = {}

    def add(label: str | None, level: str, planted: dict[str, str]) -> None:
        if not label:
            return
        key = normalise(label)
        if not key:
            return
        current = by_label.get(key)
        if current is not None and ranked[current["level"]] <= ranked[level]:
            # Same or broader level already owns the label; keep its forms.
            if label not in current["forms"]:
                current["forms"].append(label)
            return
        by_label[key] = {"level": level, "forms": [label], "planted": planted}

    region_of = {s["id"]: s["regionId"] for s in geo["subregions"]}
    for region in geo["regions"]:
        planted = {"regionId": region["id"]}
        add(region["en"], "region", planted)
        add(region.get("zh"), "region", planted)
    for subregion in geo["subregions"]:
        planted = {
            "regionId": subregion["regionId"],
            "subregionId": subregion["id"],
        }
        add(subregion["en"], "subregion", planted)
        add(subregion.get("zh"), "subregion", planted)
    for district in geo["districts"]:
        planted = {
            "regionId": region_of[district["subregionId"]],
            "subregionId": district["subregionId"],
            "districtId": district["id"],
        }
        add(district["en"], "district", planted)
        add(district.get("zh"), "district", planted)
        for alias in district["aliases"]:
            add(alias, "district", planted)

    entries = [
        item(entry["forms"], entry["planted"]) for entry in by_label.values()
    ]
    return {"place": sorted(entries, key=lambda row: normalise(row["forms"][0]))}


def scope_for(geo: dict[str, Any], level: str, identifier: str) -> dict[str, str]:
    if level == "region":
        return {"regionId": identifier}
    if level == "subregion":
        subregion = next(s for s in geo["subregions"] if s["id"] == identifier)
        return {"regionId": subregion["regionId"], "subregionId": identifier}
    district = next(d for d in geo["districts"] if d["id"] == identifier)
    subregion = next(s for s in geo["subregions"] if s["id"] == district["subregionId"])
    return {
        "regionId": subregion["regionId"],
        "subregionId": district["subregionId"],
        "districtId": identifier,
    }


def build_pools(
    geo: dict[str, Any], gazetteer: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    pools: dict[str, list[dict[str, Any]]] = build_places(geo)

    pools["bedrooms"] = [
        item([phrase], {"bedrooms": value}) for phrase, value in BEDROOMS
    ]
    pools["area"] = [
        item([phrase], {"minNetArea": low, "maxNetArea": high})
        for phrase, low, high in AREAS
    ]
    pools["price"] = [
        item([phrase], {"minPrice": low, "maxPrice": high})
        for phrase, low, high in PRICES
    ]
    pools["sort"] = [
        item([phrase], {"sort": key}) for phrase, key in SORTS
    ]
    pools["unsupported"] = [
        item([phrase], {}, "ignored") for phrase in UNSUPPORTED
    ]
    pools["direction"] = [
        item([word], {}, "ambiguous") for word in DIRECTIONS
    ]
    pools["out_of_scope"] = [
        item([term], {}, "refused") for term in gazetteer["outOfScope"]
    ]

    mtr: list[dict[str, Any]] = []
    for line in gazetteer["mtrLines"]:
        forms = [line["en"]]
        if line["en"] in MTR_SHORTHANDS:
            forms.append(MTR_SHORTHANDS[line["en"]])
        mtr.append(item(forms, {"mtrLine": line["en"]}))
    pools["mtr"] = mtr

    # Net ids with more than one name would plant a name that covers several
    # nets; that is a production-wide ambiguity, so those ids stay out of the
    # training bulk and are left to the abstain slice.
    names_by_id: dict[str, set[str]] = defaultdict(set)
    for net in gazetteer["schoolNets"]:
        names_by_id[net["id"]].add(net["en"])
    pools["net"] = [
        item([f"school net {net_id}", f"net {net_id}"], {"schoolNet": name})
        for net_id, names in sorted(names_by_id.items(), key=lambda pair: int(pair[0]))
        if len(names) == 1
        for name in names
        if name
    ]

    abbr: list[dict[str, Any]] = []
    for entry in gazetteer["abbreviations"]:
        candidates = entry["candidates"]
        if len(candidates) > 1:
            abbr.append(item([entry["term"].upper()], {}, "ambiguous"))
            continue
        candidate = candidates[0]
        scope = scope_for(geo, candidate["level"], candidate["id"])
        abbr.append(item([entry["term"].upper()], scope))
    pools["abbr"] = abbr
    return pools


def check_weights() -> None:
    total = round(sum(family["weight"] for family in FAMILIES), 6)
    if abs(total - 1.0) > 1e-6:
        raise SystemExit(f"family weights must sum to 1.0, got {total}")


def weighted_family(rng: random.Random) -> dict[str, Any]:
    roll = rng.random()
    cumulative = 0.0
    for family in FAMILIES:
        cumulative += family["weight"]
        if roll <= cumulative:
            return family
    return FAMILIES[-1]


def least_used(
    pool: list[dict[str, Any]],
    usage: Counter[str],
    rng: random.Random,
    predicate: Any = None,
) -> dict[str, Any]:
    """Pick the least-used value, then a random phrasing of it.

    Balancing per planted value (not per phrase) is what keeps "3 bed" from
    getting three times the rows of "1 bed" just because it has more spellings.
    """
    candidates = [entry for entry in pool if predicate is None or predicate(entry)]
    if not candidates:
        candidates = pool
    lowest = min(usage[entry["key"]] for entry in candidates)
    tied = [entry for entry in candidates if usage[entry["key"]] == lowest]
    chosen = rng.choice(tied)["key"]
    return rng.choice([entry for entry in candidates if entry["key"] == chosen])


ANCHOR_FAMILIES = {"place_line": ("mtr", "mtrLine"), "place_net": ("net", "schoolNet")}


def render(
    family: dict[str, Any],
    pools: dict[str, list[dict[str, Any]]],
    usage: dict[str, Counter[str]],
    rng: random.Random,
    cooccurrence: dict[str, dict[str, set[str]]],
    region_of: dict[str, str],
) -> tuple[str, dict[str, Any], str, str]:
    chosen: dict[str, dict[str, Any]] = {}
    planted: dict[str, Any] = {}
    expect = "applied"

    anchor = ANCHOR_FAMILIES.get(family["name"])
    if anchor:
        anchor_slot, anchor_key = anchor
        entry = least_used(pools[anchor_slot], usage[anchor_slot], rng)
        usage[anchor_slot][entry["key"]] += 1
        chosen[anchor_slot] = entry
        planted.update(entry["planted"])
        allowed = cooccurrence.get(anchor_key, {}).get(
            str(entry["planted"].get(anchor_key, "")), set()
        )
        place = least_used(
            pools["place"],
            usage["place"],
            rng,
            lambda candidate: place_allowed(candidate, allowed, region_of),
        )
        usage["place"][place["key"]] += 1
        chosen["place"] = place
        planted.update(place["planted"])

    for slot in family["slots"]:
        if slot in chosen:
            continue
        entry = least_used(pools[slot], usage[slot], rng)
        usage[slot][entry["key"]] += 1
        chosen[slot] = entry
        planted.update(entry["planted"])
        expect = entry.get("expect", expect)
    template = rng.choice(family["templates"])
    forms = {slot: rng.choice(item["forms"]) for slot, item in chosen.items()}
    return template.format(**forms), planted, expect, template


def load_cooccurrence(db_path: Path) -> dict[str, dict[str, set[str]]]:
    """Which subregions actually contain each MTR line and school-net name.

    Without this, a random pair produces "South Island Line in Tung Chung":
    a sentence the parser handles but no estate matches, and a label the teacher
    may try to "correct". The mart is read-only here; tests pass a fixture.
    """
    if not db_path.exists():
        return {}
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        lines: dict[str, set[str]] = defaultdict(set)
        nets: dict[str, set[str]] = defaultdict(set)
        for line_names, net_names, subregion_id in connection.execute(
            "SELECT mtr_lines, school_nets, subregion_id FROM mart_estate_summary"
        ):
            for name in (line_names or "").split(","):
                name = name.strip()
                if name:
                    lines[name].add(subregion_id)
            for name in (net_names or "").split(","):
                name = name.strip()
                if name:
                    nets[name].add(subregion_id)
    finally:
        connection.close()
    return {"mtrLine": lines, "schoolNet": nets}


def place_allowed(
    entry: dict[str, Any],
    allowed: set[str],
    region_of: dict[str, str],
) -> bool:
    if not allowed:
        return True
    subregion = entry["planted"].get("subregionId")
    if subregion:
        return subregion in allowed
    region = entry["planted"].get("regionId")
    return bool(region) and region in {region_of[sub] for sub in allowed if sub in region_of}


def generate(
    count: int,
    seed: int,
    db_path: Path | None = DEFAULT_DB,
) -> list[dict[str, Any]]:
    check_weights()
    geo = load_json(GEO)
    gazetteer = load_json(GAZETTEER)
    pools = build_pools(geo, gazetteer)
    cooccurrence = load_cooccurrence(db_path) if db_path is not None else {}
    region_of = {s["id"]: s["regionId"] for s in geo["subregions"]}
    usage: dict[str, Counter[str]] = {
        slot: Counter({entry["key"]: 0 for entry in pool})
        for slot, pool in pools.items()
    }
    rng = random.Random(seed)
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    attempts = 0
    limit = count * 40
    while len(rows) < count and attempts < limit:
        attempts += 1
        family = weighted_family(rng)
        text, planted, expect, template = render(
            family, pools, usage, rng, cooccurrence, region_of
        )
        key = normalise(text)
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "id": f"nl{len(rows) + 1:06d}",
                "text": text,
                "planted": planted,
                "expect": expect,
                "family": family["name"],
                "template": template,
            }
        )
    if len(rows) < count:
        raise SystemExit(
            f"stopped after {attempts} attempts with {len(rows)} unique rows; "
            "the template space is too small for the requested count"
        )
    return rows


def report(rows: list[dict[str, Any]], pools: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    families = Counter(row["family"] for row in rows)
    expects = Counter(row["expect"] for row in rows)
    coverage: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        for slot in ("mtrLine", "schoolNet", "sort", "bedrooms"):
            if slot in row["planted"]:
                coverage[slot][str(row["planted"][slot])] += 1
        level = (
            "district"
            if "districtId" in row["planted"]
            else "subregion"
            if "subregionId" in row["planted"]
            else "region"
            if "regionId" in row["planted"]
            else None
        )
        if level:
            coverage["place"][level] += 1
    return {
        "rows": len(rows),
        "unique_texts": len({normalise(row["text"]) for row in rows}),
        "families": dict(sorted(families.items())),
        "expect": dict(sorted(expects.items())),
        "coverage": {slot: dict(sorted(values.items())) for slot, values in coverage.items()},
        "pool_sizes": {slot: len(pool) for slot, pool in pools.items()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=6000)
    parser.add_argument("--seed", type=int, default=20261124)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument("--out-sample", type=Path, default=None)
    args = parser.parse_args(argv)

    geo = load_json(GEO)
    gazetteer = load_json(GAZETTEER)
    pools = build_pools(geo, gazetteer)
    rows = generate(args.count, args.seed, args.db)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} rows to {args.out}")

    if args.report:
        print(json.dumps(report(rows, pools), indent=2, ensure_ascii=False))

    if args.sample:
        # Spread the sample across the generated file so every family shows up.
        step = max(1, len(rows) // args.sample)
        sample = rows[::step][: args.sample]
        out_sample = args.out_sample or args.out.with_name("sample.jsonl")
        out_sample.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in sample),
            encoding="utf-8",
        )
        print(f"wrote {len(sample)} sample rows to {out_sample}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
