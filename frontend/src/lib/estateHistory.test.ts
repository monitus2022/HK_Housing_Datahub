import { describe, expect, it } from "vitest";
import type { EstateMonthlyHistory } from "../types";
import { estateHistorySeries } from "./estateHistory";

const history: EstateMonthlyHistory = {
  months: ["2024-01", "2024-02", "2024-03", "2025-01"],
  estates: {
    E1: [
      [0, 1, 10000, 1, 40],
      [1, 3, 12000, 0, 0],
      [2, 2, 0, 2, 35],
      [3, 4, 15000, 0, 0],
    ],
    E2: [[3, 1, 20000, 0, 0]],
  },
};

describe("estateHistorySeries", () => {
  it("maps sale points, drops non-positive prices, and sorts by month", () => {
    expect(estateHistorySeries(history, "E1", "sale", "all")).toEqual([
      { month: "2024-01", value: 10000, txCount: 1 },
      { month: "2024-02", value: 12000, txCount: 3 },
      { month: "2025-01", value: 15000, txCount: 4 },
    ]);
  });

  it("keeps volume months even when the average price is zero", () => {
    const series = estateHistorySeries(history, "E1", "volume", "all");
    expect(series.map((point) => point.month)).toEqual([
      "2024-01",
      "2024-02",
      "2024-03",
      "2025-01",
    ]);
    expect(series[2].value).toBe(2);
  });

  it("maps rent points and drops months without rent", () => {
    expect(estateHistorySeries(history, "E1", "rent", "all")).toEqual([
      { month: "2024-01", value: 40, txCount: 1 },
      { month: "2024-03", value: 35, txCount: 2 },
    ]);
  });

  it("windows by calendar span ending at the estate's latest month", () => {
    const withOld: EstateMonthlyHistory = {
      months: [...history.months, "2022-01"],
      estates: { E1: [...history.estates.E1, [4, 1, 9000, 0, 0]] },
    };
    const series = estateHistorySeries(withOld, "E1", "sale", "24");
    expect(series.map((point) => point.month)).toEqual([
      "2024-01",
      "2024-02",
      "2025-01",
    ]);
  });

  it("keeps legacy three-field points sale-readable", () => {
    const legacy = {
      months: ["2024-01"],
      estates: { E1: [[0, 2, 10000]] },
    } as unknown as EstateMonthlyHistory;

    expect(estateHistorySeries(legacy, "E1", "sale", "all")).toEqual([
      { month: "2024-01", value: 10000, txCount: 2 },
    ]);
    expect(estateHistorySeries(legacy, "E1", "rent", "all")).toEqual([]);
  });

  it("keeps rent-only months out of the sale-volume series", () => {
    const mixed: EstateMonthlyHistory = {
      months: ["2024-01", "2024-02"],
      estates: { E1: [[0, 2, 10000, 0, 0], [1, 0, 0, 2, 40]] },
    };

    expect(
      estateHistorySeries(mixed, "E1", "volume", "all").map((p) => p.month),
    ).toEqual(["2024-01"]);
    const rent = estateHistorySeries(mixed, "E1", "rent", "all");
    expect(rent.map((p) => p.month)).toEqual(["2024-02"]);
    expect(rent[0].txCount).toBe(2);
  });

  it("returns an empty series for an unknown estate", () => {
    expect(estateHistorySeries(history, "missing", "sale", "all")).toEqual([]);
  });
});
