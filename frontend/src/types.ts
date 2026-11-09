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
  tx_count_12m: number;
  avg_net_ft_price_12m: number | null;
  avg_net_ft_rent_12m: number | null;
  latest_market_date: string | null;
  has_market: number;
  has_transactions: number;
  has_wiki: number;
}

export interface DashboardData {
  manifest: Manifest;
  estates: EstateSummary[];
}
