import type { EstateSummary } from "../types";

export interface EstateFilters {
  districtId: string;
  minPrice: string;
  maxPrice: string;
  minNetFtPrice: string;
  maxNetFtPrice: string;
  minNetArea: string;
  maxNetArea: string;
  bedrooms: string;
  mtrLine: string;
  schoolNet: string;
}

export const EMPTY_ESTATE_FILTERS: EstateFilters = {
  districtId: "",
  minPrice: "",
  maxPrice: "",
  minNetFtPrice: "",
  maxNetFtPrice: "",
  minNetArea: "",
  maxNetArea: "",
  bedrooms: "",
  mtrLine: "",
  schoolNet: "",
};

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinRange(
  value: number | null,
  minimum: string,
  maximum: string,
): boolean {
  const low = parseNumber(minimum);
  const high = parseNumber(maximum);
  if (low === null && high === null) return true;
  // Zero and negative prices/areas are unusable source values, not matches.
  if (value === null || !Number.isFinite(value) || value <= 0) return false;
  if (low !== null && value < low) return false;
  if (high !== null && value > high) return false;
  return true;
}

export function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesBedrooms(estate: EstateSummary, bedrooms: string): boolean {
  if (!bedrooms) return true;
  if (estate.latest_bedroom === null) return false;
  if (bedrooms === "4+") return estate.latest_bedroom >= 4;
  return estate.latest_bedroom === Number(bedrooms);
}

export function matchesFilters(
  estate: EstateSummary,
  filters: EstateFilters,
): boolean {
  if (filters.districtId && estate.district_id !== filters.districtId) {
    return false;
  }
  if (
    !withinRange(estate.latest_tx_price, filters.minPrice, filters.maxPrice)
  ) {
    return false;
  }
  if (
    !withinRange(
      estate.latest_tx_net_ft_price,
      filters.minNetFtPrice,
      filters.maxNetFtPrice,
    )
  ) {
    return false;
  }
  if (
    !withinRange(
      estate.latest_net_area,
      filters.minNetArea,
      filters.maxNetArea,
    )
  ) {
    return false;
  }
  if (!matchesBedrooms(estate, filters.bedrooms)) {
    return false;
  }
  if (
    filters.mtrLine &&
    !splitList(estate.mtr_lines).includes(filters.mtrLine)
  ) {
    return false;
  }
  if (
    filters.schoolNet &&
    !splitList(estate.school_nets).includes(filters.schoolNet)
  ) {
    return false;
  }
  return true;
}

export function activeFilterCount(filters: EstateFilters): number {
  let count = 0;
  if (filters.districtId) count += 1;
  if (filters.minPrice || filters.maxPrice) count += 1;
  if (filters.minNetFtPrice || filters.maxNetFtPrice) count += 1;
  if (filters.minNetArea || filters.maxNetArea) count += 1;
  if (filters.bedrooms) count += 1;
  if (filters.mtrLine) count += 1;
  if (filters.schoolNet) count += 1;
  return count;
}

export function listMtrLines(estates: EstateSummary[]): string[] {
  const lines = new Set<string>();
  for (const estate of estates) {
    for (const line of splitList(estate.mtr_lines)) lines.add(line);
  }
  return [...lines].sort((left, right) => left.localeCompare(right));
}

export function listSchoolNets(estates: EstateSummary[]): string[] {
  const nets = new Set<string>();
  for (const estate of estates) {
    for (const net of splitList(estate.school_nets)) nets.add(net);
  }
  return [...nets].sort((left, right) => left.localeCompare(right));
}
