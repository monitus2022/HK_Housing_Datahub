from typing import Optional
from crawlers.agency import *
from models.agency.responses import EstateMonthlyMarketInfoResponse
from processors.agency import *
from logger import housing_logger
import time

# TODO: Refine import to be exact later


class AgencyOrchestrator:
    """
    Orchestrates the crawling and processing of agency data.
    """

    def __init__(self, debug_mode: bool = False):
        self._init_crawlers()
        self._init_processors()
        self.debug_mode = debug_mode

    def _init_crawlers(self):
        self.agency_crawler = AgencyCrawler()
        self.agency_session = self.agency_crawler.request_session
        self.estates_crawler = EstatesCrawler(agency_session=self.agency_session)

    def _init_processors(self):
        self.estates_processor = EstatesProcessor()

    def run_estates_info_data_pipeline(self) -> None:
        """
        Run the complete data pipeline for estates data.
        """
        housing_logger.info("Starting estates data pipeline.")

        # Step 1: Fetch all estate IDs
        housing_logger.info("#1 Fetching all estate IDs.")
        self._estate_ids()

        # Step 2: Fetch and process single estate info for each estate ID in zh and en
        housing_logger.info("#2 Fetching and processing single estate info.")
        self._estate_infos()

        # Step 3: Fetch estate monthly market info
        housing_logger.info("#3 Fetching and processing estate monthly market info.")
        self._estate_monthly_market_infos()

        # Step 4: Insert data into database
        housing_logger.info("#4 Inserting data into database.")
        self.estates_processor.insert_cache_into_db_tables()

        housing_logger.info("Completed estates data pipeline.")

    def _estate_ids(self) -> None:
        if not self.estates_processor.caches["estate_ids_cache"]:
            housing_logger.info("No local estate IDs cache found. Fetching from API.")
            self.estates_processor.caches["estate_ids_cache"] = (
                self.estates_crawler.fetch_estate_ids_from_all_estate_info()
            )
            self.estates_processor.save_estate_ids_to_txt()

        # Debug: Limit to first estates
        if self.debug_mode:
            self.estates_processor.caches["estate_ids_cache"] = (
                self.estates_processor.caches["estate_ids_cache"][:20]
            )

    def _estate_infos(self) -> None:
        housing_logger.info(
            "Starting to fetch and process single estate info for each estate ID."
        )
        estate_id_count = 0
        total_estates = len(self.estates_processor.caches["estate_ids_cache"])
        for estate_id in self.estates_processor.caches["estate_ids_cache"]:
            single_estate_info_zh = (
                self.estates_crawler.fetch_single_estate_info_by_id_lang(
                    estate_id, lang="zh-hk"
                )
            )
            single_estate_info_en = (
                self.estates_crawler.fetch_single_estate_info_by_id_lang(
                    estate_id, lang="en"
                )
            )
            if single_estate_info_zh and single_estate_info_en:
                self.estates_processor.map_single_estate_info_responses_to_table_dicts(
                    single_estate_info_zh, single_estate_info_en
                )
                estate_id_count += 1
            if estate_id_count % 100 == 0:
                housing_logger.info(
                    f"Processed {estate_id_count} / {total_estates} estates so far."
                )
            time.sleep(0.25)

    def _estate_monthly_market_infos(self) -> None:
        housing_logger.info(
            "Starting to fetch and process estate monthly market info for each estate ID."
        )
        estate_id_count = 0
        total_estates = len(self.estates_processor.caches["estate_ids_cache"])
        housing_logger.info(f"Total estates to process: {total_estates}")
        for estate_id in self.estates_processor.caches["estate_ids_cache"]:
            # List of monthly market info per estate
            market_info_response: Optional[list[EstateMonthlyMarketInfoResponse]] = (
                self.estates_crawler.fetch_estate_monthly_market_info_by_estate_ids(
                    estate_id
                )
            )
            if not market_info_response:
                continue
            # Process each estate's market info response
            for info in market_info_response:
                self.estates_processor.map_single_estate_market_info_responses_to_table_dicts(
                    response=info
                )
            estate_id_count += 1
            if estate_id_count % 100 == 0:
                housing_logger.info(
                    f"Processed {estate_id_count} / {total_estates} estates so far."
                )
            time.sleep(0.25)
