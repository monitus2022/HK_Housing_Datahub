import { describe, expect, it } from "vitest";
import type { RecentTransaction } from "../types";
import {
  EMPTY_FILTERS,
  filterTransactions,
  sortTransactions,
  summarizeTransactions,
} from "./transactions";

function tx(
  date: string,
  estate: string,
  district: string,
  price: number | null,
  netFtPrice: number | null,
  netArea: number | null = 400,
): RecentTransaction {
  return {
    tx_date: date,
    price,
    net_ft_price: netFtPrice,
    estate_id: `E-${estate}`,
    estate_name_en: estate,
    district_id: district,
    district_name_en: `District ${district}`,
    area: netArea,
    net_area: netArea,
    bedroom: 2,
  };
}

const rows = [
  tx("2025-10-01", "Alpha Court", "A", 5000000, 12000),
  tx("2025-09-15", "Beta Tower", "B", 8000000, null),
  tx("2024-12-31", "Gamma House", "A", null, 9000),
];

describe("filterTransactions", () => {
  it("returns everything with empty filters", () => {
    expect(filterTransactions(rows, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("matches estate, district, and id text case-insensitively", () => {
    expect(
      filterTransactions(rows, { ...EMPTY_FILTERS, query: "alpha" }),
    ).toHaveLength(1);
    expect(
      filterTransactions(rows, { ...EMPTY_FILTERS, query: "district b" }),
    ).toHaveLength(1);
    expect(
      filterTransactions(rows, { ...EMPTY_FILTERS, query: "e-gamma" }),
    ).toHaveLength(1);
  });

  it("filters by district and inclusive date range", () => {
    expect(
      filterTransactions(rows, { ...EMPTY_FILTERS, districtId: "A" }),
    ).toHaveLength(2);
    expect(
      filterTransactions(rows, {
        ...EMPTY_FILTERS,
        from: "2025-09-15",
        to: "2025-10-01",
      }),
    ).toHaveLength(2);
    expect(
      filterTransactions(rows, { ...EMPTY_FILTERS, from: "2025-01-01" }),
    ).toHaveLength(2);
  });
});

describe("sortTransactions", () => {
  it("sorts by date descending and ascending", () => {
    expect(
      sortTransactions(rows, "date", "desc").map((row) => row.tx_date),
    ).toEqual(["2025-10-01", "2025-09-15", "2024-12-31"]);
    expect(
      sortTransactions(rows, "date", "asc").map((row) => row.tx_date),
    ).toEqual(["2024-12-31", "2025-09-15", "2025-10-01"]);
  });

  it("puts missing numeric values last regardless of direction", () => {
    expect(
      sortTransactions(rows, "net_ft_price", "asc").map(
        (row) => row.net_ft_price,
      ),
    ).toEqual([9000, 12000, null]);
    expect(
      sortTransactions(rows, "price", "desc").map((row) => row.price),
    ).toEqual([8000000, 5000000, null]);
  });
});

describe("summarizeTransactions", () => {
  it("counts rows and districts, sums prices, and takes the median net ft price", () => {
    expect(summarizeTransactions(rows)).toEqual({
      count: 3,
      totalPrice: 13000000,
      medianNetFtPrice: 10500,
      districts: 2,
    });
  });

  it("handles an empty set", () => {
    expect(summarizeTransactions([])).toEqual({
      count: 0,
      totalPrice: 0,
      medianNetFtPrice: null,
      districts: 0,
    });
  });

  it("uses the lower and upper middle values for an even count", () => {
    const even = [
      tx("2025-01-01", "A", "A", 1, 10000),
      tx("2025-01-02", "B", "A", 1, 12000),
      tx("2025-01-03", "C", "A", 1, 14000),
      tx("2025-01-04", "D", "A", 1, 16000),
    ];
    expect(summarizeTransactions(even).medianNetFtPrice).toBe(13000);
  });
});
