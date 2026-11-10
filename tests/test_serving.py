"""Serving snapshot, verification, and publish-plan tests (no network)."""

from __future__ import annotations

import gzip
import json
import sqlite3
from pathlib import Path

import pytest

from serving.publish import (
    build_parser,
    cache_control_for,
    content_encoding_for,
    content_type_for,
    main as publish_main,
    publish_snapshot,
    validate_bucket_name,
)
from serving.snapshot import build_snapshot
from serving.verify import main as verify_main
from serving.verify import verify_snapshot

REQUIRED_FILES = {
    "overview.json",
    "district_monthly.json.gz",
    "estate_summary.json.gz",
    "transaction_recent.json.gz",
    "coverage.json.gz",
    "manifest.json",
}


def read_json(path: Path):
    if path.name.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(path.read_text(encoding="utf-8"))


def make_snapshot_db(path: Path) -> None:
    con = sqlite3.connect(path)
    try:
        con.executescript(
            """
            CREATE TABLE transactions (tx_date TEXT);
            CREATE TABLE estate_monthly_market_info (record_date TEXT);
            CREATE TABLE mart_estate_summary (
                estate_id TEXT, estate_name_en TEXT, latest_tx_date TEXT,
                has_market INTEGER, has_transactions INTEGER, has_wiki INTEGER
            );
            CREATE TABLE mart_district_monthly (
                district_id TEXT, month TEXT, tx_count INTEGER
            );
            CREATE TABLE mart_estate_monthly (
                estate_id TEXT, month TEXT, tx_count INTEGER
            );
            CREATE TABLE mart_transaction_recent (
                tx_id TEXT, tx_date TEXT, price REAL, net_ft_price REAL,
                estate_id TEXT, estate_name_en TEXT, district_id TEXT,
                district_name_en TEXT, building_id TEXT, unit_id TEXT,
                area REAL, net_area REAL, bedroom INTEGER
            );
            CREATE TABLE mart_coverage (
                estate_id TEXT, has_market INTEGER,
                has_transactions INTEGER, has_wiki INTEGER
            );
            """
        )
        con.executemany(
            "INSERT INTO transactions (tx_date) VALUES (?)",
            [("2025-01-15 16:00:00",), ("2025-01-16",)],
        )
        con.execute(
            "INSERT INTO estate_monthly_market_info (record_date) VALUES (?)",
            ("2024-12-31",),
        )
        con.executemany(
            "INSERT INTO mart_estate_summary VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("E1", "Estate One", "2025-01-16", 1, 1, 1),
                ("E2", "Estate Two", "2023-01-01", 1, 0, 0),
            ],
        )
        con.execute(
            "INSERT INTO mart_district_monthly VALUES (?, ?, ?)",
            ("D1", "2025-01", 2),
        )
        con.execute(
            "INSERT INTO mart_estate_monthly VALUES (?, ?, ?)",
            ("E1", "2025-01", 2),
        )
        con.execute(
            "INSERT INTO mart_transaction_recent VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "T1",
                "2025-01-16",
                5000000.0,
                15000.0,
                "E1",
                "Estate One",
                "D1",
                "District One",
                "B1",
                "U1",
                400.0,
                333.0,
                2,
            ),
        )
        con.executemany(
            "INSERT INTO mart_coverage VALUES (?, ?, ?, ?)",
            [("E1", 1, 1, 1), ("E2", 1, 0, 0)],
        )
        con.commit()
    finally:
        con.close()


@pytest.fixture
def snapshot(tmp_path):
    db_path = tmp_path / "serving.db"
    make_snapshot_db(db_path)
    output_root = tmp_path / "serving"
    manifest = build_snapshot(
        db_path,
        output_root=output_root,
        build_id="test-build",
    )
    snapshot_dir = output_root / "test-build"
    return snapshot_dir, manifest


def test_snapshot_manifest_and_files(snapshot):
    snapshot_dir, manifest = snapshot

    assert manifest["schema_version"] == 2
    assert manifest["build_id"] == "test-build"
    assert manifest["data_through"] == {
        "transactions": "2025-01-16",
        "market": "2024-12-31",
    }
    assert manifest["coverage"] == {
        "estates": 2,
        "with_transactions": 1,
        "with_market": 2,
        "with_wiki": 1,
    }
    assert manifest["row_counts"] == {
        "mart_estate_summary": 2,
        "mart_district_monthly": 1,
        "mart_estate_monthly": 1,
        "mart_transaction_recent": 1,
        "mart_coverage": 2,
    }
    assert manifest["files"] == {
        "overview": "overview.json",
        "district_monthly": "district_monthly.json.gz",
        "estate_summary": "estate_summary.json.gz",
        "transaction_recent": "transaction_recent.json.gz",
        "coverage": "coverage.json.gz",
    }
    assert manifest["source"] == ["HKP", "Wikipedia"]

    assert {path.name for path in snapshot_dir.iterdir()} == REQUIRED_FILES
    for name in REQUIRED_FILES:
        assert (snapshot_dir / name).stat().st_size > 0

    overview = read_json(snapshot_dir / "overview.json")
    assert overview["build_id"] == "test-build"
    assert overview["coverage"] == manifest["coverage"]
    assert len(read_json(snapshot_dir / "estate_summary.json.gz")) == 2
    assert len(read_json(snapshot_dir / "district_monthly.json.gz")) == 1
    transactions = read_json(snapshot_dir / "transaction_recent.json.gz")
    assert transactions == [
        {
            "tx_date": "2025-01-16",
            "price": 5000000.0,
            "net_ft_price": 15000.0,
            "estate_id": "E1",
            "estate_name_en": "Estate One",
            "district_id": "D1",
            "district_name_en": "District One",
            "area": 400.0,
            "net_area": 333.0,
            "bedroom": 2,
        }
    ]
    assert len(read_json(snapshot_dir / "coverage.json.gz")) == 2

    assert verify_snapshot(snapshot_dir) == []


