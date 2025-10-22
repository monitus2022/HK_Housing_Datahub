import requests
from wikipediaapi import Wikipedia, ExtractFormat, WikipediaPage
from logger import housing_logger
from typing import Optional
from crawlers.base import BaseCrawler
from models.wiki.request_params import WikiPageRequestParams
import re


class WikiCrawler(BaseCrawler):
    """
    Wikipedia Crawler to fetch Estate information.
    Get page content and raw wikitext from Wikipedia.
    """

    def __init__(self, language: str = "zh"):
        super().__init__()
        self.language = language
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "HK_Housing_Datahub_Crawler"})
        self.wiki = Wikipedia(
            user_agent="HK_Housing_Datahub_Crawler", language=self.language
        )
        self._set_request_urls()

    def _set_request_urls(self):
        self.base_url = f"https://{self.language}.wikipedia.org/w/api.php"

    def _make_request(self, url: str, params: dict = None) -> Optional[requests.Response]:
        """Make a request to the API."""
        try:
            response = self.session.get(url, params=params)
            response.raise_for_status()
            return response
        except Exception as e:
            housing_logger.error(f"Request failed: {e}")
            return None

    def get_page_content(self, page_title: str) -> Optional[WikipediaPage]:
        try:
            page = self.wiki.page(page_title)
        except Exception as e:
            housing_logger.error(f"Error fetching page '{page_title}': {e}")
            return None
        if not page.exists():
            housing_logger.warning(
                f"Page '{page_title}' does not exist in Wikipedia ({self.language})."
            )
            return None
        return page

    def get_section_wikitext(
        self, page_content: WikipediaPage, section_title: str
    ) -> str:
        """Get the raw wikitext for a specific section."""
        # Find the section index
        section_index = None
        for i, section in enumerate(page_content.sections):
            if section.title == section_title:
                section_index = i
                break
        if section_index is None:
            return ""

        # Fetch section wikitext via MediaWiki API
        try:
            api_url = self.base_url
            params = WikiPageRequestParams(
                page=page_content.title, prop="wikitext", section=section_index
            ).model_dump()
            response = self._make_request(api_url, params=params)
            if response:
                data = response.json()
            else:
                return ""
            if "parse" in data and "wikitext" in data["parse"]:
                return data["parse"]["wikitext"]["*"]
        except Exception as e:
            housing_logger.warning(
                f"Failed to fetch section wikitext for '{section_title}': {e}"
            )

        # Fallback: return parsed text
        return page_content.sections[section_index].text
