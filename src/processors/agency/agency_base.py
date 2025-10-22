from ..base import BaseProcessor
from config import housing_datahub_config
from logger import housing_logger
from abc import abstractmethod
from sqlalchemy import create_engine, text
import os
import json
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import sessionmaker
from time import time
from collections import defaultdict


class AgencyProcessor(BaseProcessor):
    def __init__(self):
        super().__init__()
        self._set_agency_file_paths()
        self._init_sql_db()
        # Primary key map for upsert operations
        self.pk_map = {}

    @abstractmethod
    def _create_tables(self):
        pass

    @abstractmethod
    def _create_data_cache(self):
        pass

    def _set_agency_file_paths(self) -> None:
        self.agency_data_storage_path = (
            self.data_storage_path / housing_datahub_config.storage.agency.path
        )
        if not self.agency_data_storage_path.exists():
            try:
                self.agency_data_storage_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                housing_logger.error(
                    f"Failed to create directory {self.agency_data_storage_path}: {e}"
                )
        self.estate_ids_file_path = (
            self.agency_data_storage_path
            / housing_datahub_config.storage.agency.files.get(
                "estate_ids", "estate_ids.txt"
            )
        )

    def _init_sql_db(self) -> None:
        """
        Initialize SQL database connection and session
        """
        self.local_db_path = (
            self.agency_data_storage_path
            / housing_datahub_config.storage.agency.files.get(
                "sqlite_db", "agency_data.db"
            )
        )
        self.remote_db_path = None  # To be set for remote DBs like Neon
        self.engine = create_engine(f"sqlite:///{self.local_db_path}")
        # Enable WAL mode for better concurrency
        with self.engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL;"))
            housing_logger.info("Enabled WAL journal mode for SQLite database.")
            conn.commit()
        Session = sessionmaker(bind=self.engine)
        self.session = Session()

    def export_data_caches_to_json(self) -> None:
        """
        Export data caches to JSON files for inspection
        """
        output_directory = self.agency_data_storage_path / "data_cache_exports"
        os.makedirs(output_directory, exist_ok=True)

        for cache_name, data_list in self.caches.items():
            output_file_path = os.path.join(output_directory, f"{cache_name}.json")
            with open(output_file_path, "w", encoding="utf-8") as f:
                json.dump(data_list, f, ensure_ascii=False, indent=4)
            housing_logger.info(f"Exported {cache_name} to {output_file_path}.")

    def insert_cache_into_db_tables(self, config_maps: list[dict] = None) -> None:
        """
        Bulk upsert cached data into database tables
        Using bulk INSERT with on_conflict_do_nothing to avoid duplicates
        """
        housing_logger.info("Bulk upserting cached data into database tables.")
        table_data = defaultdict(list)

        for table_config in config_maps:
            for cache_name, (_, db_table_class) in table_config.items():
                data_list = self.caches.get(cache_name, [])
                if data_list:
                    table_data[db_table_class].extend(data_list)

        for db_table_class, data_list in table_data.items():
            if data_list:
                start_time = time()
                stmt = insert(db_table_class).values(data_list).on_conflict_do_nothing()
                self.session.execute(stmt)
                end_time = time()
                housing_logger.debug(
                    f"Bulk upserted {len(data_list)} records into {db_table_class.__tablename__} in {end_time - start_time:.2f} seconds."
                )

        self.session.commit()
        housing_logger.info("Bulk data upsertion completed.")

    def bulk_insert_cache_into_db_tables(self, config_maps: list[dict] = None) -> None:
        """
        Bulk insert cached data into database tables without upsert
        Suitable for tables where duplicates are not a concern
        """
        housing_logger.info("Bulk inserting cached data into database tables.")

        for table_config in config_maps:
            for cache_name, (_, db_table_class) in table_config.items():
                data_list = self.caches.get(cache_name, [])
                if not data_list:
                    continue
                objects = [db_table_class(**data) for data in data_list]
                self.session.bulk_save_objects(objects)
            self.session.commit()
        housing_logger.info("Bulk data insertion completed.")
