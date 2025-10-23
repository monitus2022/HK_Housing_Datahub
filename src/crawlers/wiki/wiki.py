import requests
import asyncio
import aiohttp
from wikipediaapi import Wikipedia, WikipediaPage
from logger import housing_logger
from typing import Optional, Dict
from crawlers.base import BaseCrawler
from models.wiki.request_params import WikiPageRequestParams
from config import housing_datahub_config
import time
from utils import generate_wikipedia_title_variations

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
        self.aio_session = None

    async def __aenter__(self):
        """Async context manager entry."""
        if self.aio_session is None:
            self.aio_session = aiohttp.ClientSession(headers={"User-Agent": "HK_Housing_Datahub_Crawler"})
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.aio_session:
            await self.aio_session.close()
            self.aio_session = None

    def _set_request_urls(self):
        self.base_url = housing_datahub_config.wiki_api.urls.search.format(
            language=self.language
        )

    def _make_request(
        self, url: str, params: dict = None
    ) -> Optional[requests.Response]:
        """Make a request to the API."""
        try:
            response = self.session.get(url, params=params)
            response.raise_for_status()
            return response
        except Exception as e:
            housing_logger.error(f"Request failed: {e}")
            return None

    def get_page_content(self, page_title: str) -> Optional[WikipediaPage]:


        start_time = time.time()
        # Try different title variations to handle case sensitivity
        title_variations = generate_wikipedia_title_variations(page_title)

        for title in title_variations:
            try:
                page = self.wiki.page(title)
                if page.exists():
                    # Check if the page is a disambiguation page by looking for "消歧義" in categories
                    if any("消歧義" in category for category in page.categories):
                        housing_logger.warning(f"Page '{title}' is a disambiguation page, skipping.")
                        continue  # Skip to next variation

                    # Verify the page is related to Hong Kong by checking for "香港" in the text
                    if "香港" not in page.text:
                        housing_logger.warning(f"Page '{title}' does not mention '香港', likely not an HK estate, skipping.")
                        continue  # Skip to next variation

                    fetch_time = time.time() - start_time
                    housing_logger.info(f"Successfully fetched page '{title}' in {fetch_time:.2f}s")
                    return page
            except Exception as e:
                housing_logger.debug(f"Error fetching page '{title}': {e}")
                continue

        # If none of the variations work, log the failure
        fetch_time = time.time() - start_time
        housing_logger.warning(
            f"Page '{page_title}' does not exist in Wikipedia ({self.language}). Tried variations: {title_variations}. Total time: {fetch_time:.2f}s"
        )
        return None

    async def _aio_make_request(self, url: str, params: dict = None) -> Optional[dict]:
        """Make an async request to the API."""
        if self.aio_session is None:
            self.aio_session = aiohttp.ClientSession(headers={"User-Agent": "HK_Housing_Datahub_Crawler"})
        try:
            async with self.aio_session.get(url, params=params) as response:
                response.raise_for_status()
                return await response.json()
        except Exception as e:
            housing_logger.error(f"Async request failed: {e}")
            return None

    async def _fetch_single_section_wikitext(
        self, page_title: str, section_title: str, section_index: int
    ) -> tuple[str, str]:
        """Fetch wikitext for a single section asynchronously."""
        start_time = time.time()
        try:
            api_url = self.base_url
            params = WikiPageRequestParams(
                page=page_title, prop="wikitext", section=section_index
            ).model_dump()
            data = await self._aio_make_request(api_url, params=params)
            if data and "parse" in data and "wikitext" in data["parse"]:
                fetch_time = time.time() - start_time
                # Removed detailed debug logging for cleaner output
                return section_title, data["parse"]["wikitext"]["*"]
            else:
                fetch_time = time.time() - start_time
                housing_logger.warning(f"No data for section wikitext '{section_title}' in {fetch_time:.2f}s")
                return section_title, ""
        except Exception as e:
            fetch_time = time.time() - start_time
            housing_logger.warning(
                f"Failed to fetch section wikitext for '{section_title}': {e}. Time: {fetch_time:.2f}s"
            )
            return section_title, ""

    async def fetch_section_wikitexts_concurrent(
        self, page_content: WikipediaPage
    ) -> Dict[str, str]:
        """Fetch wikitext for all sections concurrently."""
        section_wikitexts = {}

        # Prepare tasks for sections with titles
        tasks = []
        for i, section in enumerate(page_content.sections):
            if section.title:  # Only fetch for sections with titles
                tasks.append(
                    self._fetch_single_section_wikitext(
                        page_content.title, section.title, i
                    )
                )

        # Execute all tasks concurrently
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    housing_logger.error(f"Exception in concurrent fetch: {result}")
                else:
                    section_title, wikitext = result
                    section_wikitexts[section_title] = wikitext

        return section_wikitexts

    def get_section_wikitext(
        self, page_content: WikipediaPage, section_title: str
    ) -> str:
        """Get the raw wikitext for a specific section (synchronous fallback)."""
        start_time = time.time()
        # Find the section index
        section_index = None
        for i, section in enumerate(page_content.sections):
            if section.title == section_title:
                section_index = i
                break
        if section_index is None:
            housing_logger.debug(f"Section '{section_title}' not found in page '{page_content.title}'")
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
                fetch_time = time.time() - start_time
                housing_logger.warning(f"No response for section wikitext '{section_title}' in {fetch_time:.2f}s")
                return ""
            if "parse" in data and "wikitext" in data["parse"]:
                fetch_time = time.time() - start_time
                housing_logger.debug(f"Successfully fetched wikitext for section '{section_title}' in {fetch_time:.2f}s")
                return data["parse"]["wikitext"]["*"]
        except Exception as e:
            fetch_time = time.time() - start_time
            housing_logger.warning(
                f"Failed to fetch section wikitext for '{section_title}': {e}. Time: {fetch_time:.2f}s"
            )

        # Fallback: return parsed text
        fetch_time = time.time() - start_time
        housing_logger.debug(f"Using fallback parsed text for section '{section_title}' in {fetch_time:.2f}s")
        return page_content.sections[section_index].text
