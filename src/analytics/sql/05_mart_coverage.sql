-- Grain: one row per estate.
-- Counts are pre-aggregated to avoid correlated subqueries over 1M+ rows.
DROP TABLE IF EXISTS mart_coverage;

CREATE TABLE mart_coverage AS
WITH building_counts AS (
    SELECT estate_id, count(*) AS building_count
    FROM buildings
    GROUP BY estate_id
),
unit_counts AS (
    SELECT b.estate_id, count(*) AS unit_count
    FROM units u
    JOIN buildings b ON u.building_id = b.building_id
    GROUP BY b.estate_id
),
transaction_counts AS (
    SELECT
        b.estate_id,
        count(*) AS tx_count,
        max(date(t.tx_date)) AS last_tx_date
    FROM transactions t
    JOIN units u ON t.unit_id = u.unit_id
    JOIN buildings b ON u.building_id = b.building_id
    GROUP BY b.estate_id
),
market AS (
    SELECT DISTINCT estate_id
    FROM estate_monthly_market_info
)
SELECT
    e.estate_id,
    e.estate_name_en,
    e.district_id,
    1 AS has_estate_info,
    CASE WHEN market.estate_id IS NOT NULL THEN 1 ELSE 0 END AS has_market,
    CASE WHEN transaction_counts.estate_id IS NOT NULL
         THEN 1 ELSE 0 END AS has_transactions,
    transaction_counts.last_tx_date,
    COALESCE(building_counts.building_count, 0) AS building_count,
    COALESCE(unit_counts.unit_count, 0) AS unit_count,
    COALESCE(transaction_counts.tx_count, 0) AS tx_count,
    CASE WHEN w.estate_name IS NOT NULL THEN 1 ELSE 0 END AS has_wiki
FROM estates e
LEFT JOIN building_counts
    ON e.estate_id = building_counts.estate_id
LEFT JOIN unit_counts
    ON e.estate_id = unit_counts.estate_id
LEFT JOIN transaction_counts
    ON e.estate_id = transaction_counts.estate_id
LEFT JOIN market
    ON e.estate_id = market.estate_id
LEFT JOIN wiki_estates w
    ON e.estate_name_zh = w.estate_name;
