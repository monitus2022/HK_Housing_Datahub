"""Download and parse RVD private domestic benchmark series.

The RVD publishes historical monthly XLS workbooks. These are benchmark
aggregates, not transaction records: rents and prices are HKD per square metre,
indices are 1999 = 100, and yields are percentage returns.
"""

from __future__ import annotations

import sqlite3
import urllib.request
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
from sqlalchemy import create_engine

from logger import housing_logger
from models.rvd.sql_db import RvdBase

RVD_BASE_URL = "https://www.rvd.gov.hk/doc/en/statistics/"
RVD_FILES = {
    "rents": "his_data_1.xls",
    "prices": "his_data_2.xls",
    "rental_indices": "his_data_3.xls",
    "price_indices": "his_data_4.xls",
    "yields": "his_data_15.xls",
}

REGION_CLASS_COLUMNS = {
    "hk:A": 8,
    "kln:A": 11,
    "nt:A": 14,
    "hk:B": 17,
    "kln:B": 20,
    "nt:B": 23,
    "hk:C": 26,
    "kln:C": 29,
    "nt:C": 32,
    "hk:D": 35,
    "kln:D": 38,
    "nt:D": 41,
    "hk:E": 44,
    "kln:E": 47,
    "nt:E": 50,
}
INDEX_COLUMNS = {
    "A": 8,
    "B": 11,
    "C": 14,
    "D": 17,
    "E": 20,
    "ABC": 23,
    "DE": 26,
    "ALL": 29,
}
YIELD_COLUMNS = {"A": 8, "B": 11, "C": 14, "D": 17, "E": 20}


