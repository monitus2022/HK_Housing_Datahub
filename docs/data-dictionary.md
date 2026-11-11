# Data Dictionary

This document explains the grain, keys, and caveats of the current SQLite
model. The ER diagram is [`db.dbml`](db.dbml); the SQLAlchemy models in
`src/models/agency/sql_db.py` are the source of truth. `pipeline_runs` and the
five analytics marts are current tables; only the deferred ML mart is planned.

All row counts below are from the 2026-11-09 baseline snapshot in
[`baseline-stats.md`](baseline-stats.md).

## Entity groups

```text
regions
  └─ subregions
       └─ districts
            └─ estates
                 ├─ estate_school_nets
                 ├─ estate_facilities ── facilities
                 ├─ estate_mtr_lines
                 ├─ estate_monthly_market_info
                 ├─ phases
                 │    └─ buildings
                 │         └─ units
                 │              ├─ unit_features
                 │              └─ transactions
```

## Location hierarchy

### `regions`

Grain: one row per region. Primary key: `region_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `region_id` | text | no | HKP region ID |
| `region_name_zh` | text | no | Chinese name |
| `region_name_en` | text | no | English name |

Rows: 3.

### `subregions`

Grain: one row per subregion. Primary key: `subregion_id`. Foreign key:
`region_id → regions.region_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `subregion_id` | text | no | HKP subregion ID |
| `subregion_name_zh` | text | no | Chinese name |
| `subregion_name_en` | text | no | English name |
| `region_id` | text | no | Parent region |

Rows: 20.

### `districts`

Grain: one row per district. Primary key: `district_id`. Foreign key:
`subregion_id → subregions.subregion_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `district_id` | text | no | HKP district ID |
| `district_name_zh` | text | no | Chinese name |
| `district_name_en` | text | no | English name |
| `subregion_id` | text | no | Parent subregion |

Rows: 60.

## Estates

### `estates`

Grain: one row per estate. Primary key: `estate_id`. Foreign keys to
`regions`, `subregions`, and `districts`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `estate_id` | text | no | HKP estate ID, usually `E…` |
| `estate_name_zh` | text | no | Chinese name |
| `estate_name_en` | text | no | English name |
| `region_id` | text | no | Region |
| `subregion_id` | text | no | Subregion |
| `district_id` | text | no | District |
| `address_zh` | text | yes | Chinese address |
| `address_en` | text | no | English address; empty when the source omits it |
| `first_op_date` | datetime | yes | First occupation date |
| `last_op_date` | datetime | yes | Last occupation date |
| `latitude` | real | yes | WGS84 latitude |
| `longitude` | real | yes | WGS84 longitude |

Rows: 9,748. Coverage: 6,638 have transactions, 5,292 have monthly market
data, 8,856 have `first_op_date`, and 9,116 have coordinates.

### `estate_school_nets`

Grain: one row per estate × primary-school net. Composite primary key:
(`estate_id`, `school_net_id`). Foreign key: `estate_id → estates.estate_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `estate_id` | text | no | Estate |
| `school_net_id` | text | no | Primary-school net ID |
| `school_net_name_zh` | text | no | Secondary-school net name, Chinese |
| `school_net_name_en` | text | no | Secondary-school net name, English |

Rows: 9,219 distinct estate/net pairs across 9,219 estates. The table name says
"school net"; the ID is the primary-school net and the name is taken from the
secondary-school net in the source payload.

### `estate_facilities`

Grain: one row per estate × facility. Composite primary key:
(`estate_id`, `facility_id`). Foreign keys to `estates` and `facilities`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `estate_id` | text | no | Estate |
| `facility_id` | text | no | Facility |

Rows: 4,257.

### `facilities`

Grain: one row per facility. Primary key: `facility_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `facility_id` | text | no | Facility ID |
| `facility_name_zh` | text | yes | Chinese name |
| `facility_name_en` | text | no | English name |

Rows: 9. The lookup is small in the current snapshot; facility coverage is
1,089 estates.

### `estate_mtr_lines`

Grain: one row per estate × MTR line. Composite primary key:
(`estate_id`, `mtr_line_name_en`). Foreign key: `estate_id → estates.estate_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `estate_id` | text | no | Estate |
| `mtr_line_name_zh` | text | yes | Chinese line name |
| `mtr_line_name_en` | text | no | English line name |

Rows: 1,780 across 1,773 estates in the refreshed DB. **Caveat:** each ingest kept only the first MTR line returned for an estate,
so the table may be missing later lines for some estates. The mart aggregates
every stored row.

### `estate_monthly_market_info`

