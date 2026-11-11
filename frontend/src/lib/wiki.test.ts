import { describe, expect, it } from "vitest";
import { wikiUrl } from "./wiki";

describe("wikiUrl", () => {
  it("builds an encoded Chinese Wikipedia URL", () => {
    expect(wikiUrl("日出康城")).toBe(
      "https://zh.wikipedia.org/wiki/%E6%97%A5%E5%87%BA%E5%BA%B7%E5%9F%8E",
    );
  });

  it("converts spaces to underscores and trims input", () => {
    expect(wikiUrl("  Taikoo Shing  ")).toBe(
      "https://zh.wikipedia.org/wiki/Taikoo_Shing",
    );
  });

  it("returns null for missing titles", () => {
    expect(wikiUrl(null)).toBeNull();
    expect(wikiUrl("   ")).toBeNull();
  });
});
