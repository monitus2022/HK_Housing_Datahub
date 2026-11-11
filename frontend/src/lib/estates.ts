import type { EstateSummary } from "../types";
import { matchesFilters, type EstateFilters } from "./filters";

export type SortKey =
  | "name"
  | "latest_price"
  | "tx_count_12m"
  | "latest_tx_date";

export interface DistrictOption {
  id: string;
  nameEn: string;
  nameZh: string;
}

export function filterEstates(
  estates: EstateSummary[],
  query: string,
  filters: EstateFilters,
): EstateSummary[] {
  const needle = query.trim().toLowerCase();
  return estates.filter((estate) => {
    if (!matchesFilters(estate, filters)) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return [
      estate.estate_name_en,
      estate.estate_name_zh,
      estate.district_name_en,
      estate.district_name_zh,
      estate.estate_id,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

export function sortEstates(
  estates: EstateSummary[],
  sort: SortKey,
): EstateSummary[] {
  return [...estates].sort((left, right) => {
    switch (sort) {
      case "latest_price":
        return compareNullableNumbers(
          left.latest_tx_price,
          right.latest_tx_price,
        );
      case "tx_count_12m": {
        const byCount = right.tx_count_12m - left.tx_count_12m;
        if (byCount !== 0) return byCount;
        const byDate = (right.latest_tx_date ?? "").localeCompare(
          left.latest_tx_date ?? "",
        );
        if (byDate !== 0) return byDate;
        return (left.estate_name_en || left.estate_name_zh).localeCompare(
          right.estate_name_en || right.estate_name_zh,
        );
      }
      case "latest_tx_date":
        return (right.latest_tx_date ?? "").localeCompare(
          left.latest_tx_date ?? "",
        );
      case "name":
      default:
        return (left.estate_name_en || left.estate_name_zh).localeCompare(
          right.estate_name_en || right.estate_name_zh,
        );
    }
  });
}

export function listDistricts(estates: EstateSummary[]): DistrictOption[] {
  const districts = new Map<string, DistrictOption>();
  for (const estate of estates) {
    if (!estate.district_id || districts.has(estate.district_id)) continue;
    districts.set(estate.district_id, {
      id: estate.district_id,
      nameEn: estate.district_name_en || estate.district_id,
      nameZh: estate.district_name_zh || "",
    });
  }
  return [...districts.values()].sort((left, right) =>
    left.nameEn.localeCompare(right.nameEn),
  );
}

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    totalPages,
    totalItems: items.length,
  };
}
