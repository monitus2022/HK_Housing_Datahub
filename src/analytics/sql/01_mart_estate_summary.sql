-- Grain: one row per estate.
-- "12m" metrics are relative to the latest transaction date in the data,
-- not the wall-clock date, so the snapshot is reproducible.
DROP TABLE IF EXISTS mart_estate_summary;

CREATE TABLE mart_estate_summary AS
WITH data_through AS (
    SELECT date(max(tx_date)) AS as_of_date
    FROM transactions
),
estate_transactions AS (
    SELECT
        e.estate_id,
        t.tx_id,
        date(t.tx_date) AS tx_date,
        t.price,
        t.net_ft_price,
        u.net_area,
        u.bedroom
    FROM transactions t
    JOIN units u ON t.unit_id = u.unit_id
    JOIN buildings b ON u.building_id = b.building_id
    JOIN estates e ON b.estate_id = e.estate_id
),
latest_transaction AS (
    SELECT estate_id, tx_id, tx_date, price, net_ft_price, net_area, bedroom
    FROM (
        SELECT
            estate_id,
            tx_id,
            tx_date,
            price,
            net_ft_price,
            net_area,
            bedroom,
            ROW_NUMBER() OVER (
                PARTITION BY estate_id
                ORDER BY tx_date DESC, tx_id DESC
            ) AS row_number
        FROM estate_transactions
    )
    WHERE row_number = 1
),
transactions_12m AS (
    SELECT
        et.estate_id,
        count(*) AS tx_count_12m,
        avg(
            CASE WHEN et.net_ft_price > 0 THEN et.net_ft_price END
        ) AS avg_net_ft_price_12m
    FROM estate_transactions et
    CROSS JOIN data_through dt
    WHERE et.tx_date > date(dt.as_of_date, '-12 months')
      AND et.tx_date <= dt.as_of_date
    GROUP BY et.estate_id
),
latest_market AS (
    SELECT
        estate_id,
        max(date(record_date)) AS latest_market_date
    FROM estate_monthly_market_info
    GROUP BY estate_id
),
rent_12m AS (
    SELECT
        m.estate_id,
        avg(
            CASE WHEN m.avg_net_ft_rent > 0 THEN m.avg_net_ft_rent END
        ) AS avg_net_ft_rent_12m
    FROM estate_monthly_market_info m
    CROSS JOIN data_through dt
    WHERE date(m.record_date) > date(dt.as_of_date, '-12 months')
      AND date(m.record_date) <= dt.as_of_date
    GROUP BY m.estate_id
),
-- SQLite before 3.44 has no ORDER BY inside group_concat. The DISTINCT
-- subquery is materialised and ordered; the frontend treats the value as a set.
estate_mtr AS (
    SELECT estate_id, group_concat(name, ',') AS mtr_lines
    FROM (
        SELECT DISTINCT estate_id, mtr_line_name_en AS name
        FROM estate_mtr_lines
        ORDER BY estate_id, name
    )
    GROUP BY estate_id
),
estate_school AS (
    SELECT estate_id, group_concat(name, ',') AS school_nets
    FROM (
        SELECT DISTINCT estate_id, school_net_name_en AS name
        FROM estate_school_nets
        ORDER BY estate_id, name
    )
    GROUP BY estate_id
)
SELECT
    e.estate_id,
    e.estate_name_zh,
    e.estate_name_en,
    e.region_id,
    r.region_name_en,
    e.subregion_id,
    sr.subregion_name_en,
    e.district_id,
    d.district_name_en,
    d.district_name_zh,
    e.latitude,
    e.longitude,
    date(e.first_op_date) AS first_op_date,
    date(e.last_op_date) AS last_op_date,
    lt.tx_date AS latest_tx_date,
    lt.price AS latest_tx_price,
    lt.net_ft_price AS latest_tx_net_ft_price,
    lt.net_area AS latest_net_area,
    lt.bedroom AS latest_bedroom,
    COALESCE(t12.tx_count_12m, 0) AS tx_count_12m,
    t12.avg_net_ft_price_12m,
    r12.avg_net_ft_rent_12m,
    lm.latest_market_date,
    em.mtr_lines,
    es.school_nets,
    CASE WHEN lm.estate_id IS NOT NULL THEN 1 ELSE 0 END AS has_market,
    CASE WHEN lt.estate_id IS NOT NULL THEN 1 ELSE 0 END AS has_transactions,
    CASE WHEN w.estate_name IS NOT NULL THEN 1 ELSE 0 END AS has_wiki
FROM estates e
LEFT JOIN regions r ON e.region_id = r.region_id
LEFT JOIN subregions sr ON e.subregion_id = sr.subregion_id
LEFT JOIN districts d ON e.district_id = d.district_id
LEFT JOIN latest_transaction lt ON e.estate_id = lt.estate_id
LEFT JOIN transactions_12m t12 ON e.estate_id = t12.estate_id
LEFT JOIN rent_12m r12 ON e.estate_id = r12.estate_id
LEFT JOIN latest_market lm ON e.estate_id = lm.estate_id
LEFT JOIN estate_mtr em ON e.estate_id = em.estate_id
LEFT JOIN estate_school es ON e.estate_id = es.estate_id
LEFT JOIN wiki_estates w ON e.estate_name_zh = w.estate_name;
