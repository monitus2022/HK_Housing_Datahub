"""Offline tests for rental-transaction ingestion."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

from crawlers.agency.rentals import RentalsCrawler
from models.agency.outputs import RentalTransactionModel
from processors.agency import RentalsProcessor


def rental_payload(rental_id: str, estate_id: str = "E1") -> dict:
    return {
        "id": rental_id,
        "tx_type": "L",
        "tx_date": "2026-10-15T16:00:00.000Z",
        "price": 25000,
        "net_area": 500,
        "area": 650,
        "unit_price_net": 50,
        "bedroom": "2",
        "district": {"id": "D1", "name": "District One"},
        "estate": {"id": estate_id, "name": "Estate One"},
        "phase": {"id": "P1", "name": "Phase One"},
        "building": {"id": "B1", "name": "Tower One"},
        "source": "MIDLAND",
    }


def test_rental_model_parses_api_payload():
    row = RentalTransactionModel.from_api(rental_payload("L1"))

    assert row.rental_id == "L1"
    assert row.tx_date.year == 2026
    assert row.price == 25000
    assert row.net_ft_price == 50
    assert row.bedroom == 2
    assert row.estate_id == "E1"
    assert row.district_name_en == "District One"
    assert row.building_name_en == "Tower One"


def test_rental_model_rejects_non_rental_types():
    payload = rental_payload("L1")
    payload["tx_type"] = "S"

    try:
        RentalTransactionModel.from_api(payload)
    except ValueError as exc:
        assert "Not a rental" in str(exc)
    else:
        raise AssertionError("Expected non-rental payload to be rejected")


def test_crawler_paginates_until_short_page(monkeypatch):
    crawler = RentalsCrawler(agency_session=SimpleNamespace())
    calls = []

    def fake_request(url, params=None, retry=3):
        calls.append(params["page"])
        if params["page"] == 1:
            return SimpleNamespace(
                json=lambda: {"count": 3, "result": [
                    {"id": "L1"}, {"id": "L2"}
                ]}
            )
        return SimpleNamespace(
            json=lambda: {"count": 3, "result": [{"id": "L3"}]}
        )

    monkeypatch.setattr(crawler, "_make_request", fake_request)

    records = crawler.fetch_district_rentals("D1", page_size=2)

    assert [record["id"] for record in records] == ["L1", "L2", "L3"]
    assert calls == [1, 2]


def test_crawler_returns_none_on_invalid_json(monkeypatch):
    crawler = RentalsCrawler(agency_session=SimpleNamespace())

    def bad_response(url, params=None, retry=3):
        def fail():
            raise ValueError("not json")

        return SimpleNamespace(json=fail)

    monkeypatch.setattr(crawler, "_make_request", bad_response)

    assert crawler.fetch_district_rentals("D1") is None


def test_processor_upserts_idempotently(tmp_path):
    db = tmp_path / "rentals.db"
    processor = RentalsProcessor(db_path=str(db))
    try:
        assert processor.map_rental_transactions(
            [rental_payload("L1"), rental_payload("L2")]
        ) == 2
        assert processor.flush() == 2

        # Re-ingesting the same keys refreshes rows instead of duplicating.
        assert processor.map_rental_transactions(
            [rental_payload("L1"), rental_payload("L2")]
        ) == 2
        processor.flush()
    finally:
        processor.close_session()

    connection = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        assert connection.execute(
            "SELECT count(*) FROM rental_transactions"
        ).fetchone()[0] == 2
        assert connection.execute(
            "SELECT price FROM rental_transactions WHERE rental_id='L1'"
        ).fetchone()[0] == 25000
    finally:
        connection.close()
