import type { DistrictMonthly } from "../types";

export type TrendMetric = "sale" | "rent" | "volume";

export type TrendView = "level" | "index" | "change";

export interface TrendDistrict {
  id: string;
  nameEn: string;
  nameZh: string;
}

export interface TrendPoint {
  month: string;
  value: number;
  txCount: number;
}

export interface TrendSummary {
  latest: TrendPoint | null;
  changePct: number | null;
  /** The month the change is measured against; null when there is no basis. */
  changeBasisMonth: string | null;
  /** True when `changeBasisMonth` is exactly 12 months before `latest`. */
  changeIsAnnual: boolean;
  min: number | null;
  max: number | null;
  months: number;
}

export const METRIC_LABELS: Record<TrendMetric, string> = {
  sale: "Sale net ft price",
  rent: "Rent net ft price",
  volume: "Transactions",
};

export const METRIC_UNITS: Record<TrendMetric, string> = {
  sale: "HKD/ft²",
  rent: "HKD/ft²",
  volume: "transactions",
};

export const VIEW_LABELS: Record<TrendView, string> = {
  level: "Level",
  index: "Indexed to 100",
  change: "12-month change",
};

const WINDOWS = [
  { value: "24", label: "Last 2 years", months: 24 },
  { value: "60", label: "Last 5 years", months: 60 },
  { value: "120", label: "Last 10 years", months: 120 },
  { value: "all", label: "All months", months: null },
] as const;

export type TrendWindow = (typeof WINDOWS)[number]["value"];

export { WINDOWS };

function metricValue(
  row: DistrictMonthly,
  metric: TrendMetric,
): number | null {
  switch (metric) {
    case "sale":
      return row.avg_net_ft_price !== null && row.avg_net_ft_price > 0
        ? row.avg_net_ft_price
        : null;
    case "rent":
      return row.avg_net_ft_rent !== null && row.avg_net_ft_rent > 0
        ? row.avg_net_ft_rent
        : null;
    case "volume":
    default:
      return row.tx_count;
  }
}

export function listTrendDistricts(rows: DistrictMonthly[]): TrendDistrict[] {
  const districts = new Map<string, TrendDistrict>();
  for (const row of rows) {
    if (districts.has(row.district_id)) continue;
    districts.set(row.district_id, {
      id: row.district_id,
      nameEn: row.district_name_en || row.district_id,
      nameZh: row.district_name_zh || "",
    });
  }
  return [...districts.values()].sort((left, right) =>
    left.nameEn.localeCompare(right.nameEn),
  );
}

/**
 * Build the series for a district and metric.
 *
 * A window is a calendar span ending at the latest month that has a value for
 * the selected metric, not a count of points. Sparse districts therefore keep
 * an honest date range: a "last 2 years" series starts 24 months back even if
 * the district only traded in a few of those months.
 */
export function buildTrendSeries(
  rows: DistrictMonthly[],
  districtId: string,
  metric: TrendMetric,
  window: TrendWindow = "60",
): TrendPoint[] {
  if (!districtId) return [];

  const points: TrendPoint[] = [];
  for (const row of rows) {
    if (row.district_id !== districtId) continue;
    const value = metricValue(row, metric);
    if (value === null || Number.isNaN(value)) continue;
    points.push({
      month: row.month,
      value,
      txCount: metric === "rent" ? row.rent_tx_count : row.tx_count,
    });
  }

  points.sort((left, right) => left.month.localeCompare(right.month));
  const windowDef = WINDOWS.find((item) => item.value === window);
  const limit = windowDef?.months ?? null;
  if (limit === null || points.length === 0) return points;

  const latestIndex = parseMonth(points[points.length - 1].month);
  if (latestIndex === null) return points;

  // Inclusive span: the latest month counts as month 1 of the window.
  const cutoff = formatMonth(latestIndex - (limit - 1));
  return points.filter((point) => point.month >= cutoff);
}

