import { describe, expect, it } from "vitest";
import type { EstateSummary } from "../types";
import {
  boundsFor,
  clusterMapEstates,
  hasCoordinates,
  mapPrice,
  mapFocusAction,
  mapPriceSource,
  NO_PRICE_BUCKET,
  PRICE_BUCKETS,
  priceBucket,
  selectMapEstates,
} from "./map";

function estate(
  id: string,
  district: string,
  latitude: number | null,
  longitude: number | null,
  price: number | null = 10000,
): EstateSummary {
  return {
    estate_id: id,
    estate_name_zh: "",
    estate_name_en: `Estate ${id}`,
    region_id: "R",
    region_name_en: "Region",
    subregion_id: "S",
    subregion_name_en: "Subregion",
    district_id: district,
    district_name_en: `District ${district}`,
    district_name_zh: "",
    latitude,
    longitude,
    first_op_date: null,
    last_op_date: null,
    latest_tx_date: null,
    latest_tx_price: null,
    latest_tx_net_ft_price: price,
    latest_net_area: null,
    latest_bedroom: null,
    mtr_lines: null,
    school_nets: null,
    tx_count_12m: 0,
    avg_net_ft_price_12m: null,
    avg_net_ft_rent_12m: null,
    latest_market_date: null,
    has_market: 0,
    has_transactions: 0,
    has_wiki: 0,
  };
}

describe("priceBucket", () => {
  it("places prices into the documented buckets at the boundaries", () => {
    expect(priceBucket(7999).id).toBe(PRICE_BUCKETS[0].id);
    expect(priceBucket(8000).id).toBe("8k-12k");
    expect(priceBucket(11999).id).toBe("8k-12k");
    expect(priceBucket(12000).id).toBe("12k-16k");
    expect(priceBucket(16000).id).toBe("16k-24k");
    expect(priceBucket(24000).id).toBe("24k-plus");
    expect(priceBucket(500000).id).toBe("24k-plus");
  });

  it("returns the no-price bucket for null, zero, and invalid values", () => {
    expect(priceBucket(null)).toBe(NO_PRICE_BUCKET);
    expect(priceBucket(0)).toBe(NO_PRICE_BUCKET);
    expect(priceBucket(Number.NaN)).toBe(NO_PRICE_BUCKET);
    expect(priceBucket(-1)).toBe(NO_PRICE_BUCKET);
  });
});

describe("mapPrice", () => {
  it("prefers the 12-month average and falls back to the latest price", () => {
    const withAverage = {
      ...estate("1", "A", 22.3, 114.1, 9000),
      avg_net_ft_price_12m: 12000,
    };
    expect(mapPrice(withAverage)).toBe(12000);
    expect(priceBucket(mapPrice(withAverage)).id).toBe("12k-16k");
  });

  it("uses the latest price when the average is missing or zero", () => {
    expect(mapPrice(estate("1", "A", 22.3, 114.1, 9000))).toBe(9000);
    expect(
      mapPrice({
        ...estate("1", "A", 22.3, 114.1, 9000),
        avg_net_ft_price_12m: 0,
      }),
    ).toBe(9000);
  });

  it("returns null when neither price is available", () => {
    expect(mapPrice(estate("1", "A", 22.3, 114.1, null))).toBeNull();
    expect(priceBucket(mapPrice(estate("1", "A", 22.3, 114.1, null)))).toBe(
      NO_PRICE_BUCKET,
    );
  });
});

describe("mapPriceSource", () => {
  it("reports which price the marker used", () => {
    expect(
      mapPriceSource({
        ...estate("1", "A", 22.3, 114.1, 9000),
        avg_net_ft_price_12m: 12000,
      }),
    ).toBe("average");
    expect(mapPriceSource(estate("2", "A", 22.3, 114.1, 9000))).toBe("latest");
    expect(mapPriceSource(estate("3", "A", 22.3, 114.1, null))).toBe("none");
  });
});

describe("hasCoordinates", () => {
  it("accepts finite coordinates and rejects missing or out-of-range ones", () => {
    expect(hasCoordinates(estate("1", "A", 22.3, 114.1))).toBe(true);
    expect(hasCoordinates(estate("2", "A", null, 114.1))).toBe(false);
    expect(hasCoordinates(estate("3", "A", 22.3, null))).toBe(false);
    expect(hasCoordinates(estate("4", "A", 122.3, 114.1))).toBe(false);
    expect(hasCoordinates(estate("5", "A", Number.NaN, 114.1))).toBe(false);
  });
});

