from crawlers.agency import *
from processors.agency import *
from logger import housing_logger

# TODO: Refine import to be exact later


class AgencyOrchestrator:
    """
    Orchestrates the crawling and processing of agency data.
    """
    def __init__(self):
        self._init_crawlers()
        self._init_processors()
        self._create_data_cache()

    def _init_crawlers(self):
        self.agency_crawler = AgencyCrawler()
        self.agency_session = self.agency_crawler.request_session
        self.estates_crawler = EstatesCrawler(agency_session=self.agency_session)

    def _init_processors(self):
        self.estates_processor = EstatesProcessor()

    def _create_data_cache(self) -> None:
        self.estate_ids_cache = []
        self.estate_info_cache = []

    def run_estates_info_data_pipeline(self) -> None:
        """
        Run the complete data pipeline for estates data.
        """
        # Step 1: Fetch all estate IDs
        self.estate_ids_cache = (
            self.estates_crawler.fetch_all_estate_info_for_estate_ids()
        )

        # Step 2: Save estate IDs to file
        self.estates_processor.save_estate_ids_to_txt(estate_ids=self.estate_ids_cache)

        # Step 3: Fetch and process single estate info for each estate ID
        single_estate_infos = self.estates_crawler.fetch_all_single_estate_info()
        if not single_estate_infos:
            housing_logger.error("No single estate info fetched. Aborting pipeline.")
            return

        # Further processing can be added here as needed
        housing_logger.info("Completed estates data pipeline.")
