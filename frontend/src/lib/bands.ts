import type { DistrictPriceBand } from "../types";
import {
  DEFAULT_CHART_OPTIONS,
  formatMonth,
  parseMonth,
  WINDOWS,
  type ChartOptions,
  type ChartTick,
  type TrendWindow,
} from "./trends";

export type BandMetric = "sale" | "rent";

export interface BandPoint {
  month: string;
  count: number;
  p25: number;
  median: number;
  p75: number;
}

export function buildBandSeries(
  rows: DistrictPriceBand[],
  districtId: string,
  metric: BandMetric,
  window: TrendWindow = "60",
): BandPoint[] {
  if (!districtId) return [];

  const points: BandPoint[] = [];
  for (const row of rows) {
    if (row.district_id !== districtId) continue;
    const count = metric === "sale" ? row.sale_count : row.rent_count;
    const p25 = metric === "sale" ? row.sale_p25 : row.rent_p25;
    const median = metric === "sale" ? row.sale_median : row.rent_median;
    const p75 = metric === "sale" ? row.sale_p75 : row.rent_p75;
    if (
      count <= 0 ||
      p25 === null ||
      median === null ||
      p75 === null ||
      p25 <= 0 ||
      median <= 0 ||
      p75 <= 0
    ) {
      continue;
    }
    points.push({ month: row.month, count, p25, median, p75 });
  }

  points.sort((left, right) => left.month.localeCompare(right.month));
  const windowDef = WINDOWS.find((item) => item.value === window);
  const limit = windowDef?.months ?? null;
  if (limit === null || points.length === 0) return points;

  const latestIndex = parseMonth(points[points.length - 1].month);
  if (latestIndex === null) return points;
  const cutoff = formatMonth(latestIndex - (limit - 1));
  return points.filter((point) => point.month >= cutoff);
}

export interface BandChartPoint {
  x: number;
  yMedian: number;
  yP25: number;
  yP75: number;
  point: BandPoint;
}

export interface BandGeometry {
  points: BandChartPoint[];
  medianPath: string;
  bandPath: string;
  yTicks: ChartTick[];
}

export function buildBandGeometry(
  points: BandPoint[],
  options: ChartOptions = DEFAULT_CHART_OPTIONS,
): BandGeometry | null {
  if (points.length === 0) return null;

  let min = Math.min(...points.map((point) => point.p25));
  let max = Math.max(...points.map((point) => point.p75));
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min = Math.max(0, min - pad);
    max += pad;
  }
  const span = max - min;
  const plotWidth =
    options.width - options.paddingLeft - options.paddingRight;
  const plotHeight =
    options.height - options.paddingTop - options.paddingBottom;

  const monthIndexes = points
    .map((point) => parseMonth(point.month))
    .filter((index): index is number => index !== null);
  const minMonth = Math.min(...monthIndexes);
  const maxMonth = Math.max(...monthIndexes);
  const monthSpan = maxMonth - minMonth;

  const chartPoints: BandChartPoint[] = points.map((point, index) => {
    const monthIndex = parseMonth(point.month);
    const x =
      monthIndex === null || monthSpan === 0
        ? options.paddingLeft +
          (points.length === 1
            ? plotWidth / 2
            : (index / (points.length - 1)) * plotWidth)
        : options.paddingLeft +
          ((monthIndex - minMonth) / monthSpan) * plotWidth;
    const y = (value: number) =>
      options.paddingTop + (1 - (value - min) / span) * plotHeight;
    return {
      x,
      yMedian: y(point.median),
      yP25: y(point.p25),
      yP75: y(point.p75),
      point,
    };
  });

  const medianPath = chartPoints
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"}${item.x.toFixed(1)} ${item.yMedian.toFixed(1)}`,
    )
    .join(" ");

  const upper = chartPoints
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"}${item.x.toFixed(1)} ${item.yP75.toFixed(1)}`,
    )
    .join(" ");
  const lower = [...chartPoints]
    .reverse()
    .map((item) => `L${item.x.toFixed(1)} ${item.yP25.toFixed(1)}`)
    .join(" ");
  const bandPath = `${upper} ${lower} Z`;

  const tickCount = 4;
  const yTicks: ChartTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const value = min + (span * index) / (tickCount - 1);
    yTicks.push({
      value,
      y: options.paddingTop + (1 - (value - min) / span) * plotHeight,
    });
  }

  return { points: chartPoints, medianPath, bandPath, yTicks };
}
