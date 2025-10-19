from .agency_base import AgencyProcessor
from requests import Response
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional
import os
from utils import parse_response
from models.agency.responses import (
    EstateInfoResponse,
    SingleEstateInfoResponse,
)
from models.agency.outputs import (
    EstateInfoTableModel,
    EstateFacilitiesTableModel,
)



class EstatesProcessor(AgencyProcessor):
    def __init__(self):
        super().__init__()
        self._create_data_cache()

    def _create_data_cache(self) -> None:
        self.estate_info_cache = []
        self.estate_facilities_cache = []

        # Load local txt file for estate_ids if exists
        if os.path.exists(self.estate_ids_file_path):
            with open(self.estate_ids_file_path, "r", encoding="utf-8") as f:
                self.estate_ids_cache = [line.strip() for line in f.readlines()]
        else:
            self.estate_ids_cache = []

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
        self.estate_ids_cache.extend([estate.id for estate in estate_info.result])
        return estate_count

    def save_estate_ids_to_txt(self) -> None:
        """
        Save estate IDs to a text file
        """
        with open(self.estate_ids_file_path, "w", encoding="utf-8") as f:
            for estate_id in self.estate_ids_cache:
                f.write(f"{estate_id}\n")
        housing_logger.info(
            f"Saved {len(self.estate_ids_cache)} estate IDs to {self.estate_ids_file_path}."
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
        - Facilities
        - Regions
        - Subregions
        - Districts
        - Phases
        - Buildings
        """
        # Single language: get from zh response
        facilities = estate_info_zh.facilityGroup or []
        if facilities:
            for facility in facilities:
                self.estate_facilities_cache.extend([
                    EstateFacilitiesTableModel(
                        estate_id=estate_info_zh.id,
                        facility_id=facility.id
                    ).model_dump()
                ])

        # Multilingual names: get from both responses
        estate_info_table = EstateInfoTableModel.from_responses(estate_info_zh).model_dump()
