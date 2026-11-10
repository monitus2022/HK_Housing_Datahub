import type { RecentTransaction } from "../types";

export type TransactionSortKey =
  | "date"
  | "price"
  | "net_ft_price"
  | "net_area";

export type SortDirection = "asc" | "desc";

export interface TransactionFilters {
  query: string;
  districtId: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  query: "",
  districtId: "",
  from: "",
  to: "",
};

export const SORT_OPTIONS: {
  value: TransactionSortKey;
  label: string;
}[] = [
  { value: "date", label: "Transaction date" },
  { value: "price", label: "Price" },
  { value: "net_ft_price", label: "Net ft price" },
  { value: "net_area", label: "Net area" },
];

export function filterTransactions(
  rows: RecentTransaction[],
  filters: TransactionFilters,
): RecentTransaction[] {
  const needle = filters.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.districtId && row.district_id !== filters.districtId) {
      return false;
    }
    if (filters.from && row.tx_date < filters.from) {
      return false;
    }
    if (filters.to && row.tx_date > filters.to) {
      return false;
    }
    if (!needle) return true;
    return [row.estate_name_en, row.district_name_en, row.estate_id]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

function compareOptional(
  left: number | null,
  right: number | null,
  factor: number,
): number {
  if (left === null && right === null) return 0;
  // Missing values sort last in both directions.
  if (left === null) return 1;
  if (right === null) return -1;
  return factor * (left - right);
}

export function sortTransactions(
  rows: RecentTransaction[],
  key: TransactionSortKey,
  direction: SortDirection,
): RecentTransaction[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    switch (key) {
      case "price":
        return compareOptional(left.price, right.price, factor);
      case "net_ft_price":
        return compareOptional(left.net_ft_price, right.net_ft_price, factor);
      case "net_area":
        return compareOptional(left.net_area, right.net_area, factor);
      case "date":
      default: {
        const byDate =
          left.tx_date.localeCompare(right.tx_date) ||
          left.estate_id.localeCompare(right.estate_id);
        return factor * byDate;
      }
    }
  });
}

export interface TransactionSummary {
  count: number;
  totalPrice: number;
  medianNetFtPrice: number | null;
  districts: number;
}

export function summarizeTransactions(
  rows: RecentTransaction[],
): TransactionSummary {
  if (rows.length === 0) {
    return { count: 0, totalPrice: 0, medianNetFtPrice: null, districts: 0 };
  }

  let totalPrice = 0;
  const prices: number[] = [];
  const districts = new Set<string>();

  for (const row of rows) {
    if (row.price !== null && Number.isFinite(row.price)) totalPrice += row.price;
    if (
      row.net_ft_price !== null &&
      Number.isFinite(row.net_ft_price) &&
      row.net_ft_price > 0
    ) {
      prices.push(row.net_ft_price);
    }
    if (row.district_id) districts.add(row.district_id);
  }

  prices.sort((left, right) => left - right);
  const middle = Math.floor(prices.length / 2);
  const medianNetFtPrice =
    prices.length === 0
      ? null
      : prices.length % 2 === 1
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2;

  return {
    count: rows.length,
    totalPrice,
    medianNetFtPrice,
    districts: districts.size,
  };
}
