"""Offline tests for the natural-language dataset generator.

The generator also reads the mart for line/net co-occurrence, so these tests
supply either ``db_path=None`` (correlation off) or a temporary fixture database.
No test touches the real DB or the network.
"""

from __future__ import annotations

import importlib.util
import json
import random
import re
import sqlite3
from collections import Counter
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
    "maxBuildingAge",
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


def test_language_mix_and_purity() -> None:
    """55% English, 30% Chinese, 15% mixed, and each row is what it claims."""
    generator = load_generator()
    rows = generator.generate(3000, seed=107, db_path=None)
    counts = Counter(row["lang"] for row in rows)
    total = len(rows)
    for lang, share in (("en", 0.55), ("zh", 0.30), ("mixed", 0.15)):
        assert abs(counts[lang] / total - share) < 0.05, (lang, counts[lang], total)

    for row in rows:
        text = row["text"]
        if row["lang"] == "en":
            assert not re.search(r"[\u4e00-\u9fff]", text), row
        elif row["lang"] == "zh":
            assert not re.search(r"[A-Za-z]", text), row
        else:
            assert re.search(r"[\u4e00-\u9fff]", text), row
            assert re.search(r"[A-Za-z]", text), row


def test_language_predicate_rejects_an_incompatible_entry() -> None:
    generator = load_generator()
    pool = [
        {"forms": {"en": ["english only"]}, "planted": {}, "expect": "applied", "key": "en"},
        {"forms": {"en": ["both"], "zh": ["兩者"]}, "planted": {}, "expect": "applied", "key": "both"},
        {"forms": {"zh": ["只有中文"]}, "planted": {}, "expect": "applied", "key": "zh"},
    ]
    usage = {"en": 0, "both": 0, "zh": 0}
    picked = generator.least_used(
        pool, usage, random.Random(3), generator.language_predicate("place", "zh")
    )
    # Either bilingual or Chinese-only is fine; the English-only one is not.
    assert picked["key"] != "en"
    assert "zh" in picked["forms"]
    # Assert the predicate itself, not a pick: it must accept the English-capable
    # entries and reject the Chinese-only one.
    english = generator.language_predicate("place", "en")
    accepted = {entry["key"] for entry in pool if english(entry)}
    assert accepted == {"en", "both"}


def test_anchor_path_skips_a_monolingual_line() -> None:
    """The anchor selection must obey the row language, not only the main loop.

    Real lines and nets are all bilingual, so this can only be shown with a pool
    where the English-only candidate is the least-used one: without the predicate
    it is chosen first and leaks "mono" into a Chinese row.
    """
    generator = load_generator()
    pools = {
        "mtr": [
            {"forms": {"en": ["mono"]}, "planted": {"mtrLine": "Mono"}, "expect": "applied", "key": "m"},
            {"forms": {"en": ["bilingual"], "zh": ["雙語"]}, "planted": {"mtrLine": "Bilingual"}, "expect": "applied", "key": "b"},
        ],
        "place": [
            {"forms": {"en": ["place"], "zh": ["地方"]}, "planted": {"subregionId": "1001"}, "expect": "applied", "key": "p"},
        ],
    }
    family = next(f for f in generator.FAMILIES if f["name"] == "place_line")
    usage = {"mtr": Counter({"m": 0, "b": 5}), "place": Counter({"p": 0})}
    cooccurrence = {"mtrLine": {"Mono": {"1001"}, "Bilingual": {"1001"}}}
    for seed in range(5):
        text, _, _, _ = generator.render(
            family, pools, usage, random.Random(seed), cooccurrence, {"1001": "10"}, "zh"
        )
        assert "mono" not in text, text


def test_language_purity_survives_the_correlated_path(tmp_path: Path) -> None:
    """The mtr/net anchor picks entries too, and must respect the row language."""
    generator = load_generator()
    db = write_fixture_db(tmp_path / "fixture.db")
    rows = generator.generate(1200, seed=113, db_path=db)
    # The anchor path must actually be exercised, or the purity check is vacuous.
    assert any(
        row["lang"] == "zh" and ("mtrLine" in row["planted"] or "schoolNet" in row["planted"])
        for row in rows
    ), "no correlated Chinese rows were generated"
    for row in rows:
        text = row["text"]
        if row["lang"] == "en":
            assert not re.search(r"[\u4e00-\u9fff]", text), row
        elif row["lang"] == "zh":
            assert not re.search(r"[A-Za-z]", text), row
        else:
            assert re.search(r"[\u4e00-\u9fff]", text), row
            assert re.search(r"[A-Za-z]", text), row


