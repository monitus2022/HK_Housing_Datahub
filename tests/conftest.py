"""Shared fixtures for API payload tests.

All payloads are committed under docs/api_responses/; tests never call the
network.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from models.agency.responses import (
    BuildingInfoResponse,
    EstateMonthlyMarketInfoResponse,
    SingleEstateInfoResponse,
)

FIXTURES = Path(__file__).resolve().parent.parent / "docs" / "api_responses"


def load_fixture(name: str):
    with (FIXTURES / name).open(encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="session")
def estate_info_payload():
    return load_fixture("estate_info.json")


@pytest.fixture(scope="session")
def single_has_phases_payload():
    return load_fixture("single_estate_info_has_phases.json")


@pytest.fixture(scope="session")
def single_no_phases_payload():
    return load_fixture("single_estate_info_no_phases.json")


@pytest.fixture(scope="session")
def market_info_payload():
    return load_fixture("estate_monthly_market_info.json")


@pytest.fixture(scope="session")
def transactions_payload():
    return load_fixture("transactions.json")


@pytest.fixture(scope="session")
def single_has_phases_response(single_has_phases_payload):
    return SingleEstateInfoResponse.model_validate(single_has_phases_payload)


@pytest.fixture(scope="session")
def single_no_phases_response(single_no_phases_payload):
    return SingleEstateInfoResponse.model_validate(single_no_phases_payload)


@pytest.fixture(scope="session")
def market_info_responses(market_info_payload):
    return [
        EstateMonthlyMarketInfoResponse.model_validate(item)
        for item in market_info_payload
    ]


@pytest.fixture(scope="session")
def building_info_response(transactions_payload):
    return BuildingInfoResponse.model_validate(transactions_payload)
