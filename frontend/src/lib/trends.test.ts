import { describe, expect, it } from "vitest";
import type { DistrictMonthly } from "../types";
import {
  applyTrendView,
  buildChartGeometry,
  buildMultiLineGeometry,
  buildTrendSeries,
  listTrendDistricts,
  summarizeTrend,
  valueMonthsBefore,
} from "./trends";

function row(
  district: string,
  month: string,
  sale: number | null,
  rent: number | null,
  txCount = 1,
): DistrictMonthly {
  return {
    district_id: district,
    district_name_en: `District ${district}`,
    district_name_zh: "",
    month,
    tx_count: txCount,
    avg_net_ft_price: sale,
    total_tx_amount: 0,
    rent_tx_count: 0,
    avg_net_ft_rent: rent,
    total_rent_tx_amount: 0,
  };
}

describe("listTrendDistricts", () => {
  it("deduplicates districts and sorts by English name", () => {
    const districts = listTrendDistricts([
      row("B", "2025-01", 10000, null),
      row("A", "2025-01", 12000, null),
      row("B", "2025-02", 11000, null),
    ]);

    expect(districts).toEqual([
      { id: "A", nameEn: "District A", nameZh: "" },
      { id: "B", nameEn: "District B", nameZh: "" },
    ]);
  });
});

