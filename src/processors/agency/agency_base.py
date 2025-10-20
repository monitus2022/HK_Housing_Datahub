from ..base import BaseProcessor
from config import housing_datahub_config
from logger import housing_logger
from abc import abstractmethod
from sqlalchemy import create_engine


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
        self.caches = {}

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
    def insert_cache_into_db_tables(self):
        pass

    @abstractmethod
    def _create_data_cache(self):
        pass

