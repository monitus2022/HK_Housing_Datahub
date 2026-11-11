import { describe, expect, it } from "vitest";
import type { EstateMonthlyHistory } from "../types";
import { estateHistorySeries } from "./estateHistory";

const history: EstateMonthlyHistory = {
  months: ["2024-01", "2024-02", "2024-03", "2025-01"],
  estates: {
    E1: [
      [0, 1, 10000],
      [1, 3, 12000],
      [2, 2, 0],
      [3, 4, 15000],
    ],
    E2: [[3, 1, 20000]],
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

  it("windows by calendar span ending at the estate's latest month", () => {
    const withOld: EstateMonthlyHistory = {
      months: [...history.months, "2022-01"],
      estates: { E1: [...history.estates.E1, [4, 1, 9000]] },
    };
    const series = estateHistorySeries(withOld, "E1", "sale", "24");
    expect(series.map((point) => point.month)).toEqual([
      "2024-01",
      "2024-02",
      "2025-01",
    ]);
  });

  it("returns an empty series for an unknown estate", () => {
    expect(estateHistorySeries(history, "missing", "sale", "all")).toEqual([]);
  });
});
