from ..base import BaseCrawler
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional
from requests import Session
from utils import parse_response
import time
from models.agency.request_params import (
    EstateInfoRequestParams,
    SingleEstateInfoRequestParams
)
from models.agency.responses import (
    EstateInfoResponse,
    SingleEstateInfoResponse
)

class EstatesCrawler(BaseCrawler):
    def __init__(self, agency_session: Session):
        super().__init__()
        self._set_request_urls()
        self.session = agency_session

    def _set_request_urls(self):
        self.all_estate_info_url = (
            housing_datahub_config.agency_api.urls.all_estate_info
        )
        self.single_estate_info_url = (
            housing_datahub_config.agency_api.urls.single_estate_info
        )
        self.estate_monthly_market_info_url = (
            housing_datahub_config.agency_api.urls.estate_monthly_market_info
        )

    def fetch_estate_ids_from_all_estate_info(self) -> Optional[list]:
        """
        Fetch all estate info and return a list of estate IDs
        """
        base_url = self.all_estate_info_url
        request_params = EstateInfoRequestParams(
            lang="zh-hk", limit=1000, page=1
        ).model_dump()

        estate_count = float("inf")
        estate_ids = []

        # Get estate ids 
        housing_logger.info("Starting to fetch all estate info for estate IDs.")
        while request_params["page"] * request_params["limit"] < estate_count:
            response = self._make_request(
                url=base_url, params=request_params
            )
            if not response:
                housing_logger.error("Failed to fetch estate info.")
                return None
            estate_info: EstateInfoResponse = parse_response(
                response=response,
                model=EstateInfoResponse
            )
            if estate_info.count < estate_count:
                estate_count = estate_info.count
            estate_ids.extend([estate.id for estate in estate_info.result])
            housing_logger.info(
                f"Fetched page {request_params['page']}. Total estates fetched so far: {len(estate_ids)}."
            )
            request_params["page"] += 1
            time.sleep(0.25)

        housing_logger.info(f"Fetched {len(estate_ids)} estate IDs.")
        return estate_ids
    
    def fetch_single_estate_info_by_id_lang(self, estate_id: str, lang="en") -> Optional[SingleEstateInfoResponse]:
        base_url = self.single_estate_info_url.format(estate_id=estate_id)
        request_params = SingleEstateInfoRequestParams(
            lang=lang
        ).model_dump()
        response = self._make_request(
            url=base_url, params=request_params
        )
        if not response:
            housing_logger.warning(f"Failed to fetch single estate info for estate ID: {estate_id} in language: {lang}.")
            return None
        
        estate_info: Optional[SingleEstateInfoResponse] = parse_response(
            response=response,
            model=SingleEstateInfoResponse
        )
        return estate_info

    def fetch_all_estate_monthly_market_info(self) -> Optional[dict]:
        pass

    def _fetch_estate_monthly_market_info_by_estate_id(
        self, estate_id: list
    ) -> Optional[dict]:
        pass
