import type {
  DistrictMonthly,
  EstateSummary,
  RecentTransaction,
} from "../types";
import {
  formatMonth,
  parseMonth,
  type TrendPoint,
} from "./trends";

export interface OverviewKpis {
  medianPrice: number | null;
  medianRent: number | null;
  medianYield: number | null;
  transactions12m: number;
  rentTransactions12m: number;
  estatesWithSales: number;
  estatesWithRent: number;
  asOfMonth: string | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Estate-level medians and coverage from the already-served summary rows. */
export function buildOverviewKpis(estates: EstateSummary[]): OverviewKpis {
  const prices: number[] = [];
  const rents: number[] = [];
  const yields: number[] = [];
  let transactions12m = 0;
  let rentTransactions12m = 0;
  let latestDate: string | null = null;

  for (const estate of estates) {
    const price = estate.avg_net_ft_price_12m;
    const rent = estate.avg_net_ft_rent_12m;
    if (price !== null && price > 0) prices.push(price);
    if (rent !== null && rent > 0) rents.push(rent);
    if (price !== null && price > 0 && rent !== null && rent > 0) {
      yields.push((rent * 12 * 100) / price);
    }
    transactions12m += estate.tx_count_12m || 0;
    rentTransactions12m += estate.rent_count_12m || 0;
    if (
      estate.latest_tx_date &&
      (latestDate === null || estate.latest_tx_date > latestDate)
    ) {
      latestDate = estate.latest_tx_date;
    }
  }

  return {
    medianPrice: median(prices),
    medianRent: median(rents),
    medianYield: median(yields),
    transactions12m,
    rentTransactions12m,
    estatesWithSales: prices.length,
    estatesWithRent: rents.length,
    asOfMonth: latestDate ? latestDate.slice(0, 7) : null,
  };
}

interface MonthlyAggregate {
  month: string;
  saleValue: number | null;
  saleCount: number;
  rentValue: number | null;
  rentCount: number;
}

function aggregateHongKong(rows: DistrictMonthly[]): MonthlyAggregate[] {
  const months = new Map<
    string,
    {
      saleSum: number;
      saleWeight: number;
      rentSum: number;
      rentWeight: number;
      saleCount: number;
      rentCount: number;
    }
  >();

  for (const row of rows) {
    const bucket = months.get(row.month) ?? {
      saleSum: 0,
      saleWeight: 0,
      rentSum: 0,
      rentWeight: 0,
      saleCount: 0,
      rentCount: 0,
    };
    if (row.avg_net_ft_price !== null && row.avg_net_ft_price > 0 && row.tx_count > 0) {
      bucket.saleSum += row.avg_net_ft_price * row.tx_count;
      bucket.saleWeight += row.tx_count;
    }
    if (
      row.avg_net_ft_rent !== null &&
      row.avg_net_ft_rent > 0 &&
      row.rent_tx_count > 0
    ) {
      bucket.rentSum += row.avg_net_ft_rent * row.rent_tx_count;
      bucket.rentWeight += row.rent_tx_count;
    }
    bucket.saleCount += row.tx_count;
    bucket.rentCount += row.rent_tx_count;
    months.set(row.month, bucket);
  }

  return [...months.entries()]
    .map(([month, bucket]) => ({
      month,
      saleValue:
        bucket.saleWeight > 0 ? bucket.saleSum / bucket.saleWeight : null,
      saleCount: bucket.saleCount,
      rentValue:
        bucket.rentWeight > 0 ? bucket.rentSum / bucket.rentWeight : null,
      rentCount: bucket.rentCount,
    }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

export interface MarketPulsePoint {
  month: string;
  saleIndex: number | null;
  rentIndex: number | null;
  saleValue: number | null;
  rentValue: number | null;
  txCount: number;
  rentCount: number;
}

export interface MarketPulse {
  /** First month with both sale and rent values; null when they never overlap. */
  baseMonth: string | null;
  points: MarketPulsePoint[];
  saleSeries: TrendPoint[];
  rentSeries: TrendPoint[];
}

/**
 * Build a sale and rent pulse from district monthly rows.
 *
 * Pass one district's rows for a district pulse, or all rows for Hong Kong.
 * District averages are weighted by transaction counts. Both series are
 * indexed to 100 at the first month where sale and rent overlap, so the lines
 * are comparable even though rent history is shorter.
 */
export function buildMarketPulse(
  rows: DistrictMonthly[],
  windowMonths = 60,
): MarketPulse {
  const monthly = aggregateHongKong(rows);
  if (monthly.length === 0) {
    return {
      baseMonth: null,
      points: [],
      saleSeries: [],
      rentSeries: [],
    };
  }

  const latest = monthly[monthly.length - 1].month;
  const latestIndex = parseMonth(latest);
  const cutoff =
    latestIndex === null
      ? null
      : formatMonth(latestIndex - (windowMonths - 1));
  const windowed =
    cutoff === null ? monthly : monthly.filter((row) => row.month >= cutoff);

  const base = windowed.find(
    (row) => row.saleValue !== null && row.rentValue !== null,
  );
  if (!base || base.saleValue === null || base.rentValue === null) {
    return {
      baseMonth: null,
      points: windowed.map((row) => ({
        month: row.month,
        saleIndex: null,
        rentIndex: null,
        saleValue: row.saleValue,
        rentValue: row.rentValue,
        txCount: row.saleCount,
        rentCount: row.rentCount,
      })),
      saleSeries: [],
      rentSeries: [],
    };
  }

  const baseSale = base.saleValue;
  const baseRent = base.rentValue;
  const covered = windowed.filter((row) => row.month >= base.month);
  const points: MarketPulsePoint[] = covered.map((row) => ({
    month: row.month,
    saleIndex:
      row.saleValue === null ? null : (row.saleValue / baseSale) * 100,
    rentIndex:
      row.rentValue === null ? null : (row.rentValue / baseRent) * 100,
    saleValue: row.saleValue,
    rentValue: row.rentValue,
    txCount: row.saleCount,
    rentCount: row.rentCount,
  }));

  const saleSeries: TrendPoint[] = points
    .filter(
      (point): point is MarketPulsePoint & { saleIndex: number } =>
        point.saleIndex !== null,
    )
    .map((point) => ({
      month: point.month,
      value: point.saleIndex,
      txCount: point.txCount,
    }));
  const rentSeries: TrendPoint[] = points
    .filter(
      (point): point is MarketPulsePoint & { rentIndex: number } =>
        point.rentIndex !== null,
    )
    .map((point) => ({
      month: point.month,
      value: point.rentIndex,
      txCount: point.rentCount,
    }));

  return {
    baseMonth: base.month,
    points,
    saleSeries,
    rentSeries,
  };
}

export interface DistrictLeagueEntry {
  id: string;
  nameEn: string;
  nameZh: string;
  month: string;
  price: number;
  changePct: number | null;
  changeBasisMonth: string | null;
  yieldPct: number | null;
  txCount: number;
  rentCount: number;
}

interface DistrictMonthPoint {
  month: string;
  value: number;
  count: number;
}

function latestSaleAndRent(rows: DistrictMonthly[]) {
  const districts = new Map<
    string,
    {
      nameEn: string;
      nameZh: string;
      sale: DistrictMonthPoint[];
      rent: DistrictMonthPoint[];
    }
  >();

  for (const row of rows) {
    const district = districts.get(row.district_id) ?? {
      nameEn: row.district_name_en || row.district_id,
      nameZh: row.district_name_zh || "",
      sale: [],
      rent: [],
    };
    if (row.avg_net_ft_price !== null && row.avg_net_ft_price > 0) {
      district.sale.push({
        month: row.month,
        value: row.avg_net_ft_price,
        count: row.tx_count,
      });
    }
    if (row.avg_net_ft_rent !== null && row.avg_net_ft_rent > 0) {
      district.rent.push({
        month: row.month,
        value: row.avg_net_ft_rent,
        count: row.rent_tx_count,
      });
    }
    districts.set(row.district_id, district);
  }

  return districts;
}

function previousPoint(
  points: DistrictMonthPoint[],
  month: string,
  monthsBack: number,
): DistrictMonthPoint | null {
  const target = parseMonth(month);
  if (target === null) return null;
  const cutoff = formatMonth(target - monthsBack);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].month <= cutoff) return points[index];
  }
  return null;
}

/** Latest sale price, annual change, yield proxy, and volume by district. */
export function buildDistrictLeague(
  rows: DistrictMonthly[],
): DistrictLeagueEntry[] {
  const districts = latestSaleAndRent(rows);
  const entries: DistrictLeagueEntry[] = [];

  for (const [id, district] of districts) {
    district.sale.sort((left, right) => left.month.localeCompare(right.month));
    district.rent.sort((left, right) => left.month.localeCompare(right.month));
    const latest = district.sale[district.sale.length - 1];
    if (!latest) continue;

    const previous = previousPoint(district.sale, latest.month, 12);
    const changePct =
      previous !== null && previous.value !== 0
        ? ((latest.value - previous.value) / previous.value) * 100
        : null;

    let rent: DistrictMonthPoint | null = null;
    for (let index = district.rent.length - 1; index >= 0; index -= 1) {
      if (district.rent[index].month <= latest.month) {
        rent = district.rent[index];
        break;
      }
    }
    entries.push({
      id,
      nameEn: district.nameEn,
      nameZh: district.nameZh,
      month: latest.month,
      price: latest.value,
      changePct,
      changeBasisMonth: previous?.month ?? null,
      yieldPct:
        rent !== null ? ((rent.value * 12) / latest.value) * 100 : null,
      txCount: latest.count,
      rentCount: rent?.count ?? 0,
    });
  }

  return entries.sort((left, right) => right.price - left.price);
}

/** Keep all rows for All Hong Kong, or only one district's rows. */
export function filterDistrictRows(
  rows: DistrictMonthly[],
  districtId: string,
): DistrictMonthly[] {
  return districtId
    ? rows.filter((row) => row.district_id === districtId)
    : rows;
}

export interface TopEstateEntry {
  id: string;
  name: string;
  district: string;
  totalValue: number;
  txCount: number;
}

export interface TopEstatesResult {
  entries: TopEstateEntry[];
  start: string | null;
  end: string | null;
  months: number;
}

function shiftMonths(date: string, months: number): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCMonth(parsed.getUTCMonth() - months);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Rank estates by total transacted value over a trailing window.
 *
 * The window is relative to `asOf` (the snapshot's sale data-through date), or
 * the latest transaction date when `asOf` is omitted. Only positive prices are
 * summed; estates without one are omitted.
 */
export function buildTopEstatesByValue(
  transactions: RecentTransaction[],
  limit = 10,
  months = 12,
  asOf: string | null = null,
): TopEstatesResult {
  let end = asOf;
  if (!end) {
    for (const transaction of transactions) {
      if (transaction.tx_date && (!end || transaction.tx_date > end)) {
        end = transaction.tx_date;
      }
    }
  }
  const start = end ? shiftMonths(end, months) : null;

  const grouped = new Map<
    string,
    { name: string; district: string; totalValue: number; txCount: number }
  >();
  for (const transaction of transactions) {
    if (start && transaction.tx_date <= start) continue;
    if (end && transaction.tx_date > end) continue;
    if (transaction.price === null || transaction.price <= 0) continue;
    const existing = grouped.get(transaction.estate_id);
    if (existing) {
      existing.totalValue += transaction.price;
      existing.txCount += 1;
    } else {
      grouped.set(transaction.estate_id, {
        name: transaction.estate_name_en || transaction.estate_id,
        district: transaction.district_name_en || "",
        totalValue: transaction.price,
        txCount: 1,
      });
    }
  }

  const entries = [...grouped.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort(
      (left, right) =>
        right.totalValue - left.totalValue ||
        right.txCount - left.txCount ||
        left.name.localeCompare(right.name),
    )
    .slice(0, Math.max(1, limit));

  return { entries, start, end, months };
}

export interface YieldPoint {
  id: string;
  nameEn: string;
  nameZh: string;
  price: number;
  yieldPct: number;
  txCount: number;
}

export function buildYieldPoints(
  league: DistrictLeagueEntry[],
): YieldPoint[] {
  return league
    .filter(
      (entry): entry is DistrictLeagueEntry & { yieldPct: number } =>
        entry.yieldPct !== null && entry.yieldPct > 0,
    )
    .map((entry) => ({
      id: entry.id,
      nameEn: entry.nameEn,
      nameZh: entry.nameZh,
      price: entry.price,
      yieldPct: entry.yieldPct,
      txCount: entry.txCount,
    }));
}

export interface ScatterPoint {
  x: number;
  y: number;
  point: YieldPoint;
}

export interface ScatterTick {
  value: number;
  position: number;
}

export interface ScatterGeometry {
  points: ScatterPoint[];
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
}

export interface ScatterOptions {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

export const DEFAULT_SCATTER_OPTIONS: ScatterOptions = {
  width: 760,
  height: 320,
  paddingLeft: 64,
  paddingRight: 22,
  paddingTop: 18,
  paddingBottom: 44,
};

function paddedRange(values: number[]): { min: number; max: number } {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

export function buildScatterGeometry(
  points: YieldPoint[],
  options: ScatterOptions = DEFAULT_SCATTER_OPTIONS,
): ScatterGeometry | null {
  if (points.length === 0) return null;

  const xRange = paddedRange(points.map((point) => point.price));
  const yRange = paddedRange(points.map((point) => point.yieldPct));
  const plotWidth =
    options.width - options.paddingLeft - options.paddingRight;
  const plotHeight =
    options.height - options.paddingTop - options.paddingBottom;

  const scatterPoints = points.map((point) => ({
    x:
      options.paddingLeft +
      ((point.price - xRange.min) / (xRange.max - xRange.min)) * plotWidth,
    y:
      options.paddingTop +
      (1 - (point.yieldPct - yRange.min) / (yRange.max - yRange.min)) *
        plotHeight,
    point,
  }));

  const tickCount = 4;
  const xTicks: ScatterTick[] = [];
  const yTicks: ScatterTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / (tickCount - 1);
    xTicks.push({
      value: xRange.min + (xRange.max - xRange.min) * ratio,
      position: options.paddingLeft + plotWidth * ratio,
    });
    yTicks.push({
      value: yRange.min + (yRange.max - yRange.min) * ratio,
      position: options.paddingTop + plotHeight * (1 - ratio),
    });
  }

  return { points: scatterPoints, xTicks, yTicks };
}
