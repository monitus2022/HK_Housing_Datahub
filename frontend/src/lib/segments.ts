import type { SegmentSummary } from "../types";

export type SegmentMetric = "sale" | "rent" | "yield";

export interface SegmentBar {
  value: string;
  count: number;
  metricValue: number;
  median: number | null;
}

export function buildSegmentBars(
  rows: SegmentSummary[],
  segmentType: string,
  metric: SegmentMetric,
  limit = 12,
  includeUnknown = false,
): SegmentBar[] {
  const bars: SegmentBar[] = [];

  for (const row of rows) {
    if (row.segment_type !== segmentType) continue;
    if (!includeUnknown && row.segment_value === "Unknown") continue;

    if (metric === "yield") {
      if (row.gross_yield_pct === null || row.gross_yield_pct <= 0) continue;
      bars.push({
        value: row.segment_value,
        count: row.sale_count ?? 0,
        metricValue: row.gross_yield_pct,
        median: row.sale_median,
      });
      continue;
    }

    const median = metric === "sale" ? row.sale_median : row.rent_median;
    const count = metric === "sale" ? row.sale_count : row.rent_count;
    if (median === null || median <= 0 || !count) continue;
    bars.push({
      value: row.segment_value,
      count,
      metricValue: median,
      median,
    });
  }

  return bars
    .sort(
      (left, right) =>
        right.metricValue - left.metricValue ||
        right.count - left.count ||
        left.value.localeCompare(right.value),
    )
    .slice(0, Math.max(1, limit));
}
