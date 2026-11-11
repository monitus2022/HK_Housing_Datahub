import type { EstateMonthlyHistory } from "../types";
import {
  formatMonth,
  parseMonth,
  WINDOWS,
  type TrendPoint,
  type TrendWindow,
} from "./trends";

export type EstateHistoryMetric = "sale" | "volume";

export const ESTATE_METRIC_LABELS: Record<EstateHistoryMetric, string> = {
  sale: "Sale net ft price",
  volume: "Transactions",
};

export const ESTATE_METRIC_UNITS: Record<EstateHistoryMetric, string> = {
  sale: "HKD/ft²",
  volume: "transactions",
};

export function estateHistorySeries(
  history: EstateMonthlyHistory,
  estateId: string,
  metric: EstateHistoryMetric,
  window: TrendWindow = "60",
): TrendPoint[] {
  const entries = history.estates[estateId];
  if (!entries || entries.length === 0) return [];

  const points: TrendPoint[] = [];
  for (const [monthIndex, txCount, avgPrice] of entries) {
    const month = history.months[monthIndex];
    if (!month) continue;
    if (metric === "sale" && !(avgPrice > 0)) continue;
    points.push({
      month,
      value: metric === "volume" ? txCount : avgPrice,
      txCount,
    });
  }

  points.sort((left, right) => left.month.localeCompare(right.month));

  const windowDef = WINDOWS.find((item) => item.value === window);
  const limit = windowDef?.months ?? null;
  const latest = points[points.length - 1];
  const latestIndex = latest ? parseMonth(latest.month) : null;
  if (limit === null || latestIndex === null) return points;

  const cutoff = formatMonth(latestIndex - (limit - 1));
  return points.filter((point) => point.month >= cutoff);
}
