from crawlers.agency import AgencyCrawler, EstatesCrawler
from processors.agency import EstatesProcessor


def main():
    agency_crawler = AgencyCrawler()
    estates_crawler = EstatesCrawler(agency_crawler=agency_crawler)
    estate_ids = estates_crawler.fetch_all_estate_info_for_estate_ids()  # Print first 10 estate IDs
    estates_processor = EstatesProcessor()
    if estate_ids:
        estates_processor.save_estate_ids_to_txt(estate_ids=estate_ids)
        print(f"First 10 estate IDs: {estate_ids[:10]}")

if __name__ == "__main__":
    main()