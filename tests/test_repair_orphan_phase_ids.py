"""Offline tests for the orphan phase-id repair script."""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parent.parent
    / "scripts"
    / "repair_orphan_phase_ids.py"
)
SPEC = importlib.util.spec_from_file_location("repair_orphan_phase_ids", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

repair_orphan_phase_ids = module.repair_orphan_phase_ids
main = module.main


def make_db(path: Path) -> None:
    con = sqlite3.connect(path)
    try:
        con.executescript(
            """
            CREATE TABLE phases (
                phase_id TEXT PRIMARY KEY,
                estate_id TEXT NOT NULL
            );
            CREATE TABLE buildings (
                building_id TEXT PRIMARY KEY,
                estate_id TEXT NOT NULL,
                phase_id TEXT
            );
            INSERT INTO phases VALUES ('P1', 'E1');
            INSERT INTO buildings VALUES ('B1', 'E1', 'P1');
            INSERT INTO buildings VALUES ('B2', 'E2', 'E2');
            INSERT INTO buildings VALUES ('B3', 'E3', 'E3');
            INSERT INTO buildings VALUES ('B4', 'E3', NULL);
            """
        )
        con.commit()
    finally:
        con.close()


def phase_ids(path: Path) -> dict[str, str | None]:
    con = sqlite3.connect(path)
    try:
        return {
            row[0]: row[1]
            for row in con.execute(
                "SELECT building_id, phase_id FROM buildings ORDER BY building_id"
            )
        }
    finally:
        con.close()


def test_dry_run_reports_without_writing(tmp_path):
    db = tmp_path / "agency.db"
    make_db(db)

    result = repair_orphan_phase_ids(db, apply=False)

    assert result["orphans_before"] == 2
    assert result["orphans_after"] == 2
    assert result["updated"] == 0
    assert result["groups"] == [("E2", "E2", 1), ("E3", "E3", 1)]
    assert phase_ids(db) == {"B1": "P1", "B2": "E2", "B3": "E3", "B4": None}


def test_apply_nulls_only_orphans_and_is_idempotent(tmp_path):
    db = tmp_path / "agency.db"
    make_db(db)

    result = repair_orphan_phase_ids(db, apply=True)

    assert result["orphans_before"] == 2
    assert result["updated"] == 2
    assert result["orphans_after"] == 0
    assert phase_ids(db) == {"B1": "P1", "B2": None, "B3": None, "B4": None}

    again = repair_orphan_phase_ids(db, apply=True)
    assert again["orphans_before"] == 0
    assert again["updated"] == 0
    assert again["orphans_after"] == 0


def test_dry_run_handles_paths_with_spaces(tmp_path):
    directory = tmp_path / "dir with space"
    directory.mkdir()
    db = directory / "agency.db"
    make_db(db)

    result = repair_orphan_phase_ids(db)

    assert result["orphans_before"] == 2
    assert result["orphans_after"] == 2
    assert phase_ids(db)["B2"] == "E2"


def test_missing_database_and_tables_are_errors(tmp_path):
    with pytest.raises(FileNotFoundError):
        repair_orphan_phase_ids(tmp_path / "missing.db")

    empty = tmp_path / "empty.db"
    sqlite3.connect(empty).close()
    with pytest.raises(ValueError, match="buildings"):
        repair_orphan_phase_ids(empty)


def test_main_exit_codes(tmp_path, capsys):
    db = tmp_path / "agency.db"
    make_db(db)

    assert main(["--db", str(db)]) == 1
    output = capsys.readouterr().out
    assert "orphans before: 2" in output
    assert "dry run" in output

    # --dry-run is an explicit alias for the default.
    assert main(["--db", str(db), "--dry-run"]) == 1
    assert "dry run" in capsys.readouterr().out

    assert main(["--db", str(db), "--apply"]) == 0
    assert "orphans after: 0" in capsys.readouterr().out

    assert main(["--db", str(tmp_path / "missing.db")]) == 2

    not_a_db = tmp_path / "not-a-db.sqlite"
    not_a_db.write_text("this is not sqlite", encoding="utf-8")
    assert main(["--db", str(not_a_db)]) == 2
    assert "error:" in capsys.readouterr().err


def test_apply_and_dry_run_are_mutually_exclusive(tmp_path):
    with pytest.raises(SystemExit) as exc:
        main(["--db", str(tmp_path / "agency.db"), "--apply", "--dry-run"])
    assert exc.value.code == 2
