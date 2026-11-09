"""Map fixture responses into the SQLite table dictionaries."""

from __future__ import annotations

import pytest

from models.agency.outputs import (
    BuildingsTableModel,
    DistrictsTableModel,
    EstateFacilitiesTableModel,
    EstateInfoTableModel,
    EstateMonthlyMarketInfoTableModel,
    EstateMtrLineTableModel,
    EstateSchoolNetTableModel,
    FacilitiesTableModel,
    PhasesTableModel,
    RegionsTableModel,
    SubregionsTableModel,
    TransactionsDetailModel,
    UnitFeaturesModel,
    UnitInfoModel,
)


def test_estate_info_mapping(single_has_phases_response):
    row = EstateInfoTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert row.estate_id == "E000004419"
    assert row.estate_name_zh == "日出康城"
    assert row.estate_name_en == "Lohas Park"
    assert row.region_id == "20"
    assert row.subregion_id == "2010"
    assert row.district_id == "201005"
    assert row.address_en == "1 Lohas Park Road"
    assert row.first_op_date.year == 2008
    assert row.latitude == pytest.approx(22.2944)
    assert row.longitude == pytest.approx(114.269558)


def test_location_hierarchy_mapping(single_has_phases_response):
    region = RegionsTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    subregion = SubregionsTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    district = DistrictsTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert (region.region_id, subregion.subregion_id, district.district_id) == (
        "20",
        "2010",
        "201005",
    )
    assert subregion.region_id == "20"
    assert district.subregion_id == "2010"


def test_school_net_and_mtr_mapping(
    single_has_phases_response, single_no_phases_response
):
    school_net = EstateSchoolNetTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert school_net.school_net_id == "95"
    assert school_net.school_net_name_en == "Saikung"

    mtr_line = EstateMtrLineTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert mtr_line.mtr_line_name_en == "Tseung Kwan O Line"

    assert (
        EstateMtrLineTableModel.from_both_responses(
            single_no_phases_response, single_no_phases_response
        )
        is None
    )


def test_facility_mapping(
    single_has_phases_response, single_no_phases_response
):
    facilities = FacilitiesTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert len(facilities) == 1
    assert facilities[0].facility_id == "FM12"
    assert facilities[0].facility_name_en == "Clubhouse"

    estate_facilities = EstateFacilitiesTableModel.from_response(
        single_has_phases_response
    )
    assert len(estate_facilities) == 1
    assert estate_facilities[0].estate_id == "E000004419"
    assert estate_facilities[0].facility_id == "FM12"

    assert (
        EstateFacilitiesTableModel.from_response(single_no_phases_response)
        is None
    )


def test_phase_and_building_mapping(
    single_has_phases_response, single_no_phases_response
):
    phases = PhasesTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert len(phases) == 1
    assert phases[0].phase_id == "P000000424"
    assert phases[0].estate_id == "E000004419"

    buildings = BuildingsTableModel.from_both_responses(
        single_has_phases_response, single_has_phases_response
    )
    assert len(buildings) == 1
    assert buildings[0].building_id == "B000063459"
    assert buildings[0].estate_id == "E000004419"
    assert buildings[0].phase_id == "P000000424"

    assert (
        PhasesTableModel.from_both_responses(
            single_no_phases_response, single_no_phases_response
        )
        == []
    )
    no_phase_buildings = BuildingsTableModel.from_both_responses(
        single_no_phases_response, single_no_phases_response
    )
    assert len(no_phase_buildings) == 1
    assert no_phase_buildings[0].building_id == "B000073945"
    assert no_phase_buildings[0].phase_id is None


def test_market_info_mapping(market_info_responses):
    rows = EstateMonthlyMarketInfoTableModel.from_response(
        market_info_responses[0]
    )
    assert len(rows) == 1
    row = rows[0]
    assert row.estate_id == "E000004419"
    assert row.record_date.year == 2025
    assert row.record_date.month == 7
    assert row.avg_net_ft_price == 11598
    assert row.max_net_ft_price == 15428
    assert row.total_tx_count == 57
    assert row.total_tx_amount == 424_978_000


def test_transaction_unit_and_feature_mapping(building_info_response):
    unit = building_info_response.data[0]
    transaction = unit.transactions[0]

    transaction_row = TransactionsDetailModel.from_response(
        unit_id=unit.unit_id, response=transaction
    )
    assert transaction_row.tx_id == "I20250300653"
    assert transaction_row.price == 6_800_000.0
    assert transaction_row.tx_date.year == 2025
    assert transaction_row.last_tx_date.year == 2017
    assert transaction_row.gain == pytest.approx(-2.86)
    assert transaction_row.net_ft_price == 9985.0
    assert transaction_row.unit_id == "U001660920"

    unit_row = UnitInfoModel.from_response(
        response=unit,
        building_id=building_info_response.building.id,
        bedroom=3,
        sitting_room=2,
    )
    assert unit_row.unit_id == "U001660920"
    assert unit_row.floor == "70"
    assert unit_row.flat == "B"
    assert unit_row.area == 903.0
    assert unit_row.net_area == 681.0
    assert unit_row.bedroom == 3
    assert unit_row.sitting_room == 2
    assert unit_row.building_id == "B000063458"

    feature = transaction.feature[0]
    feature_row = UnitFeaturesModel.from_response(
        unit_id=unit.unit_id, response=feature
    )
    assert feature_row.feature_id == "balcony"
    assert feature_row.feature_name_zh == "連露台"
    assert feature_row.feature_name_en == "balcony"
