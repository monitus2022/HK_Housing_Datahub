#!/usr/bin/env python3
"""Generate candidate natural-language utterances for the NL-search dataset.

The generator writes **inputs and planted slot values only**. It never writes
labels: the teacher labels the sentences, and the lexicon remains the baseline
that must be beaten (see ``docs/nl-search-development.md``).

Inputs:

- ``frontend/src/lib/geo.json``       region -> subregion -> district
- ``frontend/src/lib/gazetteer.json`` MTR lines, school nets, abbreviations,
                                      direction cells, out-of-scope places
- ``data/agency/agency_data.db``      read-only, only for line/net co-occurrence

The third input is what keeps "South Island Line in Tung Chung" out of the bulk.
Because it is gitignored, a checkout without it refuses to run rather than
silently pairing lines and nets at random; pass ``--no-correlation`` for offline
use, and note that such output is uncorrelated and marked as such in the report.

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
import sys
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
        "weight": 0.13,
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
        "weight": 0.12,
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
        "weight": 0.07,
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
        "weight": 0.09,
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
            "looking for {bedrooms} {area} in {place}",
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
        "weight": 0.11,
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
        "templates": [
            "{bedrooms} {price}",
            "{price} {bedrooms} flat",
            "{bedrooms} for {price}",
        ],
    },
    {
        "name": "place_age",
        "weight": 0.03,
        "slots": ["place", "age"],
        "templates": [
            "{age} in {place}",
            "{place} {age}",
            "looking for {age} in {place}",
        ],
    },
    {
        "name": "sort_place",
        "weight": 0.05,
        "slots": ["sort", "place"],
        "templates": [
            "{sort} in {place}",
            "{sort} flats in {place}",
            "show me {sort} in {place}",
        ],
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
            "show me flats in {out_of_scope}",
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

# Chinese templates read like something typed into a chat box: 想搵 ("want to
# find"), 有冇 ("any?"), 嘅 ("of"), 預算 ("budget"). Placeholders are separated
# while the sentence is assembled, then a zh row is joined before it is written:
# Chinese is typed without spaces and the lexicon segments it. The particles are
# deliberately words the lexicon does not know, which is the gap the model is
# meant to close.
TEMPLATES_ZH: dict[str, list[str]] = {
    "place": ["{place}", "想搵 {place}", "{place} 樓盤"],
    "place_bed": [
        "{place} {bedrooms}",
        "想搵 {place} {bedrooms}",
        "{place} {bedrooms} 有冇",
    ],
    "place_price": [
        "{place} {price}",
        "想搵 {place} {price}",
        "{place} 預算 {price}",
    ],
    "place_area": ["{place} {area}", "想搵 {place} {area}", "{place} 要 {area}"],
    "place_bed_price": [
        "{place} {bedrooms} {price}",
        "想搵 {bedrooms} {price} 嘅 {place}",
        "想搵 {place} {bedrooms} {price}",
    ],
    "place_bed_area": [
        "{place} {bedrooms} {area}",
        "想搵 {place} {bedrooms} {area}",
        "{bedrooms} {area} {place} 有冇",
    ],
    "place_line": ["{place} {mtr}", "近 {mtr} 嘅 {place}", "想搵 {place} 近 {mtr}"],
    "place_net": ["{place} {net}", "想搵 {place} {net}", "{net} {place} 有冇"],
    "bed_price": ["{bedrooms} {price}", "想搵 {bedrooms} {price}", "{bedrooms} 預算 {price}"],
    "sort_place": ["{place} {sort}", "{sort} 嘅 {place}", "想搵 {sort} {place}"],
    "direction": ["{direction}", "{direction} 嘅樓", "想搵 {direction}"],
    "out_of_scope": ["{out_of_scope}", "想搵 {out_of_scope} 嘅樓", "{out_of_scope} 有冇"],
    "unsupported": ["{unsupported}", "要 {unsupported} 嘅樓", "想搵 {unsupported}"],
    "place_age": ["{place} {age}", "想搵 {age} {place}", "{place} 要 {age}"],
    "place_unsupported": [
        "{place} {unsupported}",
        "要 {unsupported} 嘅 {place}",
        "想搵 {place} {unsupported}",
    ],
}

for _family in FAMILIES:
    if _family["name"] in TEMPLATES_ZH:
        _family["templates_zh"] = TEMPLATES_ZH[_family["name"]]

# Row-level language mix: pure English, pure Chinese, and the mixed style people
# actually type (English keyword, Chinese place).
LANGUAGE_WEIGHTS: dict[str, int] = {"en": 55, "zh": 30, "mixed": 15}

# Bedrooms -> (value, English forms, Chinese forms). "room(s)" is prioritised
# because that is what people actually type.
BEDROOMS = [
    ("1", ["1 bedroom", "1 bed", "one bedroom"], ["一房"]),
    ("2", ["2 rooms", "2-room", "2 bed"], ["兩房", "二房"]),
    ("3", ["3 rooms", "3-room", "3 bed", "three bedrooms"], ["三房"]),
    ("4+", ["4 rooms", "4+ rooms", "4+ bed"], ["四房", "五房", "六房"]),
]

# Area phrases -> (English, Chinese, min, max). Vague words carry the shipped
# defaults; Chinese size words only appear next to 單位.
AREAS = [
    ("500-700 sq ft", "500至700呎", "500", "700"),
    ("under 600 ft", "600呎以下", "", "600"),
    ("over 800 sq ft", "800呎以上", "800", ""),
    ("over 50 sqm", "50平方米以上", "538", ""),
    ("small", "細單位", "", "400"),
    ("small size", "細單位", "", "400"),
    ("compact", "細單位", "", "400"),
    ("middle size", "中型單位", "400", "700"),
    ("mid size", "中型單位", "400", "700"),
    ("medium sized", "中型單位", "400", "700"),
    ("large", "大單位", "700", ""),
    ("big", "大單位", "700", ""),
    ("spacious", "大單位", "700", ""),
]

# Price phrases -> (English, Chinese, min, max).
PRICES = [
    ("under 3m", "300萬以下", "", "3000000"),
    ("under 5m", "500萬以下", "", "5000000"),
    ("under 6m", "600萬以下", "", "6000000"),
    ("below 8 million", "800萬以下", "", "8000000"),
    ("under 600k", "60萬以下", "", "600000"),
    ("up to 12m", "1200萬以下", "", "12000000"),
    ("over 10m", "1000萬以上", "10000000", ""),
    ("3m to 5m", "300萬至500萬", "3000000", "5000000"),
    ("5m to 8m", "500萬至800萬", "5000000", "8000000"),
    ("6.5m to 9m", "650萬至900萬", "6500000", "9000000"),
]

# Building age -> (English, Chinese).
AGES = [
    ("new build", "新樓"),
    ("newly built", "新樓"),
    ("brand new", "新樓"),
    ("new", "新樓"),
]

# Sort phrases -> (English, Chinese, SortKey).
SORTS = [
    ("cheapest", "最平", "latest_price"),
    ("most active", "最活躍", "tx_count_12m"),
    ("newest", "最新", "latest_tx_date"),
    ("alphabetical", "按名稱", "name"),
    ("budget", "最抵", "latest_price"),
]

UNSUPPORTED = [
    ("sea view", "海景"),
    ("quiet", "安靜"),
    ("pet friendly", "可養寵物"),
    ("parking", "車位"),
    ("near mtr", "近地鐵"),
    ("good schools", "好校網"),
    ("furnished", "連傢俬"),
]

DIRECTIONS = [
    ("east", "東"),
    ("west", "西"),
    ("north", "北"),
    ("south", "南"),
]

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


CJK = re.compile(r"[\u4e00-\u9fff]")


def item(
    forms: dict[str, list[str]],
    planted: dict[str, Any],
    expect: str = "applied",
) -> dict[str, Any]:
    """One pool entry, with its forms tagged by language.

    Entries with the same planted value share a key, so balancing stays per
    value: "2 bed", "2 rooms" and 兩房 are one coverage cell.
    """
    cleaned = {lang: list(values) for lang, values in forms.items() if values}
    if not cleaned:
        raise SystemExit(f"pool entry without forms: {planted}")
    key = json.dumps({"planted": planted, "expect": expect}, sort_keys=True)
    return {"forms": cleaned, "planted": planted, "expect": expect, "key": key}


def build_places(geo: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """One entry per place, carrying its English and Chinese surfaces.

    Grouping is by scope, not by label: "Sha Tin" and 沙田 are the same place, and
    a Chinese row must not fall back to an English label. Labels are still owned
    at the broadest level that claims them, because "Sha Tin" is both a subregion
    and a district and production resolves it to the subregion.
    """
    ranked = {"region": 0, "subregion": 1, "district": 2}
    by_scope: dict[str, dict[str, Any]] = {}
    owner: dict[str, dict[str, Any]] = {}

    def add(label: str | None, level: str, planted: dict[str, str]) -> None:
        if not label:
            return
        key = normalise(label)
        if not key:
            return
        language = "zh" if CJK.search(label) else "en"
        held = owner.get(key)
        if held is not None and ranked[held["level"]] <= ranked[level]:
            entry = held
        else:
            scope = json.dumps(planted, sort_keys=True)
            entry = by_scope.setdefault(
                scope,
                {"level": level, "en": [], "zh": [], "planted": planted},
            )
            # Broader levels are added first, so this only ever widens ownership.
            entry["level"] = level
            owner[key] = entry
        if label not in entry[language]:
            entry[language].append(label)

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
        aliases = [alias for alias in district["aliases"] if alias]
        compound = " / " in district["en"] or " / " in (district.get("zh") or "")
        # Nobody types "Yau Yat Chuen / Shek Kip Mei". The aliases are the
        # component names, so a joined label would teach a surface no user
        # produces and read as a multiple choice.
        if compound:
            # A joined label is only safe to drop when every component is an
            # alias; otherwise the district would silently lose that component.
            components = {
                normalise(part)
                for form in (district["en"], district.get("zh") or "")
                for part in re.split(r" / ", form)
                if part.strip()
            }
            missing = components - {normalise(alias) for alias in aliases}
            if missing:
                raise SystemExit(
                    f"district {district['id']} has a joined label but no alias "
                    f"for {sorted(missing)}; the dataset would drop those components"
                )
            forms = aliases
        else:
            forms = [district["en"], district.get("zh"), *aliases]
        for form in forms:
            add(form, "district", planted)

    entries = [
        item({"en": entry["en"], "zh": entry["zh"]}, entry["planted"])
        for entry in by_scope.values()
    ]
    return {
        "place": sorted(
            entries,
            key=lambda row: normalise((row["forms"].get("en") or row["forms"]["zh"])[0]),
        )
    }


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
        item({"en": english, "zh": chinese}, {"bedrooms": value})
        for value, english, chinese in BEDROOMS
    ]
    pools["area"] = [
        item({"en": [english], "zh": [chinese]}, {"minNetArea": low, "maxNetArea": high})
        for english, chinese, low, high in AREAS
    ]
    pools["price"] = [
        item({"en": [english], "zh": [chinese]}, {"minPrice": low, "maxPrice": high})
        for english, chinese, low, high in PRICES
    ]
    pools["age"] = [
        item({"en": [english], "zh": [chinese]}, {"maxBuildingAge": "5"})
        for english, chinese in AGES
    ]
    pools["sort"] = [
        item({"en": [english], "zh": [chinese]}, {"sort": key})
        for english, chinese, key in SORTS
    ]
    pools["unsupported"] = [
        item({"en": [english], "zh": [chinese]}, {}, "ignored")
        for english, chinese in UNSUPPORTED
    ]
    pools["direction"] = [
        item({"en": [english], "zh": [chinese]}, {}, "ambiguous")
        for english, chinese in DIRECTIONS
    ]
    # The curated list carries both languages as separate terms; tag each so a
    # Chinese row never contains an English city and vice versa.
    pools["out_of_scope"] = [
        item({"zh" if CJK.search(term) else "en": [term]}, {}, "refused")
        for term in gazetteer["outOfScope"]
    ]

    mtr: list[dict[str, Any]] = []
    for line in gazetteer["mtrLines"]:
        english = [line["en"]]
        if line["en"] in MTR_SHORTHANDS:
            english.append(MTR_SHORTHANDS[line["en"]])
        chinese = []
        if line.get("zh"):
            chinese.append(line["zh"])
            chinese.append(line["zh"].replace("綫", "線"))
        mtr.append(item({"en": english, "zh": chinese}, {"mtrLine": line["en"]}))
    pools["mtr"] = mtr

    # Net ids with more than one name would plant a name that covers several
    # nets; that is a production-wide ambiguity, so those ids stay out of the
    # training bulk and are left to the abstain slice.
    names_by_id: dict[str, set[str]] = defaultdict(set)
    for net in gazetteer["schoolNets"]:
        names_by_id[net["id"]].add(net["en"])
    pools["net"] = [
        item(
            {
                "en": [f"school net {net_id}", f"net {net_id}"],
                "zh": [f"校網 {net_id}", f"{net_id}校網"],
            },
            {"schoolNet": name},
        )
        for net_id, names in sorted(names_by_id.items(), key=lambda pair: int(pair[0]))
        if len(names) == 1
        for name in names
        if name
    ]

    abbr: list[dict[str, Any]] = []
    for entry in gazetteer["abbreviations"]:
        candidates = entry["candidates"]
        if len(candidates) > 1:
            abbr.append(item({"en": [entry["term"].upper()]}, {}, "ambiguous"))
            continue
        candidate = candidates[0]
        scope = scope_for(geo, candidate["level"], candidate["id"])
        abbr.append(item({"en": [entry["term"].upper()]}, scope))
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
    """Pick the approximately least-used value, then a random phrasing of it.

    Counters are incremented on selection, so attempts that are later discarded
    as duplicates still consume a value's budget; the spread is therefore
    approximate rather than exactly even.

    Balancing per planted value (not per phrase) is what keeps "3 bed" from
    getting three times the rows of "1 bed" just because it has more spellings.
    """
    candidates = [entry for entry in pool if predicate is None or predicate(entry)]
    if not candidates:
        raise RuntimeError(
            "no pool entry satisfies the constraint; refusing to widen the pool "
            "and break the co-occurrence mapping silently"
        )
    lowest = min(usage[entry["key"]] for entry in candidates)
    tied = [entry for entry in candidates if usage[entry["key"]] == lowest]
    chosen = rng.choice(tied)["key"]
    return rng.choice([entry for entry in candidates if entry["key"] == chosen])


ANCHOR_FAMILIES = {"place_line": ("mtr", "mtrLine"), "place_net": ("net", "schoolNet")}


def language_predicate(slot: str, lang: str):
    """Only accept a pool entry that has a surface in the row's language."""
    wanted = form_language(slot, lang)
    return lambda entry: bool(entry["forms"].get(wanted))


