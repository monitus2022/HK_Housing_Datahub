from ..base import BaseCrawler
from logger import housing_logger
from config import housing_datahub_config
from typing import Optional, Union
from requests import Response, Session
from utils import parse_response
import time
from models.agency.request_params import (
    EstateInfoRequestParams,
    SingleEstateInfoRequestParams,
    EstateMonthlyMarketInfoRequestParams,
)
from models.agency.responses import (
    EstateInfoResponse,
    EstateMonthlyMarketInfoRecord,
    SingleEstateInfoResponse,
    EstateMonthlyMarketInfoResponse,
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
            response = self._make_request(url=base_url, params=request_params)
            if not response:
                housing_logger.error("Failed to fetch estate info.")
                return None
            estate_info: EstateInfoResponse = parse_response(
                response=response, model=EstateInfoResponse
            )
            if estate_info.count < estate_count:
                estate_count = estate_info.count
            # Only include estate IDs, not phase IDs
            estate_ids.extend(
                [
                    estate.id
                    for estate in estate_info.result
                    if estate.id.startswith("E")
                ]
            )
            housing_logger.info(
                f"Fetched page {request_params['page']}. Total estates fetched so far: {len(estate_ids)}."
            )
            request_params["page"] += 1
            time.sleep(0.25)

        housing_logger.info(f"Fetched {len(estate_ids)} estate IDs.")
        return estate_ids

    def fetch_single_estate_info_by_id_lang(
        self, estate_id: str, lang="en"
    ) -> Optional[SingleEstateInfoResponse]:
        """
        Fetch single estate info by estate ID and language
        """
        base_url = self.single_estate_info_url.format(estate_id=estate_id)
        request_params = SingleEstateInfoRequestParams(lang=lang).model_dump()
        response = self._make_request(url=base_url, params=request_params)
        if not response:
            housing_logger.warning(
                f"Failed to fetch single estate info for estate ID: {estate_id} in language: {lang}."
            )
            return None

        estate_info: Optional[SingleEstateInfoResponse] = parse_response(
            response=response, model=SingleEstateInfoResponse
        )
        return estate_info

    def fetch_estate_monthly_market_info_by_estate_ids(
        self, estate_id: Union[list, str]
    ) -> Optional[list[EstateMonthlyMarketInfoResponse]]:
        """
        Fetch estate monthly market info by estate IDs
        """
        base_url = self.estate_monthly_market_info_url
        if isinstance(estate_id, list):
            estate_id = ",".join(estate_id)
        request_params = EstateMonthlyMarketInfoRequestParams(
            lang="en", type="estate", est_ids=estate_id
        )
        response = self._make_request(url=base_url, params=request_params)
        if not response:
            housing_logger.warning(
                f"Failed to fetch estate monthly market info for estate IDs: {estate_id}."
            )
            return None
        # Parsing nested list response
        estates_monthly_market_infos = []
        for item in response.json():
            try:
                estate_monthly_market_info_response: Optional[EstateMonthlyMarketInfoResponse] = EstateMonthlyMarketInfoResponse(
                    id=item.get("id"),
                    monthly=[EstateMonthlyMarketInfoRecord(**record) for record in item.get("monthly", [])]
                )
                if estate_monthly_market_info_response:
                    estates_monthly_market_infos.append(estate_monthly_market_info_response)
            except ValueError as e:
                housing_logger.error(
                    f"Failed to parse estate monthly market info for estate IDs: {estate_id}. Error: {e}"
                )
                return None
        return estates_monthly_market_infos
