from ..base import BaseCrawler
from config import housing_datahub_config
from logger import housing_logger
import requests


class AgencyCrawler(BaseCrawler):
    """
    Crawler for HKP APIs
    Dataflow:
    1. Fetch all estate IDs from paginated API
    2. For each estate ID, fetch estate infos and building IDs
    3. For each building ID, fetch building, unit info and transaction history

    Crawler class is initialized globally to maintain session with cookies
    """

    def __init__(self):
        super().__init__()
        self.headers = dict(housing_datahub_config.agency_api.headers)
        self._set_request_urls()

        # Init session to persist headers and cookies
        self.session = requests.Session()
        self.session.headers.update(self.headers)

        # Fetch fresh cookies and update session
        self.get_fresh_cookies()
        self.test_crawler(url=self.homepage_url)

    def _set_request_urls(self) -> None:
        self.homepage_url = housing_datahub_config.agency_api.urls.homepage
        self.all_estate_info_url = (
            housing_datahub_config.agency_api.urls.all_estate_info
        )
        self.single_estate_info_url = (
            housing_datahub_config.agency_api.urls.single_estate_info
        )
        self.estate_monthly_market_info_url = (
            housing_datahub_config.agency_api.urls.estate_monthly_market_info
        )
        self.building_transactions_url = (
            housing_datahub_config.agency_api.urls.building_transactions
        )

    def get_fresh_cookies(self):
        """
        Use selenium to get fresh cookies for the session
        """
        cookies = requests.get(self.homepage_url).cookies.get_dict()
        self.session.cookies.update(requests.utils.cookiejar_from_dict(cookies))
        housing_logger.info(
            f"Fresh cookies obtained from {self.homepage_url}: {cookies.keys()}"
        )
