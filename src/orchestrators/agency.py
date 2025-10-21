from typing import Optional
from crawlers.agency import AgencyCrawler, EstatesCrawler, BuildingsCrawler
from models.agency.responses import (
    BuildingInfoResponse,
    EstateMonthlyMarketInfoResponse,
)
from processors.agency import EstatesProcessor, BuildingsProcessor
from logger import housing_logger
import time
from utils import partition_ids


class AgencyOrchestrator:
    """
    Orchestrates the crawling and processing of agency data.
    """

    def __init__(self, debug_mode: bool = False, partition_size: int = 100):
        self._init_crawlers()
        self._init_processors()
        self.debug_mode = debug_mode
        self.debug_estate_limit = 20  # Limit number of estates to process in debug mode

        self.partition_size = partition_size  # For batch processing

    def _init_crawlers(self):
        self.agency_crawler = AgencyCrawler()
        self.agency_session = self.agency_crawler.request_session
        self.estates_crawler = EstatesCrawler(agency_session=self.agency_session)
        self.buildings_crawler = BuildingsCrawler(agency_session=self.agency_session)

    def _init_processors(self):
        self.estates_processor = EstatesProcessor()
        self.buildings_processor = BuildingsProcessor()

    def run_estates_info_data_pipeline(self) -> None:
        """
        Run the complete data pipeline for estates data.
        """
        housing_logger.info("Starting estates data pipeline.")

        # Step 1: Fetch all estate IDs
        housing_logger.info("#1 Fetching all estate IDs.")
        self._estate_ids()

        # Large volume data, partition processing required
        partitioned_estate_ids = partition_ids(
            self.estates_processor.caches["estate_ids_cache"], self.partition_size
        )
        # Step 2: Fetch and process single estate info for each estate ID in zh and en
        # Step 3: Fetch estate monthly market info
        housing_logger.info("#2 Fetching and processing single estate info.")
        housing_logger.info("#3 Fetching and processing estate monthly market info.")
        for idx, estate_id_partition in enumerate(partitioned_estate_ids):
            housing_logger.info(
                f"Processing estate monthly market info partition {idx + 1} / {len(partitioned_estate_ids)}."
            )
            self._estate_infos(estate_ids=estate_id_partition)
            self._estate_monthly_market_infos(estate_ids=estate_id_partition)
            housing_logger.info(
                f"Completed processing partition {idx + 1} / {len(partitioned_estate_ids)}."
            )

        # Step 4: Fetch buildings transaction info
        housing_logger.info("#4 Fetching and processing buildings transaction info.")
        partitioned_building_ids = partition_ids(
            self.estates_processor.caches["building_ids_cache"], self.partition_size
        )
        for idx, building_id_partition in enumerate(partitioned_building_ids):
            housing_logger.info(
                f"Processing building info partition {idx + 1} / {len(partitioned_building_ids)}."
            )
            self._buildings(building_ids=building_id_partition)
            housing_logger.info(
                f"Completed processing partition {idx + 1} / {len(partitioned_building_ids)}."
            )
        housing_logger.info(
            "#4 Completed fetching and processing buildings transaction info."
        )

        housing_logger.info("Completed estates data pipeline.")

    def _estate_ids(self) -> None:
        if not self.estates_processor.caches["estate_ids_cache"]:
            housing_logger.info("No local estate IDs cache found. Fetching from API.")
            self.estates_processor.caches["estate_ids_cache"] = (
                self.estates_crawler.fetch_estate_ids_from_all_estate_info()
            )
            self.estates_processor.save_estate_ids_to_txt()
            housing_logger.info(
                f"Fetched {len(self.estates_processor.caches['estate_ids_cache'])} estate IDs."
            )

        # Debug: Limit to first estates
        if self.debug_mode:
            self.estates_processor.caches["estate_ids_cache"] = (
                self.estates_processor.caches["estate_ids_cache"][
                    : self.debug_estate_limit
                ]
            )

    def _estate_infos(self, estate_ids: list[str]) -> None:
        for estate_id in estate_ids:
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
            time.sleep(0.1)
        # After processing all estates in the partition, create building IDs cache
        self.estates_processor.create_building_ids_cache_from_building_cache()

        # Push to db and clear caches
        self.estates_processor.insert_cache_into_db_tables(
            config_maps=[self.estates_processor.zh_table_configs, self.estates_processor.table_configs]
        )
        self.estates_processor.clear_data_caches(
            cache_excluded=[
                "building_ids_cache",
            ]
        )

    def _estate_monthly_market_infos(self, estate_ids: list[str]) -> None:
        for estate_id in estate_ids:
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
            time.sleep(0.1)
        
        # Push to db and clear caches
        self.estates_processor.insert_cache_into_db_tables(
            config_maps=[self.estates_processor.zh_table_configs, self.estates_processor.table_configs]
        )
        self.estates_processor.clear_data_caches(
            cache_excluded=[
                "building_ids_cache",
            ]
        )

    def _buildings(self, building_ids: list[str]) -> None:
        if not building_ids:
            housing_logger.warning("No building IDs found to process.")
            return

        buildings: Optional[list[BuildingInfoResponse]] = (
            self.buildings_crawler.fetch_buildings_by_building_ids(
                building_ids=building_ids
            )
        )
        for building in buildings:
            self.buildings_processor.map_building_info_response_to_table_dicts(
                building_info_response=building
            )

        # Push to db and clear caches
        self.buildings_processor.insert_cache_into_db_tables(
            config_maps=[self.buildings_processor.zh_table_configs]
        )
        self.buildings_processor.clear_data_caches(cache_excluded=[])
