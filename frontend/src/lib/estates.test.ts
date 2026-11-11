import { describe, expect, it } from "vitest";
import type { EstateSummary } from "../types";
import {
  filterEstates,
  listDistricts,
  paginate,
  sortEstates,
} from "./estates";
import { EMPTY_ESTATE_FILTERS } from "./filters";

function estate(overrides: Partial<EstateSummary>): EstateSummary {
  return {
    estate_id: "E1",
    estate_name_zh: "屋苑一",
    estate_name_en: "Estate One",
    region_id: "R1",
    region_name_en: "Region",
    subregion_id: "S1",
    subregion_name_en: "Subregion",
    district_id: "D1",
    district_name_en: "District One",
    district_name_zh: "地區一",
    latitude: 22.3,
    longitude: 114.1,
    first_op_date: "2000-01-01",
    last_op_date: null,
    latest_tx_date: "2025-01-01",
    latest_tx_price: 5_000_000,
    latest_tx_net_ft_price: 10_000,
    latest_net_area: 400,
    latest_bedroom: 2,
    mtr_lines: "Tsuen Wan Line",
    school_nets: "Net 62",
    tx_count_12m: 4,
    avg_net_ft_price_12m: 10_500,
    avg_net_ft_rent_12m: null,
    latest_market_date: "2024-12-31",
    has_market: 1,
    has_transactions: 1,
    has_wiki: 0,
    ...overrides,
  };
}

const estates = [
  estate({ estate_id: "E1", estate_name_en: "Alpha", district_id: "D1" }),
  estate({
    estate_id: "E2",
    estate_name_en: "Beta",
    estate_name_zh: "屋苑二",
    district_id: "D2",
    district_name_en: "District Two",
    district_name_zh: "地區二",
    latest_tx_price: null,
    tx_count_12m: 9,
    latest_tx_date: null,
  }),
  estate({
    estate_id: "E3",
    estate_name_en: "Gamma",
    district_id: "D1",
    latest_tx_price: 8_000_000,
    tx_count_12m: 1,
    latest_tx_date: "2024-01-01",
  }),
];

describe("filterEstates", () => {
  it("matches English, Chinese, district, and id text", () => {
    expect(filterEstates(estates, "beta", EMPTY_ESTATE_FILTERS).map((e) => e.estate_id)).toEqual(
      ["E2"],
    );
    expect(filterEstates(estates, "屋苑二", EMPTY_ESTATE_FILTERS).map((e) => e.estate_id)).toEqual(
      ["E2"],
    );
    expect(filterEstates(estates, "地區一", EMPTY_ESTATE_FILTERS).map((e) => e.estate_id)).toEqual(
      ["E1", "E3"],
    );
    expect(filterEstates(estates, "E3", EMPTY_ESTATE_FILTERS).map((e) => e.estate_id)).toEqual([
      "E3",
    ]);
  });

  it("filters by district", () => {
    expect(filterEstates(estates, "", { ...EMPTY_ESTATE_FILTERS, districtId: "D1" }).map((e) => e.estate_id)).toEqual([
      "E1",
      "E3",
    ]);
  });
});

describe("sortEstates", () => {
  it("sorts by price with nulls last", () => {
    expect(
      sortEstates(estates, "latest_price").map((e) => e.estate_id),
    ).toEqual(["E3", "E1", "E2"]);
  });

  it("sorts by 12-month transaction count", () => {
    expect(
      sortEstates(estates, "tx_count_12m").map((e) => e.estate_id),
    ).toEqual(["E2", "E1", "E3"]);
  });

  it("breaks 12-month count ties by latest date, then name", () => {
    const tied = [
      estate({
        estate_id: "A",
        estate_name_en: "Alpha",
        tx_count_12m: 5,
        latest_tx_date: "2025-01-01",
      }),
      estate({
        estate_id: "B",
        estate_name_en: "Beta",
        tx_count_12m: 5,
        latest_tx_date: "2026-01-01",
      }),
      estate({
        estate_id: "C",
        estate_name_en: "Gamma",
        tx_count_12m: 5,
        latest_tx_date: null,
      }),
      estate({
        estate_id: "D",
        estate_name_en: "Delta",
        tx_count_12m: 5,
        latest_tx_date: "2025-01-01",
      }),
    ];

    expect(
      sortEstates(tied, "tx_count_12m").map((e) => e.estate_id),
    ).toEqual(["B", "A", "D", "C"]);
  });

  it("sorts by latest transaction date", () => {
    expect(
      sortEstates(estates, "latest_tx_date").map((e) => e.estate_id),
    ).toEqual(["E1", "E3", "E2"]);
  });
});

describe("listDistricts", () => {
  it("returns unique districts sorted by English name", () => {
    expect(listDistricts(estates)).toEqual([
      { id: "D1", nameEn: "District One", nameZh: "地區一" },
      { id: "D2", nameEn: "District Two", nameZh: "地區二" },
    ]);
  });
});

describe("paginate", () => {
  it("clamps pages and computes totals", () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page.items).toEqual([3, 4]);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.totalItems).toBe(5);
    expect(paginate([1, 2, 3], 99, 2).page).toBe(2);
  });
});
