"""Offline tests for the natural-language dataset generator.

The generator reads only the checked-in ``geo.json`` and ``gazetteer.json``, so
these tests need no database and no network.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "build_nl_dataset.py"
GEO = ROOT / "frontend" / "src" / "lib" / "geo.json"

FILTER_KEYS = {
    "regionId",
    "subregionId",
    "districtId",
    "minPrice",
    "maxPrice",
    "minNetArea",
    "maxNetArea",
    "bedrooms",
    "mtrLine",
    "schoolNet",
    "sort",
}


def load_generator():
    spec = importlib.util.spec_from_file_location("build_nl_dataset", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def geo_model() -> dict:
    return json.loads(GEO.read_text(encoding="utf-8"))


def test_family_weights_sum_to_one() -> None:
    generator = load_generator()
    generator.check_weights()  # raises SystemExit on drift

    # Mutating the table must fail loudly rather than silently starving a family.
    original = [dict(family) for family in generator.FAMILIES]
    generator.FAMILIES[0]["weight"] = 0.5
    with pytest.raises(SystemExit):
        generator.check_weights()
    generator.FAMILIES[:] = original


def test_generation_is_deterministic() -> None:
    generator = load_generator()
    first = generator.generate(120, seed=7, db_path=None)
    second = generator.generate(120, seed=7, db_path=None)
    assert first == second
    other = generator.generate(120, seed=8, db_path=None)
    assert [row["text"] for row in first] != [row["text"] for row in other]


def test_texts_are_unique_and_ids_are_sequential() -> None:
    generator = load_generator()
    rows = generator.generate(300, seed=11, db_path=None)
    texts = [generator.normalise(row["text"]) for row in rows]
    assert len(rows) == 300
    assert len(set(texts)) == len(texts)
    assert [row["id"] for row in rows][:3] == ["nl000001", "nl000002", "nl000003"]


def test_planted_values_are_known_filter_keys() -> None:
    generator = load_generator()
    for row in generator.generate(300, seed=13, db_path=None):
        assert set(row["planted"]) <= FILTER_KEYS, row
        assert row["expect"] in {"applied", "ambiguous", "ignored", "refused"}
        assert row["family"]
        assert row["template"]


def test_locations_are_geographically_consistent() -> None:
    generator = load_generator()
    geo = geo_model()
    region_of = {s["id"]: s["regionId"] for s in geo["subregions"]}
    district_of = {d["id"]: d["subregionId"] for d in geo["districts"]}

    for row in generator.generate(500, seed=17, db_path=None):
        planted = row["planted"]
        if "districtId" in planted:
            assert "subregionId" in planted and "regionId" in planted, row
            assert district_of[planted["districtId"]] == planted["subregionId"], row
            assert region_of[planted["subregionId"]] == planted["regionId"], row
        elif "subregionId" in planted:
            assert "regionId" in planted, row
            assert region_of[planted["subregionId"]] == planted["regionId"], row


def test_area_and_price_ranges_are_ordered() -> None:
    generator = load_generator()
    for row in generator.generate(400, seed=19, db_path=None):
        planted = row["planted"]
        for low_key, high_key in (
            ("minNetArea", "maxNetArea"),
            ("minPrice", "maxPrice"),
        ):
            low = planted.get(low_key)
            high = planted.get(high_key)
            if low and high:
                assert int(low) <= int(high), row


def test_enum_values_are_not_starved() -> None:
    """Least-used sampling must cover every MTR line and sort key early."""
    generator = load_generator()
    rows = generator.generate(600, seed=23, db_path=None)
    lines = {row["planted"]["mtrLine"] for row in rows if "mtrLine" in row["planted"]}
    sorts = {row["planted"]["sort"] for row in rows if "sort" in row["planted"]}
    nets = {row["planted"]["schoolNet"] for row in rows if "schoolNet" in row["planted"]}
    assert len(lines) == 8, lines
    assert len(sorts) == 4, sorts
    assert len(nets) >= 15, nets


def test_negative_families_are_generated() -> None:
    generator = load_generator()
    rows = generator.generate(2000, seed=29, db_path=None)
    expects = {row["expect"] for row in rows}
    assert {"refused", "ignored", "ambiguous"} <= expects


def write_fixture_db(path: Path) -> Path:
    """A minimal mart that maps one line and one net to single subregions."""
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE mart_estate_summary (mtr_lines TEXT, school_nets TEXT, subregion_id TEXT)"
    )
    connection.executemany(
        "INSERT INTO mart_estate_summary VALUES (?, ?, ?)",
        [
            ("Island Line", "Central & Western", "1001"),
            ("Island Line", "Wan Chai", "1001"),
            ("Tseung Kwan O Line", "Saikung", "2010"),
        ],
    )
    connection.commit()
    connection.close()
    return path


def test_line_and_net_places_follow_the_mart(tmp_path: Path) -> None:
    generator = load_generator()
    db = write_fixture_db(tmp_path / "fixture.db")

    rows = generator.generate(400, seed=31, db_path=db)
    checked = 0
    for row in rows:
        planted = row["planted"]
        line = planted.get("mtrLine")
        if line == "Island Line" and "subregionId" in planted:
            assert planted["subregionId"] == "1001", row
            checked += 1
        if line == "Tseung Kwan O Line" and "subregionId" in planted:
            assert planted["subregionId"] == "2010", row
            checked += 1
    assert checked > 0, "no correlated rows were generated"


def test_cli_writes_candidates_and_sample(tmp_path: Path) -> None:
    generator = load_generator()
    out = tmp_path / "candidates.jsonl"
    sample = tmp_path / "sample.jsonl"

    assert (
        generator.main(
            [
                "--count",
                "200",
                "--out",
                str(out),
                "--sample",
                "10",
                "--out-sample",
                str(sample),
            ]
        )
        == 0
    )
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    picked = [json.loads(line) for line in sample.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 200
    assert len(picked) == 10
    assert all(row["text"] for row in rows)