def forms_for(entry: dict[str, Any], slot: str, lang: str) -> list[str]:
    """Which language's surface to use for one slot.

    A mixed row is an English sentence with a Chinese place: "2 bed in 旺角".
    """
    forms = entry["forms"]
    wanted = form_language(slot, lang)
    return forms.get(wanted) or forms.get("en") or forms["zh"]


def choose_language(rng: random.Random, family: dict[str, Any]) -> str:
    """Pick a row language.

    Chinese needs a Chinese template; mixed needs a place slot, because a mixed
    row is an English sentence with a Chinese place. A family without a Chinese
    template (abbreviations) is English-only.
    """
    options = ["en"]
    weights = [LANGUAGE_WEIGHTS["en"]]
    if "place" in family["slots"]:
        options.append("mixed")
        weights.append(LANGUAGE_WEIGHTS["mixed"])
    if family.get("templates_zh"):
        options.append("zh")
        weights.append(LANGUAGE_WEIGHTS["zh"])
    return rng.choices(options, weights=weights, k=1)[0]


def form_language(slot: str, lang: str) -> str:
    """A mixed row is English except for the place."""
    return "zh" if lang == "zh" or (lang == "mixed" and slot == "place") else "en"


def render(
    family: dict[str, Any],
    pools: dict[str, list[dict[str, Any]]],
    usage: dict[str, Counter[str]],
    rng: random.Random,
    cooccurrence: dict[str, dict[str, set[str]]] | None,
    region_of: dict[str, str],
    lang: str,
) -> tuple[str, dict[str, Any], str, str]:
    chosen: dict[str, dict[str, Any]] = {}
    planted: dict[str, Any] = {}
    expect = "applied"

    anchor = ANCHOR_FAMILIES.get(family["name"])
    if anchor and cooccurrence is not None:
        anchor_slot, anchor_key = anchor
        entry = least_used(
            pools[anchor_slot],
            usage[anchor_slot],
            rng,
            language_predicate(anchor_slot, lang),
        )
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
            lambda candidate: (
                bool(candidate["forms"].get(form_language("place", lang)))
                and place_allowed(candidate, allowed, region_of)
            ),
        )
        usage["place"][place["key"]] += 1
        chosen["place"] = place
        planted.update(place["planted"])

    for slot in family["slots"]:
        if slot in chosen:
            continue
        entry = least_used(
            pools[slot],
            usage[slot],
            rng,
            language_predicate(slot, lang),
        )
        usage[slot][entry["key"]] += 1
        chosen[slot] = entry
        planted.update(entry["planted"])
        expect = entry.get("expect", expect)
    if lang == "zh" and family.get("templates_zh"):
        templates = family["templates_zh"]
    elif lang == "mixed":
        # "{place}" alone has no English side, so it would be indistinguishable
        # from a Chinese row.
        templates = [
            t
            for t in family["templates"]
            if re.search(r"[A-Za-z]{2,}", re.sub(r"\{[a-z_]+\}", "", t))
        ] or family["templates"]
    else:
        templates = family["templates"]
    template = rng.choice(templates)
    forms = {
        slot: rng.choice(forms_for(entry, slot, lang))
        for slot, entry in chosen.items()
    }
    text = template.format(**forms)
    if lang == "zh":
        # Chinese is typed without spaces; the parser segments it. Zones are
        # joined, so the dataset contains no spaced Chinese at all.
        text = text.replace(" ", "")
    return text, planted, expect, template


