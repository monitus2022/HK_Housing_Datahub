import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseQuery } from "./lexicon";

/**
 * The lexicon baseline, re-derivable rather than quoted.
 *
 * `data/` is gitignored, so this runs only after `make nl-dataset`. In CI the
 * candidate file is absent and the test skips; locally it asserts that the
 * parser reproduces every planted slot on every row that carries one.
 */
const CANDIDATES = new URL("../../../data/nl/candidates.jsonl", import.meta.url)
  .pathname;
const available = existsSync(CANDIDATES);

const FIELDS = [
  "regionId",
  "subregionId",
  "districtId",
  "bedrooms",
  "minNetArea",
  "maxNetArea",
  "minPrice",
  "maxPrice",
  "mtrLine",
  "schoolNet",
  "maxBuildingAge",
] as const;

(available ? describe : describe.skip)("lexicon baseline", () => {
  it("reproduces every planted slot", () => {
    const rows = readFileSync(CANDIDATES, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { text: string; planted: Record<string, string> });

    const misses: string[] = [];
    let withFields = 0;
    for (const row of rows) {
      const parse = parseQuery(row.text);
      const spec = parse.spec;
      const filters: Record<string, string> = (spec?.filters ?? {}) as never;
      const planted = row.planted ?? {};
      const fields = FIELDS.filter((field) => planted[field]);
      if (fields.length === 0 && !planted.sort) continue;
      withFields += 1;
      for (const field of fields) {
        if (String(filters[field] ?? "") !== String(planted[field])) {
          misses.push(`${row.text} :: ${field} ${planted[field]} -> ${filters[field] ?? "∅"}`);
        }
      }
      if (planted.sort && spec?.sort !== planted.sort) {
        misses.push(`${row.text} :: sort ${planted.sort} -> ${spec?.sort ?? "∅"}`);
      }
    }

    expect(withFields).toBeGreaterThan(5000);
    expect(misses.slice(0, 10)).toEqual([]);
  }, 60_000);
});
