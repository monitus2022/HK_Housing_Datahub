"""Offline tests for the natural-language dataset generator.

The generator also reads the mart for line/net co-occurrence, so these tests
supply either ``db_path=None`` (correlation off) or a temporary fixture database.
No test touches the real DB or the network.
"""

from __future__ import annotations

import importlib.util
import json
import random
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


def test_every_family_has_at_least_three_templates() -> None:
    generator = load_generator()
    thin = {
        family["name"]: len(family["templates"])
        for family in generator.FAMILIES
        if len(family["templates"]) < 3
    }
    assert not thin, thin


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
    assert len(nets) == 18, nets


def test_negative_families_are_generated() -> None:
    generator = load_generator()
    rows = generator.generate(2000, seed=29, db_path=None)
    expects = {row["expect"] for row in rows}
    assert {"refused", "ignored", "ambiguous"} <= expects


def test_compound_district_labels_are_never_emitted() -> None:
    """Nobody types "Yau Yat Chuen / Shek Kip Mei"; the components stand alone."""
    generator = load_generator()
    rows = generator.generate(3000, seed=103, db_path=None)
    # No slash surface at all, not only the spaced form.
    assert all("/" not in row["text"] for row in rows)

    geo = geo_model()
    compound = {
        d["id"]
        for d in geo["districts"]
        if " / " in d["en"] or " / " in (d.get("zh") or "")
    }
    assert compound, "fixture has no compound districts"
    planted = {row["planted"].get("districtId") for row in rows}
    assert compound <= planted, sorted(compound - planted)


def test_a_joined_label_without_component_aliases_is_refused() -> None:
    """Dropping the joined form is only safe when every component is an alias."""
    generator = load_generator()
    geo = geo_model()
    district = next(d for d in geo["districts"] if " / " in d["en"])
    district["aliases"] = district["aliases"][:1]
    with pytest.raises(SystemExit) as error:
        generator.build_places(geo)
    assert "component" in str(error.value)


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
    lines = 0
    nets = 0
    for row in rows:
        planted = row["planted"]
        line = planted.get("mtrLine")
        net = planted.get("schoolNet")
        subregion = planted.get("subregionId")
        if line and subregion:
            assert subregion == {"Island Line": "1001", "Tseung Kwan O Line": "2010"}[line], row
            lines += 1
        if net and subregion:
            # Both nets live in 1001 in the fixture, so the net half of
            # load_cooccurrence is exercised rather than assumed.
            assert subregion == {"Central & Western": "1001", "Wan Chai": "1001", "Saikung": "2010"}[net], row
            nets += 1
    assert lines > 0, "no correlated line rows were generated"
    assert nets > 0, "no correlated net rows were generated"


def test_unmapped_values_are_dropped_not_widened(tmp_path: Path) -> None:
    """A line or net the mart cannot place must not appear at all."""
    generator = load_generator()
    db = write_fixture_db(tmp_path / "fixture.db")
    rows = generator.generate(600, seed=37, db_path=db)

    lines = {row["planted"]["mtrLine"] for row in rows if "mtrLine" in row["planted"]}
    nets = {row["planted"]["schoolNet"] for row in rows if "schoolNet" in row["planted"]}
    assert lines == {"Island Line", "Tseung Kwan O Line"}, lines
    assert nets <= {"Central & Western", "Wan Chai", "Saikung"}, nets


def test_missing_database_is_refused(tmp_path: Path) -> None:
    generator = load_generator()
    with pytest.raises(SystemExit) as error:
        generator.generate(20, seed=41, db_path=tmp_path / "absent.db")
    assert "--no-correlation" in str(error.value)


def test_uncorrelated_run_is_marked_in_the_report(tmp_path: Path, capsys) -> None:
    """A run without the mart must say so, not look like a correlated one."""
    generator = load_generator()
    out = tmp_path / "c.jsonl"
    generator.main(["--count", "60", "--no-correlation", "--out", str(out), "--report"])

    captured = capsys.readouterr().out
    report = json.loads(captured[captured.index("{") :])
    assert report["correlation"] == "off"
    assert report["duplicates"] == 0
    # At 60 rows most places never appear; `missing` must show that rather
    # than letting an absent value pass as covered.
    places = report["place_values"]
    assert places["expected"] == 77
    assert places["values"] + len(places["missing"]) == places["expected"]


def test_place_allowed_refuses_an_empty_allowance() -> None:
    """An empty allowance is a drift bug, not permission to pair anything."""
    generator = load_generator()
    entry = {"planted": {"subregionId": "1001"}}
    with pytest.raises(RuntimeError):
        generator.place_allowed(entry, set(), {"1001": "10"})


def test_least_used_refuses_an_unsatisfiable_predicate() -> None:
    generator = load_generator()
    pool = [{"forms": ["x"], "planted": {}, "expect": "applied", "key": "k"}]
    usage = {"k": 0}
    with pytest.raises(RuntimeError):
        generator.least_used(pool, usage, random.Random(1), lambda entry: False)


def test_report_lists_values_the_mart_cannot_place(tmp_path: Path, capsys) -> None:
    generator = load_generator()
    db = write_fixture_db(tmp_path / "fixture.db")
    out = tmp_path / "c.jsonl"
    assert (
        generator.main(["--count", "80", "--db", str(db), "--out", str(out), "--report"])
        == 0
    )
    captured = capsys.readouterr().out
    report = json.loads(captured[captured.index("{") :])
    excluded = report["excluded_unmapped"]
    # The fixture maps two lines and three nets; the rest must be named, not paired.
    assert "South Island Line" in excluded["mtrLine"]
    assert len(excluded["mtrLine"]) == 6
    assert "Yuen Long" in excluded["schoolNet"]
    # pool_sizes must reflect the filtered pools, not the unfiltered rebuild.
    assert report["pool_sizes"]["mtr"] == 2
    assert report["pool_sizes"]["net"] == 3


def test_cli_writes_candidates_and_sample(tmp_path: Path) -> None:
    generator = load_generator()
    out = tmp_path / "candidates.jsonl"
    sample = tmp_path / "nested" / "sample.jsonl"

    assert (
        generator.main(
            [
                "--count",
                "200",
                "--no-correlation",
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