describe("selectMapEstates", () => {
  const estates = [
    estate("1", "A", 22.3, 114.1),
    estate("2", "A", null, null),
    estate("3", "B", 22.4, 114.2),
  ];

  it("keeps only estates with coordinates and counts the rest", () => {
    const selection = selectMapEstates(estates, "");
    expect(selection.visible.map((item) => item.estate_id)).toEqual([
      "1",
      "3",
    ]);
    expect(selection.missingCoordinates).toBe(1);
  });

  it("applies the district filter before counting", () => {
    const selection = selectMapEstates(estates, "A");
    expect(selection.visible.map((item) => item.estate_id)).toEqual(["1"]);
    expect(selection.missingCoordinates).toBe(1);

    const other = selectMapEstates(estates, "B");
    expect(other.visible.map((item) => item.estate_id)).toEqual(["3"]);
    expect(other.missingCoordinates).toBe(0);
  });
});

describe("boundsFor", () => {
  it("returns the south-west and north-east corners", () => {
    expect(
      boundsFor([
        estate("1", "A", 22.3, 114.1),
        estate("2", "A", 22.5, 113.9),
        estate("3", "A", null, null),
      ]),
    ).toEqual([
      [22.3, 113.9],
      [22.5, 114.1],
    ]);
  });

  it("returns null when nothing can be plotted", () => {
    expect(boundsFor([estate("1", "A", null, null)])).toBeNull();
    expect(boundsFor([])).toBeNull();
  });
});

describe("clusterMapEstates", () => {
  const nearbyA = estate("A", "D", 22.3, 114.1, 9000);
  const nearbyB = estate("B", "D", 22.301, 114.101, 13000);
  const far = estate("C", "D", 22.4, 114.3, 9000);

  it("groups nearby estates and keeps distant ones separate", () => {
    const clusters = clusterMapEstates([nearbyA, nearbyB, far], 11);

    expect(clusters).toHaveLength(2);
    const grouped = clusters.find((cluster) => cluster.count === 2);
    expect(grouped?.estates.map((item) => item.estate_id)).toEqual([
      "A",
      "B",
    ]);
    expect(grouped?.latitude).toBeCloseTo(22.3005, 4);
    expect(grouped?.longitude).toBeCloseTo(114.1005, 4);
    expect(grouped?.mixedBuckets).toBe(true);
    expect(grouped?.bucket.id).toBe("8k-12k");
  });

  it("breaks dominant bucket ties by the documented bucket order", () => {
    const clusters = clusterMapEstates(
      [
        estate("higher", "D", 22.3, 114.1, 13000),
        estate("lower", "D", 22.301, 114.101, 9000),
      ],
      11,
    );

    expect(clusters[0].bucket.id).toBe("8k-12k");
    expect(clusters[0].mixedBuckets).toBe(true);
  });

  it("shows individual estates at the maximum cluster zoom", () => {
    const clusters = clusterMapEstates([nearbyA, nearbyB, far], 15);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((cluster) => cluster.count === 1)).toBe(true);
    expect(clusters.map((cluster) => cluster.estates[0].estate_id).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("drops estates without coordinates", () => {
    expect(
      clusterMapEstates(
        [nearbyA, estate("missing", "D", null, null), far],
        11,
      ).reduce((total, cluster) => total + cluster.count, 0),
    ).toBe(2);
    expect(clusterMapEstates([], 11)).toEqual([]);
  });
});

describe("mapFocusAction", () => {
  it("skips missing or already-applied focus requests", () => {
    expect(mapFocusAction(null, null, "")).toBe("skip");
    expect(mapFocusAction(undefined, 2, "D")).toBe("skip");
    expect(mapFocusAction(3, 3, "D")).toBe("skip");
  });

  it("clears a district before centring a new focus request", () => {
    expect(mapFocusAction(4, 3, "D")).toBe("clear-district");
    expect(mapFocusAction(4, 3, "")).toBe("center");
  });
});
