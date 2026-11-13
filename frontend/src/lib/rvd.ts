import type { RvdBenchmarks } from "../types";
import type { TrendPoint } from "./trends";

export type RvdMeasure =
  | "price_index"
  | "rent_index"
  | "rent"
  | "price"
  | "yield";

export interface RvdSelection {
  measure: RvdMeasure;
  propertyClass: string;
  regionCode: string;
}

export interface RvdSeriesResult {
  points: TrendPoint[];
  provisionalMonths: string[];
  unit: "index" | "hkd_m2" | "percent";
  title: string;
}

export interface RvdClassSeries extends RvdSeriesResult {
  propertyClass: string;
  label: string;
}

export const RVD_MEASURES: { id: RvdMeasure; label: string }[] = [
  { id: "price_index", label: "Price index (1999 = 100)" },
  { id: "rent_index", label: "Rental index (1999 = 100)" },
  { id: "price", label: "Average price" },
  { id: "rent", label: "Average rent" },
  { id: "yield", label: "Market yield" },
];

export const RVD_REGIONS = [
  { id: "hk", label: "Hong Kong Island" },
  { id: "kln", label: "Kowloon" },
  { id: "nt", label: "New Territories" },
];

export const RVD_CLASSES = ["A", "B", "C", "D", "E"];

export const RVD_CLASS_DEFINITIONS: { id: string; label: string }[] = [
  { id: "A", label: "under 40 m² saleable area" },
  { id: "B", label: "40 to 69.9 m² saleable area" },
  { id: "C", label: "70 to 99.9 m² saleable area" },
  { id: "D", label: "100 to 159.9 m² saleable area" },
  { id: "E", label: "160 m² or more saleable area" },
];

export function rvdHkdM2ToFt2(value: number): number {
  return value / 10.7639;
}

function regionLabel(code: string): string {
  return RVD_REGIONS.find((region) => region.id === code)?.label ?? code;
}

function provisional(rows: { month: string; is_provisional: number }[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.is_provisional === 1)
        .map((row) => row.month),
    ),
  ].sort();
}

export function buildRvdSeries(
  data: RvdBenchmarks | null,
  selection: RvdSelection,
): RvdSeriesResult {
  if (!data) {
    return {
      points: [],
      provisionalMonths: [],
      unit: "index",
      title: "RVD benchmarks",
    };
  }

  const measure = selection.measure;
  if (measure === "price_index" || measure === "rent_index") {
    const indexType = measure === "price_index" ? "price" : "rental";
    const rows = data.indices.filter(
      (row) =>
        row.index_type === indexType &&
        row.property_class === selection.propertyClass &&
        row.value !== null,
    );
    const points = rows
      .map((row) => ({
        month: row.month,
        value: row.value as number,
        txCount: 0,
      }))
      .sort((left, right) => left.month.localeCompare(right.month));
    return {
      points,
      provisionalMonths: provisional(rows),
      unit: "index",
      title: `${measure === "price_index" ? "Price" : "Rental"} index · Class ${selection.propertyClass}`,
    };
  }

  if (measure === "yield") {
    const rows = data.yields.filter(
      (row) =>
        row.property_class === selection.propertyClass &&
        row.yield_pct !== null,
    );
    return {
      points: rows
        .map((row) => ({
          month: row.month,
          value: row.yield_pct as number,
          txCount: 0,
        }))
        .sort((left, right) => left.month.localeCompare(right.month)),
      provisionalMonths: provisional(rows),
      unit: "percent",
      title: `Market yield · Class ${selection.propertyClass}`,
    };
  }

  const rows = (
    measure === "rent" ? data.rents : data.prices
  ).filter(
    (row) =>
      row.region_code === selection.regionCode &&
      row.property_class === selection.propertyClass &&
      row.value_hkd_m2 !== null,
  );
  return {
    points: rows
      .map((row) => ({
        month: row.month,
        value: row.value_hkd_m2 as number,
        txCount: 0,
      }))
      .sort((left, right) => left.month.localeCompare(right.month)),
    provisionalMonths: provisional(rows),
    unit: "hkd_m2",
    title: `${measure === "rent" ? "Average rent" : "Average price"} · ${regionLabel(
      selection.regionCode,
    )} · Class ${selection.propertyClass}`,
  };
}

export function buildRvdClassSeries(
  data: RvdBenchmarks | null,
  measure: RvdMeasure,
  regionCode: string,
  classes: string[] = RVD_CLASSES,
): RvdClassSeries[] {
  return classes
    .map((propertyClass) => {
      const result = buildRvdSeries(data, {
        measure,
        propertyClass,
        regionCode,
      });
      return {
        ...result,
        propertyClass,
        label: `Class ${propertyClass}`,
      };
    })
    .filter((result) => result.points.length > 0);
}
