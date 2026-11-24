import { describe, expect, it } from "vitest";
import {
  hintSpec,
  parseQuery,
  refineDirection,
  specToState,
  type NlParse,
} from "./lexicon";
import { searchStateToSearch } from "./searchState";

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

  it("consumes the word size after any vague word", () => {
    for (const text of ["small size", "large size", "middle size"]) {
      const spec = applied(parseQuery(text));
      expect(spec.unrecognised).toEqual([]);
      expect(spec.applied[0].defaulted).toBe(true);
    }
  });

  it("offers neighbouring bands while a default is applied", () => {
    const middle = applied(parseQuery("2 bed middle size"));
    expect(middle.hints.map((hint) => hint.label)).toEqual([
      "300–500 ft²",
      "500–700 ft²",
      "700–900 ft²",
    ]);
    expect(middle.hints.every((hint) => hint.level === "size")).toBe(true);

    // Choosing a band keeps the rest of the sentence.
    const picked = middle.hints[0];
    const next = hintSpec(middle, picked);
    expect(next.filters.bedrooms).toBe("2");
    expect(next.filters.minNetArea).toBe("300");
    expect(next.filters.maxNetArea).toBe("500");
    expect(next.applied).toContainEqual({
      field: "Area",
      value: "300–500 ft²",
    });
    // The chosen band is not a default, and the band hints are spent.
    expect(next.applied.every((slot) => !slot.defaulted)).toBe(true);
    expect(next.hints).toEqual([]);

    const small = applied(parseQuery("small flat"));
    expect(small.hints.map((hint) => hint.label)).toEqual([
      "≤ 300 ft²",
      "300–450 ft²",
    ]);

    const large = applied(parseQuery("large flat"));
    expect(large.hints.map((hint) => hint.label)).toEqual([
      "700–900 ft²",
      "900–1200 ft²",
    ]);
  });

  it("does not read a place as a size word", () => {
    // "mid levels central" is a district; only "mid size" is a band.
    const place = applied(parseQuery("flat in mid levels central"));
    expect(place.filters.minNetArea).toBe("");
    expect(place.filters.maxNetArea).toBe("");
    expect(place.filters.districtId).toBe("100101");

    const band = applied(parseQuery("mid size"));
    expect([band.filters.minNetArea, band.filters.maxNetArea]).toEqual([
      "400",
      "700",
    ]);
  });

  it("reads Chinese size words only next to 單位", () => {
    const big = applied(parseQuery("大單位"));
    expect([big.filters.minNetArea, big.filters.maxNetArea]).toEqual([
      "700",
      "",
    ]);

    const small = applied(parseQuery("細單位"));
    expect([small.filters.minNetArea, small.filters.maxNetArea]).toEqual([
      "",
      "400",
    ]);

    const middle = applied(parseQuery("中型單位"));
    expect([middle.filters.minNetArea, middle.filters.maxNetArea]).toEqual([
      "400",
      "700",
    ]);

    // 大埔 is a place, not a size.
    const taiPo = applied(parseQuery("大埔"));
    expect(taiPo.filters.minNetArea).toBe("");
    expect(taiPo.filters.maxNetArea).toBe("");
    expect(taiPo.filters.districtId || taiPo.filters.subregionId).not.toBe("");
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

  it("reads a decimal price", () => {
    const spec = applied(parseQuery("under 6.5m in TKO"));
    expect(spec.filters.maxPrice).toBe("6500000");
    expect(spec.filters.subregionId).toBe("2010");
  });

  it("does not mistake a place for an MTR line", () => {
    // "Tung Chung" is a district; only "Tung Chung Line" is the railway.
    const spec = applied(parseQuery("flat in Tung Chung"));
    expect(spec.filters.mtrLine).toBe("");
    expect(spec.filters.districtId).toBe("301803");
  });

  it("reads an MTR line", () => {
    const spec = applied(parseQuery("near the island line"));
    expect(spec.filters.mtrLine).toBe("Island Line");
  });

  it("reads a numeric school net", () => {
    const spec = applied(parseQuery("school net 41"));
    expect(spec.filters.schoolNet).toBe("Kowloon City");
    // The filter matches the net name, so say that it is not id 41 alone.
    expect(
      spec.applied.find((slot) => slot.field === "School net")?.value,
    ).toContain("all nets with this name");
  });

  it("shows a decimal back as the user typed it", () => {
    const parse = parseQuery("2 bed 6.5m");
    expect(parse.spec?.unrecognised).toEqual(["6.5m"]);
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
        .map((hint) =>
          hint.kind === "place"
            ? hint.scope.districtId || hint.scope.subregionId
            : "",
        )
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
    expect(parse.spec?.hints.map((hint) =>
        hint.kind === "place" ? hint.scope.regionId : "",
      ).sort()).toEqual([
      "10",
      "20",
      "30",
    ]);
  });

  it("anchors a direction to the visible cascade", () => {
    const spec = applied(parseQuery("east", { regionId: "10" }));
    expect(spec.filters.subregionId).toBe("1004");
  });

  it("names the direction and the level it is asking about", () => {
    expect(parseQuery("east").question).toBe("East of which region?");
    const anchored = parseQuery("east", { regionId: "20" });
    expect(anchored.kind).toBe("ambiguous");
    expect(anchored.question).toBe("East of which subregion?");
    expect(anchored.spec?.hints.map((hint) => hint.level)).toEqual([
      "subregion",
      "subregion",
      "subregion",
    ]);
    expect(
      anchored.spec?.hints.map((hint) =>
        hint.kind === "place" ? hint.scope.subregionId : "",
      ).sort(),
    ).toEqual(["2007", "2010", "2011"]);
  });

  it("refines a direction hint into real subregions", () => {
    // Clicking a region hint must not apply the whole region: re-parsing with
    // that anchor turns "east" into East Kowloon.
    const first = parseQuery("2 bed in east");
    expect(first.kind).toBe("ambiguous");
    expect(first.question).toBe("East of which region?");
    const refined = refineDirection(first, "20");
    expect(refined.kind).toBe("ambiguous");
    expect(refined.spec?.filters.bedrooms).toBe("2");
    expect(
      refined.spec?.hints.map((hint) =>
        hint.kind === "place" ? hint.scope.subregionId : "",
      ).sort(),
    ).toEqual(["2007", "2010", "2011"]);
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

  it("still reports ignored concepts when nothing else applies", () => {
    const view = parseQuery("sea view");
    expect(view.kind).toBe("unresolved");
    expect(view.spec?.ignored).toContain("View (no view data)");

    const mtr = parseQuery("mtr");
    expect(mtr.kind).toBe("unresolved");
    expect(mtr.spec?.ignored).toContain("MTR proximity (line-level data only)");
  });

  it("reports a school net that is not in the snapshot", () => {
    const parse = parseQuery("school net 19");
    expect(parse.kind).toBe("unresolved");
    expect(parse.spec?.ignored.join(" ")).toContain("not in this snapshot");
  });
});

describe("hint composition", () => {
  it("keeps a chosen band when the place is answered afterwards", () => {
    const parse = parseQuery("middle size in KT");
    expect(parse.kind).toBe("ambiguous");
    if (!parse.spec) throw new Error("expected a spec");

    const band = parse.spec.hints.find((hint) => hint.kind === "size");
    expect(band).toBeDefined();
    if (!band) return;
    const withBand = hintSpec(parse.spec, band);
    expect(withBand.filters.minNetArea).toBe("300");
    // Choosing a band does not answer the place question.
    expect(withBand.hints.some((hint) => hint.kind === "place")).toBe(true);

    const place = withBand.hints.find((hint) => hint.kind === "place");
    expect(place).toBeDefined();
    if (!place) return;
    const answered = hintSpec(withBand, place);
    expect(answered.filters.minNetArea).toBe("300");
    expect(answered.filters.maxNetArea).toBe("500");
    expect(
      answered.filters.subregionId || answered.filters.districtId,
    ).not.toBe("");
    expect(answered.hints).toEqual([]);
  });

  it("keeps a chosen band through direction refinement", () => {
    const parse = parseQuery("middle size in east");
    expect(parse.kind).toBe("ambiguous");
    if (!parse.spec) throw new Error("expected a spec");
    const band = parse.spec.hints.find((hint) => hint.kind === "size");
    if (!band) return;
    const withBand = hintSpec(parse.spec, band);
    const refined = refineDirection({ ...parse, spec: withBand }, "20");
    expect(refined.kind).toBe("ambiguous");
    expect(refined.spec?.filters.minNetArea).toBe("300");
    expect(refined.spec?.filters.maxNetArea).toBe("500");
    expect(refined.spec?.hints.every((hint) => hint.kind === "place")).toBe(
      true,
    );
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

  it("turns a hint into a shareable URL", () => {
    const parse = parseQuery("KT");
    const districtHint = parse.spec?.hints.find(
      (hint) =>
        hint.kind === "place" && hint.scope.districtId === "200903",
    );
    expect(districtHint).toBeDefined();
    if (!parse.spec || !districtHint) return;
    const url = searchStateToSearch(
      specToState(hintSpec(parse.spec, districtHint)),
    );
    expect(url).toContain("district=200903");
    expect(url).toContain("subregion=2009");
    expect(url).toContain("region=20");
  });
});
