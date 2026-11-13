import { describe, expect, it } from "vitest";
import type { DistrictPriceBand } from "../types";
import { buildBandGeometry, buildBandSeries } from "./bands";

function row(
  month: string,
  sale: [number, number, number] | null,
  rent: [number, number, number] | null,
): DistrictPriceBand {
  return {
    district_id: "D1",
    district_name_en: "District One",
    district_name_zh: "",
    month,
    sale_count: sale ? 10 : 0,
    sale_p25: sale?.[0] ?? null,
    sale_median: sale?.[1] ?? null,
    sale_p75: sale?.[2] ?? null,
    rent_count: rent ? 5 : 0,
    rent_p25: rent?.[0] ?? null,
    rent_median: rent?.[1] ?? null,
    rent_p75: rent?.[2] ?? null,
    gross_yield_pct: sale && rent ? (rent[1] * 12 * 100) / sale[1] : null,
  };
}

describe("buildBandSeries", () => {
  const rows = [
    row("2020-01-01", [1, 1, 1], null),
    row("2024-01", [10000, 12000, 15000], [40, 50, 60]),
    row("2025-01", [11000, 13000, 17000], [42, 52, 65]),
  ];

  it("filters district, metric, and window", () => {
    expect(buildBandSeries(rows, "D1", "sale", "24")).toEqual([
      {
        month: "2024-01",
        count: 10,
        p25: 10000,
        median: 12000,
        p75: 15000,
      },
      {
        month: "2025-01",
        count: 10,
        p25: 11000,
        median: 13000,
        p75: 17000,
      },
    ]);
  });

  it("returns rent bands and ignores missing values", () => {
    const series = buildBandSeries(rows, "D1", "rent", "all");
    expect(series).toHaveLength(2);
    expect(series[1].median).toBe(52);
  });

  it("builds median and p25-p75 geometry", () => {
    const geometry = buildBandGeometry(
      buildBandSeries(rows, "D1", "sale", "24"),
      {
        width: 200,
        height: 100,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 10,
        paddingBottom: 10,
      },
    );

    expect(geometry?.points).toHaveLength(2);
    expect(geometry?.medianPath.startsWith("M")).toBe(true);
    expect(geometry?.bandPath.endsWith("Z")).toBe(true);
    expect(geometry?.yTicks).toHaveLength(4);
    expect(geometry?.points[0].yP75).toBeLessThan(
      geometry?.points[0].yP25 ?? 0,
    );
  });
});
