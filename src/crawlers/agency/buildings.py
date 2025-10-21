from ..base import BaseCrawler
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional
from requests import Session
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
        self.session = agency_session

    def _set_request_urls(self):
        self.buildings_url = housing_datahub_config.agency_api.urls.building_transactions

    def fetch_buildings_by_building_ids(
        self, building_ids: list[str]
    ) -> Optional[list[BuildingInfoResponse]]:
        """
        Fetch buildings transaction info.
        """
        output = []
        for building_id in building_ids:
            response = self._fetch_single_building_by_building_id(building_id=building_id)
            if response:
                output.append(response)
            time.sleep(0.1)
        return output

    def _fetch_single_building_by_building_id(
        self, building_id: str
    ) -> Optional[BuildingInfoResponse]:
        """
        Fetch single building transaction info by building ID.
        """
        request_url = self.buildings_url.format(building_id=building_id)
        request_params = BuildingsRequestParams(lang="en").model_dump()

        response = self._make_request(url=request_url, params=request_params)
        if not response:
            housing_logger.error(
                f"Failed to fetch building transaction info for building ID {building_id}."
            )
            return None
        parsed_response: BuildingInfoResponse = parse_response(
            response=response, model=BuildingInfoResponse
        )
        return parsed_response