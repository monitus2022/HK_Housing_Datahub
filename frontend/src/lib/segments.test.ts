import { describe, expect, it } from "vitest";
import type { SegmentSummary } from "../types";
import { buildSegmentBars } from "./segments";

function segment(
  value: string,
  saleMedian: number | null,
  rentMedian: number | null,
  yieldPct: number | null,
): SegmentSummary {
  return {
    segment_type: "bedroom",
    segment_value: value,
    sale_count: saleMedian === null ? 0 : 10,
    sale_estates: 5,
    sale_p25: null,
    sale_median: saleMedian,
    sale_p75: null,
    rent_count: rentMedian === null ? 0 : 4,
    rent_estates: 3,
    rent_p25: null,
    rent_median: rentMedian,
    rent_p75: null,
    window_start: "2025-01-01",
    window_end: "2026-01-01",
    gross_yield_pct: yieldPct,
  };
}

describe("buildSegmentBars", () => {
  const rows = [
    segment("0-1", 16000, 54, 4),
    segment("2", 15000, 44, 3.5),
    segment("4+", 21000, 48, 2.7),
    segment("Unknown", 9000, 46, 6),
  ];

  it("filters type and excludes Unknown by default", () => {
    const bars = buildSegmentBars(rows, "bedroom", "sale");
    expect(bars.map((bar) => bar.value)).toEqual(["4+", "0-1", "2"]);
  });

  it("can include Unknown and uses rent medians", () => {
    const bars = buildSegmentBars(rows, "bedroom", "rent", 12, true);
    expect(bars[0]).toMatchObject({ value: "0-1", metricValue: 54 });
    expect(bars.some((bar) => bar.value === "Unknown")).toBe(true);
  });

  it("sorts and limits yield comparisons", () => {
    const bars = buildSegmentBars(rows, "bedroom", "yield", 2, true);
    expect(bars.map((bar) => bar.value)).toEqual(["Unknown", "0-1"]);
    expect(bars[0].metricValue).toBe(6);
  });
});
