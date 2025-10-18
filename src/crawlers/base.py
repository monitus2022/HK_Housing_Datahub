from config import housing_crawler_config
from logger import housing_logger
import pathlib
from typing import Optional
import requests
from abc import ABC, abstractmethod
import time

class BaseCrawler(ABC):
    def __init__(self):
        self.working_dir = pathlib.Path(__file__).parent.parent.parent.resolve()
        # Set up data storage paths
        self.data_storage_path = self.working_dir / housing_crawler_config.storage.root_path
        self.files_path = self.data_storage_path / housing_crawler_config.storage.files.path
        for path in [self.data_storage_path, self.files_path]:
            if not path.exists():
                try:
                    path.mkdir(parents=True, exist_ok=True)
                except Exception as e:
                    housing_logger.error(f"Failed to create directory {path}: {e}")
        self.session: Optional[requests.Session] = None
        self.headers: Optional[dict] = None

    def _make_request(self, url: str, params: dict = None, retry: int = 3) -> Optional[requests.Response]:
        """
        Make a GET request to the specified URL with the given parameters. Retry on failure up to 'retry' times.
        """
        retry_count = 0
        while retry_count < retry:
            response = self.session.get(url, params=params)
            try:
                response.raise_for_status()
            except requests.HTTPError as e:
                retry_count += 1
                housing_logger.error(f"HTTP error for URL: {url} with params: {params}. Error: {e}. Retry {retry_count}/{retry}")
                time.sleep(2)  # Wait for 2 seconds before retrying
                continue
            except requests.RequestException as e:
                retry_count += 1
                housing_logger.error(f"Request exception for URL: {url} with params: {params}. Error: {e}. Retry {retry_count}/{retry}")
                time.sleep(2)
                continue
            return response
        housing_logger.error(f"Failed to fetch URL: {url} with params: {params} after {retry} retries.")
        return None
    
    @abstractmethod
    def _set_file_paths(self):
        pass

    @abstractmethod
    def _set_request_urls(self):
        pass