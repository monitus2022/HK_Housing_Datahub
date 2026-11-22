"""Offline tests for the geography builder.

Builds a throwaway SQLite database so CI never touches the real one.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "build_geo.py"

ROWS = [
    (
        "10",
        "Hong Kong Island",
        "1001",
        "Central And Western",
        "100101",
        "Mid-Levels Central  / Admiralty",
        "中半山 / 金鐘",
    ),
    (
        "10",
        "Hong Kong Island",
        "1001",
        "Central And Western",
        "100101",
        "Mid-Levels Central  / Admiralty",
        "中半山 / 金鐘",
    ),
    ("20", "Kowloon", "2010", "Tseung Kwan O", "201001", "Lohas Park", "日出康城"),
    ("20", "Kowloon", "2009", "Kowloon City", "200905", "Kowloon City", "九龍城"),
]


def load_builder():
    spec = importlib.util.spec_from_file_location("build_geo", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_db(path: Path) -> Path:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE mart_estate_summary (
            region_id TEXT,
            region_name_en TEXT,
            subregion_id TEXT,
            subregion_name_en TEXT,
            district_id TEXT,
            district_name_en TEXT,
            district_name_zh TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO mart_estate_summary VALUES (?, ?, ?, ?, ?, ?, ?)",
        ROWS,
    )
    conn.commit()
    conn.close()
    return path


def test_build_is_deterministic_and_splits_aliases(tmp_path: Path) -> None:
    build_geo = load_builder()
    db = write_db(tmp_path / "fixture.db")

    first = build_geo.render(build_geo.build(db))
    second = build_geo.render(build_geo.build(db))
    assert first == second, "builder output must be byte-identical across runs"

    model = json.loads(first)
    meta = model["_meta"]
    assert meta["regions"] == 2
    assert meta["subregions"] == 3
    assert meta["districts"] == 3
    assert meta["estates"] == 4
    assert meta["district_aliases"] == 8
    assert meta["missing_zh"] == []

    compound = next(d for d in model["districts"] if d["id"] == "100101")
    assert set(compound["aliases"]) == {
        "Mid-Levels Central",
        "Admiralty",
        "中半山",
        "金鐘",
    }
    assert compound["estates"] == 2

    subregion = next(s for s in model["subregions"] if s["id"] == "1001")
    assert subregion["estates"] == 2
    assert subregion["regionId"] == "10"


def test_check_mode_reports_drift(tmp_path: Path) -> None:
    build_geo = load_builder()
    db = write_db(tmp_path / "fixture.db")
    out = tmp_path / "geo.json"

    assert build_geo.main(["--db", str(db), "--out", str(out)]) == 0
    assert out.exists()
    assert build_geo.main(["--db", str(db), "--out", str(out), "--check"]) == 0

    out.write_text("{}\n", encoding="utf-8")
    assert build_geo.main(["--db", str(db), "--out", str(out), "--check"]) == 1
