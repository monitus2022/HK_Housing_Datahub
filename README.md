# HK_Housing_Datahub

A comprehensive ETL pipeline that crawls, processes, and stores Hong Kong housing data from multiple sources including Hong Kong Property APIs and Wikipedia. Features include structured data storage in SQLite/PostgreSQL, text embeddings for RAG applications, and cloud storage integration. Designed for data analytics, trend visualization, and chatbot development.

## Features

- Multi-source data crawling (HK Property APIs, Wikipedia)
- Structured ETL pipeline with partitioning for large datasets
- Text embeddings for RAG applications using Sentence Transformers and ChromaDB
- Cloud storage integration (Cloudflare R2 or AWS S3)
- Debug mode for development and testing

## Specs

- Data sources:
    - [Hong Kong Property](https://www.hkp.com.hk/zh-hk/list/estate)
    - [Wikipedia](https://www.wikipedia.org/)
    - [Rating and Valuation Department, Hong Kong Gov](https://www.rvd.gov.hk/en/publications/property_market_statistics.html) (To be implemented)
- Data storage:
    - Temporary storage: CSV/JSON files
    - Long-term storage: SQLite DB, Object Storage (Cloudflare R2), Vector DB (ChromaDB)
- Data usage: For data analytics and chatbot application


## API Endpoints

Detailed API endpoint documentation is available in [`docs/api_endpoints.md`](docs/api_endpoints.md).

## Data Flow for Agency API

![Data Flow Diagram](https://github.com/monitus2022/draw.io/blob/main/HK_Housing_Agent-Data%20Source%20-%20Agency.drawio.png?raw=true)



## Setup

### Local Development

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
For MacOS: `greenlet` may require manual installation:
```bash
pip install --only-binary :all: greenlet
```
4. Create a `.env` file in the root directory based on the provided `.env.template` and fill in the necessary details (e.g., API tokens and cloud storage credentials).
5. Run the crawler:
```bash
python src/main.py
```

### Docker Setup

Alternatively, use Docker for containerized deployment:
```bash
docker-compose up --build
```


## Disclaimer
All data listed in examples are public and owned by Hong Kong Property. This project is for educational and non-commercial use only. Please refer to [HKP Terms of Service](https://www.hkp.com.hk/disclaim.html) for more details.
