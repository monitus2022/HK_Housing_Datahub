from logger import housing_logger
from config import housing_datahub_config
from typing import Optional
from crawlers.agency import AgencyCrawler
from processors.agency import EstatesProcessor
from models.agency.request_params import (
    EstateInfoRequestParams,
    SingleEstateInfoRequestParams
)


class EstatesCrawler:
    def __init__(self, agency_crawler: AgencyCrawler):
        self.agency_crawler = agency_crawler
        self._set_file_paths()
        self.estates_processor = EstatesProcessor()

    def _set_file_paths(self) -> None:
        pass

    def fetch_all_estate_info_for_estate_ids(self) -> Optional[list]:
        """
        Fetch all estate info and return a list of estate IDs
        """
        base_url = self.agency_crawler.all_estate_info_url
        request_params = EstateInfoRequestParams(
            lang="zh-hk", limit=1000, page=1
        ).model_dump()

        estate_count = float("inf")
        estate_ids = []

        housing_logger.info("Starting to fetch all estate info for estate IDs.")
        while request_params["page"] * request_params["limit"] < estate_count:
            response = self.agency_crawler._make_request(
                url=base_url, params=request_params
            )
            if not response:
                housing_logger.error("Failed to fetch estate info.")
                return None

            current_estate_count, current_estate_ids = (
                self.estates_processor.process_all_estate_info_responses(
                    estate_info_response=response
                )
            )
            if current_estate_count < estate_count and current_estate_count > 0:
                housing_logger.info(
                    f"Fetched {len(current_estate_ids)} estate IDs in current page. Total estates: {current_estate_count}."
                )
                estate_count = current_estate_count
            if current_estate_ids:
                estate_ids.extend(current_estate_ids)
            request_params["page"] += 1

        housing_logger.info(f"Completed fetching all estate IDs. Total IDs fetched: {len(estate_ids)}.")
        return estate_ids

    def fetch_all_single_estate_info(self) -> Optional[list]:
        pass

    def _fetch_single_estate_info_by_id(self, estate_id: str, lang: str="en") -> Optional[dict]:
        """
        Fetch single estate info, phases and buildings by estate ID
        """
        base_url = self.agency_crawler.single_estate_info_url.format(estate_id=estate_id)
        request_params = SingleEstateInfoRequestParams(
            lang=lang
        ).model_dump()
        response = self.agency_crawler._make_request(
            url=base_url, params=request_params
        )
        if not response:
            housing_logger.warning(f"Failed to fetch single estate info for estate ID: {estate_id}.")
            return None
        
        # Generate multiple dataset models from response
        estate_info = self.estates_processor.process_single_estate_info_response(
            single_estate_info_response=response
        )
        return estate_info

    def fetch_all_estate_monthly_market_info(self) -> Optional[dict]:
        pass

    def _fetch_estate_monthly_market_info_by_estate_id(
        self, estate_id: list
    ) -> Optional[dict]:
        pass
