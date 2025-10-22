from config import housing_datahub_config
from logger import housing_logger
import pathlib

WORKING_DIR = pathlib.Path(__file__).parent.parent.parent.resolve()


class BaseProcessor:
    """
    Base class for all processors
    """
    def __init__(self):
        self._set_file_paths()
        self.caches = {}
        
    def _set_file_paths(self):
        self.working_dir = WORKING_DIR
        # Set up data storage paths
        self.data_storage_path = self.working_dir / housing_datahub_config.storage.root_path
        if not self.data_storage_path.exists():
            try:
                self.data_storage_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                housing_logger.error(f"Failed to create directory {self.data_storage_path}: {e}")

    def clear_data_caches(self, cache_excluded: list[str]) -> None:
        """
        Clear all data caches
        """
        for cache_name in self.caches.keys():
            if cache_name not in cache_excluded:
                self.caches[cache_name] = []
        housing_logger.info("Cleared all data caches.")