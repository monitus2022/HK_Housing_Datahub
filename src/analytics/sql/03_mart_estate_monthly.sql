-- Grain: one row per estate x calendar month.
-- Keeps the full history. The serving layer may export Parquet for this table.
DROP TABLE IF EXISTS mart_estate_monthly;

CREATE TABLE mart_estate_monthly AS
WITH sale AS (
    SELECT
        e.estate_id,
        substr(date(t.tx_date), 1, 7) AS month,
        count(*) AS tx_count,
        avg(
            CASE WHEN t.net_ft_price > 0 THEN t.net_ft_price END
        ) AS avg_net_ft_price,
        sum(t.price) AS total_tx_amount
    FROM transactions t
    JOIN units u ON t.unit_id = u.unit_id
    JOIN buildings b ON u.building_id = b.building_id
    JOIN estates e ON b.estate_id = e.estate_id
    GROUP BY e.estate_id, substr(date(t.tx_date), 1, 7)
),
rent AS (
    SELECT
        m.estate_id,
        substr(date(m.record_date), 1, 7) AS month,
        sum(COALESCE(m.total_rent_tx_count, 0)) AS rent_tx_count,
        sum(COALESCE(m.total_rent_tx_amount, 0)) AS total_rent_tx_amount,
        CASE
            WHEN sum(
                CASE WHEN m.avg_net_ft_rent > 0
                     THEN COALESCE(m.total_rent_tx_count, 0) ELSE 0 END
            ) > 0
            THEN sum(
                CASE WHEN m.avg_net_ft_rent > 0
                     THEN m.avg_net_ft_rent * COALESCE(m.total_rent_tx_count, 0)
                     ELSE 0 END
            ) / sum(
                CASE WHEN m.avg_net_ft_rent > 0
                     THEN COALESCE(m.total_rent_tx_count, 0) ELSE 0 END
            )
            ELSE avg(
                CASE WHEN m.avg_net_ft_rent > 0 THEN m.avg_net_ft_rent END
            )
        END AS avg_net_ft_rent
    FROM estate_monthly_market_info m
    GROUP BY m.estate_id, substr(date(m.record_date), 1, 7)
),
months AS (
    SELECT estate_id, month FROM sale
    UNION
    SELECT estate_id, month FROM rent
)
SELECT
    e.estate_id,
    e.estate_name_en,
    e.district_id,
    months.month,
    COALESCE(sale.tx_count, 0) AS tx_count,
    sale.avg_net_ft_price,
    COALESCE(sale.total_tx_amount, 0) AS total_tx_amount,
    COALESCE(rent.rent_tx_count, 0) AS rent_tx_count,
    rent.avg_net_ft_rent,
    COALESCE(rent.total_rent_tx_amount, 0) AS total_rent_tx_amount
FROM months
JOIN estates e ON months.estate_id = e.estate_id
LEFT JOIN sale
    ON months.estate_id = sale.estate_id
   AND months.month = sale.month
LEFT JOIN rent
    ON months.estate_id = rent.estate_id
   AND months.month = rent.month
ORDER BY months.estate_id, months.month;
