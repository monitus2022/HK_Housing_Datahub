from logger import housing_logger
from typing import Optional
import requests
from abc import ABC, abstractmethod
import time


class BaseCrawler(ABC):
    """
    Base class for all crawlers
    """
    def __init__(self):
        self.session: Optional[requests.Session] = None
        self.headers: Optional[dict] = None

    def _make_request(
        self, url: str, params: dict = None, retry: int = 3
    ) -> Optional[requests.Response]:
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
                housing_logger.error(
                    f"HTTP error for URL: {url} with params: {params}. Error: {e}. Retry {retry_count}/{retry}"
                )
                time.sleep(2)  # Wait for 2 seconds before retrying
                continue
            except requests.RequestException as e:
                retry_count += 1
                housing_logger.error(
                    f"Request exception for URL: {url} with params: {params}. Error: {e}. Retry {retry_count}/{retry}"
                )
                time.sleep(2)
                continue
            return response
        housing_logger.error(
            f"Failed to fetch URL: {url} with params: {params} after {retry} retries."
        )
        return None

    def test_crawler(self, url: str) -> None:
        """
        Test the crawler by making a request to url and logging the response status
        """
        return self._make_request(url)

    @abstractmethod
    def _set_request_urls(self):
        pass
