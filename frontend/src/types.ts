export interface Coverage {
  estates: number;
  with_transactions: number;
  with_market: number;
  with_wiki: number;
}

export interface DataThrough {
  transactions: string | null;
  market: string | null;
}

export interface Manifest {
  schema_version: number;
  build_id: string;
  generated_at: string;
  data_through: DataThrough;
  coverage: Coverage;
  row_counts: Record<string, number>;
  files: Record<string, string>;
  source: string[];
}

export interface EstateSummary {
  estate_id: string;
  estate_name_zh: string;
  estate_name_en: string;
  region_id: string;
  region_name_en: string;
  subregion_id: string;
  subregion_name_en: string;
  district_id: string;
  district_name_en: string;
  district_name_zh: string;
  latitude: number | null;
  longitude: number | null;
  first_op_date: string | null;
  last_op_date: string | null;
  latest_tx_date: string | null;
  latest_tx_price: number | null;
  latest_tx_net_ft_price: number | null;
  latest_net_area: number | null;
  latest_bedroom: number | null;
  mtr_lines: string | null;
  school_nets: string | null;
  tx_count_12m: number;
  avg_net_ft_price_12m: number | null;
  avg_net_ft_rent_12m: number | null;
  rent_count_12m?: number;
  latest_rent_date?: string | null;
  latest_rent_net_ft_price?: number | null;
  latest_market_date: string | null;
  has_market: number;
  has_transactions: number;
  has_wiki: number;
  wiki_title?: string | null;
}

/** One row per district and calendar month (mart_district_monthly). */
export interface DistrictMonthly {
  district_id: string;
  district_name_en: string;
  district_name_zh: string;
  /** Calendar month, formatted as `YYYY-MM`. */
  month: string;
  tx_count: number;
  avg_net_ft_price: number | null;
  total_tx_amount: number;
  rent_tx_count: number;
  avg_net_ft_rent: number | null;
  total_rent_tx_amount: number;
}

/** `[month index, tx count, avg price, rent count, avg rent]`. */
export type EstateMonthlyPoint = [
  number,
  number,
  number,
  number,
  number,
];

/** Compact estate-month history keyed by estate id. */
export interface EstateMonthlyHistory {
  months: string[];
  estates: Record<string, EstateMonthlyPoint[]>;
}

/** One row per transaction in the last 24 months (mart_transaction_recent). */
export interface RecentTransaction {
  tx_date: string;
  price: number | null;
  net_ft_price: number | null;
  mkt_type?: string | null;
  estate_id: string;
  estate_name_en: string;
  district_id: string;
  district_name_en: string;
  area: number | null;
  net_area: number | null;
  bedroom: number | null;
}

export interface DashboardData {
  manifest: Manifest;
  estates: EstateSummary[];
}

export interface CatalogColumn {
  name: string;
  type: string | null;
  nullable: boolean;
  primary_key: boolean;
  null_count: number;
}

export interface CatalogForeignKey {
  column: string;
  references_table: string;
  references_column: string;
}

export interface CatalogTable {
  name: string;
  description: string | null;
  grain: string | null;
  caveats: string | null;
  row_count: number;
  columns: CatalogColumn[];
  foreign_keys: CatalogForeignKey[];
}

export interface CatalogDataset {
  id: string;
  name: string;
  layer: string;
  description: string | null;
  source: string | null;
  refresh: string | null;
  licence: string | null;
  owner: string | null;
  caveats: string | null;
  artifacts: string[] | null;
  table_count: number;
  row_count: number;
  tables: CatalogTable[];
}

export interface DataCatalog {
  version: number;
  generated_at: string;
  database: { name: string; table_count: number; row_count: number };
  quality: {
    status: string;
    critical_failures: number;
    warning_failures: number;
    checks_total: number;
  } | null;
  manifest: {
    build_id: string;
    schema_version: number;
    data_through: DataThrough;
    coverage: Coverage;
  } | null;
  datasets: CatalogDataset[];
}

/** Monthly district sale/rent distribution (mart_district_price_bands). */
export interface DistrictPriceBand {
  district_id: string;
  district_name_en: string;
  district_name_zh: string;
  month: string;
  sale_count: number;
  sale_p25: number | null;
  sale_median: number | null;
  sale_p75: number | null;
  rent_count: number;
  rent_p25: number | null;
  rent_median: number | null;
  rent_p75: number | null;
  gross_yield_pct: number | null;
}

/** Trailing-12-month sale/rent stats by segment (mart_segment_summary). */
export interface SegmentSummary {
  segment_type: string;
  segment_value: string;
  sale_count: number | null;
  sale_estates: number | null;
  sale_p25: number | null;
  sale_median: number | null;
  sale_p75: number | null;
  rent_count: number | null;
  rent_estates: number | null;
  rent_p25: number | null;
  rent_median: number | null;
  rent_p75: number | null;
  window_start: string;
  window_end: string;
  gross_yield_pct: number | null;
}

export interface RvdRent {
  region_code: string;
  property_class: string;
  month: string;
  value_hkd_m2: number | null;
  is_provisional: number;
}

export interface RvdPrice {
  region_code: string;
  property_class: string;
  month: string;
  value_hkd_m2: number | null;
  is_provisional: number;
}

export interface RvdIndex {
  index_type: "rental" | "price";
  property_class: string;
  month: string;
  value: number | null;
  is_provisional: number;
}

export interface RvdYield {
  property_class: string;
  month: string;
  yield_pct: number | null;
  is_provisional: number;
}

export interface RvdBenchmarks {
  rents: RvdRent[];
  prices: RvdPrice[];
  indices: RvdIndex[];
  yields: RvdYield[];
}
