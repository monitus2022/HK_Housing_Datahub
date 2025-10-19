from crawlers.agency import AgencyCrawler, EstatesCrawler
from processors.agency import EstatesProcessor


def main():
    agency_crawler = AgencyCrawler()
    estates_crawler = EstatesCrawler(agency_crawler=agency_crawler)
    print(estates_crawler._fetch_single_estate_info_by_id(estate_id="E000012000", lang="en"))

if __name__ == "__main__":
    main()