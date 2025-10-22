from requests import Response
from typing import Optional
import os
import json

from utils import parse_response
from logger import housing_logger
from .agency_base import AgencyProcessor
from models.agency.responses import (
    EstateInfoResponse,
    SingleEstateInfoResponse,
)
from models.agency.outputs import *
from models.agency.sql_db import *


class EstatesProcessor(AgencyProcessor):
    def __init__(self, force_refetch_estate_ids: bool = False):
        super().__init__()
        self.force_refetch_estate_ids = force_refetch_estate_ids

        # Table config: cache name to (Pydantic Model, SQLAlchemy Model)
        self.zh_table_configs: dict[str, tuple[type[SingleLanguageBaseModel], type]] = {
            "estate_facilities_cache": (EstateFacilitiesTableModel, EstateFacility),
            "estate_monthly_market_info_cache": (
                EstateMonthlyMarketInfoTableModel,
                EstateMonthlyMarketInfo,
            ),
        }
        self.table_configs: dict[str, tuple[type[BilingualBaseModel], type]] = {
            "estate_info_cache": (EstateInfoTableModel, Estate),
            "estate_school_nets_cache": (EstateSchoolNetTableModel, EstateSchoolNet),
            "estate_mtr_lines_cache": (EstateMtrLineTableModel, EstateMtrLine),
            "regions_cache": (RegionsTableModel, Region),
            "subregions_cache": (SubregionsTableModel, Subregion),
            "districts_cache": (DistrictsTableModel, District),
            "facilities_cache": (FacilitiesTableModel, Facility),
            "phases_cache": (PhasesTableModel, Phase),
            "buildings_cache": (BuildingsTableModel, Building),
        }
        # Primary key map for upsert operations
        self.pk_map = {
            "estate_info_cache": ["estate_id"],
            "estate_school_nets_cache": ["estate_id", "school_net_id"],
            "estate_mtr_lines_cache": ["estate_id", "mtr_line_name_en"],
            "regions_cache": ["region_id"],
            "subregions_cache": ["subregion_id"],
            "districts_cache": ["district_id"],
            "phases_cache": ["phase_id"],
            "buildings_cache": ["building_id"],
            "estate_facilities_cache": ["estate_id", "facility_id"],
            "facilities_cache": ["facility_id"],
            "estate_monthly_market_info_cache": ["estate_id", "record_date"],
        }
        self._create_data_cache()
        # Create tables if not exist
        self._create_tables()

    def _create_data_cache(self) -> None:
        self.caches = {
            "estate_ids_cache": [],
            "building_ids_cache": [],
            }
        # Load local txt file for estate_ids if exists or not forced to refetch
        if (
            os.path.exists(self.estate_ids_file_path)
            and not self.force_refetch_estate_ids
        ):
            housing_logger.info(
                f"Loading local estate IDs cache from {self.estate_ids_file_path}."
            )
            with open(self.estate_ids_file_path, "r", encoding="utf-8") as f:
                self.caches["estate_ids_cache"] = [
                    line.strip() for line in f.readlines()
                ]

        for cache_name in self.zh_table_configs.keys():
            self.caches[cache_name] = []
        for cache_name in self.table_configs.keys():
            self.caches[cache_name] = []

    def _create_tables(self):
        Base.metadata.create_all(self.engine)

    def process_all_estate_info_response(self, estate_info_response: Response) -> int:
        """
        Simple parse estate info response to get estate IDs, save to cache
        """
        estate_info: Optional[EstateInfoResponse] = parse_response(
            response=estate_info_response, model=EstateInfoResponse
        )
        if not estate_info:
            housing_logger.error("Failed to process estate info response.")
            return (None, None)

        estate_count = estate_info.count
        self.caches["estate_ids_cache"].extend(
            [estate.id for estate in estate_info.result]
        )
        return estate_count

    def save_estate_ids_to_txt(self) -> None:
        """
        Save estate IDs to a text file
        """
        with open(self.estate_ids_file_path, "w", encoding="utf-8") as f:
            for estate_id in self.caches["estate_ids_cache"]:
                f.write(f"{estate_id}\n")
        housing_logger.info(
            f"Saved {len(self.caches['estate_ids_cache'])} estate IDs to {self.estate_ids_file_path}."
        )

    def map_single_estate_info_responses_to_table_dicts(
        self,
        estate_info_zh: SingleEstateInfoResponse,
        estate_info_en: SingleEstateInfoResponse,
    ) -> None:
        """
        Map single estate info response to dicts with table fields

        Tables:
        - Estate Facilities

        Tables with multilingual names:
        - Estate Info
        - Estate School Nets
        - Estate Mtr Lines
        - Facilities
        - Regions
        - Subregions
        - Districts
        - Phases
        - Buildings
        """
        # Single language: get from zh response
        facilities = EstateFacilitiesTableModel.from_response(response=estate_info_zh)
        if facilities:
            for facility in facilities:
                facility_dict = facility.model_dump()
                if facility_dict in self.caches["estate_facilities_cache"]:
                    continue
                self.caches["estate_facilities_cache"].append(facility_dict)

        # Bilingual: get from both zh and en responses
        for cache_name, (table_model, _) in self.table_configs.items():
            content: Optional[BilingualBaseModel] = table_model.from_both_responses(
                zh_response=estate_info_zh, en_response=estate_info_en
            )
            if not content:
                continue
            elif type(content) is list:
                for item in content:
                    item_dict = item.model_dump()
                    if item_dict in self.caches[cache_name]:
                        continue
                    self.caches[cache_name].append(item_dict)
            else:
                content_dict = content.model_dump()
                if content_dict in self.caches[cache_name]:
                    continue
                self.caches[cache_name].append(content_dict)

    def map_single_estate_market_info_responses_to_table_dicts(
        self, response: EstateMonthlyMarketInfoResponse
    ) -> None:
        """
        Process single estate monthly market info response and save to cache
        """
        if not response:
            return None
        month_records = EstateMonthlyMarketInfoTableModel.from_response(
            response=response
        )
        for month_record in month_records:
            self.caches["estate_monthly_market_info_cache"].append(
                month_record.model_dump()
            )

    def create_building_ids_cache_from_building_cache(self) -> None:
        """
        Create building IDs cache from buildings cache
        """
        building_ids = set()
        for building in self.caches.get("buildings_cache", []):
            building_id = building.get("building_id")
            if building_id:
                building_ids.add(building_id)
        self.caches["building_ids_cache"].extend(list(building_ids))
