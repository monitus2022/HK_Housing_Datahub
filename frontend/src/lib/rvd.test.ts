import { describe, expect, it } from "vitest";
import type { RvdBenchmarks } from "../types";
import {
  buildEstateRvdBenchmark,
  buildRvdClassSeries,
  buildRvdSeries,
  RVD_CLASSES,
  RVD_CLASS_DEFINITIONS,
  rvdClassForNetAreaFt2,
  rvdHkdM2ToFt2,
  rvdRegionForName,
  toggleRvdClass,
} from "./rvd";

const data: RvdBenchmarks = {
  rents: [
    {
      region_code: "hk",
      property_class: "A",
      month: "2026-08",
      value_hkd_m2: 500,
      is_provisional: 1,
    },
    {
      region_code: "hk",
      property_class: "A",
      month: "2026-09",
      value_hkd_m2: 510,
      is_provisional: 1,
    },
    {
      region_code: "kln",
      property_class: "A",
      month: "2026-09",
      value_hkd_m2: 450,
      is_provisional: 0,
    },
  ],
  prices: [
    {
      region_code: "hk",
      property_class: "B",
      month: "2026-09",
      value_hkd_m2: 150000,
      is_provisional: 1,
    },
  ],
  indices: [
    {
      index_type: "price",
      property_class: "ALL",
      month: "2026-09",
      value: 320,
      is_provisional: 1,
    },
    {
      index_type: "rental",
      property_class: "ALL",
      month: "2026-09",
      value: 212,
      is_provisional: 0,
    },
    {
      index_type: "price",
      property_class: "A",
      month: "2026-09",
      value: 340,
      is_provisional: 0,
    },
  ],
  yields: [
    {
      property_class: "A",
      month: "2026-09",
      yield_pct: 3.5,
      is_provisional: 1,
    },
  ],
};

describe("buildRvdSeries", () => {
  it("selects the requested index and flags provisional months", () => {
    const result = buildRvdSeries(data, {
      measure: "price_index",
      propertyClass: "ALL",
      regionCode: "hk",
    });

    expect(result.points).toEqual([
      { month: "2026-09", value: 320, txCount: 0 },
    ]);
    expect(result.provisionalMonths).toEqual(["2026-09"]);
    expect(result.unit).toBe("index");
    expect(result.title).toContain("Class ALL");
  });

  it("filters rent by region and class", () => {
    const result = buildRvdSeries(data, {
      measure: "rent",
      propertyClass: "A",
      regionCode: "hk",
    });

    expect(result.points.map((point) => point.value)).toEqual([500, 510]);
    expect(result.provisionalMonths).toEqual(["2026-08", "2026-09"]);
    expect(result.unit).toBe("hkd_m2");
    expect(result.title).toContain("Hong Kong Island");
  });

  it("selects yields and returns an empty result for missing series", () => {
    expect(
      buildRvdSeries(data, {
        measure: "yield",
        propertyClass: "A",
        regionCode: "hk",
      }).points,
    ).toEqual([{ month: "2026-09", value: 3.5, txCount: 0 }]);

    expect(
      buildRvdSeries(data, {
        measure: "price",
        propertyClass: "E",
        regionCode: "nt",
      }).points,
    ).toEqual([]);
    expect(buildRvdSeries(null, {
      measure: "price",
      propertyClass: "A",
      regionCode: "hk",
    }).points).toEqual([]);
  });

  it("converts HKD per square metre to HKD per square foot", () => {
    expect(rvdHkdM2ToFt2(100000)).toBeCloseTo(9290.3, 1);
  });
});

describe("buildRvdClassSeries", () => {
  it("returns multiple class lines and filters empty classes", () => {
    const indices = buildRvdClassSeries(data, "price_index", "hk", [
      "ALL",
      "A",
      "E",
    ]);
    expect(indices.map((series) => series.label)).toEqual([
      "Class ALL",
      "Class A",
    ]);

    const rents = buildRvdClassSeries(data, "rent", "hk", ["A", "B"]);
    expect(rents).toHaveLength(1);
    expect(rents[0].label).toBe("Class A");
    expect(rents[0].unit).toBe("hkd_m2");
  });
});

describe("RVD class controls", () => {
  it("exposes the five saleable-area classes and their definitions", () => {
    expect(RVD_CLASSES).toEqual(["A", "B", "C", "D", "E"]);
    expect(RVD_CLASS_DEFINITIONS.map((item) => item.id)).toEqual(RVD_CLASSES);
  });

  it("prevents removing the last selected class", () => {
    expect(toggleRvdClass(RVD_CLASSES, "B")).toEqual(["A", "C", "D", "E"]);
    expect(toggleRvdClass(["B"], "B")).toEqual(["B"]);
    expect(toggleRvdClass(["A"], "C")).toEqual(["A", "C"]);
  });
});

