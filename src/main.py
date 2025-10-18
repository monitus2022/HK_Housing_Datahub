from config import housing_datahub_config
from logger import housing_logger
from crawlers import AgencyCrawler


def main():
    crawler = AgencyCrawler()
    crawler.test_crawler_with_cookies()

if __name__ == "__main__":
    main()