def test_verify_detects_missing_and_empty_files(snapshot):
    snapshot_dir, _ = snapshot

    (snapshot_dir / "coverage.json.gz").unlink()
    errors = verify_snapshot(snapshot_dir)
    assert any("coverage.json.gz" in error for error in errors)

    (snapshot_dir / "district_monthly.json.gz").write_text("")
    errors = verify_snapshot(snapshot_dir)
    assert any("Empty file" in error for error in errors)

    (snapshot_dir / "coverage.json.gz").write_bytes(b"\x1f\x8b")
    errors = verify_snapshot(snapshot_dir)
    assert any("gzipped JSON" in error for error in errors)


def test_publish_dry_run_plans_versioned_files_and_manifest_last(snapshot):
    snapshot_dir, manifest = snapshot

    uploads = publish_snapshot(
        snapshot_dir,
        "test-bucket",
        dry_run=True,
    )
    keys = [upload["key"] for upload in uploads]
    assert keys[:5] == [
        f"dashboard/{manifest['build_id']}/overview.json",
        f"dashboard/{manifest['build_id']}/district_monthly.json.gz",
        f"dashboard/{manifest['build_id']}/estate_summary.json.gz",
        f"dashboard/{manifest['build_id']}/transaction_recent.json.gz",
        f"dashboard/{manifest['build_id']}/coverage.json.gz",
    ]
    assert keys[-2:] == [
        f"dashboard/{manifest['build_id']}/manifest.json",
        "dashboard/manifest.json",
    ]
    assert uploads[0]["cache_control"] == (
        "public, max-age=31536000, immutable"
    )
    assert uploads[0]["content_encoding"] is None
    assert uploads[1]["content_encoding"] == "gzip"
    assert uploads[-1]["cache_control"] == "public, max-age=60"


def test_publish_rejects_unsafe_manifest_paths(snapshot):
    snapshot_dir, _ = snapshot
    manifest = read_json(snapshot_dir / "manifest.json")
    manifest["files"]["overview"] = "../escape.json"
    (snapshot_dir / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )

    with pytest.raises(ValueError, match="Unsafe manifest file path"):
        publish_snapshot(snapshot_dir, "test-bucket", dry_run=True)


def test_publish_with_fake_uploader(snapshot):
    snapshot_dir, _ = snapshot
    uploaded = []

    def fake_uploader(
        local_path, key, content_type, cache_control, content_encoding
    ):
        uploaded.append(
            (
                local_path.name,
                key,
                content_type,
                cache_control,
                content_encoding,
            )
        )

    uploads = publish_snapshot(
        snapshot_dir,
        "test-bucket",
        uploader=fake_uploader,
    )
    assert len(uploads) == len(uploaded)
    assert uploaded[-1][1] == "dashboard/manifest.json"
    assert uploaded[-1][3] == "public, max-age=60"
    assert uploaded[-1][4] is None
    assert all(item[2] == "application/json" for item in uploaded)
    assert uploaded[1][4] == "gzip"


def test_bucket_cache_and_content_type_helpers():
    assert validate_bucket_name("hk-housing-datahub") == "hk-housing-datahub"
    with pytest.raises(ValueError):
        validate_bucket_name("Bad_Bucket")
    with pytest.raises(ValueError):
        validate_bucket_name("bad..bucket")
    assert cache_control_for("manifest") == "public, max-age=60"
    assert cache_control_for("estate_summary") == (
        "public, max-age=31536000, immutable"
    )
    assert content_type_for(Path("x.json")) == "application/json"
    assert content_type_for(Path("x.json.gz")) == "application/json"
    assert content_type_for(Path("x.parquet")) == "application/octet-stream"
    assert content_encoding_for(Path("x.json.gz")) == "gzip"
    assert content_encoding_for(Path("x.json")) is None


def test_publish_cli_and_verify_cli(tmp_path, snapshot):
    snapshot_dir, manifest = snapshot
    assert (
        verify_main(["--snapshot-dir", str(snapshot_dir)]) == 0
    )

    db_path = tmp_path / "serving.db"
    output_root = tmp_path / "cli-serving"
    assert (
        publish_main(
            [
                "--db",
                str(db_path),
                "--output-dir",
                str(output_root),
                "--build-id",
                "cli-build",
                "--dry-run",
            ]
        )
        == 0
    )
    cli_snapshot = output_root / "cli-build"
    assert (cli_snapshot / "manifest.json").exists()
    assert verify_snapshot(cli_snapshot) == []

    (cli_snapshot / "overview.json").unlink()
    assert verify_main(["--snapshot-dir", str(cli_snapshot)]) == 1


def test_legacy_raw_upload_is_gated():
    pytest.importorskip("boto3")
    from orchestrators.cloud_upload import CloudUploadOrchestrator

    orchestrator = CloudUploadOrchestrator()
    with pytest.raises(RuntimeError, match="Raw data upload is disabled"):
        orchestrator.upload_files_from_data_folder()


def test_publish_parser_defaults():
    args = build_parser().parse_args([])
    assert args.dry_run is False
    assert args.db == "data/agency/agency_data.db"
    assert args.output_dir == "data/serving"