def load_cooccurrence(db_path: Path) -> dict[str, dict[str, set[str]]]:
    """Which subregions actually contain each MTR line and school-net name.

    Without this, a random pair produces "South Island Line in Tung Chung":
    a sentence the parser handles but no estate matches, and a label the teacher
    may try to "correct". The mart is read-only here; tests pass a fixture.
    """
    if not db_path.exists():
        raise SystemExit(
            f"missing database: {db_path}\n"
            "Line and net rows are paired only with subregions that actually contain\n"
            "them. Without the mart those pairs become random, which is exactly the\n"
            "defect this constraint exists to prevent, so this refuses to guess.\n"
            "Pass --no-correlation to generate without the constraint; such output is\n"
            "marked as uncorrelated and is not suitable for labelling."
        )
    try:
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.DatabaseError as error:
        raise SystemExit(f"cannot open {db_path}: {error}") from error
    try:
        try:
            records = list(
                connection.execute(
                    "SELECT mtr_lines, school_nets, subregion_id FROM mart_estate_summary"
                )
            )
        except sqlite3.DatabaseError as error:
            raise SystemExit(
                f"{db_path} is not a usable mart ({error}); pass --no-correlation "
                "to generate without line/net correlation"
            ) from error
        lines: dict[str, set[str]] = defaultdict(set)
        nets: dict[str, set[str]] = defaultdict(set)
        for line_names, net_names, subregion_id in records:
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


