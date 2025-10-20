from ..base import BaseCrawler
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional, Union
from requests import Response, Session
from utils import parse_response
import time
from models.agency.request_params import BuildingsRequestParams
from models.agency.responses import (
    BuildingInfoResponse,
)


class BuildingsCrawler(BaseCrawler):
    def __init__(self, agency_session: Session):
        super().__init__()
        self._set_request_urls()
        self.agency_session = agency_session

    def _set_request_urls(self):
        self.buildings_url = (
            housing_datahub_config.agency_api.urls.building_transactions
        )

    def fetch_buildings_by_building_ids(
        self, building_ids: list[str]
    ) -> Optional[list[BuildingInfoResponse]]:
        """
        Fetch buildings transaction info.
        """
        base_url = self.buildings_url
        request_params = BuildingsRequestParams(lang="en").model_dump()

        output = []
        housing_logger.info("Starting to fetch buildings transaction info.")
        for building_id in building_ids:
            request_url = f"{base_url}/{building_id}"
            response = self._make_request(url=request_url, params=request_params)
            if not response:
                housing_logger.error("Failed to fetch buildings transaction info.")
                return None
            parsed_response: BuildingInfoResponse = parse_response(
                response=response, model=BuildingInfoResponse
            )
            output.append(parsed_response)
            time.sleep(0.1)
        return output
