import { describe, expect, it } from "vitest";
import type { RvdBenchmarks } from "../types";
import {
  buildRvdClassSeries,
  buildRvdSeries,
  RVD_CLASSES,
  RVD_CLASS_DEFINITIONS,
  rvdHkdM2ToFt2,
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