describe("buildTrendSeries", () => {
  const rows = [
    row("A", "2025-03", 12000, null, 5),
    row("A", "2024-12", 10000, null, 3),
    row("A", "2025-01", null, null, 0),
    row("A", "2025-02", 0, 0, 1),
    row("B", "2025-03", 20000, null, 9),
  ];

  it("filters by district, drops non-positive prices, and sorts by month", () => {
    const series = buildTrendSeries(rows, "A", "sale", "all");
    expect(series).toEqual([
      { month: "2024-12", value: 10000, txCount: 3 },
      { month: "2025-03", value: 12000, txCount: 5 },
    ]);
  });

  it("keeps volume months even when there were no transactions", () => {
    const series = buildTrendSeries(rows, "A", "volume", "all");
    expect(series.map((point) => point.month)).toEqual([
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
    expect(series[2].value).toBe(1);
  });

  it("returns no points for rent when the source has no positive rent values", () => {
    expect(buildTrendSeries(rows, "A", "rent", "all")).toEqual([]);
  });

  it("windows by calendar span, not by number of points", () => {
    // A sparse district: three widely separated sale months, latest 2025-06.
    const sparse = [
      row("A", "2006-07", 5000, null),
      row("A", "2013-06", 8000, null),
      row("A", "2025-05", 11000, null),
      row("A", "2025-06", 12000, null),
    ];

    // "Last 2 years" is 2023-07 .. 2025-06, so the old points must be dropped
    // even though the series only has four points in total.
    expect(buildTrendSeries(sparse, "A", "sale", "24")).toEqual([
      { month: "2025-05", value: 11000, txCount: 1 },
      { month: "2025-06", value: 12000, txCount: 1 },
    ]);

    expect(buildTrendSeries(sparse, "A", "sale", "all")).toHaveLength(4);
  });

  it("windows relative to the district's latest month", () => {
    const series = buildTrendSeries(
      [
        row("A", "2022-01", 9000, null),
        row("A", "2024-06", 11000, null),
        row("A", "2025-06", 12000, null),
      ],
      "A",
      "sale",
      "24",
    );
    expect(series.map((point) => point.month)).toEqual([
      "2024-06",
      "2025-06",
    ]);
  });
});

describe("valueMonthsBefore", () => {
  const points = [
    { month: "2024-06", value: 90, txCount: 1 },
    { month: "2024-10", value: 100, txCount: 1 },
    { month: "2025-10", value: 110, txCount: 1 },
  ];

  it("returns the latest point at or before the cutoff month", () => {
    expect(valueMonthsBefore(points, "2025-10", 12)).toEqual(points[1]);
    expect(valueMonthsBefore(points, "2025-10", 16)).toEqual(points[0]);
  });

  it("returns null when there is no earlier point", () => {
    expect(valueMonthsBefore(points, "2024-06", 12)).toBeNull();
    expect(valueMonthsBefore(points, "2025-10", 18)).toBeNull();
  });
});

describe("summarizeTrend", () => {
  it("computes latest, range, and an exact annual change", () => {
    const summary = summarizeTrend([
      { month: "2024-10", value: 100, txCount: 2 },
      { month: "2025-04", value: 80, txCount: 4 },
      { month: "2025-10", value: 110, txCount: 6 },
    ]);

    expect(summary.latest).toEqual({
      month: "2025-10",
      value: 110,
      txCount: 6,
    });
    expect(summary.changePct).toBeCloseTo(10);
    expect(summary.changeBasisMonth).toBe("2024-10");
    expect(summary.changeIsAnnual).toBe(true);
    expect(summary.min).toBe(80);
    expect(summary.max).toBe(110);
    expect(summary.months).toBe(3);
  });

  it("reports a non-annual basis instead of pretending it is 12 months", () => {
    const summary = summarizeTrend([
      { month: "2023-02", value: 90, txCount: 1 },
      { month: "2025-06", value: 100, txCount: 1 },
    ]);

    expect(summary.changeBasisMonth).toBe("2023-02");
    expect(summary.changeIsAnnual).toBe(false);
    expect(summary.changePct).toBeCloseTo(11.111, 2);
  });

  it("returns nulls for an empty series", () => {
    expect(summarizeTrend([])).toEqual({
      latest: null,
      changePct: null,
      changeBasisMonth: null,
      changeIsAnnual: false,
      min: null,
      max: null,
      months: 0,
    });
  });
});

describe("buildChartGeometry", () => {
  const options = {
    width: 200,
    height: 100,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 10,
    paddingBottom: 10,
  };

  it("maps x by calendar month so gaps are visible", () => {
    const geometry = buildChartGeometry(
      [
        { month: "2025-01", value: 10, txCount: 1 },
        { month: "2025-02", value: 20, txCount: 1 },
        { month: "2025-05", value: 15, txCount: 1 },
      ],
      options,
    );

    expect(geometry).not.toBeNull();
    expect(geometry?.points).toHaveLength(3);
    expect(geometry?.points[0].x).toBe(20);
    // February is one of four months from January to May.
    expect(geometry?.points[1].x).toBe(60);
    expect(geometry?.points[2].x).toBe(180);
    expect(geometry?.points[1].y).toBe(10);
    expect(geometry?.linePath.startsWith("M")).toBe(true);
    expect(geometry?.areaPath.endsWith("Z")).toBe(true);
    expect(geometry?.yTicks).toHaveLength(4);
  });

  it("handles a single point and a flat series", () => {
    const geometry = buildChartGeometry(
      [{ month: "2025-01", value: 10, txCount: 1 }],
      options,
    );

    expect(geometry?.points).toHaveLength(1);
    expect(geometry?.points[0].x).toBe(100);
    expect(geometry?.linePath).toContain("M100.0");

    const flat = buildChartGeometry(
      [
        { month: "2025-01", value: 5, txCount: 1 },
        { month: "2025-02", value: 5, txCount: 1 },
      ],
      options,
    );
    expect(flat?.yTicks.every((tick) => tick.value >= 0)).toBe(true);
  });

  it("keeps a flat zero series non-negative", () => {
    const geometry = buildChartGeometry(
      [
        { month: "2025-01", value: 0, txCount: 0 },
        { month: "2025-02", value: 0, txCount: 0 },
      ],
      options,
    );

    expect(geometry?.yTicks.map((tick) => tick.value)).toEqual([
      0, 1 / 3, 2 / 3, 1,
    ]);
    expect(geometry?.yTicks.every((tick) => tick.y <= 90)).toBe(true);
  });

  it("returns null for no points", () => {
    expect(buildChartGeometry([])).toBeNull();
  });
});

describe("applyTrendView", () => {
  const points = [
    { month: "2024-01", value: 100, txCount: 1 },
    { month: "2025-01", value: 110, txCount: 2 },
    { month: "2025-02", value: 99, txCount: 3 },
  ];

  it("leaves level points unchanged", () => {
    expect(applyTrendView(points, "level")).toEqual(points);
  });

  it("indexes from the first positive point", () => {
    expect(
      applyTrendView(
        [
          { month: "2024-01", value: 0, txCount: 0 },
          { month: "2024-02", value: 50, txCount: 1 },
          { month: "2024-03", value: 75, txCount: 1 },
        ],
        "index",
      ),
    ).toEqual([
      { month: "2024-02", value: 100, txCount: 1 },
      { month: "2024-03", value: 150, txCount: 1 },
    ]);
  });

  it("computes 12-month percentage change with the nearest earlier point", () => {
    const changes = applyTrendView(points, "change");
    expect(changes).toHaveLength(2);
    expect(changes[0].month).toBe("2025-01");
    expect(changes[0].value).toBeCloseTo(10);
    expect(changes[1].month).toBe("2025-02");
    expect(changes[1].value).toBeCloseTo(-1);
  });
});

describe("buildMultiLineGeometry", () => {
  it("puts multiple series on a shared scale and month axis", () => {
    const geometry = buildMultiLineGeometry(
      [
        {
          id: "sale",
          label: "Sale",
          points: [
            { month: "2025-01", value: 100, txCount: 1 },
            { month: "2025-03", value: 120, txCount: 1 },
          ],
        },
        {
          id: "rent",
          label: "Rent",
          points: [
            { month: "2025-01", value: 50, txCount: 1 },
            { month: "2025-02", value: 60, txCount: 1 },
          ],
        },
      ],
      {
        width: 200,
        height: 100,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 10,
        paddingBottom: 10,
      },
    );

    expect(geometry?.series).toHaveLength(2);
    expect(geometry?.series[0].linePath.startsWith("M")).toBe(true);
    expect(geometry?.yTicks).toHaveLength(4);
    expect(geometry?.series[0].points).toHaveLength(2);
  });

  it("returns null when every series is empty", () => {
    expect(
      buildMultiLineGeometry([{ id: "a", label: "A", points: [] }]),
    ).toBeNull();
  });
});
