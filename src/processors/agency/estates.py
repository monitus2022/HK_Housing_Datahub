from .agency_base import AgencyProcessor
from requests import Response
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional
from models.agency.responses import (
    EstateInfoResponse,
    SingleEstateInfoResponse,
)


class EstatesProcessor(AgencyProcessor):
    def __init__(self):
        super().__init__()

    def process_all_estate_info_responses(
        self, estate_info_response: Response
    ) -> Optional[tuple[int, list[str]]]:
        """
        Simple parse estate info response to get estate IDs
        """
        estate_info: Optional[EstateInfoResponse] = self._parse_response(
            response=estate_info_response, model=EstateInfoResponse
        )
        if not estate_info:
            housing_logger.error("Failed to process estate info response.")
            return (None, None)

        estate_count = estate_info.count
        estate_ids = [estate.id for estate in estate_info.result]
        return (estate_count, estate_ids)

    def save_estate_ids_to_txt(self, estate_ids: list[str]) -> None:
        """
        Save estate IDs to a text file
        """
        with open(self.estate_ids_file_path, "w", encoding="utf-8") as f:
            for estate_id in estate_ids:
                f.write(f"{estate_id}\n")
        housing_logger.info(f"Saved {len(estate_ids)} estate IDs to {self.estate_ids_file_path}.")
    
    def process_single_estate_info_response(
        self, single_estate_info_response: Response
    ) -> Optional[dict]:
        """
        Simple parse single estate info response to get estate details
        """
        estate_info: Optional[SingleEstateInfoResponse] = self._parse_response(
            response=single_estate_info_response, model=SingleEstateInfoResponse
        )
        if not estate_info:
            housing_logger.error("Failed to process single estate info response.")
            return None

        return estate_info
