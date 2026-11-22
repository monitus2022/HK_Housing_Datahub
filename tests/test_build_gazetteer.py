"""Offline tests for the gazetteer builder.

Builds a throwaway SQLite database seeded from the checked-in `geo.json`, so
every curated id in the builder is validated against the hierarchy that
actually ships. No network, no real database.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "build_gazetteer.py"
GEO = ROOT / "frontend" / "src" / "lib" / "geo.json"


def load_builder():
    spec = importlib.util.spec_from_file_location("build_gazetteer", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def hierarchy_rows() -> list[tuple[str, str, str]]:
    model = json.loads(GEO.read_text(encoding="utf-8"))
    subregion_parent = {s["id"]: s["regionId"] for s in model["subregions"]}
    return [
        (subregion_parent[d["subregionId"]], d["subregionId"], d["id"])
        for d in model["districts"]
    ]


def write_db(path: Path) -> Path:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE mart_estate_summary (
            region_id TEXT, subregion_id TEXT, district_id TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO mart_estate_summary VALUES (?, ?, ?)", hierarchy_rows()
    )
    conn.execute(
        """
        CREATE TABLE estate_mtr_lines (
            estate_id TEXT, mtr_line_name_zh TEXT, mtr_line_name_en TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO estate_mtr_lines VALUES (?, ?, ?)",
        [
            ("E1", "荃灣綫", "Tsuen Wan Line"),
            ("E2", "荃灣綫", "Tsuen Wan Line"),
            ("E3", "將軍澳綫", "Tseung Kwan O Line"),
        ],
    )
    conn.execute(
        """
        CREATE TABLE estate_school_nets (
            estate_id TEXT, school_net_id TEXT,
            school_net_name_zh TEXT, school_net_name_en TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO estate_school_nets VALUES (?, ?, ?, ?)",
        [
            ("E1", "62", "荃灣", "Tsuen Wan"),
            ("E2", "95", "西貢", "Saikung"),
            ("E3", "34", "", ""),
        ],
    )
    conn.commit()
    conn.close()
    return path


def test_build_is_deterministic_and_counts_mtr_and_nets(tmp_path: Path) -> None:
    builder = load_builder()
    db = write_db(tmp_path / "fixture.db")

    first = builder.render(builder.build(db))
    second = builder.render(builder.build(db))
    assert first == second, "builder output must be byte-identical across runs"

    model = json.loads(first)
    assert model["_meta"]["mtr_lines"] == 2
    # The nameless net row is dropped.
    assert model["_meta"]["school_nets"] == 2
    assert [net["id"] for net in model["schoolNets"]] == ["95", "62"]
    assert model["_meta"]["direction_cells"] == 12
    assert "shenzhen" in model["outOfScope"]

    tsuen_wan = next(
        line for line in model["mtrLines"] if line["en"] == "Tsuen Wan Line"
    )
    assert tsuen_wan["zh"] == "荃灣綫"
    assert tsuen_wan["estates"] == 2


def test_curated_ids_are_validated_against_the_hierarchy(tmp_path: Path) -> None:
    builder = load_builder()
    db = write_db(tmp_path / "fixture.db")

    original = builder.DIRECTIONS
    builder.DIRECTIONS = [
        {"direction": "east", "regionId": "10", "subregionIds": ["999999"]}
    ]
    try:
        with pytest.raises(SystemExit):
            builder.build(db)
    finally:
        builder.DIRECTIONS = original


def test_check_mode_reports_drift(tmp_path: Path) -> None:
    builder = load_builder()
    db = write_db(tmp_path / "fixture.db")
    out = tmp_path / "gazetteer.json"

    assert builder.main(["--db", str(db), "--out", str(out)]) == 0
    assert out.exists()
    assert builder.main(["--db", str(db), "--out", str(out), "--check"]) == 0

    out.write_text("{}\n", encoding="utf-8")
    assert builder.main(["--db", str(db), "--out", str(out), "--check"]) == 1