Grain: one row per estate × month. Composite primary key:
(`estate_id`, `record_date`). Foreign key: `estate_id → estates.estate_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `estate_id` | text | no | Estate |
| `record_date` | datetime | no | Month-end record date |
| `avg_ft_price` | real | yes | Average sale price per gross ft |
| `avg_net_ft_price` | real | yes | Average sale price per net ft |
| `max_ft_price` | real | yes | Max sale price per gross ft |
| `min_ft_price` | real | yes | Min sale price per gross ft |
| `max_net_ft_price` | real | yes | Max sale price per net ft |
| `min_net_ft_price` | real | yes | Min sale price per net ft |
| `avg_ft_rent` | real | yes | Average rent per gross ft |
| `avg_net_ft_rent` | real | yes | Average rent per net ft |
| `max_ft_rent` | real | yes | Max rent per gross ft |
| `min_ft_rent` | real | yes | Min rent per gross ft |
| `max_net_ft_rent` | real | yes | Max rent per net ft |
| `min_net_ft_rent` | real | yes | Min rent per net ft |
| `total_tx_count` | integer | yes | Sale transaction count in the month |
| `total_rent_tx_count` | integer | yes | Rent transaction count in the month |
| `total_tx_amount` | real | yes | Total sale amount |
| `total_rent_tx_amount` | real | yes | Total rent amount |

Rows: 476,986 across 5,292 estates. Range: 1996-12 to 2025-08. This table
contains both sale and rent aggregates; do not mix it with unit-level sale
transactions without documenting the grain change.

## Buildings

### `phases`

Grain: one row per phase. Primary key: `phase_id`. Foreign key:
`estate_id → estates.estate_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `phase_id` | text | no | Phase ID |
| `phase_name_zh` | text | no | Chinese name |
| `phase_name_en` | text | no | English name |
| `estate_id` | text | no | Parent estate |

Rows: 516. Small estates may have no phase.

### `buildings`

Grain: one row per building. Primary key: `building_id`. Foreign keys:
`estate_id → estates.estate_id`, `phase_id → phases.phase_id` (nullable).

| Column | Type | Null | Notes |
|---|---|---|---|
| `building_id` | text | no | Building ID |
| `building_name_zh` | text | no | Chinese name |
| `building_name_en` | text | no | English name |
| `estate_id` | text | no | Parent estate |
| `phase_id` | text | yes | Parent phase; null when the estate has no phase |

Rows: 29,911.

## Units and transactions

### `units`

Grain: one row per unit. Primary key: `unit_id`. Foreign key:
`building_id → buildings.building_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `unit_id` | text | no | Unit ID |
| `floor` | text | yes | Raw floor text; may be `G`, `UG`, `LG`, `PH`, `-`, etc. |
| `flat` | text | no | Flat label |
| `area` | real | yes | Gross area |
| `net_area` | real | yes | Net area |
| `bedroom` | integer | yes | Bedroom count, derived from transactions |
| `sitting_room` | integer | yes | Sitting-room count, derived from transactions |
| `building_id` | text | no | Parent building |

Rows: 1,229,204. Coverage: 927,065 have `net_area > 0`; 302,085 have
`net_area <= 0`; 54 are null. `bedroom` is present for 637,891 (51.9%).

### `unit_features`

Grain: one row per unit × feature. Composite primary key:
(`unit_id`, `feature_id`). Foreign key: `unit_id → units.unit_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `unit_id` | text | no | Unit |
| `feature_id` | text | no | Feature ID; the source uses the English name as the ID |
| `feature_name_zh` | text | yes | Chinese feature name |
| `feature_name_en` | text | no | English feature name |

Rows: 563,346 across 338,394 units. This table replaces the stale
`unit_facilities` name in older diagrams.

### `transactions`

Grain: one row per transaction. Primary key: `tx_id`. Foreign key:
`unit_id → units.unit_id`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `tx_id` | text | no | Transaction ID |
| `tx_date` | datetime | no | Transaction date |
| `price` | real | no | Transaction price, HKD |
| `last_tx_date` | datetime | yes | Previous transaction date for the unit |
| `gain` | real | yes | Gain versus the previous transaction |
| `net_ft_price` | real | yes | Price per net sq ft |
| `unit_id` | text | no | Unit |

Rows: 1,071,268 across 719,895 units; 351,373 units have more than one
transaction. Range: 1996-01 to 2025-10-21. There is **no transaction-type
column**; treat the table as sale transactions unless the source is re-audited.
`last_tx_date` and `gain` are transaction outcomes and must not be used as
predictors for earlier rows.

### `rental_transactions`

Grain: one row per rental/lease transaction from HKP's district transaction
search (`tx_type=L`). Primary key: `rental_id`. Rows: 53,038 in the refreshed
DB, covering 2023-11 to 2026-11 across 58 districts.

