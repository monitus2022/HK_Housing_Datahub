import { describe, expect, it } from "vitest";
import { parseQuery, specToState, type NlParse } from "./lexicon";

function applied(parse: NlParse) {
  expect(parse.kind).toBe("applied");
  if (!parse.spec) throw new Error("expected a spec");
  return parse.spec;
}

describe("one utterance, one spec", () => {
  it("reads bedrooms and a place from a natural sentence", () => {
    const spec = applied(parseQuery("2 bedroom flat in TKO"));
    expect(spec.filters.bedrooms).toBe("2");
    expect(spec.filters.regionId).toBe("20");
    expect(spec.filters.subregionId).toBe("2010");
    expect(spec.filters.districtId).toBe("");
    expect(spec.unrecognised).toEqual([]);
    expect(spec.applied.map((slot) => slot.field)).toEqual([
      "Bedrooms",
      "Location",
    ]);
  });

  it("combines bedrooms, a price ceiling and a district", () => {
    const spec = applied(parseQuery("3 bed under 6m in Sha Tin"));
    expect(spec.filters.bedrooms).toBe("3");
    expect(spec.filters.maxPrice).toBe("6000000");
    expect(spec.filters.subregionId).toBe("3017");
    expect(spec.applied).toContainEqual({ field: "Price", value: "≤ HK$6M" });
  });

  it("reads a square-foot range", () => {
    const spec = applied(parseQuery("500-700 sq ft in Tuen Mun"));
    expect(spec.filters.minNetArea).toBe("500");
    expect(spec.filters.maxNetArea).toBe("700");
    expect(spec.filters.subregionId).toBe("3013");
  });

  it("marks a vague size word as a default", () => {
    const spec = applied(parseQuery("middle size in Kowloon City"));
    expect(spec.filters.minNetArea).toBe("400");
    expect(spec.filters.maxNetArea).toBe("700");
    expect(spec.filters.subregionId).toBe("2009");
    expect(spec.applied[0]).toEqual({
      field: "Area",
      value: "400–700 ft²",
      defaulted: true,
    });
  });

  it("maps ordering words onto the existing sort keys", () => {
    const spec = applied(parseQuery("cheapest 2 bed in Kwun Tong"));
    expect(spec.sort).toBe("latest_price");
    expect(spec.filters.bedrooms).toBe("2");
    expect(spec.filters.subregionId).toBe("2007");
    expect(spec.applied.map((slot) => slot.field)).toContain("Sort");
  });

  it("reads a room count the way people say it", () => {
    const spec = applied(parseQuery("3 room flat in Tsuen Wan"));
    expect(spec.filters.bedrooms).toBe("3");
    expect(spec.filters.subregionId).toBe("3011");
  });

  it("maps a vague size word to a marked band", () => {
    const spec = applied(parseQuery("big flat in Kowloon"));
    expect(spec.filters.minNetArea).toBe("700");
    expect(spec.filters.regionId).toBe("20");
    expect(spec.applied.some((slot) => slot.defaulted)).toBe(true);
  });

  it("reads an MTR line", () => {
    const spec = applied(parseQuery("near the island line"));
    expect(spec.filters.mtrLine).toBe("Island Line");
  });

  it("reads a numeric school net", () => {
    const spec = applied(parseQuery("school net 41"));
    expect(spec.filters.schoolNet).toBe("Kowloon City");
  });

  it("resolves a typo in the leftover phrase", () => {
    const spec = applied(parseQuery("shaitn"));
    expect(spec.filters.subregionId).toBe("3017");
  });
});

describe("no silent guessing", () => {
  it("asks which place for an ambiguous abbreviation", () => {
    const parse = parseQuery("KT");
    expect(parse.kind).toBe("ambiguous");
    expect(parse.question).toBe("Which place did you mean?");
    const spec = parse.spec;
    expect(spec?.filters.subregionId).toBe("");
    expect(spec?.filters.districtId).toBe("");
    expect(
      spec?.hints
        .map((hint) => hint.filters.districtId || hint.filters.subregionId)
        .sort(),
    ).toEqual(["2007", "200903"]);
  });

  it("keeps the non-location slots when the place is ambiguous", () => {
    const parse = parseQuery("2 bed in KT");
    expect(parse.kind).toBe("ambiguous");
    expect(parse.spec?.filters.bedrooms).toBe("2");
    expect(parse.spec?.filters.subregionId).toBe("");
    expect(parse.spec?.hints).toHaveLength(2);
  });

  it("asks which region for a bare direction", () => {
    const parse = parseQuery("east");
    expect(parse.kind).toBe("ambiguous");
    expect(parse.question).toBe("East of which region?");
    expect(parse.spec?.hints.map((hint) => hint.filters.regionId).sort()).toEqual([
      "10",
      "20",
      "30",
    ]);
  });

  it("anchors a direction to the visible cascade", () => {
    const spec = applied(parseQuery("east", { regionId: "10" }));
    expect(spec.filters.subregionId).toBe("1004");
  });

  it("refuses a place outside Hong Kong", () => {
    const parse = parseQuery("3 bed in Shenzhen");
    expect(parse.kind).toBe("refused");
    expect(parse.term).toBe("shenzhen");
    expect(parse.spec).toBeNull();
  });

  it("reports nonsense instead of matching something", () => {
    const parse = parseQuery("qwepoiqwepoi");
    expect(parse.kind).toBe("unresolved");
    expect(parse.spec).toBeNull();
  });

  it("still applies the parts it understood when one word is unknown", () => {
    const spec = applied(parseQuery("2 bed zzzz in TKO"));
    expect(spec.filters.bedrooms).toBe("2");
    expect(spec.filters.subregionId).toBe("2010");
    expect(spec.unrecognised).toEqual(["zzzz"]);
  });
});

describe("disclosure", () => {
  it("names concepts it cannot filter", () => {
    const spec = applied(parseQuery("sea view in TKO"));
    expect(spec.filters.subregionId).toBe("2010");
    expect(spec.ignored).toContain("View (no view data)");
  });

  it("says MTR filters are line-level only", () => {
    const spec = applied(parseQuery("2 bed in tko near mtr station"));
    expect(spec.ignored).toContain("MTR proximity (line-level data only)");
    expect(spec.filters.mtrLine).toBe("");
    expect(spec.filters.subregionId).toBe("2010");
  });

  it("says a size needs a direction", () => {
    const spec = applied(parseQuery("2 bed 500 sq ft in TKO"));
    expect(spec.filters.minNetArea).toBe("");
    expect(spec.ignored.join(" ")).toContain("Size 500 ft² without a range");
  });
});

describe("apply", () => {
  it("replaces the previous query rather than narrowing it", () => {
    const spec = applied(parseQuery("TKO"));
    const state = specToState(spec);
    expect(state.query).toBe("");
    expect(state.filters.bedrooms).toBe("");
    expect(state.filters.subregionId).toBe("2010");
    expect(state.sort).toBe("tx_count_12m");
  });
});