describe("estate RVD class mapping", () => {
  it("maps HKP net area in square feet to saleable-area classes", () => {
    expect(rvdClassForNetAreaFt2(39.9 * 10.7639)).toBe("A");
    expect(rvdClassForNetAreaFt2(40.1 * 10.7639)).toBe("B");
    expect(rvdClassForNetAreaFt2(69.9 * 10.7639)).toBe("B");
    expect(rvdClassForNetAreaFt2(70.1 * 10.7639)).toBe("C");
    expect(rvdClassForNetAreaFt2(99.9 * 10.7639)).toBe("C");
    expect(rvdClassForNetAreaFt2(100.1 * 10.7639)).toBe("D");
    expect(rvdClassForNetAreaFt2(159.9 * 10.7639)).toBe("D");
    expect(rvdClassForNetAreaFt2(160.1 * 10.7639)).toBe("E");
  });

  it("treats exact boundaries as the upper class despite float division", () => {
    expect(rvdClassForNetAreaFt2(40 * 10.7639)).toBe("B");
    expect(rvdClassForNetAreaFt2(70 * 10.7639)).toBe("C");
    expect(rvdClassForNetAreaFt2(100 * 10.7639)).toBe("D");
    expect(rvdClassForNetAreaFt2(160 * 10.7639)).toBe("E");
    expect(rvdClassForNetAreaFt2(40 * 10.7639 - 0.5)).toBe("A");
  });

  it("classifies a typical Hong Kong flat", () => {
    expect(rvdClassForNetAreaFt2(472)).toBe("B");
  });

  it("rejects missing or invalid areas", () => {
    expect(rvdClassForNetAreaFt2(null)).toBeNull();
    expect(rvdClassForNetAreaFt2(undefined)).toBeNull();
    expect(rvdClassForNetAreaFt2(0)).toBeNull();
    expect(rvdClassForNetAreaFt2(-5)).toBeNull();
    expect(rvdClassForNetAreaFt2(Number.NaN)).toBeNull();
  });

  it("maps HKP region names to RVD region codes", () => {
    expect(rvdRegionForName("Hong Kong Island")).toBe("hk");
    expect(rvdRegionForName("Kowloon")).toBe("kln");
    expect(rvdRegionForName("New Territories")).toBe("nt");
    expect(rvdRegionForName(" kowloon ")).toBe("kln");
    expect(rvdRegionForName("Mars")).toBeNull();
    expect(rvdRegionForName(null)).toBeNull();
  });
});

describe("buildEstateRvdBenchmark", () => {
  it("picks the latest rent and territory yield for the region and class", () => {
    const benchmark = buildEstateRvdBenchmark(data, "Hong Kong Island", 430);

    expect(benchmark).not.toBeNull();
    expect(benchmark?.propertyClass).toBe("A");
    expect(benchmark?.regionLabel).toBe("Hong Kong Island");
    expect(benchmark?.asOfMonth).toBe("2026-09");
    expect(benchmark?.rent?.hkdM2).toBe(510);
    expect(benchmark?.rent?.hkdFt2).toBeCloseTo(47.38, 1);
    expect(benchmark?.rent?.isProvisional).toBe(true);
    expect(benchmark?.price).toBeNull();
    expect(benchmark?.yieldPct?.value).toBe(3.5);
    expect(benchmark?.yieldPct?.month).toBe("2026-09");
    expect(benchmark?.yieldPct?.isProvisional).toBe(true);
  });

  it("returns only the price series when rent is missing", () => {
    const benchmark = buildEstateRvdBenchmark(data, "Hong Kong Island", 600);

    expect(benchmark?.propertyClass).toBe("B");
    expect(benchmark?.rent).toBeNull();
    expect(benchmark?.price?.hkdM2).toBe(150000);
    expect(benchmark?.price?.isProvisional).toBe(true);
    expect(benchmark?.asOfMonth).toBe("2026-09");
  });

  it("returns null when the region or class has no RVD series", () => {
    expect(buildEstateRvdBenchmark(data, "New Territories", 472)).toBeNull();
    expect(buildEstateRvdBenchmark(data, "Mars", 472)).toBeNull();
    expect(buildEstateRvdBenchmark(data, "Hong Kong Island", null)).toBeNull();
    expect(buildEstateRvdBenchmark(data, "Hong Kong Island", 0)).toBeNull();
    expect(buildEstateRvdBenchmark(null, "Hong Kong Island", 472)).toBeNull();
  });
});