def filter_correlated(
    pools: dict[str, list[dict[str, Any]]],
    cooccurrence: dict[str, dict[str, set[str]]],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[str]]]:
    """Drop line and net values that no estate in the mart matches.

    A name missing from the mart has no correct place, so pairing it with one
    would invent a sentence the data cannot support. Dropping is visible in the
    report; the alternative — silently widening every pair — hides the defect.
    """
    dropped: dict[str, list[str]] = {}
    for slot, key, names in (
        ("mtr", "mtrLine", cooccurrence.get("mtrLine", {})),
        ("net", "schoolNet", cooccurrence.get("schoolNet", {})),
    ):
        kept = [
            entry for entry in pools[slot] if str(entry["planted"][key]) in names
        ]
        dropped[key] = sorted(
            {
                str(entry["planted"][key])
                for entry in pools[slot]
                if str(entry["planted"][key]) not in names
            }
        )
        pools[slot] = kept
    return pools, dropped


def place_allowed(
    entry: dict[str, Any],
    allowed: set[str],
    region_of: dict[str, str],
) -> bool:
    if not allowed:
        raise RuntimeError(
            "co-occurrence came back empty for a value that is in the pool; "
            "the mapping and the pool have drifted apart"
        )
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
    cooccurrence = load_cooccurrence(db_path) if db_path is not None else None
    if cooccurrence is not None:
        pools, dropped = filter_correlated(pools, cooccurrence)
        for key, names in dropped.items():
            if names:
                print(
                    f"warning: {len(names)} {key} value(s) match no estate and are "
                    f"excluded: {', '.join(names)}",
                    file=sys.stderr,
                )
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
        lang = choose_language(rng, family)
        text, planted, expect, template = render(
            family, pools, usage, rng, cooccurrence, region_of, lang
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
                "lang": lang,
            }
        )
    if len(rows) < count:
        raise SystemExit(
            f"stopped after {attempts} attempts with {len(rows)} unique rows; "
            "the template space is too small for the requested count"
        )
    return rows


