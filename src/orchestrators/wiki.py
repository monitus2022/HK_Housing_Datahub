from crawlers.wiki import WikiCrawler
from processors.wiki import WikiProcessor
from models.agency.sql_db import Estate
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from config import housing_datahub_config
from logger import housing_logger
import json
import pathlib
import asyncio
from typing import Dict, Any, Optional


class WikiOrchestrator:
    def __init__(self, partition_count: int = 10):
        self.partition_count = partition_count
        self.crawler = WikiCrawler()
        self.wiki_processor = WikiProcessor()
        self.estate_list = []
        self._init_db_connection()
        self._read_estate_list_from_db()

    def _init_db_connection(self):
        """Initialize database connection to read estate data"""
        working_dir = pathlib.Path(__file__).parent.parent.parent.resolve()
        db_path = (
            working_dir
            / housing_datahub_config.storage.root_path
            / housing_datahub_config.storage.agency.path
            / housing_datahub_config.storage.agency.files.get(
                "sqlite_db", "agency_data.db"
            )
        )
        self.engine = create_engine(f"sqlite:///{db_path}")
        Session = sessionmaker(bind=self.engine)
        self.session = Session()

    def _read_estate_list_from_db(self):
        """Read estate list from the estates table in the database"""
        try:
            estates = self.session.query(Estate.estate_name_zh).all()
            self.estate_list = [estate[0] for estate in estates if estate[0]]
            housing_logger.info(
                f"Loaded {len(self.estate_list)} estates from database."
            )
        except Exception as e:
            housing_logger.error(f"Failed to read estates from database: {e}")
            self.estate_list = []
        finally:
            # Close the session to free up database connections
            self.session.close()

    def _flush_partition_to_local(
        self, partition_data: Dict[str, Any], partition_idx: int
    ):
        """Flush partition data to local storage"""
        partition_file_path = (
            self.wiki_processor.wiki_data_storage_path
            / housing_datahub_config.storage.wiki.files["pages"]
        ).format(num=partition_idx)
        try:
            with open(partition_file_path, "w", encoding="utf-8") as f:
                json.dump(partition_data, f, ensure_ascii=False, indent=4)
            housing_logger.info(
                f"Successfully flushed partition {partition_idx} to {partition_file_path}"
            )
        except Exception as e:
            housing_logger.error(
                f"Failed to flush partition {partition_idx} to local: {e}"
            )

    async def _fetch_estate_wiki_data_async(self) -> Dict[str, Any]:
        estate_wiki_data = {}
        housing_logger.info(
            f"Starting to fetch wiki data for {len(self.estate_list)} estates."
        )

        total_estates = len(self.estate_list)
        partition_size = total_estates // self.partition_count
        if partition_size == 0:
            partition_size = (
                1  # Ensure at least 1 estate per partition if total < partition_count
            )

        for partition_idx in range(self.partition_count):
            start_idx = partition_idx * partition_size
            end_idx = (
                start_idx + partition_size
                if partition_idx < self.partition_count - 1
                else total_estates
            )
            partition_estates = self.estate_list[start_idx:end_idx]

            housing_logger.info(
                f"Processing partition {partition_idx + 1}/{self.partition_count} with {len(partition_estates)} estates."
            )

            partition_data = {}
            for estate in partition_estates:
                try:
                    page_content = self.crawler.get_page_content(estate)
                    if not page_content:
                        housing_logger.warning(
                            f"No page content found for estate: {estate}"
                        )
                        continue

                    # Fetch wikitext for all sections concurrently
                    section_wikitexts = (
                        await self.crawler.fetch_section_wikitexts_concurrent(
                            page_content
                        )
                    )

                    # Process the page content with the fetched wikitext data
                    wiki_data = self.wiki_processor.process_page_content(
                        page_content, section_wikitexts
                    )

                    if wiki_data is not None:
                        partition_data[estate] = wiki_data
                    else:
                        housing_logger.warning(
                            f"Failed to process page content for estate: {estate}"
                        )

                except Exception as e:
                    housing_logger.error(f"Failed to process estate '{estate}': {e}")
                    continue

            # Flush partition data to local storage
            if partition_data:
                self._flush_partition_to_local(partition_data, partition_idx)
                estate_wiki_data.update(partition_data)

            housing_logger.info(f"Partition {partition_idx + 1} processed and flushed.")

        successful_count = len(estate_wiki_data)
        total_count = len(self.estate_list)
        housing_logger.info(
            f"Successfully processed {successful_count}/{total_count} estates."
        )
        return estate_wiki_data

    def _fetch_estate_wiki_data(self) -> Dict[str, Any]:
        """Synchronous wrapper for async method."""
        try:
            # Create a new event loop if one doesn't exist
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            # Run the async method with proper session management
            async def run_with_session():
                async with self.crawler:
                    return await self._fetch_estate_wiki_data_async()

            return loop.run_until_complete(run_with_session())

        except Exception as e:
            housing_logger.error(f"Failed to fetch estate wiki data: {e}")
            return {}

    def run_estate_wiki_data_pipeline(self) -> Optional[Dict[str, Any]]:
        try:
            wiki_data = self._fetch_estate_wiki_data()
            if not wiki_data:
                housing_logger.warning("No wiki data was successfully fetched")
                return None

            # Note: Individual partitions are already flushed to local storage in _fetch_estate_wiki_data_async
            # Here we save the complete aggregated data as well
            with open(
                self.wiki_processor.wiki_data_file_path, "w", encoding="utf-8"
            ) as f:
                json.dump(wiki_data, f, ensure_ascii=False, indent=4)
            housing_logger.info(
                f"Successfully saved complete wiki data to {self.wiki_processor.wiki_data_file_path}"
            )
            return wiki_data

        except Exception as e:
            housing_logger.error(f"Failed to run wiki data pipeline: {e}")
            return None
