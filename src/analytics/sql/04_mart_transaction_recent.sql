-- Grain: one row per transaction in the last 24 months.
-- The window is relative to the latest transaction date in the data.
DROP TABLE IF EXISTS mart_transaction_recent;

CREATE TABLE mart_transaction_recent AS
WITH data_through AS (
    SELECT date(max(tx_date)) AS as_of_date
    FROM transactions
)
SELECT
    t.tx_id,
    date(t.tx_date) AS tx_date,
    t.price,
    t.net_ft_price,
    e.estate_id,
    e.estate_name_en,
    e.district_id,
    d.district_name_en,
    b.building_id,
    u.unit_id,
    u.area,
    u.net_area,
    u.bedroom
FROM transactions t
JOIN units u ON t.unit_id = u.unit_id
JOIN buildings b ON u.building_id = b.building_id
JOIN estates e ON b.estate_id = e.estate_id
JOIN districts d ON e.district_id = d.district_id
CROSS JOIN data_through dt
WHERE date(t.tx_date) >= date(dt.as_of_date, '-24 months')
  AND date(t.tx_date) <= dt.as_of_date
ORDER BY t.tx_date DESC;
