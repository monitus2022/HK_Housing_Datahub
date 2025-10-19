from ..base import BaseProcessor
from config import housing_datahub_config
from logger import housing_logger
from abc import abstractmethod


class AgencyProcessor(BaseProcessor):
    def __init__(self):
        super().__init__()
        self._set_agency_file_paths()

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
    def _create_data_cache(self):
        pass

    def connect_db(self):
        pass
