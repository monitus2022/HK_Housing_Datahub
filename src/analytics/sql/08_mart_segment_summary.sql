-- Grain: one row per segment type and value, covering the trailing 12 months.
-- Sale and rent percentiles use positive net-ft prices only. MTR and school-net
-- segments fan out over the estate mappings, so those groups overlap.
DROP TABLE IF EXISTS mart_segment_summary;

CREATE TABLE mart_segment_summary AS
WITH data_through AS (
    SELECT date(max(as_of_date)) AS as_of_date
    FROM (
        SELECT max(tx_date) AS as_of_date FROM transactions
        UNION ALL
        SELECT max(tx_date) AS as_of_date FROM rental_transactions
    )
),
period AS (
    SELECT
        date(as_of_date, '-12 months') AS start_date,
        as_of_date AS end_date
    FROM data_through
),
sale_base AS (
    SELECT
        t.tx_id,
        e.estate_id,
        date(t.tx_date) AS tx_date,
        t.net_ft_price,
        u.net_area,
        u.bedroom,
        e.first_op_date
    FROM transactions t
    JOIN units u ON t.unit_id = u.unit_id
    JOIN buildings b ON u.building_id = b.building_id
    JOIN estates e ON b.estate_id = e.estate_id
    CROSS JOIN period p
    WHERE date(t.tx_date) >= p.start_date
      AND date(t.tx_date) <= p.end_date
      AND t.net_ft_price IS NOT NULL
      AND t.net_ft_price > 0
),
rent_base AS (
    SELECT
        r.rental_id,
        r.estate_id,
        date(r.tx_date) AS tx_date,
        r.net_ft_price,
        r.net_area,
        r.bedroom,
        e.first_op_date
    FROM rental_transactions r
    JOIN estates e ON r.estate_id = e.estate_id
    CROSS JOIN period p
    WHERE date(r.tx_date) >= p.start_date
      AND date(r.tx_date) <= p.end_date
      AND r.net_ft_price IS NOT NULL
      AND r.net_ft_price > 0
),
sale_segments AS (
    SELECT
        'bedroom' AS segment_type,
        CASE
            WHEN bedroom IS NULL OR bedroom < 0 THEN 'Unknown'
            WHEN bedroom <= 1 THEN '0-1'
            WHEN bedroom = 2 THEN '2'
            WHEN bedroom = 3 THEN '3'
            ELSE '4+'
        END AS segment_value,
        estate_id,
        net_ft_price
    FROM sale_base
    UNION ALL
    SELECT
        'area_band' AS segment_type,
        CASE
            WHEN net_area IS NULL OR net_area <= 0 THEN 'Unknown'
            WHEN net_area < 300 THEN '<300'
            WHEN net_area < 500 THEN '300-499'
            WHEN net_area < 700 THEN '500-699'
            WHEN net_area < 1000 THEN '700-999'
            ELSE '1000+'
        END AS segment_value,
        estate_id,
        net_ft_price
    FROM sale_base
    UNION ALL
    SELECT
        'age_band' AS segment_type,
        CASE
            WHEN first_op_date IS NULL THEN 'Unknown'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 10
                THEN '0-10'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 20
                THEN '11-20'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 30
                THEN '21-30'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 40
                THEN '31-40'
            ELSE '40+'
        END AS segment_value,
        sale_base.estate_id,
        sale_base.net_ft_price
    FROM sale_base
    UNION ALL
    SELECT
        'mtr_line' AS segment_type,
        m.mtr_line_name_en AS segment_value,
        sale_base.estate_id,
        sale_base.net_ft_price
    FROM sale_base
    JOIN estate_mtr_lines m ON sale_base.estate_id = m.estate_id
    WHERE m.mtr_line_name_en IS NOT NULL
      AND trim(m.mtr_line_name_en) <> ''
    UNION ALL
    SELECT
        'school_net' AS segment_type,
        s.school_net_name_en AS segment_value,
        sale_base.estate_id,
        sale_base.net_ft_price
    FROM sale_base
    JOIN estate_school_nets s ON sale_base.estate_id = s.estate_id
    WHERE s.school_net_name_en IS NOT NULL
      AND trim(s.school_net_name_en) <> ''
),
rent_segments AS (
    SELECT
        'bedroom' AS segment_type,
        CASE
            WHEN bedroom IS NULL OR bedroom < 0 THEN 'Unknown'
            WHEN bedroom <= 1 THEN '0-1'
            WHEN bedroom = 2 THEN '2'
            WHEN bedroom = 3 THEN '3'
            ELSE '4+'
        END AS segment_value,
        estate_id,
        net_ft_price
    FROM rent_base
    UNION ALL
    SELECT
        'area_band' AS segment_type,
        CASE
            WHEN net_area IS NULL OR net_area <= 0 THEN 'Unknown'
            WHEN net_area < 300 THEN '<300'
            WHEN net_area < 500 THEN '300-499'
            WHEN net_area < 700 THEN '500-699'
            WHEN net_area < 1000 THEN '700-999'
            ELSE '1000+'
        END AS segment_value,
        estate_id,
        net_ft_price
    FROM rent_base
    UNION ALL
    SELECT
        'age_band' AS segment_type,
        CASE
            WHEN first_op_date IS NULL THEN 'Unknown'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 10
                THEN '0-10'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 20
                THEN '11-20'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 30
                THEN '21-30'
            WHEN (julianday(tx_date) - julianday(first_op_date)) / 365.25 <= 40
                THEN '31-40'
            ELSE '40+'
        END AS segment_value,
        rent_base.estate_id,
        rent_base.net_ft_price
    FROM rent_base
    UNION ALL
    SELECT
        'mtr_line' AS segment_type,
        m.mtr_line_name_en AS segment_value,
        rent_base.estate_id,
        rent_base.net_ft_price
    FROM rent_base
    JOIN estate_mtr_lines m ON rent_base.estate_id = m.estate_id
    WHERE m.mtr_line_name_en IS NOT NULL
      AND trim(m.mtr_line_name_en) <> ''
    UNION ALL
    SELECT
        'school_net' AS segment_type,
        s.school_net_name_en AS segment_value,
        rent_base.estate_id,
        rent_base.net_ft_price
    FROM rent_base
    JOIN estate_school_nets s ON rent_base.estate_id = s.estate_id
    WHERE s.school_net_name_en IS NOT NULL
      AND trim(s.school_net_name_en) <> ''
),
segments AS (
    SELECT segment_type, segment_value, 'sale' AS kind, estate_id, net_ft_price
    FROM sale_segments
    UNION ALL
    SELECT segment_type, segment_value, 'rent' AS kind, estate_id, net_ft_price
    FROM rent_segments
),
ranked AS (
    SELECT
        segment_type,
        segment_value,
        kind,
        estate_id,
        net_ft_price,
        row_number() OVER (
            PARTITION BY segment_type, segment_value, kind
            ORDER BY net_ft_price
        ) AS rn,
        count(*) OVER (
            PARTITION BY segment_type, segment_value, kind
        ) AS cnt
    FROM segments
),
aggregated AS (
    SELECT
        segment_type,
        segment_value,
        kind,
        count(*) AS tx_count,
        count(DISTINCT estate_id) AS estate_count,
        avg(
            CASE
                WHEN rn = (cnt * 25 + 99) / 100 THEN net_ft_price
            END
        ) AS p25,
        avg(
            CASE
                WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN net_ft_price
            END
        ) AS median,
        avg(
            CASE
                WHEN rn = (cnt * 75 + 99) / 100 THEN net_ft_price
            END
        ) AS p75
    FROM ranked
    GROUP BY segment_type, segment_value, kind
),
combined AS (
    SELECT
        segment_type,
        segment_value,
        max(CASE WHEN kind = 'sale' THEN tx_count END) AS sale_count,
        max(CASE WHEN kind = 'sale' THEN estate_count END) AS sale_estates,
        max(CASE WHEN kind = 'sale' THEN p25 END) AS sale_p25,
        max(CASE WHEN kind = 'sale' THEN median END) AS sale_median,
        max(CASE WHEN kind = 'sale' THEN p75 END) AS sale_p75,
        max(CASE WHEN kind = 'rent' THEN tx_count END) AS rent_count,
        max(CASE WHEN kind = 'rent' THEN estate_count END) AS rent_estates,
        max(CASE WHEN kind = 'rent' THEN p25 END) AS rent_p25,
        max(CASE WHEN kind = 'rent' THEN median END) AS rent_median,
        max(CASE WHEN kind = 'rent' THEN p75 END) AS rent_p75
    FROM aggregated
    GROUP BY segment_type, segment_value
)
SELECT
    combined.*,
    period.start_date AS window_start,
    period.end_date AS window_end,
    CASE
        WHEN combined.sale_median > 0
         AND combined.rent_median IS NOT NULL
        THEN combined.rent_median * 12.0 / combined.sale_median * 100.0
    END AS gross_yield_pct
FROM combined
CROSS JOIN period
ORDER BY segment_type, segment_value;
