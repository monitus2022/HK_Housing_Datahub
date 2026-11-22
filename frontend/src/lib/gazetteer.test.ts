import { describe, expect, it } from "vitest";
import {
  MTR_LINES,
  SCHOOL_NETS,
  editDistance,
  maxDistance,
  normalise,
  resolvePhrase,
} from "./gazetteer";

describe("vocabulary", () => {
  it("publishes every MTR line with a name", () => {
    expect(MTR_LINES).toHaveLength(8);
    expect(MTR_LINES.every((line) => line.en.length > 0)).toBe(true);
    expect(MTR_LINES.some((line) => line.en === "Tseung Kwan O Line")).toBe(
      true,
    );
  });

  it("publishes school nets with an id and at least one name", () => {
    expect(SCHOOL_NETS.length).toBeGreaterThan(30);
    expect(
      SCHOOL_NETS.every((net) => net.id && (net.en || net.zh)),
    ).toBe(true);
  });
});

describe("normalisation", () => {
  it("folds case, punctuation, ampersands and spacing", () => {
    expect(normalise("  Central & Western  ")).toBe("central and western");
    expect(normalise("ＴＳＵＥＮ　ＷＡＮ")).toBe("tsuen wan");
  });
});

describe("place resolution", () => {
  it("refuses places outside Hong Kong instead of guessing", () => {
    expect(resolvePhrase("shenzhen")).toEqual({
      kind: "out-of-scope",
      term: "shenzhen",
    });
    expect(resolvePhrase("深圳").kind).toBe("out-of-scope");
    expect(resolvePhrase("Macau").kind).toBe("out-of-scope");
  });

  it("resolves abbreviations that have one meaning", () => {
    const tko = resolvePhrase("TKO");
    expect(tko.kind).toBe("resolved");
    if (tko.kind !== "resolved") return;
    expect(tko.candidate.scope.subregionId).toBe("2010");
    expect(tko.via).toBe("abbreviation");

    const tw = resolvePhrase("TW");
    expect(tw.kind).toBe("resolved");
    if (tw.kind !== "resolved") return;
    expect(tw.candidate.scope.subregionId).toBe("3011");
  });

  it("returns both candidates for a genuine abbreviation collision", () => {
    const outcome = resolvePhrase("KT");
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.via).toBe("abbreviation");
    expect(
      outcome.candidates.map((c) => `${c.level}:${c.id}`).sort(),
    ).toEqual(["district:200903", "subregion:2007"]);
  });

  it("resolves exact English, Chinese and alias labels", () => {
    const happy = resolvePhrase("Happy Valley");
    expect(happy.kind).toBe("resolved");
    if (happy.kind !== "resolved") return;
    expect(happy.candidate.scope.districtId).toBeDefined();

    const island = resolvePhrase("香港島");
    expect(island.kind).toBe("resolved");
    if (island.kind !== "resolved") return;
    expect(island.candidate.level).toBe("region");
  });

  it("prefers the broader level when a label exists at two levels", () => {
    const shaTin = resolvePhrase("Sha Tin");
    expect(shaTin.kind).toBe("resolved");
    if (shaTin.kind !== "resolved") return;
    expect(shaTin.candidate.level).toBe("subregion");
    expect(shaTin.candidate.id).toBe("3017");
  });

  it("tolerates a typo inside the margin", () => {
    for (const typo of ["shaitn", "shamtin"]) {
      const outcome = resolvePhrase(typo);
      expect(outcome.kind).toBe("resolved");
      if (outcome.kind !== "resolved") continue;
      expect(outcome.via).toBe("fuzzy");
      expect(outcome.candidate.scope.subregionId).toBe("3017");
    }
  });

  it("does not fuzzy-match nonsense", () => {
    expect(resolvePhrase("qwepoiqwepoi").kind).toBe("unresolved");
    expect(resolvePhrase("").kind).toBe("unresolved");
  });
});

describe("direction handling", () => {
  it("asks which region for a bare direction", () => {
    const outcome = resolvePhrase("east");
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.via).toBe("direction");
    expect(outcome.candidates.every((c) => c.level === "region")).toBe(true);
    expect(outcome.candidates.map((c) => c.id).sort()).toEqual([
      "10",
      "20",
      "30",
    ]);
  });

  it("uses the current cascade as the anchor", () => {
    const eastern = resolvePhrase("east", { regionId: "10" });
    expect(eastern.kind).toBe("resolved");
    if (eastern.kind !== "resolved") return;
    expect(eastern.candidate.scope.subregionId).toBe("1004");

    const nt = resolvePhrase("east", { regionId: "30" });
    expect(nt.kind).toBe("ambiguous");
    if (nt.kind !== "ambiguous") return;
    expect(nt.candidates.map((c) => c.id).sort()).toEqual(["3010", "3017"]);
  });

  it("accepts the region in the utterance", () => {
    const outcome = resolvePhrase("kowloon east");
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.candidates.map((c) => c.id).sort()).toEqual([
      "2007",
      "2011",
    ]);
  });

  it("treats a direction with no cell for the anchor as unresolved", () => {
    expect(resolvePhrase("north", { regionId: "10" }).kind).toBe("unresolved");
  });
});

describe("edit distance", () => {
  it("agrees with hand-computed distances", () => {
    expect(editDistance("sha tin", "sha tin")).toBe(0);
    expect(editDistance("shamtin", "sha tin")).toBe(1);
    expect(editDistance("shaitn", "sha tin")).toBe(2);
  });

  it("scales the budget with length", () => {
    expect(maxDistance(3)).toBe(1);
    expect(maxDistance(6)).toBe(2);
    expect(maxDistance(12)).toBe(3);
  });
});
