-- Lookup indexes on the materialized marts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_estate_summary_estate_id
    ON mart_estate_summary(estate_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_district_monthly_district_month
    ON mart_district_monthly(district_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_estate_monthly_estate_month
    ON mart_estate_monthly(estate_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_transaction_recent_tx_id
    ON mart_transaction_recent(tx_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_coverage_estate_id
    ON mart_coverage(estate_id);
