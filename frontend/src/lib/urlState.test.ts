import { describe, expect, it } from "vitest";
import { estateIdFromSearch, withEstateParam } from "./urlState";

describe("estateIdFromSearch", () => {
  it("reads and trims the estate parameter", () => {
    expect(estateIdFromSearch("?estate=E1")).toBe("E1");
    expect(estateIdFromSearch("?foo=1&estate=%20E2%20")).toBe("E2");
  });

  it("returns null when the parameter is absent or empty", () => {
    expect(estateIdFromSearch("")).toBeNull();
    expect(estateIdFromSearch("?estate=")).toBeNull();
    expect(estateIdFromSearch("?estate=%20")).toBeNull();
  });
});

describe("withEstateParam", () => {
  it("sets the estate parameter and keeps other parameters", () => {
    expect(withEstateParam("?view=map", "E1")).toBe("?view=map&estate=E1");
    expect(withEstateParam("", "E1")).toBe("?estate=E1");
  });

  it("removes the estate parameter and drops an empty query", () => {
    expect(withEstateParam("?estate=E1", null)).toBe("");
    expect(withEstateParam("?estate=E1&view=map", null)).toBe("?view=map");
  });
});