def test_every_row_carries_its_language() -> None:
    generator = load_generator()
    rows = generator.generate(200, seed=127, db_path=None)
    assert {row["lang"] for row in rows} <= {"en", "zh", "mixed"}
    assert all(row["lang"] for row in rows)


def test_area_rows_use_units_the_lexicon_understands() -> None:
    """呎 and 平方米 are parseable now, so the dataset must exercise them."""
    generator = load_generator()
    rows = generator.generate(2000, seed=131, db_path=None)
    area = [
        row
        for row in rows
        if "minNetArea" in row["planted"] or "maxNetArea" in row["planted"]
    ]
    chinese = [row for row in area if row["lang"] == "zh"]
    assert chinese, "no Chinese area rows"
    assert any("呎" in row["text"] for row in chinese), "no 呎 rows"
    assert any("平方米" in row["text"] for row in chinese), "no 平方米 rows"

    for row in chinese:
        # The planted bounds are square feet, so a metric phrase must have been
        # converted before it was recorded.
        if "平方米" in row["text"]:
            bounds = {row["planted"].get("minNetArea"), row["planted"].get("maxNetArea")}
            assert bounds <= {"538", ""}, row


def test_chinese_rows_read_like_typing() -> None:
    """Placeholder order reads like a spec; the dataset should read like speech."""
    generator = load_generator()
    rows = generator.generate(2000, seed=137, db_path=None)
    chinese = [row["text"] for row in rows if row["lang"] == "zh"]
    assert chinese
    # 近 is excluded: 近地鐵 is a pool surface that predates the templates, so it
    # would satisfy the assertion on placeholder-order rows.
    particles = re.compile(r"想搵|有冇|嘅|預算")
    assert any(particles.search(text) for text in chinese), "no template particles"
    share = sum(1 for text in chinese if particles.search(text)) / len(chinese)
    assert share > 0.5, share


def test_chinese_rows_contain_no_spaces() -> None:
    """Chinese is typed without spaces, so the dataset must not ship them."""
    generator = load_generator()
    rows = generator.generate(1500, seed=139, db_path=None)
    chinese = [row for row in rows if row["lang"] == "zh"]
    assert chinese
    spaced = [row["text"] for row in chinese if " " in row["text"]]
    assert not spaced, spaced[:3]
    # Mixed rows must keep their English spacing; joining them would be a
    # different change and would break the mixed contract.
    mixed = [row["text"] for row in rows if row["lang"] == "mixed"]
    assert mixed
    assert all(" " in text for text in mixed), mixed[:3]


def test_direction_word_places_are_not_planted_in_english() -> None:
    """"North" is a district and a direction; English rows must not use it."""
    generator = load_generator()
    places = generator.build_places(geo_model())["place"]
    for place in places:
        planted = place["planted"]
        if planted.get("subregionId") not in {"3015", "301502"}:
            continue
        assert "north" not in [form.lower() for form in place["forms"].get("en", [])]


def test_room_phrasing_is_used() -> None:
    """'room(s)' is what people type, so it must outnumber the 'bed' forms."""
    generator = load_generator()
    rows = generator.generate(2000, seed=109, db_path=None)
    texts = [row["text"].lower() for row in rows if "bedrooms" in row["planted"]]
    rooms = sum(1 for text in texts if re.search(r"\brooms?\b", text))
    beds = sum(1 for text in texts if re.search(r"\bbed\b", text))
    assert rooms >= beds * 1.2, (rooms, beds)


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


def test_a_joined_label_missing_a_chinese_alias_is_refused() -> None:
    """The guard must cover the Chinese components too, not only English."""
    generator = load_generator()
    geo = geo_model()
    district = next(d for d in geo["districts"] if " / " in (d.get("zh") or ""))
    zh_parts = {part.strip() for part in district["zh"].split(" / ")}
    district["aliases"] = [
        alias for alias in district["aliases"] if alias.strip() not in zh_parts
    ]
    with pytest.raises(SystemExit):
        generator.build_places(geo)


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
    pool = [{"forms": {"en": ["x"]}, "planted": {}, "expect": "applied", "key": "k"}]
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
