import { describe, expect, it } from "vitest";
import type { DistrictMonthly, EstateSummary } from "../types";
import {
  buildDistrictLeague,
  buildMarketPulse,
  buildOverviewKpis,
  buildScatterGeometry,
  buildYieldPoints,
  median,
} from "./overview";

function estate(overrides: Partial<EstateSummary>): EstateSummary {
  return {
    estate_id: "E1",
    estate_name_zh: "屋苑",
    estate_name_en: "Estate",
    region_id: "R1",
    region_name_en: "Region",
    subregion_id: "S1",
    subregion_name_en: "Subregion",
    district_id: "D1",
    district_name_en: "District",
    district_name_zh: "區",
    latitude: null,
    longitude: null,
    first_op_date: null,
    last_op_date: null,
    latest_tx_date: null,
    latest_tx_price: null,
    latest_tx_net_ft_price: null,
    latest_net_area: null,
    latest_bedroom: null,
    mtr_lines: null,
    school_nets: null,
    tx_count_12m: 0,
    avg_net_ft_price_12m: null,
    avg_net_ft_rent_12m: null,
    rent_count_12m: 0,
    latest_rent_date: null,
    latest_rent_net_ft_price: null,
    latest_market_date: null,
    has_market: 0,
    has_transactions: 0,
    has_wiki: 0,
    wiki_title: null,
    ...overrides,
  };
}

function row(
  district: string,
  month: string,
  sale: number | null,
  rent: number | null,
  txCount = 1,
  rentCount = 1,
): DistrictMonthly {
  return {
    district_id: district,
    district_name_en: `District ${district}`,
    district_name_zh: "",
    month,
    tx_count: txCount,
    avg_net_ft_price: sale,
    total_tx_amount: 0,
    rent_tx_count: rentCount,
    avg_net_ft_rent: rent,
    total_rent_tx_amount: 0,
  };
}

describe("median", () => {
  it("handles odd, even, and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("buildOverviewKpis", () => {
  it("uses positive estate values and sums transaction counts", () => {
    const kpis = buildOverviewKpis([
      estate({
        estate_id: "E1",
        avg_net_ft_price_12m: 10000,
        avg_net_ft_rent_12m: 50,
        tx_count_12m: 4,
        rent_count_12m: 2,
        latest_tx_date: "2025-03-15",
      }),
      estate({
        estate_id: "E2",
        avg_net_ft_price_12m: 12000,
        avg_net_ft_rent_12m: 60,
        tx_count_12m: 6,
        rent_count_12m: 3,
        latest_tx_date: "2025-04-01",
      }),
      estate({ estate_id: "E3", avg_net_ft_price_12m: 0 }),
    ]);

    expect(kpis.medianPrice).toBe(11000);
    expect(kpis.medianRent).toBe(55);
    expect(kpis.medianYield).toBeCloseTo(6);
    expect(kpis.transactions12m).toBe(10);
    expect(kpis.rentTransactions12m).toBe(5);
    expect(kpis.estatesWithSales).toBe(2);
    expect(kpis.estatesWithRent).toBe(2);
    expect(kpis.asOfMonth).toBe("2025-04");
  });
});

describe("buildMarketPulse", () => {
  it("indexes sale and rent to their first overlapping month", () => {
    const pulse = buildMarketPulse(
      [
        row("A", "2025-01", 100, 50, 2, 2),
        row("A", "2025-02", 110, 55, 1, 1),
      ],
      24,
    );

    expect(pulse.baseMonth).toBe("2025-01");
    expect(pulse.saleSeries.map((point) => point.month)).toEqual([
      "2025-01",
      "2025-02",
    ]);
    expect(pulse.saleSeries[0].value).toBeCloseTo(100);
    expect(pulse.saleSeries[1].value).toBeCloseTo(110);
    expect(pulse.rentSeries.map((point) => point.value)).toEqual([
      expect.closeTo(100),
      expect.closeTo(110),
    ]);
  });

  it("weights district averages by transaction counts", () => {
    const pulse = buildMarketPulse(
      [
        row("A", "2025-01", 100, 50, 2, 2),
        row("B", "2025-01", 200, 80, 1, 1),
      ],
      24,
    );

    expect(pulse.points[0].saleValue).toBeCloseTo(133.333, 2);
    expect(pulse.points[0].rentValue).toBeCloseTo(60);
  });

  it("starts both series at the common sale and rent coverage month", () => {
    const pulse = buildMarketPulse(
      [
        row("A", "2023-01", 100, null, 1, 0),
        row("A", "2023-02", 110, 55, 1, 1),
        row("A", "2023-03", 120, 60, 1, 1),
      ],
      60,
    );

    expect(pulse.baseMonth).toBe("2023-02");
    expect(pulse.points.map((point) => point.month)).toEqual([
      "2023-02",
      "2023-03",
    ]);
    expect(pulse.saleSeries.map((point) => point.month)).toEqual([
      "2023-02",
      "2023-03",
    ]);
    expect(pulse.rentSeries.map((point) => point.month)).toEqual([
      "2023-02",
      "2023-03",
    ]);
  });

  it("returns no indexed series when sale and rent never overlap", () => {
    const pulse = buildMarketPulse(
      [
        row("A", "2025-01", 100, null),
        row("A", "2025-02", null, 50),
      ],
      24,
    );

    expect(pulse.baseMonth).toBeNull();
    expect(pulse.saleSeries).toEqual([]);
    expect(pulse.rentSeries).toEqual([]);
  });
});

describe("buildDistrictLeague", () => {
  it("computes the annual change and yield from the latest sale month", () => {
    const league = buildDistrictLeague([
      row("A", "2024-01", 10000, 50, 1, 1),
      row("A", "2025-01", 11000, 55, 3, 4),
      row("B", "2025-01", 20000, null, 1, 0),
    ]);

    expect(league.map((entry) => entry.id)).toEqual(["B", "A"]);
    const a = league.find((entry) => entry.id === "A");
    expect(a).toMatchObject({
      month: "2025-01",
      price: 11000,
      txCount: 3,
      rentCount: 4,
    });
    expect(a?.changePct).toBeCloseTo(10);
    expect(a?.changeBasisMonth).toBe("2024-01");
    expect(a?.yieldPct).toBeCloseTo(6);
    expect(league.find((entry) => entry.id === "B")?.yieldPct).toBeNull();
  });

  it("uses the latest rent at or before the latest sale month", () => {
    const league = buildDistrictLeague([
      row("A", "2025-01", 10000, 50, 1, 1),
      row("A", "2025-02", 12000, null, 1, 0),
      row("A", "2025-03", null, 60, 0, 1),
    ]);

    expect(league[0].month).toBe("2025-02");
    expect(league[0].yieldPct).toBeCloseTo(5);
  });
});

describe("yield scatter", () => {
  it("drops districts without a yield and builds finite geometry", () => {
    const league = buildDistrictLeague([
      row("A", "2025-01", 11000, 55, 3, 4),
      row("B", "2025-01", 20000, null, 1, 0),
      row("C", "2025-01", 30000, 90, 5, 5),
    ]);
    const points = buildYieldPoints(league);
    expect(points.map((point) => point.id)).toEqual(["C", "A"]);

    const geometry = buildScatterGeometry(points);
    expect(geometry?.points).toHaveLength(2);
    expect(geometry?.xTicks).toHaveLength(4);
    expect(geometry?.yTicks).toHaveLength(4);
    for (const point of geometry?.points ?? []) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});
