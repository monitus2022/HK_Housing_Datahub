import type { SortKey } from "./estates";
import {
  EMPTY_ESTATE_FILTERS,
  type EstateFilters,
} from "./filters";

export interface SearchState {
  query: string;
  sort: SortKey;
  filters: EstateFilters;
}

export const DEFAULT_SEARCH_STATE: SearchState = {
  query: "",
  sort: "tx_count_12m",
  filters: EMPTY_ESTATE_FILTERS,
};

const SORTS: SortKey[] = [
  "name",
  "latest_price",
  "tx_count_12m",
  "latest_tx_date",
];

const PARAM_KEYS = [
  "q",
  "sort",
  "district",
  "minPrice",
  "maxPrice",
  "minNetFtPrice",
  "maxNetFtPrice",
  "minNetArea",
  "maxNetArea",
  "bedrooms",
  "mtr",
  "school",
] as const;

function readSort(value: string | null): SortKey {
  return value && (SORTS as string[]).includes(value)
    ? (value as SortKey)
    : DEFAULT_SEARCH_STATE.sort;
}

export function searchStateFromParams(search: string): SearchState {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? "",
    sort: readSort(params.get("sort")),
    filters: {
      districtId: params.get("district") ?? "",
      minPrice: params.get("minPrice") ?? "",
      maxPrice: params.get("maxPrice") ?? "",
      minNetFtPrice: params.get("minNetFtPrice") ?? "",
      maxNetFtPrice: params.get("maxNetFtPrice") ?? "",
      minNetArea: params.get("minNetArea") ?? "",
      maxNetArea: params.get("maxNetArea") ?? "",
      bedrooms: params.get("bedrooms") ?? "",
      mtrLine: params.get("mtr") ?? "",
      schoolNet: params.get("school") ?? "",
    },
  };
}

export function searchStateToSearch(
  state: SearchState,
  baseSearch = "",
): string {
  const params = new URLSearchParams(baseSearch);
  for (const key of PARAM_KEYS) params.delete(key);

  if (state.query.trim()) params.set("q", state.query);
  if (state.sort !== DEFAULT_SEARCH_STATE.sort) {
    params.set("sort", state.sort);
  }
  const filters = state.filters;
  if (filters.districtId) params.set("district", filters.districtId);
  if (filters.minPrice) params.set("minPrice", filters.minPrice);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  if (filters.minNetFtPrice) {
    params.set("minNetFtPrice", filters.minNetFtPrice);
  }
  if (filters.maxNetFtPrice) {
    params.set("maxNetFtPrice", filters.maxNetFtPrice);
  }
  if (filters.minNetArea) params.set("minNetArea", filters.minNetArea);
  if (filters.maxNetArea) params.set("maxNetArea", filters.maxNetArea);
  if (filters.bedrooms) params.set("bedrooms", filters.bedrooms);
  if (filters.mtrLine) params.set("mtr", filters.mtrLine);
  if (filters.schoolNet) params.set("school", filters.schoolNet);

  const query = params.toString();
  return query ? `?${query}` : "";
}
