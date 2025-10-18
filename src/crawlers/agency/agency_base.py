from ..base import BaseCrawler
from config import housing_datahub_config
from logger import housing_logger
import requests

class AgencyCrawler(BaseCrawler):
    """
    Crawler for HKP APIs
    Dataflow:
    1. Fetch all estate IDs and info from paginated API
    2. For each estate ID, fetch building IDs
    3. For each building ID, fetch building, unit info and transaction history
    Data will be further processed in the processor class
    """
    def __init__(self):
        super().__init__()
        self.headers = dict(housing_datahub_config.agency_api.headers)
        self._set_file_paths()
        self._set_request_urls()
        
        # Init session to persist headers and cookies
        self.session = requests.Session()
        self.session.headers.update(self.headers)

        # Load cookies from file and update with token from config
        self._get_fresh_cookies()

    def _set_file_paths(self) -> None:
        files_path = self.data_storage_path / housing_datahub_config.storage.agency.path
        # self.estate_info_file_path = files_path / housing_datahub_config.storage.files.outputs.estate_info_json
        # self.estate_id_file_path = files_path / housing_datahub_config.storage.files.outputs.estate_id_json
        # self.building_id_file_path = files_path / housing_datahub_config.storage.files.outputs.building_id_json

    def _set_request_urls(self) -> None:
        self.homepage_url = housing_datahub_config.agency_api.urls.homepage
        self.all_estate_info_url = housing_datahub_config.agency_api.urls.all_estate_info
        self.single_estate_info_url = housing_datahub_config.agency_api.urls.single_estate_info
        self.estate_monthly_market_info_url = housing_datahub_config.agency_api.urls.estate_monthly_market_info
        self.building_transactions_url = housing_datahub_config.agency_api.urls.building_transactions

    def _get_fresh_cookies(self):
        """
        Use selenium to get fresh cookies for the session
        """
        cookies = requests.get("https://www.hkp.com.hk").cookies.get_dict()
        self.session.cookies.update(requests.utils.cookiejar_from_dict(cookies))
        housing_logger.info(f"Fresh cookies obtained: {cookies}")
    
    def test_crawler(self):
        """
        Test the crawler by making a request to the homepage and logging the response status
        """
        response = self._make_request(self.homepage_url)
        if response:
            housing_logger.info(f"Successfully accessed {self.homepage_url} with status code {response.status_code}")
        else:
            housing_logger.error(f"Failed to access {self.homepage_url}")
    
    def test_crawler_with_cookies(self):
        """
        Test the crawler by making a request to the homepage with cookies and logging the response status
        """
        response = self._make_request(self.single_estate_info_url.format(estate_id="E000004419"))
        if response:
            housing_logger.info(f"Successfully accessed {self.single_estate_info_url} with cookies, status code {response.status_code}")
        else:
            housing_logger.error(f"Failed to access {self.single_estate_info_url} with cookies")
