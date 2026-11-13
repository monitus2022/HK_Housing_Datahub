"""Analytics-mart tests with a small synthetic SQLite database."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import sqlalchemy as sa

from analytics.builder import build_marts, load_wiki_estates, main
from models.agency.sql_db import Base

SQL_DIR = Path(__file__).resolve().parent.parent / "src" / "analytics" / "sql"


def insert(con: sqlite3.Connection, table: str, **values) -> None:
    columns = ", ".join(f'"{name}"' for name in values)
    placeholders = ", ".join("?" for _ in values)
    con.execute(
        f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})',
        tuple(values.values()),
    )


def seed_db(path: Path) -> None:
    engine = sa.create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()

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
            district_name_zh="District One",
            district_name_en="District One",
            subregion_id="S1",
        )
        insert(
            con,
            "districts",
            district_id="D2",
            district_name_zh="District Two",
            district_name_en="District Two",
            subregion_id="S1",
        )
        insert(
            con,
            "estates",
            estate_id="E1",
            estate_name_zh="屋苑一",
            estate_name_en="Estate One",
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
            "estates",
            estate_id="E2",
            estate_name_zh="屋苑二",
            estate_name_en="Estate Two",
            region_id="R1",
            subregion_id="S1",
            district_id="D2",
            address_zh=None,
            address_en="2 Test Road",
            first_op_date="2001-01-01 00:00:00",
            last_op_date=None,
            latitude=22.4,
            longitude=114.2,
        )
        insert(
            con,
            "buildings",
            building_id="B1",
            building_name_zh="Building One",
            building_name_en="Building One",
            estate_id="E1",
            phase_id=None,
        )
        insert(
            con,
            "buildings",
            building_id="B2",
            building_name_zh="Building Two",
            building_name_en="Building Two",
            estate_id="E2",
            phase_id=None,
        )
        insert(
            con,
            "estate_mtr_lines",
            estate_id="E1",
            mtr_line_name_zh="荃灣綫",
            mtr_line_name_en="Tsuen Wan Line",
        )
        insert(
            con,
            "estate_mtr_lines",
            estate_id="E1",
            mtr_line_name_zh="港島綫",
            mtr_line_name_en="Island Line",
        )
        insert(
            con,
            "estate_school_nets",
            estate_id="E1",
            school_net_id="62",
            school_net_name_zh="62網",
            school_net_name_en="Net 62",
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
            "units",
            unit_id="U2",
            floor="5",
            flat="B",
            area=400.0,
            net_area=300.0,
            bedroom=1,
            sitting_room=1,
            building_id="B2",
        )
        transactions = [
            ("T1", "2024-01-15", 1_000_000.0, 10_000.0, "U1"),
            ("T2", "2024-06-15 16:00:00.000000", 1_200_000.0, 12_000.0, "U1"),
            ("T3", "2025-01-15", 1_300_000.0, 13_000.0, "U1"),
            ("T4", "2023-01-01", 500_000.0, 5_000.0, "U2"),
        ]
        for tx_id, tx_date, price, net_ft_price, unit_id in transactions:
            insert(
                con,
                "transactions",
                tx_id=tx_id,
                tx_date=tx_date,
                price=price,
                last_tx_date=None,
                gain=None,
                net_ft_price=net_ft_price,
                unit_id=unit_id,
            )
        rental_rows = [
            (
                "L1", "2024-12-15", 30_000.0, 1_000.0, 30.0,
                "E1", "Estate One", "D1", "District One",
            ),
            (
                "L2", "2024-12-20", 32_000.0, 1_000.0, 32.0,
                "E1", "Estate One", "D1", "District One",
            ),
            (
                "L3", "2023-01-31", 20_000.0, 1_000.0, 20.0,
                "E2", "Estate Two", "D2", "District Two",
            ),
        ]
        for rental_id, tx_date, price, net_area, net_ft, estate_id, estate, district_id, district in rental_rows:
            insert(
                con,
                "rental_transactions",
                rental_id=rental_id,
                tx_date=tx_date,
                price=price,
                net_area=net_area,
                net_ft_price=net_ft,
                estate_id=estate_id,
                estate_name_en=estate,
                district_id=district_id,
                district_name_en=district,
            )
        market_rows = [
            ("E1", "2024-11-30", 25.0, 1, 30_000.0),
            ("E1", "2024-12-31", 30.0, 2, 70_000.0),
            ("E2", "2023-01-31", 20.0, 1, 15_000.0),
        ]
        for estate_id, record_date, rent, rent_count, rent_amount in market_rows:
            insert(
                con,
                "estate_monthly_market_info",
                estate_id=estate_id,
                record_date=record_date,
                avg_net_ft_rent=rent,
                total_rent_tx_count=rent_count,
                total_rent_tx_amount=rent_amount,
            )
        con.commit()
    finally:
        con.close()


def make_wiki_dir(tmp_path: Path) -> Path:
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    (wiki_dir / "wiki_data_partition_0.json").write_text(
        json.dumps({"屋苑一": {"title": "屋苑一頁"}}),
        encoding="utf-8",
    )
    return wiki_dir


def read_rows(path: Path, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(sql, params).fetchall()
    finally:
        con.close()


def test_wiki_titles_fall_back_to_estate_names(tmp_path):
    wiki_dir = tmp_path / "fallback-wiki"
    wiki_dir.mkdir()
    (wiki_dir / "wiki_data_partition_0.json").write_text(
        json.dumps(
            {
                "屋苑一": {},
                "屋苑二": {"title": 123},
                "屋苑三": {"title": "  "},
            }
        ),
        encoding="utf-8",
    )

    assert load_wiki_estates(wiki_dir) == {
        "屋苑一": "屋苑一",
        "屋苑二": "屋苑二",
        "屋苑三": "屋苑三",
    }


def build(path: Path, wiki_dir: Path) -> dict[str, int]:
    return build_marts(path, sql_dir=SQL_DIR, wiki_dir=wiki_dir)


def test_marts_row_counts_and_known_values(tmp_path):
    db_path = tmp_path / "marts.db"
    seed_db(db_path)
    wiki_dir = make_wiki_dir(tmp_path)

    counts = build(db_path, wiki_dir)
    assert counts == {
        "mart_estate_summary": 2,
        "mart_district_monthly": 5,
        "mart_estate_monthly": 5,
        "mart_transaction_recent": 3,
        "mart_coverage": 2,
        "mart_district_price_bands": 5,
        "mart_segment_summary": 8,
    }

    summary = read_rows(
        db_path,
        "SELECT * FROM mart_estate_summary ORDER BY estate_id",
    )
    e1, e2 = summary
    assert e1["estate_id"] == "E1"
    assert e1["latest_tx_date"] == "2025-01-15"
    assert e1["latest_tx_price"] == 1_300_000
    assert e1["tx_count_12m"] == 2
    assert e1["avg_net_ft_price_12m"] == 12_500
    assert e1["avg_net_ft_rent_12m"] == 31
    assert e1["rent_count_12m"] == 2
    assert e1["latest_rent_date"] == "2024-12-20"
    assert e1["latest_rent_net_ft_price"] == 32
    assert e1["wiki_title"] == "屋苑一頁"
    assert e1["latest_market_date"] == "2024-12-31"
    assert e1["latest_net_area"] == 400
    assert e1["latest_bedroom"] == 2
    assert sorted(e1["mtr_lines"].split(",")) == [
        "Island Line",
        "Tsuen Wan Line",
    ]
    assert e1["school_nets"] == "Net 62"
    assert (e1["has_market"], e1["has_transactions"], e1["has_wiki"]) == (
        1,
        1,
        1,
    )
    assert e2["estate_id"] == "E2"
    assert e2["latest_tx_date"] == "2023-01-01"
    assert e2["tx_count_12m"] == 0
    assert e2["avg_net_ft_price_12m"] is None
    assert e2["avg_net_ft_rent_12m"] is None
    assert e2["latest_net_area"] == 300
    assert e2["latest_bedroom"] == 1
    assert e2["mtr_lines"] is None
    assert e2["school_nets"] is None
    assert e2["rent_count_12m"] == 0
    assert e2["latest_rent_date"] == "2023-01-31"
    assert e2["latest_rent_net_ft_price"] == 20
    assert e2["has_wiki"] == 0
    assert e2["wiki_title"] is None

    bands = read_rows(
        db_path,
        "SELECT * FROM mart_district_price_bands "
        "WHERE district_id='D1' AND month='2024-12'",
    )
    assert len(bands) == 1
    assert bands[0]["rent_count"] == 2
    assert bands[0]["rent_p25"] == 30
    assert bands[0]["rent_median"] == 31
    assert bands[0]["rent_p75"] == 32

    bands_sale = read_rows(
        db_path,
        "SELECT * FROM mart_district_price_bands "
        "WHERE district_id='D1' AND month='2025-01'",
    )
    assert bands_sale[0]["sale_count"] == 1
    assert bands_sale[0]["sale_median"] == 13000

    bedroom = read_rows(
        db_path,
        "SELECT * FROM mart_segment_summary "
        "WHERE segment_type='bedroom' AND segment_value='2'",
    )
    assert bedroom[0]["sale_count"] == 3
    assert bedroom[0]["sale_median"] == 12000
    assert bedroom[0]["gross_yield_pct"] is None

    district = read_rows(
        db_path,
        "SELECT * FROM mart_district_monthly WHERE district_id='D1' "
        "AND month='2024-12'",
    )
    assert len(district) == 1
    assert district[0]["tx_count"] == 0
    assert district[0]["rent_tx_count"] == 2
    assert district[0]["avg_net_ft_rent"] == 31
    assert district[0]["total_rent_tx_amount"] == 62_000

    estate_month = read_rows(
        db_path,
        "SELECT * FROM mart_estate_monthly WHERE estate_id='E1' "
        "AND month='2025-01'",
    )
    assert len(estate_month) == 1
    assert estate_month[0]["tx_count"] == 1
    assert estate_month[0]["avg_net_ft_price"] == 13_000

    estate_rent = read_rows(
        db_path,
        "SELECT * FROM mart_estate_monthly WHERE estate_id='E1' "
        "AND month='2024-12'",
    )
    assert estate_rent[0]["rent_tx_count"] == 2
    assert estate_rent[0]["avg_net_ft_rent"] == 31

    recent = read_rows(
        db_path,
        "SELECT tx_id, tx_date FROM mart_transaction_recent ORDER BY tx_id",
    )
    assert [row["tx_id"] for row in recent] == ["T1", "T2", "T3"]
    assert recent[1]["tx_date"] == "2024-06-15"

    coverage = read_rows(
        db_path,
        "SELECT * FROM mart_coverage ORDER BY estate_id",
    )
    c1, c2 = coverage
    assert (
        c1["building_count"],
        c1["unit_count"],
        c1["tx_count"],
        c1["last_tx_date"],
        c1["has_wiki"],
    ) == (1, 1, 3, "2025-01-15", 1)
    assert (
        c2["building_count"],
        c2["unit_count"],
        c2["tx_count"],
        c2["last_tx_date"],
        c2["has_wiki"],
    ) == (1, 1, 1, "2023-01-01", 0)


def test_builder_is_idempotent_and_creates_indexes(tmp_path):
    db_path = tmp_path / "marts.db"
    seed_db(db_path)
    wiki_dir = make_wiki_dir(tmp_path)

    raw_tables = [
        "estates",
        "buildings",
        "units",
        "transactions",
        "estate_monthly_market_info",
    ]
    raw_counts_before = {
        table: read_rows(db_path, f'SELECT count(*) AS c FROM "{table}"')[0][
            "c"
        ]
        for table in raw_tables
    }

    first = build(db_path, wiki_dir)
    second = build(db_path, wiki_dir)
    assert first == second
    raw_counts_after = {
        table: read_rows(db_path, f'SELECT count(*) AS c FROM "{table}"')[0][
            "c"
        ]
        for table in raw_tables
    }
    assert raw_counts_after == raw_counts_before

    indexes = read_rows(
        db_path,
        "SELECT name FROM sqlite_master WHERE type='index' "
        "AND name LIKE 'idx_%' ORDER BY name",
    )
    names = {row["name"] for row in indexes}
    assert {
        "idx_buildings_estate_id",
        "idx_market_estate_date",
        "idx_transactions_tx_date",
        "idx_transactions_unit_id",
        "idx_units_building_id",
        "idx_rental_transactions_date",
        "idx_rental_transactions_district_date",
        "idx_rental_transactions_estate_date",
    }.issubset(names)
    assert {
        "idx_mart_estate_summary_estate_id",
        "idx_mart_district_monthly_district_month",
        "idx_mart_estate_monthly_estate_month",
        "idx_mart_transaction_recent_tx_id",
        "idx_mart_coverage_estate_id",
    }.issubset(names)


def test_builder_without_wiki_dir_sets_has_wiki_zero(tmp_path):
    db_path = tmp_path / "marts.db"
    seed_db(db_path)
    counts = build_marts(
        db_path,
        sql_dir=SQL_DIR,
        wiki_dir=tmp_path / "missing-wiki",
    )
    assert counts["mart_estate_summary"] == 2
    rows = read_rows(
        db_path,
        "SELECT sum(has_wiki) AS total FROM mart_estate_summary",
    )
    assert rows[0]["total"] == 0


def test_cli_missing_database_returns_2(tmp_path):
    assert (
        main(
            [
                "--db",
                str(tmp_path / "missing.db"),
                "--sql-dir",
                str(SQL_DIR),
                "--wiki-dir",
                str(tmp_path / "wiki"),
            ]
        )
        == 2
    )
