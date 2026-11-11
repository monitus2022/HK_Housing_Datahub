-- Dashboard query indexes. Idempotent so the builder can rerun safely.
CREATE INDEX IF NOT EXISTS idx_transactions_tx_date
    ON transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_transactions_unit_id
    ON transactions(unit_id);
CREATE INDEX IF NOT EXISTS idx_market_estate_date
    ON estate_monthly_market_info(estate_id, record_date);
CREATE INDEX IF NOT EXISTS idx_units_building_id
    ON units(building_id);
CREATE INDEX IF NOT EXISTS idx_buildings_estate_id
    ON buildings(estate_id);
CREATE INDEX IF NOT EXISTS idx_rental_transactions_date
    ON rental_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_rental_transactions_district_date
    ON rental_transactions(district_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_rental_transactions_estate_date
    ON rental_transactions(estate_id, tx_date);
