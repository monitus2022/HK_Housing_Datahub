"""Duplicate fixture inputs must collapse to one row per primary key."""

from __future__ import annotations

import sqlalchemy as sa
import pytest

from processors.agency import EstatesProcessor

TABLES = [
    "regions",
    "subregions",
    "districts",
    "estates",
    "estate_school_nets",
    "estate_facilities",
    "facilities",
    "estate_mtr_lines",
    "estate_monthly_market_info",
    "phases",
    "buildings",
]


@pytest.fixture
def processor(tmp_path):
    instance = EstatesProcessor(db_path=str(tmp_path / "dedupe.db"))
    yield instance
    instance.close_session()


def table_count(processor: EstatesProcessor, table: str) -> int:
    return processor.session.execute(
        sa.text(f'SELECT count(*) FROM "{table}"')
    ).scalar_one()


def test_duplicate_mapping_inputs_produce_single_rows(
    processor, single_has_phases_response, market_info_responses
):
    for _ in range(2):
        processor.map_single_estate_info_responses_to_table_dicts(
            single_has_phases_response, single_has_phases_response
        )
        for response in market_info_responses:
            processor.map_single_estate_market_info_responses_to_table_dicts(
                response
            )

    config_maps = [processor.zh_table_configs, processor.table_configs]
    processor.upsert_cache_into_db_tables(config_maps)
    assert {table: table_count(processor, table) for table in TABLES} == {
        table: 1 for table in TABLES
    }

    # Re-upserting the same duplicated caches must not change row counts.
    processor.upsert_cache_into_db_tables(config_maps)
    assert {table: table_count(processor, table) for table in TABLES} == {
        table: 1 for table in TABLES
    }