export function parseMonth(month: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function formatMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The latest point at or before `month - monthsBack`, for a fair comparison. */
export function valueMonthsBefore(
  points: TrendPoint[],
  month: string,
  monthsBack: number,
): TrendPoint | null {
  const target = parseMonth(month);
  if (target === null) return null;
  const cutoff = formatMonth(target - monthsBack);

  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].month <= cutoff) return points[index];
  }
  return null;
}

export function summarizeTrend(points: TrendPoint[]): TrendSummary {
  if (points.length === 0) {
    return {
      latest: null,
      changePct: null,
      changeBasisMonth: null,
      changeIsAnnual: false,
      min: null,
      max: null,
      months: 0,
    };
  }

  const latest = points[points.length - 1];
  const previous = valueMonthsBefore(points, latest.month, 12);
  const changePct =
    previous !== null && previous.value !== 0
      ? ((latest.value - previous.value) / previous.value) * 100
      : null;

  let min = latest.value;
  let max = latest.value;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }

  const target = parseMonth(latest.month);

  return {
    latest,
    changePct,
    changeBasisMonth: previous?.month ?? null,
    changeIsAnnual:
      previous !== null &&
      target !== null &&
      previous.month === formatMonth(target - 12),
    min,
    max,
    months: points.length,
  };
}

/** Apply a presentation view without changing the underlying monthly rows. */
export function applyTrendView(
  points: TrendPoint[],
  view: TrendView,
): TrendPoint[] {
  if (view === "level" || points.length === 0) return points;

  if (view === "index") {
    const baseIndex = points.findIndex((point) => point.value > 0);
    if (baseIndex < 0) return [];
    const base = points[baseIndex].value;
    return points.slice(baseIndex).map((point) => ({
      ...point,
      value: (point.value / base) * 100,
    }));
  }

  const changes: TrendPoint[] = [];
  for (const point of points) {
    const previous = valueMonthsBefore(points, point.month, 12);
    if (previous === null || previous.value === 0) continue;
    changes.push({
      month: point.month,
      value: ((point.value - previous.value) / previous.value) * 100,
      txCount: point.txCount,
    });
  }
  return changes;
}

export interface ChartPoint {
  x: number;
  y: number;
  point: TrendPoint;
}

export interface ChartTick {
  value: number;
  y: number;
}

export interface ChartGeometry {
  points: ChartPoint[];
  linePath: string;
  areaPath: string;
  yTicks: ChartTick[];
}

export interface ChartOptions {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  width: 760,
  height: 300,
  paddingLeft: 64,
  paddingRight: 18,
  paddingTop: 18,
  paddingBottom: 34,
};