| Column | Type | Null | Notes |
|---|---|---|---|
| `rental_id` | text | no | Source transaction ID |
| `tx_date` | datetime | no | Rental date |
| `price` | real | no | Monthly rent |
| `net_area` / `area` | real | yes | Net and gross area |
| `net_ft_price` | real | yes | Monthly rent per net sq ft |
| `bedroom` | integer | yes | Bedrooms |
| `estate_id` / `estate_name_en` | text | no / yes | Estate |
| `district_id` / `district_name_en` | text | no / yes | District |
| `phase_id` / `phase_name_en` | text | yes | Phase |
| `building_id` / `building_name_en` | text | yes | Building |
| `source` | text | yes | Listing source |

The district search can return records from adjacent combined districts, so
per-district query counts overlap; `rental_id` deduplicates the stored rows.
HKP only accepts a 1-year or 3-year lookback.

## Run metadata

### `pipeline_runs`

Grain: one row per pipeline run. Primary key: `run_id`. This table is written by
the agency orchestrator (Phase 2); it did not exist in the Phase 0 baseline.

| Column | Type | Null | Notes |
|---|---|---|---|
| `run_id` | text | no | UUID generated per run |
| `started_at` | datetime | no | UTC start time |
| `finished_at` | datetime | yes | UTC finish time |
| `mode` | text | no | `debug` or `full` |
| `status` | text | no | `running`, `success`, or `failed` |
| `record_counts_json` | text | yes | JSON row counts for key tables at finish |
| `error_message` | text | yes | Failure detail |

## Analytics marts

The marts are derived, denormalized tables built from the raw model by
`python scripts/build_marts.py`. They are dropped and recreated on every build;
raw data and columns are never modified. The builder does add dashboard indexes
to raw tables. Row counts below are from the 2026-11-09 reference snapshot
unless marked "refreshed DB"; see `docs/baseline-stats.md` for that baseline.

### `mart_estate_summary`

Grain: one row per estate. Unique key: `estate_id`. Rows: 9,750 (refreshed DB).

| Column | Type | Notes |
|---|---|---|
| `estate_id` | text | Estate key |
| `estate_name_zh` / `estate_name_en` | text | Estate names |
| `region_id` / `region_name_en` | text | Region |
| `subregion_id` / `subregion_name_en` | text | Subregion |
| `district_id` / `district_name_en` / `district_name_zh` | text | District |
| `latitude` / `longitude` | real | Coordinates |
| `first_op_date` / `last_op_date` | date | Normalized dates |
| `latest_tx_date` | date | Latest transaction date |
| `latest_tx_price` | real | Price of the latest transaction |
| `latest_tx_net_ft_price` | real | Net-ft price of the latest transaction |
| `latest_net_area` | real | Net area of the latest transaction |
| `latest_bedroom` | integer | Bedrooms of the latest transaction |
| `mtr_lines` | text | Comma-separated MTR line names (1,773 estates in the refreshed DB) |
| `school_nets` | text | Comma-separated school-net names, which the source takes from the secondary-school net (9,219 estates) |
| `tx_count_12m` | integer | Transactions in the trailing 12 months |
| `avg_net_ft_price_12m` | real | Average sale net-ft price, trailing 12 months |
| `avg_net_ft_rent_12m` | real | Average rental net-ft price, trailing 12 months |
| `rent_count_12m` | integer | Rental transactions in the trailing 12 months |
| `latest_rent_date` / `latest_rent_net_ft_price` | date / real | Latest rental transaction |
| `latest_market_date` | date | Latest monthly market record |
| `has_market` | integer | 1 when market rows exist |
| `has_transactions` | integer | 1 when transactions exist |
| `has_wiki` | integer | 1 when the Chinese estate name matches a wiki JSON key |
| `wiki_title` | text | Chinese Wikipedia page title; `NULL` without a wiki match, falling back to the estate-name key when the payload has no usable title |

Caveats: 12-month windows end at the later of the latest sale and rental
dates in the snapshot, not the wall-clock date. The rent average uses positive rental net-ft prices and
does not weight by rent transaction count. `has_wiki` is an exact name match, so
renamed or variant wiki titles are not linked. `latest_net_area` and
`latest_bedroom` describe the latest transaction only; `mtr_lines` and
`school_nets` are comma-separated and may be empty when the source has no
mapping. The mart aggregates every stored MTR row, but the mapper historically
kept only the first line per ingest, so coverage can lag the source.

### `mart_district_monthly`

Grain: one row per district × calendar month. Unique key:
(`district_id`, `month`). Rows: 19,840 in the refreshed DB.

| Column | Type | Notes |
|---|---|---|
| `district_id` / `district_name_en` / `district_name_zh` | text | District |
| `month` | text | `YYYY-MM` |
| `tx_count` | integer | Sale transactions in the month |
| `avg_net_ft_price` | real | Average sale net-ft price |
| `total_tx_amount` | real | Total sale amount |
| `rent_tx_count` | integer | Rental transactions from HKP (`tx_type=L`) |
| `avg_net_ft_rent` | real | Average monthly rent per net sq ft |
| `total_rent_tx_amount` | real | Total monthly rent amount |

