import { describe, expect, it } from "vitest";
import type { EstateSummary } from "../types";
import {
  activeFilterCount,
  EMPTY_ESTATE_FILTERS,
  listMtrLines,
  listSchoolNets,
  matchesFilters,
  supportsBuildingAge,
} from "./filters";

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
    latest_tx_date: "2026-01-01",
    latest_tx_price: 5_000_000,
    latest_tx_net_ft_price: 10_000,
    latest_net_area: 400,
    latest_bedroom: 2,
    mtr_lines: "Tsuen Wan Line, Island Line",
    school_nets: "Net 62",
    tx_count_12m: 3,
    avg_net_ft_price_12m: 10_000,
    avg_net_ft_rent_12m: null,
    latest_market_date: null,
    has_market: 0,
    has_transactions: 1,
    has_wiki: 0,
    ...overrides,
  };
}

describe("building age", () => {
  const thisYear = new Date().getFullYear();

  it("keeps estates first occupied within the limit", () => {
    const recent = estate({ first_op_date: `${thisYear - 3}-06-01` });
    const old = estate({ first_op_date: `${thisYear - 12}-06-01` });
    const filters = { ...EMPTY_ESTATE_FILTERS, maxBuildingAge: "5" };
    expect(matchesFilters(recent, filters)).toBe(true);
    expect(matchesFilters(old, filters)).toBe(false);
  });

  it("uses a real five years, not a calendar-year bucket", () => {
    const day = 24 * 60 * 60 * 1000;
    const filters = { ...EMPTY_ESTATE_FILTERS, maxBuildingAge: "5" };
    // 5 years and one day old is outside the limit under either rule.
    const justOver = new Date(Date.now() - 5 * 365.25 * day - day);
    const justUnder = new Date(Date.now() - 5 * 365.25 * day + day);
    expect(
      matchesFilters(
        estate({ first_op_date: justOver.toISOString() }),
        filters,
      ),
    ).toBe(false);
    expect(
      matchesFilters(
        estate({ first_op_date: justUnder.toISOString() }),
        filters,
      ),
    ).toBe(true);
  });

  it("accepts a future first occupation as pre-sale", () => {
    const future = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    expect(
      matchesFilters(estate({ first_op_date: future.toISOString() }), {
        ...EMPTY_ESTATE_FILTERS,
        maxBuildingAge: "5",
      }),
    ).toBe(true);
  });

  it("rejects a malformed date", () => {
    const filters = { ...EMPTY_ESTATE_FILTERS, maxBuildingAge: "5" };
    expect(matchesFilters(estate({ first_op_date: "unknown" }), filters)).toBe(
      false,
    );
  });

  it("treats an unknown first occupation as no match", () => {
    const unknown = estate({ first_op_date: null });
    expect(
      matchesFilters(unknown, { ...EMPTY_ESTATE_FILTERS, maxBuildingAge: "5" }),
    ).toBe(false);
  });

  it("ignores the filter when it is empty", () => {
    expect(matchesFilters(estate({ first_op_date: null }), EMPTY_ESTATE_FILTERS)).toBe(
      true,
    );
  });
});

describe("supportsBuildingAge", () => {
  it("is false when every date is null", () => {
    const estates = [estate({ first_op_date: null }), estate({ first_op_date: null })];
    expect(supportsBuildingAge(estates)).toBe(false);
  });

  it("is true when any estate has a date", () => {
    const estates = [estate({ first_op_date: null }), estate({ first_op_date: "2010-01-01" })];
    expect(supportsBuildingAge(estates)).toBe(true);
  });

  it("is false for an empty snapshot", () => {
    expect(supportsBuildingAge([])).toBe(false);
  });
});

