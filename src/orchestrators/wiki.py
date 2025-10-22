from crawlers.wiki import WikiCrawler
from processors.wiki import WikiProcessor
import json


class WikiOrchestrator:
    def __init__(self):
        self.crawler = WikiCrawler()
        self.processor = WikiProcessor()
        self.estate_list = ["青怡花園", "黃埔花園", "康怡花園"] # placeholder

    def _fetch_estate_wiki_data(self) -> dict:
        estate_wiki_data = {}
        for estate in self.estate_list:
            page_content = self.crawler.get_page_content(estate)
            if not page_content:
                continue
            # Fetch wikitext for all sections that need table parsing
            section_wikitexts = {}
            for section in page_content.sections:
                if not section.title:  # Only fetch for sections with titles
                    continue
                wikitext = self.crawler.get_section_wikitext(
                    page_content, section.title
                )
                if not wikitext:
                    continue
                section_wikitexts[section.title] = wikitext

            # Process the page content with the fetched wikitext data
            wiki_data = self.processor.process_page_content(
                page_content, section_wikitexts
            )
            estate_wiki_data[estate] = wiki_data
        return estate_wiki_data

    def run_estate_wiki_data_pipeline(self):
        wiki_data = self._fetch_estate_wiki_data()
        with open("estate_wiki_data.json", "w", encoding="utf-8") as f:
            json.dump(wiki_data, f, ensure_ascii=False, indent=4)
        return wiki_data
