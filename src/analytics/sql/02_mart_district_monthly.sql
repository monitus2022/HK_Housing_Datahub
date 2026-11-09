-- Grain: one row per district x calendar month.
-- Sale metrics come from unit transactions; rent metrics come from monthly
-- estate aggregates. Rent averages are weighted by rent transaction count
-- when available, with a simple average fallback.
DROP TABLE IF EXISTS mart_district_monthly;

CREATE TABLE mart_district_monthly AS
WITH sale AS (
    SELECT
        e.district_id,
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
    GROUP BY e.district_id, substr(date(t.tx_date), 1, 7)
),
rent AS (
    SELECT
        e.district_id,
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
    JOIN estates e ON m.estate_id = e.estate_id
    GROUP BY e.district_id, substr(date(m.record_date), 1, 7)
),
months AS (
    SELECT district_id, month FROM sale
    UNION
    SELECT district_id, month FROM rent
)
SELECT
    d.district_id,
    d.district_name_en,
    d.district_name_zh,
    months.month,
    COALESCE(sale.tx_count, 0) AS tx_count,
    sale.avg_net_ft_price,
    COALESCE(sale.total_tx_amount, 0) AS total_tx_amount,
    COALESCE(rent.rent_tx_count, 0) AS rent_tx_count,
    rent.avg_net_ft_rent,
    COALESCE(rent.total_rent_tx_amount, 0) AS total_rent_tx_amount
FROM months
JOIN districts d ON months.district_id = d.district_id
LEFT JOIN sale
    ON months.district_id = sale.district_id
   AND months.month = sale.month
LEFT JOIN rent
    ON months.district_id = rent.district_id
   AND months.month = rent.month
ORDER BY months.district_id, months.month;
