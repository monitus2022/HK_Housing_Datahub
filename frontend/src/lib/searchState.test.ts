import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_STATE,
  searchStateFromParams,
  searchStateToSearch,
} from "./searchState";

describe("searchStateFromParams", () => {
  it("reads query, sort, and filters", () => {
    const state = searchStateFromParams(
      "?q=park&sort=latest_price&district=D1&minPrice=5000000" +
        "&maxNetFtPrice=20000&minNetArea=300&maxNetArea=800&bedrooms=3" +
        "&mtr=Island%20Line&school=Net%2062",
    );

    expect(state.query).toBe("park");
    expect(state.sort).toBe("latest_price");
    expect(state.filters.districtId).toBe("D1");
    expect(state.filters.minPrice).toBe("5000000");
    expect(state.filters.maxNetFtPrice).toBe("20000");
    expect(state.filters.minNetArea).toBe("300");
    expect(state.filters.maxNetArea).toBe("800");
    expect(state.filters.bedrooms).toBe("3");
    expect(state.filters.mtrLine).toBe("Island Line");
    expect(state.filters.schoolNet).toBe("Net 62");
  });

  it("falls back to defaults for missing or invalid values", () => {
    const state = searchStateFromParams("?sort=unknown");

    expect(state).toEqual(DEFAULT_SEARCH_STATE);
  });
});

describe("searchStateToSearch", () => {
  it("serializes only non-default values and preserves other params", () => {
    const search = searchStateToSearch(
      {
        query: "park",
        sort: "latest_price",
        filters: {
          ...DEFAULT_SEARCH_STATE.filters,
          districtId: "D1",
          minPrice: "5000000",
          maxPrice: "12000000",
          minNetFtPrice: "8000",
          maxNetFtPrice: "20000",
          minNetArea: "300",
          maxNetArea: "900",
          bedrooms: "4+",
          schoolNet: "Net 62",
          mtrLine: "Island Line",
        },
      },
      "?estate=E1",
    );

    const params = new URLSearchParams(search);
    expect(params.get("estate")).toBe("E1");
    expect(params.get("q")).toBe("park");
    expect(params.get("sort")).toBe("latest_price");
    expect(params.get("district")).toBe("D1");
    expect(params.get("minPrice")).toBe("5000000");
    expect(params.get("bedrooms")).toBe("4+");
    expect(params.get("maxPrice")).toBe("12000000");
    expect(params.get("minNetFtPrice")).toBe("8000");
    expect(params.get("maxNetFtPrice")).toBe("20000");
    expect(params.get("minNetArea")).toBe("300");
    expect(params.get("maxNetArea")).toBe("900");
    expect(params.get("school")).toBe("Net 62");
    expect(params.get("mtr")).toBe("Island Line");
  });

  it("removes stale search params and keeps other state", () => {
    const search = searchStateToSearch(
      DEFAULT_SEARCH_STATE,
      "?estate=E1&minPrice=1&bedrooms=2&mtr=Island%20Line",
    );

    expect(search).toBe("?estate=E1");
  });
});
