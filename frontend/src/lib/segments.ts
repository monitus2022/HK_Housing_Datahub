import type { SegmentSummary } from "../types";

export type SegmentMetric = "sale" | "rent" | "yield";

/** Groups below this many transactions are marked as low sample. */
export const MIN_SEGMENT_SAMPLE = 20;

export interface SegmentBar {
  value: string;
  count: number;
  metricValue: number;
  median: number | null;
  lowSample: boolean;
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
      const count = row.sale_count ?? 0;
      bars.push({
        value: row.segment_value,
        count,
        metricValue: row.gross_yield_pct,
        median: row.sale_median,
        lowSample: count < MIN_SEGMENT_SAMPLE,
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
      lowSample: count < MIN_SEGMENT_SAMPLE,
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
