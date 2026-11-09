"""Idempotent-write tests for the agency processors.

Every test uses a temporary SQLite database; the reference
``data/agency/agency_data.db`` is never opened for writing.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import sqlalchemy as sa

from models.agency.sql_db import PipelineRun
from processors.agency.buildings import BuildingsProcessor
from processors.agency.estates import EstatesProcessor


def make_estate_row(estate_id: str = "E1", name_en: str = "Estate A") -> dict:
    return {
        "estate_id": estate_id,
        "estate_name_zh": "屋苑 A",
        "estate_name_en": name_en,
        "region_id": "R1",
        "subregion_id": "S1",
        "district_id": "D1",
        "address_zh": None,
        "address_en": "1 Test Road",
        "first_op_date": None,
        "last_op_date": None,
        "latitude": None,
        "longitude": None,
    }


@pytest.fixture
def estates_processor(tmp_path: Path) -> EstatesProcessor:
    processor = EstatesProcessor(db_path=str(tmp_path / "test.db"))
    yield processor
    processor.close_session()


@pytest.fixture
def buildings_processor(tmp_path: Path) -> BuildingsProcessor:
    processor = BuildingsProcessor(db_path=str(tmp_path / "test.db"))
    yield processor
    processor.close_session()


def count(processor, table: str) -> int:
    return processor.session.execute(
        sa.text(f'SELECT count(*) FROM "{table}"')
    ).scalar_one()


def scalar(processor, sql: str):
    return processor.session.execute(sa.text(sql)).scalar_one()


def model_for(processor, cache_name: str):
    if cache_name in processor.table_configs:
        return processor.table_configs[cache_name][1]
    return processor.zh_table_configs[cache_name][1]


def test_upsert_is_idempotent_and_updates_non_key_columns(estates_processor):
    row = make_estate_row()
    estates_processor.caches["estate_info_cache"] = [row]
    assert estates_processor.upsert_cache_into_db_tables(
        [estates_processor.table_configs]
    ) == 1
    assert count(estates_processor, "estates") == 1
    assert scalar(
        estates_processor, "SELECT estate_name_en FROM estates WHERE estate_id='E1'"
    ) == "Estate A"

    row["estate_name_en"] = "Estate A updated"
    estates_processor.caches["estate_info_cache"] = [row]
    assert estates_processor.upsert_cache_into_db_tables(
        [estates_processor.table_configs]
    ) == 1
    assert count(estates_processor, "estates") == 1
    assert scalar(
        estates_processor, "SELECT estate_name_en FROM estates WHERE estate_id='E1'"
    ) == "Estate A updated"


def test_upsert_handles_duplicate_keys_in_same_batch(estates_processor):
    first = make_estate_row(name_en="First")
    second = make_estate_row(name_en="Second")
    estates_processor.caches["estate_info_cache"] = [first, second]
    estates_processor.upsert_cache_into_db_tables([estates_processor.table_configs])

    assert count(estates_processor, "estates") == 1
    assert scalar(
        estates_processor, "SELECT estate_name_en FROM estates WHERE estate_id='E1'"
    ) == "Second"


def test_upsert_handles_composite_primary_key(estates_processor):
    estates_processor.caches["estate_info_cache"] = [make_estate_row()]
    estates_processor.upsert_cache_into_db_tables([estates_processor.table_configs])

    estates_processor.caches["estate_mtr_lines_cache"] = [
        {
            "estate_id": "E1",
            "mtr_line_name_zh": "第一線",
            "mtr_line_name_en": "Line A",
        }
    ]
    estates_processor.upsert_cache_into_db_tables([estates_processor.table_configs])

    estates_processor.caches["estate_mtr_lines_cache"] = [
        {
            "estate_id": "E1",
            "mtr_line_name_zh": "第二線",
            "mtr_line_name_en": "Line A",
        }
    ]
    estates_processor.upsert_cache_into_db_tables([estates_processor.table_configs])

    assert count(estates_processor, "estate_mtr_lines") == 1
    assert scalar(
        estates_processor,
        "SELECT mtr_line_name_zh FROM estate_mtr_lines WHERE estate_id='E1'",
    ) == "第二線"


def test_upsert_primary_key_only_table(estates_processor):
    estates_processor.caches["estate_facilities_cache"] = [
        {"estate_id": "E1", "facility_id": "F1"}
    ]
    estates_processor.upsert_cache_into_db_tables(
        [estates_processor.zh_table_configs]
    )
    estates_processor.upsert_cache_into_db_tables(
        [estates_processor.zh_table_configs]
    )
    assert count(estates_processor, "estate_facilities") == 1


def test_buildings_processor_upsert_is_idempotent(buildings_processor):
    row = {
        "unit_id": "U1",
        "floor": "10",
        "flat": "A",
        "area": 500.0,
        "net_area": 400.0,
        "bedroom": 2,
        "sitting_room": 1,
        "building_id": "B1",
    }
    buildings_processor.caches["units_cache"] = [row]
    buildings_processor.upsert_cache_into_db_tables(
        [buildings_processor.zh_table_configs]
    )
    assert count(buildings_processor, "units") == 1

    row["net_area"] = 410.0
    buildings_processor.caches["units_cache"] = [row]
    buildings_processor.upsert_cache_into_db_tables(
        [buildings_processor.zh_table_configs]
    )
    assert count(buildings_processor, "units") == 1
    assert scalar(
        buildings_processor,
        "SELECT net_area FROM units WHERE unit_id='U1'",
    ) == 410.0


def test_bulk_insert_alias_uses_upsert(estates_processor):
    estates_processor.caches["estate_info_cache"] = [make_estate_row()]
    estates_processor.bulk_insert_cache_into_db_tables(
        [estates_processor.table_configs]
    )
    estates_processor.caches["estate_info_cache"] = [make_estate_row()]
    estates_processor.bulk_insert_cache_into_db_tables(
        [estates_processor.table_configs]
    )
    assert count(estates_processor, "estates") == 1


def test_estates_pk_map_matches_model_primary_keys(estates_processor):
    for cache_name, expected in estates_processor.pk_map.items():
        model = model_for(estates_processor, cache_name)
        actual = [
            column.name for column in model.__table__.primary_key.columns
        ]
        assert actual == expected, cache_name


def test_buildings_pk_map_matches_model_primary_keys(buildings_processor):
    for cache_name, expected in buildings_processor.pk_map.items():
        model = model_for(buildings_processor, cache_name)
        actual = [
            column.name for column in model.__table__.primary_key.columns
        ]
        assert actual == expected, cache_name


def test_pipeline_runs_table_is_added_to_existing_db(tmp_path):
    db_path = tmp_path / "existing.db"
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as connection:
        connection.execute(
            sa.text("CREATE TABLE estates (estate_id TEXT PRIMARY KEY)")
        )
    engine.dispose()

    processor = EstatesProcessor(db_path=str(db_path))
    try:
        assert processor.session.execute(
            sa.text("SELECT count(*) FROM pipeline_runs")
        ).scalar_one() == 0
    finally:
        processor.close_session()


def test_pipeline_run_lifecycle(estates_processor):
    estates_processor.start_pipeline_run("run-1", mode="debug")
    running = estates_processor.session.get(PipelineRun, "run-1")
    assert running.status == "running"
    assert running.mode == "debug"
    assert running.finished_at is None

    estates_processor.finish_pipeline_run(
        "run-1", status="success", record_counts={"estates": 1}
    )
    finished = estates_processor.session.get(PipelineRun, "run-1")
    assert finished.status == "success"
    assert finished.finished_at is not None
    assert finished.record_counts_json == '{"estates": 1}'


def test_pipeline_run_failure_records_error(estates_processor):
    estates_processor.start_pipeline_run("run-2", mode="full")
    estates_processor.finish_pipeline_run(
        "run-2", status="failed", error_message="boom"
    )
    failed = estates_processor.session.get(PipelineRun, "run-2")
    assert failed.status == "failed"
    assert failed.error_message == "boom"
