"""Data-quality check tests using synthetic SQLite databases."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import sqlalchemy as sa

from models.agency.sql_db import Base
from quality.checks import run_checks
from quality.report import write_reports
from quality.run import main


def make_db(path: Path) -> None:
    engine = sa.create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()


def insert(con: sqlite3.Connection, table: str, **values) -> None:
    columns = ", ".join(f'"{name}"' for name in values)
    placeholders = ", ".join("?" for _ in values)
    con.execute(
        f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})',
        tuple(values.values()),
    )


def seed_clean_db(path: Path) -> None:
    make_db(path)
    con = sqlite3.connect(path)
    try:
        insert(
            con,
            "regions",
            region_id="R1",
            region_name_zh="Region",
            region_name_en="Region",
        )
        insert(
            con,
            "subregions",
            subregion_id="S1",
            subregion_name_zh="Subregion",
            subregion_name_en="Subregion",
            region_id="R1",
        )
        insert(
            con,
            "districts",
            district_id="D1",
            district_name_zh="District",
            district_name_en="District",
            subregion_id="S1",
        )
        insert(
            con,
            "estates",
            estate_id="E1",
            estate_name_zh="Estate",
            estate_name_en="Estate",
            region_id="R1",
            subregion_id="S1",
            district_id="D1",
            address_zh=None,
            address_en="1 Test Road",
            first_op_date="2000-01-01 00:00:00",
            last_op_date=None,
            latitude=22.3,
            longitude=114.1,
        )
        insert(
            con,
            "buildings",
            building_id="B1",
            building_name_zh="Building",
            building_name_en="Building",
            estate_id="E1",
            phase_id=None,
        )
        insert(
            con,
            "units",
            unit_id="U1",
            floor="10",
            flat="A",
            area=500.0,
            net_area=400.0,
            bedroom=2,
            sitting_room=1,
            building_id="B1",
        )
        insert(
            con,
            "transactions",
            tx_id="T1",
            tx_date="2024-01-01 00:00:00",
            price=1_000_000.0,
            last_tx_date=None,
            gain=None,
            net_ft_price=2500.0,
            unit_id="U1",
        )
        insert(
            con,
            "estate_monthly_market_info",
            estate_id="E1",
            record_date="2024-01-31 00:00:00",
        )
        insert(
            con,
            "unit_features",
            unit_id="U1",
            feature_id="F1",
            feature_name_zh="Feature",
            feature_name_en="Feature",
        )
        con.commit()
    finally:
        con.close()


def get_check(report, name: str):
    return next(check for check in report.checks if check.name == name)


def test_clean_db_passes(tmp_path):
    db_path = tmp_path / "clean.db"
    seed_clean_db(db_path)
    report = run_checks(db_path, run_id="clean")
    assert report.status == "pass"
    assert report.critical_failures == []
    assert report.warning_failures == []


def test_negative_price_is_critical(tmp_path):
    db_path = tmp_path / "negative_price.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE transactions SET price = -1")
    report = run_checks(db_path, run_id="negative-price")
    check = get_check(report, "negative_prices")
    assert not check.passed
    assert check.details["negative_price_rows"] == 1
    assert report.status == "fail"


def test_negative_area_is_critical(tmp_path):
    db_path = tmp_path / "negative_area.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE units SET net_area = -1")
    report = run_checks(db_path, run_id="negative-area")
    check = get_check(report, "negative_areas")
    assert not check.passed
    assert check.details["negative_net_area_rows"] == 1


def test_invalid_transaction_date_is_critical(tmp_path):
    db_path = tmp_path / "bad_date.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE transactions SET tx_date = '1800-01-01'")
    report = run_checks(db_path, run_id="bad-date")
    check = get_check(report, "transaction_dates_sane")
    assert not check.passed
    assert check.details["invalid_rows"] == 1


def test_foreign_key_orphan_is_critical(tmp_path):
    db_path = tmp_path / "orphan.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE transactions SET unit_id = 'MISSING'")
    report = run_checks(db_path, run_id="orphan")
    check = get_check(report, "foreign_key_orphans")
    assert not check.passed
    assert check.details["orphans"]["transactions.unit_id -> units.unit_id"] == 1


def test_duplicate_primary_key_is_critical(tmp_path):
    db_path = tmp_path / "duplicate.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("DROP TABLE transactions")
        con.execute(
            """
            CREATE TABLE transactions (
                tx_id TEXT,
                tx_date DATETIME,
                price REAL,
                last_tx_date DATETIME,
                gain REAL,
                net_ft_price REAL,
                unit_id TEXT
            )
            """
        )
        con.executemany(
            "INSERT INTO transactions (tx_id, tx_date, price, unit_id) "
            "VALUES (?, ?, ?, ?)",
            [
                ("T-DUP", "2024-01-01", 100.0, "U1"),
                ("T-DUP", "2024-01-02", 200.0, "U1"),
            ],
        )
    report = run_checks(db_path, run_id="duplicate")
    check = get_check(report, "duplicate_primary_keys")
    assert not check.passed
    assert check.details["duplicates"]["transactions"] == 1


def test_missing_required_table_is_critical(tmp_path):
    db_path = tmp_path / "missing.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("DROP TABLE transactions")
    report = run_checks(db_path, run_id="missing")
    check = get_check(report, "required_tables_nonempty")
    assert not check.passed
    assert "transactions" in check.details["missing"]


def test_non_positive_area_is_warning_not_critical(tmp_path):
    db_path = tmp_path / "zero_area.db"
    seed_clean_db(db_path)
    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE units SET area = 0, net_area = 0")
    report = run_checks(db_path, run_id="zero-area")
    assert report.critical_failures == []
    check = get_check(report, "non_positive_areas")
    assert not check.passed
    assert report.status == "warn"


def test_reports_are_written(tmp_path):
    db_path = tmp_path / "clean.db"
    seed_clean_db(db_path)
    report = run_checks(db_path, run_id="report-run")
    output_dir = tmp_path / "reports"
    paths = write_reports(report, output_dir)

    assert paths["latest_json"].exists()
    assert paths["run_json"].exists()
    assert paths["latest_md"].exists()
    payload = json.loads(paths["latest_json"].read_text(encoding="utf-8"))
    assert payload["summary"]["status"] == "pass"
    assert payload["run_id"] == "report-run"
    assert "Data Quality Report" in paths["latest_md"].read_text(
        encoding="utf-8"
    )


def test_cli_exit_codes(tmp_path):
    db_path = tmp_path / "clean.db"
    seed_clean_db(db_path)
    output_dir = tmp_path / "reports"

    assert (
        main(
            [
                "--db",
                str(db_path),
                "--output-dir",
                str(output_dir),
                "--fail-on",
                "critical",
                "--run-id",
                "cli-clean",
            ]
        )
        == 0
    )

    with sqlite3.connect(db_path) as con:
        con.execute("UPDATE transactions SET price = -1")

    assert (
        main(
            [
                "--db",
                str(db_path),
                "--output-dir",
                str(output_dir),
                "--fail-on",
                "critical",
                "--run-id",
                "cli-bad",
            ]
        )
        == 1
    )
    assert (
        main(
            [
                "--db",
                str(db_path),
                "--output-dir",
                str(output_dir),
                "--fail-on",
                "none",
                "--run-id",
                "cli-none",
            ]
        )
        == 0
    )
