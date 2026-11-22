import { describe, expect, it } from "vitest";
import {
  DISTRICTS,
  districtsInScope,
  normalisePlace,
  REGIONS,
  resolvePlace,
  scopeForDistrict,
  scopeLabel,
  SUBREGIONS,
  subregionsInRegion,
} from "./geo";

describe("geography model", () => {
  it("covers the published hierarchy", () => {
    expect(REGIONS).toHaveLength(3);
    expect(SUBREGIONS).toHaveLength(20);
    expect(DISTRICTS).toHaveLength(60);
  });

  it("keeps every child pointing at an existing parent", () => {
    const regionIds = new Set(REGIONS.map((region) => region.id));
    const subregionIds = new Set(SUBREGIONS.map((sub) => sub.id));
    for (const subregion of SUBREGIONS) {
      expect(regionIds.has(subregion.regionId)).toBe(true);
    }
    for (const district of DISTRICTS) {
      expect(subregionIds.has(district.subregionId)).toBe(true);
    }
  });

  it("sums estate counts without double counting", () => {
    const total = DISTRICTS.reduce(
      (sum, district) => sum + district.estates,
      0,
    );
    expect(total).toBe(
      REGIONS.reduce((sum, region) => sum + region.estates, 0),
    );
  });
});

describe("cascade helpers", () => {
  it("lists subregions for a region and all subregions when empty", () => {
    const kowloon = REGIONS.find((region) => region.en === "Kowloon");
    expect(kowloon).toBeDefined();
    const scoped = subregionsInRegion(kowloon!.id);
    expect(scoped.length).toBeGreaterThan(0);
    expect(
      scoped.every((subregion) => subregion.regionId === kowloon!.id),
    ).toBe(true);
    expect(subregionsInRegion("")).toHaveLength(SUBREGIONS.length);
  });

  it("narrows districts by subregion, then by region", () => {
    const tko = SUBREGIONS.find((sub) => sub.en === "Tseung Kwan O");
    expect(tko).toBeDefined();
    const bySubregion = districtsInScope({ subregionId: tko!.id });
    expect(bySubregion).toHaveLength(5);
    expect(bySubregion.every((d) => d.subregionId === tko!.id)).toBe(true);

    const byRegion = districtsInScope({ regionId: tko!.regionId });
    expect(byRegion.length).toBeGreaterThanOrEqual(bySubregion.length);
    expect(districtsInScope({})).toHaveLength(DISTRICTS.length);
  });

  it("resolves a district to its full scope for deep links", () => {
    const district = DISTRICTS[0];
    const scope = scopeForDistrict(district.id);
    expect(scope?.districtId).toBe(district.id);
    expect(scope?.subregionId).toBe(district.subregionId);
    expect(scope?.regionId).toBeDefined();
    expect(scopeForDistrict("missing")).toBeNull();
  });
});

describe("place resolution", () => {
  it("resolves subregion, district and region names", () => {
    const tko = SUBREGIONS.find((sub) => sub.en === "Tseung Kwan O")!;
    expect(resolvePlace("Tseung Kwan O")?.subregionId).toBe(tko.id);
    expect(resolvePlace("將軍澳")?.subregionId).toBe(tko.id);

    const happy = DISTRICTS.find((d) =>
      d.aliases.includes("Happy Valley"),
    );
    expect(happy).toBeDefined();
    expect(resolvePlace("happy valley")?.districtId).toBe(happy!.id);

    const island = REGIONS.find((r) => r.en === "Hong Kong Island")!;
    expect(resolvePlace("香港島")?.regionId).toBe(island.id);
  });

  it("normalises punctuation, spacing and case", () => {
    expect(normalisePlace("Mid-Levels Central  / Admiralty")).toBe(
      "mid levels central admiralty",
    );
    const scope = resolvePlace("MID-LEVELS CENTRAL / ADMIRALTY");
    expect(scope?.districtId).toBeDefined();
    expect(scopeLabel(scope!)).toContain("Mid-Levels Central");
  });

  it("returns null for out-of-scope or unknown names", () => {
    expect(resolvePlace("Shenzhen")).toBeNull();
    expect(resolvePlace("")).toBeNull();
    expect(resolvePlace("   ")).toBeNull();
  });

  it("does not resolve ambiguous abbreviations before the gazetteer", () => {
    expect(resolvePlace("TKO")).toBeNull();
  });

  it("prefers the broader level when a label exists at two levels", () => {
    // "Tsuen Wan" names both a subregion and a district. The subregion wins so
    // the filter returns a superset instead of silently narrowing.
    const subregion = SUBREGIONS.find((sub) => sub.en === "Tsuen Wan");
    const district = DISTRICTS.find((item) => item.en === "Tsuen Wan");
    expect(subregion).toBeDefined();
    expect(district).toBeDefined();

    const scope = resolvePlace("Tsuen Wan");
    expect(scope?.subregionId).toBe(subregion!.id);
    expect(scope?.districtId).toBeUndefined();
  });
});
