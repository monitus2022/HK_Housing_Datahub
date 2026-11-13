import { describe, expect, it } from "vitest";
import { formatCompactHkd } from "./format";

describe("formatCompactHkd", () => {
  it("uses billions, millions, and thousands", () => {
    expect(formatCompactHkd(25_252_200_000)).toBe("HK$25.3b");
    expect(formatCompactHkd(2_100_000)).toBe("HK$2.1m");
    expect(formatCompactHkd(12_000)).toBe("HK$12.0k");
  });

  it("handles missing values", () => {
    expect(formatCompactHkd(null)).toBe("—");
  });
});