def report(
    rows: list[dict[str, Any]],
    pools: dict[str, list[dict[str, Any]]],
    correlation: str = "on",
    excluded: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    families = Counter(row["family"] for row in rows)
    languages = Counter(row["lang"] for row in rows)
    expects = Counter(row["expect"] for row in rows)
    coverage: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        for slot in ("mtrLine", "schoolNet", "sort", "bedrooms", "maxBuildingAge"):
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
    place_counts: Counter[str] = Counter()
    for row in rows:
        planted = row["planted"]
        key = (
            planted.get("districtId")
            or planted.get("subregionId")
            or planted.get("regionId")
        )
        if key:
            place_counts[str(key)] += 1

    unique = len({normalise(row["text"]) for row in rows})
    expected_places = {
        str(
            entry["planted"].get("districtId")
            or entry["planted"].get("subregionId")
            or entry["planted"].get("regionId")
        )
        for entry in pools["place"]
    }

    return {
        "rows": len(rows),
        "unique_texts": unique,
        "duplicates": len(rows) - unique,
        "correlation": correlation,
        "excluded_unmapped": excluded or {},
        "families": dict(sorted(families.items())),
        "languages": dict(sorted(languages.items())),
        "expect": dict(sorted(expects.items())),
        "coverage": {slot: dict(sorted(values.items())) for slot, values in coverage.items()},
        "below_gate": {
            slot: sorted(name for name, count in values.items() if count < 25)
            for slot, values in coverage.items()
            if slot != "place"
        },
        "place_values": {
            "expected": len(expected_places),
            "values": len(place_counts),
            "missing": sorted(expected_places - set(place_counts)),
            "min": min(place_counts.values()) if place_counts else 0,
            "max": max(place_counts.values()) if place_counts else 0,
            "below_25": sorted(
                key for key, count in place_counts.items() if count < 25
            ),
        },
        "pool_sizes": {slot: len(pool) for slot, pool in pools.items()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=6000)
    parser.add_argument("--seed", type=int, default=20261124)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument(
        "--no-correlation",
        action="store_true",
        help="skip the mart; line and net rows then pair with any place "
        "(offline use only, not suitable for labelling)",
    )
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument("--out-sample", type=Path, default=None)
    args = parser.parse_args(argv)

    geo = load_json(GEO)
    gazetteer = load_json(GAZETTEER)
    db_path = None if args.no_correlation else args.db
    rows = generate(args.count, args.seed, db_path)
    pools = build_pools(geo, gazetteer)
    excluded: dict[str, list[str]] = {}
    if db_path is not None:
        # Report the pools the run actually used: filter_correlated has already
        # dropped names the mart cannot place, and pool_sizes must not overstate.
        pools, excluded = filter_correlated(pools, load_cooccurrence(db_path))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} rows to {args.out}")

    if args.report:
        print(
            json.dumps(
                report(
                    rows,
                    pools,
                    correlation="off" if db_path is None else "on",
                    excluded=excluded,
                ),
                indent=2,
                ensure_ascii=False,
            )
        )

    if args.sample:
        # Spread the sample across the generated file so every family shows up.
        step = max(1, len(rows) // args.sample)
        sample = rows[::step][: args.sample]
        out_sample = args.out_sample or args.out.with_name("sample.jsonl")
        out_sample.parent.mkdir(parents=True, exist_ok=True)
        out_sample.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in sample),
            encoding="utf-8",
        )
        print(f"wrote {len(sample)} sample rows to {out_sample}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