def clean_number(value: Any) -> float | None:
    """Parse a numeric cell, accepting commas and the RVD's missing markers."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if pd.isna(value):
            return None
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if not text or text in {"-", "N.A.", "NA"}:
            return None
        negative = text.startswith("(") and text.endswith(")")
        if negative:
            text = text[1:-1]
        try:
            number = float(text)
        except ValueError:
            return None
        return -number if negative else number
    return None


def read_monthly_sheet(path: Path | str) -> pd.DataFrame:
    """Read the first monthly sheet; the workbook has several aggregate sheets."""
    return pd.read_excel(path, sheet_name=0, header=None, engine="xlrd")


def parse_monthly_frame(
    frame: pd.DataFrame,
    columns: dict[str, int],
) -> list[dict[str, Any]]:
    """Parse year/month columns and the requested value columns.

    Year cells are merged in the source, so they are forward-filled. Months are
    numeric 1-12; rows outside that range are title/footnote rows and skipped.
    """
    by_month: dict[str, dict[str, Any]] = {}
    year: int | None = None

    for index in range(len(frame)):
        raw_year = clean_number(frame.iat[index, 1])
        raw_month = clean_number(frame.iat[index, 5])
        if raw_year is not None and 1900 <= raw_year <= 2100:
            year = int(raw_year)
        if year is None or raw_month is None:
            continue
        month = int(round(raw_month))
        if not 1 <= month <= 12:
            continue
        month_key = f"{year:04d}-{month:02d}"
        record: dict[str, Any] = {"month": month_key}
        for key, column in columns.items():
            record[key] = clean_number(frame.iat[index, column])
        by_month[month_key] = record

    return [by_month[month] for month in sorted(by_month)]


def _region_class_rows(parsed: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in parsed:
        for key, value in record.items():
            if key == "month" or value is None:
                continue
            region, property_class = key.split(":")
            rows.append(
                {
                    "region_code": region,
                    "property_class": property_class,
                    "month": record["month"],
                    "value_hkd_m2": value,
                }
            )
    return rows


def parse_rents(path: Path | str) -> list[dict[str, Any]]:
    return _region_class_rows(
        parse_monthly_frame(read_monthly_sheet(path), REGION_CLASS_COLUMNS)
    )


def parse_prices(path: Path | str) -> list[dict[str, Any]]:
    return _region_class_rows(
        parse_monthly_frame(read_monthly_sheet(path), REGION_CLASS_COLUMNS)
    )


def parse_indices(
    path: Path | str,
    index_type: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in parse_monthly_frame(read_monthly_sheet(path), INDEX_COLUMNS):
        for property_class, value in record.items():
            if property_class == "month" or value is None:
                continue
            rows.append(
                {
                    "index_type": index_type,
                    "property_class": property_class,
                    "month": record["month"],
                    "value": value,
                }
            )
    return rows


def parse_yields(path: Path | str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in parse_monthly_frame(read_monthly_sheet(path), YIELD_COLUMNS):
        for property_class, value in record.items():
            if property_class == "month" or value is None:
                continue
            rows.append(
                {
                    "property_class": property_class,
                    "month": record["month"],
                    "yield_pct": value,
                }
            )
    return rows


def download_rvd(destination: Path | str) -> dict[str, Path]:
    """Download the five RVD workbooks into ``destination``."""
    directory = Path(destination)
    directory.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for key, filename in RVD_FILES.items():
        target = directory / filename
        request = urllib.request.Request(
            RVD_BASE_URL + filename,
            headers={"User-Agent": "HK-Housing-Datahub/0.1"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            target.write_bytes(response.read())
        paths[key] = target
        housing_logger.info(f"Downloaded RVD {filename} ({target.stat().st_size} bytes)")
    return paths


def ingest_rvd_rows(
    db_path: Path | str,
    rents: list[dict[str, Any]],
    prices: list[dict[str, Any]],
    indices: list[dict[str, Any]],
    yields: list[dict[str, Any]],
) -> dict[str, int]:
    """Replace the RVD benchmark tables with the supplied parsed rows."""
    database = Path(db_path)
    database.parent.mkdir(parents=True, exist_ok=True)

    engine = create_engine(f"sqlite:///{database}")
    RvdBase.metadata.create_all(engine)
    engine.dispose()

    connection = sqlite3.connect(database)
    try:
        connection.execute("DELETE FROM rvd_rents")
        connection.execute("DELETE FROM rvd_prices")
        connection.execute("DELETE FROM rvd_indices")
        connection.execute("DELETE FROM rvd_yields")

        connection.executemany(
            "INSERT OR REPLACE INTO rvd_rents "
            "(region_code, property_class, month, value_hkd_m2) "
            "VALUES (?, ?, ?, ?)",
            [
                (
                    row["region_code"],
                    row["property_class"],
                    row["month"],
                    row["value_hkd_m2"],
                )
                for row in rents
            ],
        )
        connection.executemany(
            "INSERT OR REPLACE INTO rvd_prices "
            "(region_code, property_class, month, value_hkd_m2) "
            "VALUES (?, ?, ?, ?)",
            [
                (
                    row["region_code"],
                    row["property_class"],
                    row["month"],
                    row["value_hkd_m2"],
                )
                for row in prices
            ],
        )
        connection.executemany(
            "INSERT OR REPLACE INTO rvd_indices "
            "(index_type, property_class, month, value) VALUES (?, ?, ?, ?)",
            [
                (
                    row["index_type"],
                    row["property_class"],
                    row["month"],
                    row["value"],
                )
                for row in indices
            ],
        )
        connection.executemany(
            "INSERT OR REPLACE INTO rvd_yields "
            "(property_class, month, yield_pct) VALUES (?, ?, ?)",
            [
                (row["property_class"], row["month"], row["yield_pct"])
                for row in yields
            ],
        )
        connection.commit()

        return {
            "rvd_rents": connection.execute(
                "SELECT count(*) FROM rvd_rents"
            ).fetchone()[0],
            "rvd_prices": connection.execute(
                "SELECT count(*) FROM rvd_prices"
            ).fetchone()[0],
            "rvd_indices": connection.execute(
                "SELECT count(*) FROM rvd_indices"
            ).fetchone()[0],
            "rvd_yields": connection.execute(
                "SELECT count(*) FROM rvd_yields"
            ).fetchone()[0],
        }
    finally:
        connection.close()


def load_rvd(db_path: Path | str, source_dir: Path | str) -> dict[str, int]:
    """Parse the five workbooks in ``source_dir`` and replace the tables."""
    directory = Path(source_dir)
    missing = [
        filename
        for filename in RVD_FILES.values()
        if not (directory / filename).is_file()
    ]
    if missing:
        raise FileNotFoundError(
            "Missing RVD files in "
            + str(directory)
            + ": "
            + ", ".join(missing)
        )

    rents = parse_rents(directory / RVD_FILES["rents"])
    prices = parse_prices(directory / RVD_FILES["prices"])
    indices = parse_indices(
        directory / RVD_FILES["rental_indices"],
        "rental",
    ) + parse_indices(
        directory / RVD_FILES["price_indices"],
        "price",
    )
    yields = parse_yields(directory / RVD_FILES["yields"])
    return ingest_rvd_rows(db_path, rents, prices, indices, yields)
