import { describe, expect, it } from "vitest";
import {
  hintSpec,
  parseQuery,
  refineDirection,
  specToState,
  warmEstateIndex,
  type NlParse,
} from "./lexicon";
import { searchStateFromParams, searchStateToSearch } from "./searchState";

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

  it("handles the documented acceptance sentence", () => {
    const spec = applied(parseQuery("2 bed middle size in sha tin"));
    expect(spec.filters.bedrooms).toBe("2");
    expect(spec.filters.subregionId).toBe("3017");
    expect([spec.filters.minNetArea, spec.filters.maxNetArea]).toEqual([
      "400",
      "700",
    ]);
    expect(spec.hints).toHaveLength(3);
    // Every band hint keeps the rest of the sentence, including the scope.
    for (const hint of spec.hints) {
      const next = hintSpec(spec, hint);
      expect(next.filters.bedrooms).toBe("2");
      expect(next.filters.subregionId).toBe("3017");
    }
  });

  it("accepts the size spellings people use", () => {
    for (const text of ["medium sized flat", "mid sized flat"]) {
      const spec = applied(parseQuery(text));
      expect([spec.filters.minNetArea, spec.filters.maxNetArea]).toEqual([
        "400",
        "700",
      ]);
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
    if (!band) throw new Error("expected a band hint");
    const withBand = hintSpec(parse.spec, band);
    const refined = refineDirection({ ...parse, spec: withBand }, "20");
    expect(refined.kind).toBe("ambiguous");
    expect(refined.spec?.filters.minNetArea).toBe("300");
    expect(refined.spec?.filters.maxNetArea).toBe("500");
    // The refined sentence still asks its question: exactly the three subregion
    // hints survive, so an empty hint list is not mistaken for "all place hints".
    expect(refined.spec?.hints).toHaveLength(3);
    expect(refined.spec?.hints.every((hint) => hint.kind === "place")).toBe(
      true,
    );
  });

  it("keeps a chosen place when the band is chosen afterwards", () => {
    const parse = parseQuery("middle size in KT");
    expect(parse.kind).toBe("ambiguous");
    if (!parse.spec) throw new Error("expected a spec");

    const place = parse.spec.hints.find(
      (hint) => hint.kind === "place" && hint.level === "subregion",
    );
    if (!place) throw new Error("expected a subregion hint");
    const answered = hintSpec(parse.spec, place);
    expect(answered.filters.subregionId).toBe("2007");
    expect(answered.filters.districtId).toBe("");

    // The band hints survive answering the place question.
    const bands = answered.hints.filter((hint) => hint.kind === "size");
    expect(bands).toHaveLength(3);
    const withBand = hintSpec(answered, bands[0]);
    expect(withBand.filters.subregionId).toBe("2007");
    expect(withBand.filters.minNetArea).toBe("300");
    expect(withBand.filters.maxNetArea).toBe("500");
    const area = withBand.applied.find((slot) => slot.field === "Area");
    expect(area).toEqual({ field: "Area", value: "300–500 ft²" });
    expect(withBand.hints).toEqual([]);
  });

  it("keeps a refined direction when the band is chosen afterwards", () => {
    const parse = parseQuery("middle size in east");
    const refined = refineDirection(parse, "20");
    expect(refined.spec?.hints.some((hint) => hint.kind === "place")).toBe(
      true,
    );
    const band = refined.spec?.hints.find((hint) => hint.kind === "size");
    if (!refined.spec || !band) {
      throw new Error("refineDirection dropped the band hints");
    }
    const withBand = hintSpec(refined.spec, band);
    expect(withBand.filters.minNetArea).toBe("300");
    expect(withBand.filters.maxNetArea).toBe("500");
    // The place question is still open, now at subregion level.
    expect(withBand.hints.some((hint) => hint.kind === "place")).toBe(true);
    expect(
      withBand.hints
        .filter((hint) => hint.kind === "place")
        .map((hint) => (hint.kind === "place" ? hint.level : "")),
    ).toEqual(["subregion", "subregion", "subregion"]);
  });

  it("does not refine a parse that was not a direction", () => {
    const parse = parseQuery("TKO");
    expect(refineDirection(parse, "10")).toBe(parse);
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

const ESTATES = [
  { estate_name_en: "Taikoo Shing", estate_name_zh: "太古城" },
  { estate_name_en: "Mei Foo Sun Chuen", estate_name_zh: "美孚新邨" },
  { estate_name_en: "Amoy Gardens", estate_name_zh: "淘大花園" },
];

describe("estate names", () => {
  it("combines an estate with other slots", () => {
    const spec = applied(
      parseQuery("太古城 兩房 under 6m", { estates: ESTATES }),
    );
    expect(spec.estate?.name).toBe("太古城");
    expect(spec.filters.bedrooms).toBe("2");
    expect(spec.filters.maxPrice).toBe("6000000");
    expect(spec.unrecognised).toEqual([]);
    expect(spec.applied.map((slot) => slot.field)).toEqual([
      "Bedrooms",
      "Price",
      "Estate",
    ]);
  });

  it("matches the English name and removes the whole span", () => {
    const spec = applied(parseQuery("mei foo sun chuen 3 bed", { estates: ESTATES }));
    expect(spec.estate?.name).toBe("Mei Foo Sun Chuen");
    expect(spec.filters.bedrooms).toBe("3");
    expect(spec.unrecognised).toEqual([]);
  });

  it("prefers the estate to the district prefix", () => {
    // "Mei Foo Sun Chuen" starts with the district name "Mei Foo"; the estate
    // must win, and the rest must not leak into the district.
    const spec = applied(parseQuery("Mei Foo Sun Chuen", { estates: ESTATES }));
    expect(spec.estate?.name).toBe("Mei Foo Sun Chuen");
    expect(spec.filters.districtId).toBe("");
  });

  it("applies the estate as the text query, keeping the filters", () => {
    const spec = applied(parseQuery("太古城 兩房", { estates: ESTATES }));
    const state = specToState(spec);
    expect(state.query).toBe("太古城");
    expect(state.filters.bedrooms).toBe("2");
  });

  it("says how many estates share a name", () => {
    const shared = [
      ...ESTATES,
      { estate_name_en: "Amoy Gardens", estate_name_zh: "淘大花園" },
    ];
    const spec = applied(parseQuery("Amoy Gardens", { estates: shared }));
    expect(spec.estate?.count).toBe(2);
    expect(spec.applied.find((slot) => slot.field === "Estate")?.value).toBe(
      "Amoy Gardens (2 estates)",
    );
  });

  it("survives a direction hint being applied", () => {
    // Re-parsing for an anchored direction must see the same estate list, or the
    // estate disappears and "Mei Foo" leaks as a district.
    const parse = parseQuery("Mei Foo Sun Chuen east", { estates: ESTATES });
    expect(parse.spec?.estate?.name).toBe("Mei Foo Sun Chuen");
    const refined = refineDirection(parse, "20", { estates: ESTATES });
    expect(refined.spec?.estate?.name).toBe("Mei Foo Sun Chuen");
    expect(refined.spec?.filters.districtId).toBe("");
    expect(refined.kind).toBe("ambiguous");
  });

  it("wins over a district that shares its name", () => {
    const lohas = [{ estate_name_en: "Lohas Park", estate_name_zh: "日出康城" }];
    const spec = applied(parseQuery("Lohas Park", { estates: lohas }));
    expect(spec.estate?.name).toBe("Lohas Park");
    expect(spec.filters.districtId).toBe("");
  });

  it("round-trips the estate through the URL", () => {
    const spec = applied(parseQuery("太古城 兩房", { estates: ESTATES }));
    const state = specToState(spec);
    const restored = searchStateFromParams(searchStateToSearch(state));
    expect(restored.query).toBe("太古城");
    expect(restored.filters.bedrooms).toBe("2");
  });

  it("rebuilds the index when the array identity changes", () => {
    const before = [...ESTATES];
    expect(
      applied(parseQuery("Amoy Gardens", { estates: before })).estate?.name,
    ).toBe("Amoy Gardens");

    // A new array (as a fresh fetch would provide) is re-indexed, so a name
    // added later is recognised.
    const after = [...ESTATES, { estate_name_en: "Bel Air", estate_name_zh: "貝沙灣" }];
    expect(applied(parseQuery("Bel Air", { estates: after })).estate?.name).toBe(
      "Bel Air",
    );
  });

  it("warms the index without changing behaviour", () => {
    const estates = [...ESTATES];
    expect(() => warmEstateIndex(estates)).not.toThrow();
    // A smoke test only: parseQuery would build the index itself, so this cannot
    // prove the cache was used, just that warming leaves behaviour intact.
    expect(applied(parseQuery("Taikoo Shing", { estates })).estate?.name).toBe(
      "Taikoo Shing",
    );
    expect(() => warmEstateIndex([])).not.toThrow();
  });

  it("does not recognise an estate name without the loaded list", () => {
    expect(parseQuery("太古城").kind).toBe("unresolved");
    expect(parseQuery("太古城", { estates: [] }).kind).toBe("unresolved");
  });
});

describe("new build", () => {
  it("reads the English forms as an age default", () => {
    for (const text of ["new", "new build", "newly built", "brand new"]) {
      const spec = applied(parseQuery(`${text} 3 bed`));
      expect(spec.filters.maxBuildingAge, text).toBe("5");
      expect(spec.filters.bedrooms, text).toBe("3");
    }
  });

  it("keeps newest as a sort, not an age filter", () => {
    const spec = applied(parseQuery("newest in TKO"));
    expect(spec.sort).toBe("latest_tx_date");
    expect(spec.filters.maxBuildingAge).toBe("");
  });

  it("carries the age through the URL", () => {
    const state = specToState(applied(parseQuery("new 2 bed")));
    const restored = searchStateFromParams(searchStateToSearch(state));
    expect(restored.filters.maxBuildingAge).toBe("5");
    expect(restored.filters.bedrooms).toBe("2");
  });
});

describe("compound district labels", () => {
  it("shows the component the user typed, not the joined label", () => {
    const zh = applied(parseQuery("石硤尾"));
    expect(zh.filters.districtId).toBe("200603");
    expect(zh.applied.find((slot) => slot.field === "Location")?.value).toBe(
      "石硤尾",
    );

    const en = applied(parseQuery("Shek Kip Mei"));
    expect(en.filters.districtId).toBe("200603");
    expect(en.applied.find((slot) => slot.field === "Location")?.value).toBe(
      "Shek Kip Mei",
    );
  });

  it("keeps the canonical spelling, including apostrophes and hyphens", () => {
    const value = applied(parseQuery("Jardine's Lookout")).applied.find(
      (slot) => slot.field === "Location",
    )?.value;
    expect(value).toBe("Jardine's Lookout");
    // This label ships with a double space before its slash.
    const padded = applied(parseQuery("Mid-Levels Central")).applied.find(
      (slot) => slot.field === "Location",
    )?.value;
    expect(padded).toBe("Mid-Levels Central");
  });

  it("shows the typed component even when the typo fallback found it", () => {
    const spec = applied(parseQuery("shek kip mey"));
    expect(spec.filters.districtId).toBe("200603");
    const value = spec.applied.find((slot) => slot.field === "Location")?.value;
    expect(value).toBe("Shek Kip Mey");
    expect(value).not.toContain("/");
  });

  it("still shows the canonical label for a single-name place", () => {
    const value = applied(parseQuery("Sha Tin")).applied.find(
      (slot) => slot.field === "Location",
    )?.value;
    expect(value).toBe("Sha Tin · 沙田");
  });

});

describe("Chinese belongs to v1, not to the model", () => {
  it("reads 兩房 and 六房 as bedrooms", () => {
    expect(applied(parseQuery("兩房 in 大埔")).filters.bedrooms).toBe("2");
    expect(applied(parseQuery("六房")).filters.bedrooms).toBe("4+");
    expect(applied(parseQuery("3房")).filters.bedrooms).toBe("3");
  });

  it("reads a Chinese price ceiling", () => {
    const spec = applied(parseQuery("600萬以下"));
    expect(spec.filters.maxPrice).toBe("6000000");
    expect(spec.filters.minPrice).toBe("");
    expect(spec.applied).toContainEqual({ field: "Price", value: "≤ HK$6M" });
  });

  it("reads a ceiling written in Chinese numerals", () => {
    expect(applied(parseQuery("五百萬以下")).filters.maxPrice).toBe("5000000");
    expect(applied(parseQuery("一千萬以下")).filters.maxPrice).toBe("10000000");
  });

  it("treats a leading 十/百/千 as one", () => {
    expect(applied(parseQuery("十萬以下")).filters.maxPrice).toBe("100000");
    expect(applied(parseQuery("兩百萬以下")).filters.maxPrice).toBe("2000000");
    expect(applied(parseQuery("三千萬以下")).filters.maxPrice).toBe("30000000");
  });

  it("reads 億 as a hundred million", () => {
    expect(applied(parseQuery("一億以上")).filters.minPrice).toBe("100000000");
  });

  it("reads a Chinese price floor", () => {
    expect(applied(parseQuery("800萬以上")).filters.minPrice).toBe("8000000");
  });

  it("reads a Chinese price range", () => {
    const spec = applied(parseQuery("500萬至800萬"));
    expect(spec.filters.minPrice).toBe("5000000");
    expect(spec.filters.maxPrice).toBe("8000000");
  });

  it("reads the spoken range and floor variants", () => {
    expect(applied(parseQuery("500萬到800萬")).filters.minPrice).toBe("5000000");
    expect(applied(parseQuery("600萬或以下")).filters.maxPrice).toBe("6000000");
    expect(applied(parseQuery("600萬以內")).filters.maxPrice).toBe("6000000");
    expect(applied(parseQuery("六百萬樓下")).filters.maxPrice).toBe("6000000");
    expect(applied(parseQuery("五百萬起")).filters.minPrice).toBe("5000000");
  });

  it("reads a decimal 萬 amount", () => {
    expect(applied(parseQuery("1.5萬以上")).filters.minPrice).toBe("15000");
  });

  it("refuses to guess a bare 萬 amount", () => {
    const parse = parseQuery("600萬");
    expect(parse.kind).toBe("unresolved");
    expect(parse.spec?.filters.maxPrice ?? "").toBe("");
    expect(parse.spec?.ignored.join(" ")).toContain("以下");
  });

  it("reads the Chinese MTR line names, both 綫 and 線", () => {
    expect(applied(parseQuery("將軍澳綫")).filters.mtrLine).toBe(
      "Tseung Kwan O Line",
    );
    expect(applied(parseQuery("將軍澳線")).filters.mtrLine).toBe(
      "Tseung Kwan O Line",
    );
    expect(applied(parseQuery("東鐵線")).filters.mtrLine).toBe("East Rail Line");
    expect(applied(parseQuery("港島綫")).filters.mtrLine).toBe("Island Line");
  });

  it("reads Chinese sort words", () => {
    expect(applied(parseQuery("最平")).sort).toBe("latest_price");
    expect(applied(parseQuery("最活躍")).sort).toBe("tx_count_12m");
    expect(applied(parseQuery("最新")).sort).toBe("latest_tx_date");
    expect(applied(parseQuery("按名稱")).sort).toBe("name");
  });

  it("reads 校網 with the number on either side", () => {
    expect(applied(parseQuery("校網 40")).filters.schoolNet).toBe("Sham Shui Po");
    expect(applied(parseQuery("40校網")).filters.schoolNet).toBe("Sham Shui Po");
  });

  it("discloses Chinese concepts that have no data", () => {
    const view = applied(parseQuery("海景 in 大埔"));
    expect(view.ignored).toContain("View (no view data)");
    expect(view.filters.subregionId).toBe("3016");

    // An ignored-only query applies nothing, so it is unresolved by design.
    const said = (text: string) => {
      const parse = parseQuery(text);
      expect(parse.kind).toBe("unresolved");
      if (!parse.spec) throw new Error("expected disclosure");
      return parse.spec.ignored;
    };
    expect(said("車位")).toContain("Parking (no data)");
    expect(said("近地鐵")).toContain("MTR proximity (line-level data only)");
    expect(said("連傢俬")).toContain("Furnishing (no data)");
    // 新盤 is primary-market wording the data cannot answer; 新樓 is a filter.
    expect(said("新盤")[0]).toContain("Primary market");
    const newBuild = applied(parseQuery("新樓"));
    expect(newBuild.filters.maxBuildingAge).toBe("5");
    expect(newBuild.applied).toContainEqual({
      field: "Building age",
      value: "≤ 5 years (default)",
      defaulted: true,
    });
    expect(said("安靜")).toContain("Quiet (no noise data)");
    expect(said("好校網")).toContain("School quality (net membership only)");
  });

  it("anchors a Chinese direction to the region named in front of it", () => {
    expect(applied(parseQuery("港島東")).filters.subregionId).toBe("1004");
    // East Kowloon covers three subregions, so it asks instead of guessing.
    const kowloon = parseQuery("九龍東");
    expect(kowloon.kind).toBe("ambiguous");
    expect(kowloon.spec?.hints.map((hint) => hint.label)).toEqual([
      "Kwun Tong",
      "Kai Tak",
      "Tseung Kwan O",
    ]);
  });

  it("names the direction in a Chinese question and can be anchored", () => {
    const bare = parseQuery("東");
    expect(bare.direction).toBe("east");
    expect(bare.question).toBe("East of which region?");

    const kowloon = parseQuery("九龍東");
    expect(kowloon.direction).toBe("east");
    expect(kowloon.question).toBe("East of which subregion?");

    // Answering with Kowloon must narrow to its eastern subregions, not apply
    // all of Kowloon.
    const refined = refineDirection(kowloon, "20");
    expect(refined.kind).toBe("ambiguous");
    expect(refined.spec?.hints.map((hint) => hint.label)).toEqual([
      "Kwun Tong",
      "Kai Tak",
      "Tseung Kwan O",
    ]);

    const island = refineDirection(parseQuery("東"), "10");
    expect(island.kind).toBe("applied");
    expect(island.spec?.filters.subregionId).toBe("1004");
  });

  it("keeps district names that merely look like directions", () => {
    expect(applied(parseQuery("港島西")).filters.districtId).toBe("100102");
    expect(applied(parseQuery("新界北")).filters.districtId).toBe("301502");
  });

  it("does not turn a place ending near a direction word into a direction", () => {
    for (const text of ["北角", "西貢", "東涌", "上水"]) {
      const parse = parseQuery(text);
      expect(parse.kind, text).toBe("applied");
      expect(parse.direction, text).toBeNull();
    }
  });

  it("parses the number edges the price tests skip", () => {
    expect(applied(parseQuery("九千九百萬以下")).filters.maxPrice).toBe("99000000");
    expect(applied(parseQuery("一千零五十萬以下")).filters.maxPrice).toBe("10500000");
    expect(applied(parseQuery("兩億以下")).filters.maxPrice).toBe("200000000");
    expect(applied(parseQuery("10萬以下")).filters.maxPrice).toBe("100000");
    expect(applied(parseQuery("0.5萬以上")).filters.minPrice).toBe("5000");
    // 0.07 * 100_000_000 is 7000000.000000001; without the round this would
    // stringify with that noise. Every 萬 decimal in range happens to land on an
    // integer after multiplication, so the 億 scale is the one that pins it.
    expect(applied(parseQuery("0.07億以下")).filters.maxPrice).toBe("7000000");
    // No trailing unit: not a supported amount, so no price is applied.
    expect(parseQuery("一萬五千").spec?.filters.maxPrice ?? "").toBe("");
    // A unit inside the numeral is the reachable malformed case.
    const compound = parseQuery("一億五千萬以下");
    expect(compound.spec?.filters.maxPrice ?? "").toBe("");
    expect(compound.spec?.filters.minPrice ?? "").toBe("");
  });

  it("asks which region a bare 東 means", () => {
    const parse = parseQuery("東");
    expect(parse.kind).toBe("ambiguous");
    expect(parse.question).toBe("East of which region?");
    expect(parse.spec?.hints.length).toBeGreaterThan(0);
  });

  it("refuses a Chinese city outside the market", () => {
    expect(parseQuery("深圳").kind).toBe("refused");
    expect(parseQuery("倫敦").kind).toBe("refused");
    expect(parseQuery("東京").kind).toBe("refused");
  });
});
