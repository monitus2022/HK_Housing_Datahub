"""Offline tests for RVD parsing and ingestion."""

from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pandas as pd
import pytest

from processors.rvd import (
    RVD_FILES,
    ingest_rvd_rows,
    load_rvd,
    parse_indices,
    parse_monthly_frame,
    parse_prices,
    parse_rents,
    parse_yields,
)
from processors.rvd.ingest import (
    INDEX_COLUMNS,
    REGION_CLASS_COLUMNS,
    YIELD_COLUMNS,
    clean_number,
)


def make_frame(rows: list[dict[int, object]]) -> pd.DataFrame:
    frame = pd.DataFrame(index=range(len(rows)), columns=range(52), dtype=object)
    for index, row in enumerate(rows):
        for column, value in row.items():
            frame.iat[index, column] = value
    return frame


def month_row(year: int | None, month: int, value: float) -> dict[int, object]:
    row: dict[int, object] = {5: month}
    if year is not None:
        row[1] = year
    for column in REGION_CLASS_COLUMNS.values():
        row[column] = value
    for column in INDEX_COLUMNS.values():
        row[column] = value
    for column in YIELD_COLUMNS.values():
        row[column] = value
    return row


def test_clean_number_handles_rvd_markers():
    assert clean_number(1.5) == 1.5
    assert clean_number("1,234.5") == 1234.5
    assert clean_number("(12.5)") == -12.5
    assert clean_number("-") is None
    assert clean_number("N.A.") is None
    assert clean_number(None) is None
    assert clean_number(float("nan")) is None


def test_parse_monthly_frame_forward_fills_year_and_skips_footnotes():
    frame = make_frame(
        [
            {1: 2020, 5: 1, 8: 100.0},
            {5: 2.0, 8: 110.0},
            {1: 2021, 5: 1, 8: 120.0},
            {5: 13, 8: 999.0},
        ]
    )

    rows = parse_monthly_frame(frame, {"value": 8})

    assert [row["month"] for row in rows] == [
        "2020-01",
        "2020-02",
        "2021-01",
    ]
    assert rows[1]["value"] == 110.0


@patch("processors.rvd.ingest.read_monthly_sheet")
def test_parse_rents_and_prices_expand_region_class(read_sheet):
    frame = make_frame([month_row(2020, 1, 100.0)])

    read_sheet.return_value = frame
    rents = parse_rents("unused.xls")
    prices = parse_prices("unused.xls")

    assert len(rents) == 15
    assert len(prices) == 15
    assert rents[0] == {
        "region_code": "hk",
        "property_class": "A",
        "month": "2020-01",
        "value_hkd_m2": 100.0,
    }


@patch("processors.rvd.ingest.read_monthly_sheet")
def test_parse_indices_and_yields(read_sheet):
    frame = make_frame([month_row(2020, 1, 50.0)])

    read_sheet.return_value = frame
    indices = parse_indices("unused.xls", "rental")
    yields = parse_yields("unused.xls")

    assert len(indices) == 8
    assert len(yields) == 5
    assert indices[0]["index_type"] == "rental"
    assert yields[-1]["yield_pct"] == 50.0


def test_ingest_is_idempotent(tmp_path):
    db = tmp_path / "rvd.db"
    rents = [
        {
            "region_code": "hk",
            "property_class": "A",
            "month": "2020-01",
            "value_hkd_m2": 100.0,
        }
    ]
    prices = [
        {
            "region_code": "hk",
            "property_class": "A",
            "month": "2020-01",
            "value_hkd_m2": 200000.0,
        }
    ]
    indices = [
        {
            "index_type": "price",
            "property_class": "A",
            "month": "2020-01",
            "value": 150.0,
        }
    ]
    yields = [
        {
            "property_class": "A",
            "month": "2020-01",
            "yield_pct": 3.0,
        }
    ]

    first = ingest_rvd_rows(db, rents, prices, indices, yields)
    second = ingest_rvd_rows(db, rents, prices, indices, yields)

    assert first == second == {
        "rvd_rents": 1,
        "rvd_prices": 1,
        "rvd_indices": 1,
        "rvd_yields": 1,
    }

    connection = sqlite3.connect(db)
    try:
        assert connection.execute(
            "SELECT region_code, property_class, month, value_hkd_m2 "
            "FROM rvd_rents"
        ).fetchone() == ("hk", "A", "2020-01", 100.0)
    finally:
        connection.close()


def test_load_rvd_requires_all_workbooks(tmp_path):
    with pytest.raises(FileNotFoundError, match=RVD_FILES["rents"]):
        load_rvd(tmp_path / "rvd.db", tmp_path)
