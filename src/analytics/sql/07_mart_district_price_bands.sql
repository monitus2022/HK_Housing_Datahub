-- Grain: one row per district x calendar month.
-- Sale and rent percentiles use positive net-ft prices only. Percentiles use
-- nearest-rank positions; medians average the two middle rows when the count
-- is even.
DROP TABLE IF EXISTS mart_district_price_bands;

CREATE TABLE mart_district_price_bands AS
WITH sale_base AS (
    SELECT
        e.district_id,
        substr(date(t.tx_date), 1, 7) AS month,
        t.net_ft_price
    FROM transactions t
    JOIN units u ON t.unit_id = u.unit_id
    JOIN buildings b ON u.building_id = b.building_id
    JOIN estates e ON b.estate_id = e.estate_id
    WHERE t.net_ft_price IS NOT NULL
      AND t.net_ft_price > 0
),
sale_ranked AS (
    SELECT
        district_id,
        month,
        net_ft_price,
        row_number() OVER (
            PARTITION BY district_id, month
            ORDER BY net_ft_price
        ) AS rn,
        count(*) OVER (PARTITION BY district_id, month) AS cnt
    FROM sale_base
),
sale_bands AS (
    SELECT
        district_id,
        month,
        count(*) AS sale_count,
        avg(
            CASE
                WHEN rn = (cnt * 25 + 99) / 100 THEN net_ft_price
            END
        ) AS sale_p25,
        avg(
            CASE
                WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN net_ft_price
            END
        ) AS sale_median,
        avg(
            CASE
                WHEN rn = (cnt * 75 + 99) / 100 THEN net_ft_price
            END
        ) AS sale_p75
    FROM sale_ranked
    GROUP BY district_id, month
),
rent_base AS (
    SELECT
        district_id,
        substr(date(tx_date), 1, 7) AS month,
        net_ft_price
    FROM rental_transactions
    WHERE net_ft_price IS NOT NULL
      AND net_ft_price > 0
),
rent_ranked AS (
    SELECT
        district_id,
        month,
        net_ft_price,
        row_number() OVER (
            PARTITION BY district_id, month
            ORDER BY net_ft_price
        ) AS rn,
        count(*) OVER (PARTITION BY district_id, month) AS cnt
    FROM rent_base
),
rent_bands AS (
    SELECT
        district_id,
        month,
        count(*) AS rent_count,
        avg(
            CASE
                WHEN rn = (cnt * 25 + 99) / 100 THEN net_ft_price
            END
        ) AS rent_p25,
        avg(
            CASE
                WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN net_ft_price
            END
        ) AS rent_median,
        avg(
            CASE
                WHEN rn = (cnt * 75 + 99) / 100 THEN net_ft_price
            END
        ) AS rent_p75
    FROM rent_ranked
    GROUP BY district_id, month
),
months AS (
    SELECT district_id, month FROM sale_bands
    UNION
    SELECT district_id, month FROM rent_bands
)
SELECT
    d.district_id,
    d.district_name_en,
    d.district_name_zh,
    months.month,
    COALESCE(sale_bands.sale_count, 0) AS sale_count,
    sale_bands.sale_p25,
    sale_bands.sale_median,
    sale_bands.sale_p75,
    COALESCE(rent_bands.rent_count, 0) AS rent_count,
    rent_bands.rent_p25,
    rent_bands.rent_median,
    rent_bands.rent_p75,
    CASE
        WHEN sale_bands.sale_median > 0
         AND rent_bands.rent_median IS NOT NULL
        THEN rent_bands.rent_median * 12.0 / sale_bands.sale_median * 100.0
    END AS gross_yield_pct
FROM months
JOIN districts d ON months.district_id = d.district_id
LEFT JOIN sale_bands
    ON months.district_id = sale_bands.district_id
   AND months.month = sale_bands.month
LEFT JOIN rent_bands
    ON months.district_id = rent_bands.district_id
   AND months.month = rent_bands.month
ORDER BY months.district_id, months.month;
