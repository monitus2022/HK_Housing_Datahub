"""Offline tests for the data catalogue generator."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from analytics.builder import build_marts
from catalog import build_catalog, render_markdown
from models.agency.sql_db import Base


def make_db(path: Path) -> None:
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()
    build_marts(path, wiki_dir=path.parent / "missing-wiki")


def test_catalog_covers_all_tables_and_renders(tmp_path):
    db = tmp_path / "agency.db"
    make_db(db)

    catalog = build_catalog(db)

    assert catalog["database"]["table_count"] >= 20
    dataset_ids = {dataset["id"] for dataset in catalog["datasets"]}
    assert {"agency_raw", "analytics_marts", "wikipedia", "rag_embeddings"} <= (
        dataset_ids
    )
    est = next(
        table
        for dataset in catalog["datasets"]
        for table in dataset["tables"]
        if table["name"] == "estates"
    )
    assert est["row_count"] == 0
    assert any(column["name"] == "estate_id" for column in est["columns"])

    markdown = render_markdown(catalog)
    assert "# Data Catalogue" in markdown
    assert "### `estates`" in markdown
    assert "### `mart_estate_summary`" in markdown


def test_catalog_rejects_uncurated_tables(tmp_path):
    db = tmp_path / "agency.db"
    make_db(db)
    connection = sqlite3.connect(db)
    try:
        connection.execute("CREATE TABLE rogue (id TEXT)")
        connection.commit()
    finally:
        connection.close()

    with pytest.raises(ValueError, match="rogue"):
        build_catalog(db)


def test_catalog_includes_quality_and_manifest(tmp_path):
    db = tmp_path / "agency.db"
    make_db(db)
    quality = tmp_path / "quality.json"
    quality.write_text(
        json.dumps(
            {
                "summary": {
                    "status": "warn",
                    "critical_failures": 0,
                    "warning_failures": 3,
                }
            }
        ),
        encoding="utf-8",
    )
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "build_id": "build-1",
                "schema_version": 5,
                "data_through": {"transactions": "2026-11-08"},
                "coverage": {"estates": 9750},
            }
        ),
        encoding="utf-8",
    )

    catalog = build_catalog(db, quality_path=quality, manifest_path=manifest)

    assert catalog["quality"]["status"] == "warn"
    assert catalog["manifest"]["build_id"] == "build-1"
    markdown = render_markdown(catalog)
    assert "Quality: `warn`" in markdown
    assert "Snapshot: `build-1`" in markdown
