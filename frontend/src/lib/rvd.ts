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

export function toggleRvdClass(
  current: string[],
  propertyClass: string,
): string[] {
  if (current.includes(propertyClass)) {
    return current.length === 1
      ? current
      : current.filter((item) => item !== propertyClass);
  }
  return RVD_CLASSES.filter(
    (item) => current.includes(item) || item === propertyClass,
  );
}

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

const SQFT_PER_SQM = 10.7639;

const RVD_REGION_BY_NAME: Record<string, string> = {
  "hong kong island": "hk",
  kowloon: "kln",
  "new territories": "nt",
};

/**
 * Map an HKP region name to an RVD region code.
 *
 * Estates carry `region_name_en` (Hong Kong Island / Kowloon / New
 * Territories), which matches RVD's three private-domestic regions.
 */
export function rvdRegionForName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  return RVD_REGION_BY_NAME[name.trim().toLowerCase()] ?? null;
}

/**
 * Pick an RVD saleable-area class from an HKP net area in square feet.
 *
 * This is a convenience mapping for context only: HKP net area is not RVD
 * saleable area, and the two are not guaranteed to agree at the boundaries.
 */
export function rvdClassForNetAreaFt2(
  netAreaFt2: number | null | undefined,
): string | null {
  if (netAreaFt2 === null || netAreaFt2 === undefined) return null;
  if (!Number.isFinite(netAreaFt2) || netAreaFt2 <= 0) return null;
  const areaM2 = netAreaFt2 / SQFT_PER_SQM;
  if (areaM2 < 40) return "A";
  if (areaM2 < 70) return "B";
  if (areaM2 < 100) return "C";
  if (areaM2 < 160) return "D";
  return "E";
}

export interface EstateRvdBenchmark {
  regionCode: string;
  regionLabel: string;
  propertyClass: string;
  classDefinition: string;
  asOfMonth: string;
  rent: {
    hkdM2: number;
    hkdFt2: number;
    isProvisional: boolean;
  } | null;
  price: {
    hkdM2: number;
    hkdFt2: number;
    isProvisional: boolean;
  } | null;
  yieldPct: {
    value: number;
    isProvisional: boolean;
  } | null;
}

function latestUnitPoint(data: RvdBenchmarks | null, selection: RvdSelection) {
  const series = buildRvdSeries(data, selection);
  const latest = series.points[series.points.length - 1];
  if (!latest) return null;
  return {
    month: latest.month,
    hkdM2: latest.value,
    hkdFt2: rvdHkdM2ToFt2(latest.value),
    isProvisional: series.provisionalMonths.includes(latest.month),
  };
}

/**
 * Build the RVD context shown in the estate drawer.
 *
 * Returns null when the estate has no usable net area, the region is unknown,
 * or the snapshot has no RVD rent/price series for that region and class.
 */
export function buildEstateRvdBenchmark(
  data: RvdBenchmarks | null,
  regionName: string | null | undefined,
  netAreaFt2: number | null | undefined,
): EstateRvdBenchmark | null {
  if (!data) return null;
  const regionCode = rvdRegionForName(regionName);
  const propertyClass = rvdClassForNetAreaFt2(netAreaFt2);
  if (!regionCode || !propertyClass) return null;

  const rent = latestUnitPoint(data, {
    measure: "rent",
    propertyClass,
    regionCode,
  });
  const price = latestUnitPoint(data, {
    measure: "price",
    propertyClass,
    regionCode,
  });
  if (!rent && !price) return null;

  const yieldSeries = buildRvdSeries(data, {
    measure: "yield",
    propertyClass,
    regionCode,
  });
  const latestYield = yieldSeries.points[yieldSeries.points.length - 1];

  const months = [rent?.month, price?.month]
    .filter((month): month is string => Boolean(month))
    .sort();

  return {
    regionCode,
    regionLabel: regionLabel(regionCode),
    propertyClass,
    classDefinition:
      RVD_CLASS_DEFINITIONS.find((item) => item.id === propertyClass)?.label ??
      "",
    asOfMonth: months[months.length - 1] ?? "",
    rent: rent
      ? {
          hkdM2: rent.hkdM2,
          hkdFt2: rent.hkdFt2,
          isProvisional: rent.isProvisional,
        }
      : null,
    price: price
      ? {
          hkdM2: price.hkdM2,
          hkdFt2: price.hkdFt2,
          isProvisional: price.isProvisional,
        }
      : null,
    yieldPct: latestYield
      ? {
          value: latestYield.value,
          isProvisional: yieldSeries.provisionalMonths.includes(
            latestYield.month,
          ),
        }
      : null,
  };
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
