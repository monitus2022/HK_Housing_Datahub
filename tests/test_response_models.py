"""Parse the committed API fixtures into the Pydantic response models."""

from __future__ import annotations

from models.agency.responses import (
    BuildingInfoResponse,
    EstateInfoResponse,
    EstateMonthlyMarketInfoResponse,
    SingleEstateInfoResponse,
)


def test_estate_info_response(estate_info_payload):
    response = EstateInfoResponse.model_validate(estate_info_payload)
    assert response.count == 17861
    assert response.result
    assert response.result[0].id == "E000004419"


def test_single_estate_info_with_phases(single_has_phases_payload):
    response = SingleEstateInfoResponse.model_validate(single_has_phases_payload)
    assert response.id == "E000004419"
    assert response.name.chi == "日出康城"
    assert response.name.en == "Lohas Park"
    assert response.district.id == "201005"
    assert response.phase[0].is_phase is True
    assert response.phase[0].id == "P000000424"
    assert response.phase[0].buildings[0].id == "B000063459"
    assert response.mtr_line[0].name == "Tseung Kwan O Line"


def test_single_estate_info_without_phases(single_no_phases_payload):
    response = SingleEstateInfoResponse.model_validate(single_no_phases_payload)
    assert response.id == "E000012000"
    assert response.name.en == "40 Fuk Wa Street"
    assert response.phase[0].is_phase is False
    assert response.phase[0].buildings[0].id == "B000073945"
    assert response.mtr_line == []


def test_market_info_response(market_info_payload):
    response = EstateMonthlyMarketInfoResponse.model_validate(
        market_info_payload[0]
    )
    assert response.id == "E000004419"
    assert len(response.monthly) == 1
    assert response.monthly[0].avg_net_ft_price == 11598
    assert response.monthly[0].total_tx_count == 57


def test_transactions_response(transactions_payload):
    response = BuildingInfoResponse.model_validate(transactions_payload)
    assert response.building.id == "B000063458"
    assert len(response.data) == 1
    unit = response.data[0]
    assert unit.unit_id == "U001660920"
    assert unit.net_area == 681
    assert len(unit.transactions) == 1
    transaction = unit.transactions[0]
    assert transaction.id == "I20250300653"
    assert transaction.price == 6800000.0
    assert transaction.bedroom == 3
    assert transaction.net_ft_price == 9985.0
