from ..base import BaseProcessor
from config import housing_datahub_config
from logger import housing_logger
from abc import abstractmethod
from sqlalchemy import create_engine
import os
import json
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import sessionmaker


class AgencyProcessor(BaseProcessor):
    def __init__(self):
        super().__init__()
        self._set_agency_file_paths()
        self.local_db_path = (
            self.agency_data_storage_path
            / housing_datahub_config.storage.agency.files.get(
                "sqlite_db", "agency_data.db"
            )
        )
        self.remote_db_path = None  # To be set for remote DBs like Neon
        self.engine = create_engine(f"sqlite:///{self.local_db_path}")
        Session = sessionmaker(bind=self.engine)
        self.session = Session()
        self.caches = {}
        # Primary key map for upsert operations
        self.pk_map = {}

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

    @abstractmethod
    def _create_tables(self):
        pass

    @abstractmethod
    def _create_data_cache(self):
        pass

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

    def clear_data_caches(self, cache_excluded: list[str]) -> None:
        """
        Clear all data caches
        """
        for cache_name in self.caches.keys():
            if cache_name not in cache_excluded:
                self.caches[cache_name] = []
        housing_logger.info("Cleared all data caches.")

    def insert_cache_into_db_tables(self, config_maps: list[dict] = None) -> None:
        """
        Insert cached data into database tables
        Using upsert with primary keys to avoid duplicates
        """
        housing_logger.info("Inserting cached data into database estates tables.")

        for table_config in config_maps:
            for cache_name, (_, db_table_class) in table_config.items():
                data_list = self.caches.get(cache_name, [])
                if not data_list:
                    continue
                pk_columns = self.pk_map.get(cache_name, [])
                for data in data_list:
                    stmt = insert(db_table_class).values(**data)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=pk_columns, set_=data
                    )
                    self.session.execute(stmt)
        self.session.commit()
        housing_logger.info("Data insertion completed.")