Caveats: sale metrics come from unit transactions; rent metrics come from
`rental_transactions` and cover roughly the last three years. A month can
contain sale data, rent data, or both.

### `mart_estate_monthly`

Grain: one row per estate × calendar month. Unique key:
(`estate_id`, `month`). Rows: 245,017 in the refreshed DB (sale months plus
rental months). The previous published count (662,503) included market-only months whose
rent values were zero; those rows were dropped when rent moved to transactions.

| Column | Type | Notes |
|---|---|---|
| `estate_id` / `estate_name_en` / `district_id` | text | Estate and district |
| `month` | text | `YYYY-MM` |
| `tx_count` | integer | Sale transactions |
| `avg_net_ft_price` | real | Average sale net-ft price |
| `total_tx_amount` | real | Total sale amount |
| `rent_tx_count` | integer | Rental transactions from HKP (`tx_type=L`) |
| `avg_net_ft_rent` | real | Average monthly rent per net sq ft |
| `total_rent_tx_amount` | real | Total rent amount |

Caveats: rent values come from rental transactions and cover roughly three years;
sale months keep the full history. The serving layer exports
it as a compact month-indexed JSON file (~1.3 MB gzipped) for estate views.

### `mart_transaction_recent`

Grain: one row per transaction in the last 24 months. Unique key: `tx_id`.
Rows: 72,900.

| Column | Type | Notes |
|---|---|---|
| `tx_id` | text | Transaction key |
| `tx_date` | date | Normalized transaction date |
| `price` | real | Transaction price |
| `net_ft_price` | real | Price per net sq ft |
| `estate_id` / `estate_name_en` | text | Estate |
| `district_id` / `district_name_en` | text | District |
| `building_id` / `unit_id` | text | Building and unit |
| `area` / `net_area` | real | Gross and net area |
| `bedroom` | integer | Bedroom count, when present |

Caveats: the 24-month window is relative to the latest transaction date in the
snapshot, not the current date. The serving export keeps the display columns
(`tx_date`, `price`, `net_ft_price`, estate and district names/IDs, `area`,
`net_area`, `bedroom`) and drops `tx_id`, `building_id`, and `unit_id`.

### `mart_coverage`

Grain: one row per estate. Unique key: `estate_id`. Rows: 9,750 (refreshed DB).

| Column | Type | Notes |
|---|---|---|
| `estate_id` / `estate_name_en` / `district_id` | text | Estate and district |
| `has_estate_info` | integer | Always 1 for an estate row |
| `has_market` | integer | 1 when market rows exist |
| `has_transactions` | integer | 1 when transactions exist |
| `last_tx_date` | date | Latest transaction date |
| `building_count` | integer | Buildings linked to the estate |
| `unit_count` | integer | Units linked through buildings |
| `tx_count` | integer | Transactions linked through units |
| `has_wiki` | integer | 1 when the Chinese estate name matches a wiki JSON key |

## Dates and timezone

`DateTime` values are stored by SQLite as strings. Many rows display a
`16:00:00` time component because the source dates are Hong Kong local dates
stored through a UTC-adjacent path. Use `date(tx_date)` and
`date(record_date)` in analytics and document the assumption; do not compare
the raw timestamps as if they were midnight UTC.

## Indexes

Phase 5 added idempotent indexes for the dashboard filters:
`transactions(tx_date)`, `transactions(unit_id)`,
`estate_monthly_market_info(estate_id, record_date)`,
`units(building_id)`, and `buildings(estate_id)`.

The rental-ingestion change adds three indexes on `rental_transactions`: `(tx_date)`,
`(district_id, tx_date)`, and `(estate_id, tx_date)`. The marts also have
unique lookup indexes (`idx_mart_*`) on their grain keys.

## Planned tables (not current)

| Table | Phase | Purpose |
|---|---|---|
| `mart_valuation` | ML (deferred) | Estate-level model estimates |

## Caveats that affect analysis

- Scraped data, not an official statistical product.
- Sales are in `transactions`, which has no transaction-type column; rentals
  are in `rental_transactions` (`tx_type=L`).
- `net_area`, `bedroom`, coordinates, and operation dates have meaningful
  missingness.
- `estate_mtr_lines` is not exhaustive.
- `unit_features` uses the source English name as both ID and name.
- Agency upserts and run metadata are implemented (Phase 2). RAG writes are
  idempotent and prune removed chunks (issue #17).
- Wiki JSON and Chroma are not relational tables; their counts are tracked in
  `baseline-stats.md`. The marts use wiki JSON keys for `has_wiki` and expose
  the page `title` as `wiki_title`.
- Mart windows end at the later of the latest sale and rental dates, not today.
  A fresh crawl changes the windows.
