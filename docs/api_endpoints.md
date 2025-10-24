# API Endpoints Documentation

This document details the API endpoints used for data collection in the HK Housing Datahub project.

## Agency (Hong Kong Property)

### 1. All Estate Info
- **Endpoint:** `all_estate_info`
- **Description:** Fetches a list of all estates with basic information, including estate IDs, names, and locations.
- **Example URL:** https://data.hkp.com.hk/search/v1/estates?hash=true&lang=en&currency=HKD&unit=feet&search_behavior=normal&limit=10&page=1

### 2. Single Estate Info
- **Endpoint:** `single_estate_info`
- **Description:** Fetches detailed information about a specific estate. Include list of buildings/phases belonged to the estate.
- **Contains detailed text descriptions in chinese version**
- **Example URL:** https://data.hkp.com.hk/info/v1/estates/E000004419?lang=en

### 3. Estate Monthly Market Info
- **Endpoint:** `estate_monthly_market_info`
- **Description:** Fetches monthly market information for a specific estate.
- **Example URL:** https://data.hkp.com.hk/info/v1/market_stat?lang=en&type=estate&monthly=true&est_ids=E000004419

### 4. Building Transactions
- **Endpoint:** `building_transactions`
- **Description:** Fetches transaction records for each units in a specific building/phase.
- **Example URL:** https://data.hkp.com.hk/info/v1/transactions/buildings/B000063458?lang=zh-hk&firsthand=false

### Other currently unused endpoints
- Transactions by district: https://data.hkp.com.hk/search/v1/transactions?lang=zh-hk&dist_ids=200902&tx_type=S&tx_date=3year&page=1&limit=5

## Wiki

- **Endpoint:** Wikipedia API
- **Description:** Fetches information from Wikipedia pages related to Hong Kong housing estates by name.
- **Example URL - Get sections from a page:** [https://zh.wikipedia.org/w/api.php?action=parse&page=%E6%B5%B7%E6%80%A1%E5%8D%8A%E5%B3%B6&prop=sections&format=json](https://zh.wikipedia.org/w/api.php?action=parse&page=%E6%B5%B7%E6%80%A1%E5%8D%8A%E5%B3%B6&prop=sections&format=json)