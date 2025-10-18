from config import housing_datahub_config
from logger import housing_logger
from typing import Optional
from requests import Response
from pydantic import BaseModel
import pathlib

WORKING_DIR = pathlib.Path(__file__).parent.parent.parent.resolve()


class BaseProcessor:
    """
    Base class for all processors
    """
    def __init__(self):
        self._set_file_paths()
        
    def _set_file_paths(self):
        self.working_dir = WORKING_DIR
        # Set up data storage paths
        self.data_storage_path = self.working_dir / housing_datahub_config.storage.root_path
        if not self.data_storage_path.exists():
            try:
                self.data_storage_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                housing_logger.error(f"Failed to create directory {self.data_storage_path}: {e}")
    
    def _parse_response(
        self, response: Response, model: BaseModel
    ) -> Optional[BaseModel]:
        """
        Parse the JSON response and return as a Pydantic BaseModel
        """
        try:
            data = response.json()
            return model(**data)
        except ValueError as e:
            housing_logger.error(
                f"Failed to parse JSON response to pydantic model: {model.__name__}. Error: {e}"
            )
            return None