export function buildChartGeometry(
  points: TrendPoint[],
  options: ChartOptions = DEFAULT_CHART_OPTIONS,
): ChartGeometry | null {
  if (points.length === 0) return null;

  let min = points[0].value;
  let max = points[0].value;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  if (min === max) {
    if (min >= 0) {
      // Keep count and price axes non-negative: a flat zero series would
      // otherwise render negative ticks.
      max = min === 0 ? 1 : min * 1.1;
      min = 0;
    } else {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    }
  }

  const plotWidth =
    options.width - options.paddingLeft - options.paddingRight;
  const plotHeight =
    options.height - options.paddingTop - options.paddingBottom;
  const span = max - min;

  // Map x by calendar month, not array index, so missing months leave a gap.
  const monthIndexes = points.map((point) => parseMonth(point.month));
  const known = monthIndexes.filter((index): index is number => index !== null);
  const minMonth = known.length > 0 ? Math.min(...known) : null;
  const maxMonth = known.length > 0 ? Math.max(...known) : null;
  const monthSpan =
    minMonth !== null && maxMonth !== null ? maxMonth - minMonth : 0;

  const chartPoints: ChartPoint[] = points.map((point, index) => {
    const monthIndex = monthIndexes[index];
    const x =
      monthIndex === null || minMonth === null || monthSpan === 0
        ? options.paddingLeft +
          (points.length === 1
            ? plotWidth / 2
            : (index / (points.length - 1)) * plotWidth)
        : options.paddingLeft +
          ((monthIndex - minMonth) / monthSpan) * plotWidth;
    return {
      x,
      y: options.paddingTop + (1 - (point.value - min) / span) * plotHeight,
      point,
    };
  });

  const linePath = chartPoints
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"}${item.x.toFixed(1)} ${item.y.toFixed(1)}`,
    )
    .join(" ");

  const baseline = options.paddingTop + plotHeight;
  const first = chartPoints[0];
  const last = chartPoints[chartPoints.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)} ${baseline.toFixed(
    1,
  )} L${first.x.toFixed(1)} ${baseline.toFixed(1)} Z`;

  const tickCount = 4;
  const yTicks: ChartTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const value = min + (span * index) / (tickCount - 1);
    yTicks.push({
      value,
      y: options.paddingTop + (1 - (value - min) / span) * plotHeight,
    });
  }

  return { points: chartPoints, linePath, areaPath, yTicks };
}

export interface MultiLineSeries {
  id: string;
  label: string;
  points: TrendPoint[];
}

export interface MultiLineGeometrySeries {
  id: string;
  label: string;
  points: ChartPoint[];
  linePath: string;
}

export interface MultiLineGeometry {
  series: MultiLineGeometrySeries[];
  yTicks: ChartTick[];
}

/** Shared-scale geometry for one or more metric series on a common month axis. */
export function buildMultiLineGeometry(
  series: MultiLineSeries[],
  options: ChartOptions = DEFAULT_CHART_OPTIONS,
): MultiLineGeometry | null {
  const nonEmpty = series
    .map((item) => ({
      ...item,
      points: [...item.points].sort((left, right) =>
        left.month.localeCompare(right.month),
      ),
    }))
    .filter((item) => item.points.length > 0);
  if (nonEmpty.length === 0) return null;

  const allPoints = nonEmpty.flatMap((item) => item.points);
  let min = allPoints[0].value;
  let max = allPoints[0].value;
  for (const point of allPoints) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  if (min === max) {
    if (min >= 0) {
      max = min === 0 ? 1 : min * 1.1;
      min = 0;
    } else {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    }
  }

  const monthIndexes = allPoints
    .map((point) => parseMonth(point.month))
    .filter((index): index is number => index !== null);
  const minMonth = Math.min(...monthIndexes);
  const maxMonth = Math.max(...monthIndexes);
  const monthSpan = maxMonth - minMonth;

  const plotWidth =
    options.width - options.paddingLeft - options.paddingRight;
  const plotHeight =
    options.height - options.paddingTop - options.paddingBottom;
  const span = max - min;

  const geometrySeries: MultiLineGeometrySeries[] = nonEmpty.map((item) => {
    const chartPoints: ChartPoint[] = item.points.map((point) => {
      const monthIndex = parseMonth(point.month);
      const x =
        monthIndex === null || monthSpan === 0
          ? options.paddingLeft + plotWidth / 2
          : options.paddingLeft +
            ((monthIndex - minMonth) / monthSpan) * plotWidth;
      return {
        x,
        y: options.paddingTop + (1 - (point.value - min) / span) * plotHeight,
        point,
      };
    });
    return {
      ...item,
      points: chartPoints,
      linePath: chartPoints
        .map(
          (item, index) =>
            `${index === 0 ? "M" : "L"}${item.x.toFixed(1)} ${item.y.toFixed(1)}`,
        )
        .join(" "),
    };
  });

  const tickCount = 4;
  const yTicks: ChartTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const value = min + (span * index) / (tickCount - 1);
    yTicks.push({
      value,
      y: options.paddingTop + (1 - (value - min) / span) * plotHeight,
    });
  }

  return { series: geometrySeries, yTicks };
}
