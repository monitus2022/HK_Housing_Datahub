from crawlers.agency import *
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
        # Step 1: Fetch all estate IDs
        if not self.estates_processor.caches["estate_ids_cache"]:
            housing_logger.info("No local estate IDs cache found. Fetching from API.")
            self.estates_processor.caches["estate_ids_cache"] = (
                self.estates_crawler.fetch_estate_ids_from_all_estate_info()
            )
            self.estates_processor.save_estate_ids_to_txt()

        # Step 2: Fetch and process single estate info for each estate ID in zh and en
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
            # Debug: Limit to first estates
            if self.debug_mode and estate_id_count >= 200:
                self.estates_processor.peek_data_caches()
                break
        # Further processing can be added here as needed
        housing_logger.info("Completed estates data pipeline.")
