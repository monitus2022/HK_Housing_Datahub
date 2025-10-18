# HK_Housing_Datahub

A web crawler and ETL pipeline to collect, store, and manage housing data from Hong Kong Property and other sources. The data is stored in a structured format for easy access and analysis, enabling users to visualize trends and build applications such as chatbots.

## Specs

- Data sources:
    - [Hong Kong Property](https://www.hkp.com.hk/zh-hk/list/estate)
    - [Rating and Valuation Department, Hong Kong Gov](https://www.rvd.gov.hk/en/publications/property_market_statistics.html)
    - [Wikipedia](https://www.wikipedia.org/)
- Data storage: 
    - Temporary storage: CSV/JSON files
    - Long-term storage: Cloud PostgreSQL DB, Object Storage (files and vector DB)
- Data usage: For data analytics and chatbot application


## API Endpoint Used and Examples

## Agency (Hong Kong Property)

### 1. All Estate Info
- **Endpoint:** `all_estate_info`
- Description: Fetches a list of all estates with basic information, including estate IDs, names, and locations.
- Example URL: https://data.hkp.com.hk/search/v1/estates?hash=true&lang=en&currency=HKD&unit=feet&search_behavior=normal&limit=10&page=1

### 2. Single Estate Info
- **Endpoint:** `single_estate_info`
- Description: Fetches detailed information about a specific estate. Include list of buildings/phases belonged to the estate.
- Contains detailed text descriptions in chinese version
- Example URL: https://data.hkp.com.hk/info/v1/estates/E000004419?lang=en

### 3. Estate Monthly Market Info
- **Endpoint:** `estate_monthly_market_info`
- Description: Fetches monthly market information for a specific estate.
- Example URL: https://data.hkp.com.hk/info/v1/market_stat?lang=en&type=estate&monthly=true&est_ids=E000004419

### 4. Building Transactions
- **Endpoint:** `building_transactions`
- Description: Fetches transaction records for each units in a specific building/phase.
- Example URL: https://data.hkp.com.hk/info/v1/transactions/buildings/B000063458?lang=zh-hk&firsthand=false

### Other currently unused endpoints
- Transactions by district: https://data.hkp.com.hk/search/v1/transactions?lang=zh-hk&dist_ids=200902&tx_type=S&tx_date=3year&page=1&limit=5


## Data Flow
![Data Flow Diagram](https://github.com/monitus2022/draw.io/blob/main/HK_Housing_Agent-Data%20Source%20-%20Agency.drawio.png?raw=true)


## Setup

1. Clone the repository.
2. Create a virtual env:
```bash
python3 -m venv venv
source venv/bin/activate
```
3. Install dependencies:
```bash
pip install -r requirements.txt
```
4. Create a `.env` file in the root directory based on the provided `.env.template` and fill in the necessary details (e.g., API tokens).
5. Run the crawler:
```bash
python src/main.py
```


## Disclaimer
All data listed in examples are public and owned by Hong Kong Property. This project is for educational and non-commercial use only. Respect API provider and do not abuse the service. Please refer to [HKP Terms of Service](https://www.hkp.com.hk/disclaim.html) for more details.
