-- Lookup indexes on the phase-2 marts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_district_price_bands_district_month
    ON mart_district_price_bands(district_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mart_segment_summary_type_value
    ON mart_segment_summary(segment_type, segment_value);