describe("matchesFilters", () => {
  it("applies inclusive price, net-ft, and area ranges", () => {
    const subject = estate({});
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        minPrice: "5000000",
        maxPrice: "5000000",
        minNetFtPrice: "9999",
        maxNetArea: "400",
      }),
    ).toBe(true);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, minPrice: "5000001" }),
    ).toBe(false);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, maxNetArea: "399" }),
    ).toBe(false);
  });

  it("excludes rows without values when a numeric filter is active", () => {
    const subject = estate({ latest_tx_price: null, latest_net_area: null });
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, minPrice: "1" }),
    ).toBe(false);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, minNetArea: "1" }),
    ).toBe(false);
    expect(matchesFilters(subject, EMPTY_ESTATE_FILTERS)).toBe(true);
  });

  it("rejects zero and negative values when a numeric filter is active", () => {
    expect(
      matchesFilters(estate({ latest_net_area: 0 }), {
        ...EMPTY_ESTATE_FILTERS,
        maxNetArea: "400",
      }),
    ).toBe(false);
    expect(
      matchesFilters(estate({ latest_tx_price: -1 }), {
        ...EMPTY_ESTATE_FILTERS,
        minPrice: "0",
      }),
    ).toBe(false);
    expect(
      matchesFilters(estate({ latest_tx_net_ft_price: 0 }), {
        ...EMPTY_ESTATE_FILTERS,
        maxNetFtPrice: "999999",
      }),
    ).toBe(false);
  });

  it("matches exact bedrooms and the 4+ bucket", () => {
    expect(
      matchesFilters(estate({ latest_bedroom: 3 }), {
        ...EMPTY_ESTATE_FILTERS,
        bedrooms: "3",
      }),
    ).toBe(true);
    expect(
      matchesFilters(estate({ latest_bedroom: 4 }), {
        ...EMPTY_ESTATE_FILTERS,
        bedrooms: "4+",
      }),
    ).toBe(true);
    expect(
      matchesFilters(estate({ latest_bedroom: null }), {
        ...EMPTY_ESTATE_FILTERS,
        bedrooms: "2",
      }),
    ).toBe(false);
  });

  it("matches MTR lines and school nets from the comma-separated fields", () => {
    const subject = estate({});
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        mtrLine: "Island Line",
        schoolNet: "Net 62",
      }),
    ).toBe(true);
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        mtrLine: "Tung Chung Line",
      }),
    ).toBe(false);
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        schoolNet: "Net 41",
      }),
    ).toBe(false);
  });
});

describe("filter helpers", () => {
  it("lists sorted unique MTR lines and school nets", () => {
    const estates = [
      estate({}),
      estate({
        estate_id: "E2",
        mtr_lines: "Island Line, Tseung Kwan O Line",
        school_nets: "Net 41",
      }),
    ];
    expect(listMtrLines(estates)).toEqual([
      "Island Line",
      "Tseung Kwan O Line",
      "Tsuen Wan Line",
    ]);
    expect(listSchoolNets(estates)).toEqual(["Net 41", "Net 62"]);
  });

  it("counts active filter groups", () => {
    expect(activeFilterCount(EMPTY_ESTATE_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...EMPTY_ESTATE_FILTERS,
        minPrice: "1",
        maxPrice: "2",
        bedrooms: "2",
        mtrLine: "Island Line",
      }),
    ).toBe(3);
  });

  it("counts the location cascade once", () => {
    expect(
      activeFilterCount({
        ...EMPTY_ESTATE_FILTERS,
        regionId: "10",
        subregionId: "S1",
        districtId: "D1",
      }),
    ).toBe(1);
  });
});

describe("location scope", () => {
  it("matches region, subregion and district independently", () => {
    const subject = estate({});
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, regionId: "R1" }),
    ).toBe(true);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, regionId: "R2" }),
    ).toBe(false);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, subregionId: "S1" }),
    ).toBe(true);
    expect(
      matchesFilters(subject, { ...EMPTY_ESTATE_FILTERS, subregionId: "S9" }),
    ).toBe(false);
  });

  it("applies the cascade as an AND when several levels are set", () => {
    const subject = estate({});
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        regionId: "R1",
        subregionId: "S1",
        districtId: "D1",
      }),
    ).toBe(true);
    expect(
      matchesFilters(subject, {
        ...EMPTY_ESTATE_FILTERS,
        regionId: "R1",
        subregionId: "S1",
        districtId: "D2",
      }),
    ).toBe(false);
  });
});
