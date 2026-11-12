import type { EstateSummary } from "../types";

export interface PriceBucket {
  id: string;
  label: string;
  color: string;
  /** Inclusive lower bound in HKD/ft². Absent on the open-ended buckets. */
  min?: number;
  /** Exclusive upper bound in HKD/ft². Absent on the open-ended buckets. */
  max?: number;
}

/**
 * Net-ft-price buckets for map colouring. Thresholds follow the reference
 * snapshot quartiles (~7.6k / 10.3k / 14.5k / 23.1k HKD/ft²) rounded to
 * readable boundaries. Prices are the 12-month average with a latest-price
 * fallback; see `mapPrice`.
 */
export const PRICE_BUCKETS: PriceBucket[] = [
  { id: "under-8k", label: "< 8,000", color: "#bfe3dc", max: 8000 },
  { id: "8k-12k", label: "8,000 – 12,000", color: "#7cc5b8", min: 8000, max: 12000 },
  { id: "12k-16k", label: "12,000 – 16,000", color: "#3ea394", min: 12000, max: 16000 },
  { id: "16k-24k", label: "16,000 – 24,000", color: "#1b7d70", min: 16000, max: 24000 },
  { id: "24k-plus", label: "≥ 24,000", color: "#0b5b54", min: 24000 },
];

export const NO_PRICE_BUCKET: PriceBucket = {
  id: "no-price",
  label: "No price data",
  color: "#b6c2c8",
};

export type MapPriceSource = "average" | "latest" | "none";

/** Which price `mapPrice` used, so the UI can label it honestly. */
export function mapPriceSource(estate: EstateSummary): MapPriceSource {
  if (
    estate.avg_net_ft_price_12m !== null &&
    estate.avg_net_ft_price_12m > 0
  ) {
    return "average";
  }
  if (
    estate.latest_tx_net_ft_price !== null &&
    estate.latest_tx_net_ft_price > 0
  ) {
    return "latest";
  }
  return "none";
}

/**
 * The price used for map colouring: the 12-month average when the snapshot has
 * one, otherwise the latest transaction price. Estates with neither fall into
 * the grey "no price" bucket.
 */
export function mapPrice(estate: EstateSummary): number | null {
  if (
    estate.avg_net_ft_price_12m !== null &&
    estate.avg_net_ft_price_12m > 0
  ) {
    return estate.avg_net_ft_price_12m;
  }
  return estate.latest_tx_net_ft_price;
}

export function priceBucket(value: number | null): PriceBucket {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return NO_PRICE_BUCKET;
  }
  for (const bucket of PRICE_BUCKETS) {
    const aboveMin = bucket.min === undefined || value >= bucket.min;
    const belowMax = bucket.max === undefined || value < bucket.max;
    if (aboveMin && belowMax) return bucket;
  }
  return NO_PRICE_BUCKET;
}

export function hasCoordinates(
  estate: EstateSummary,
): estate is EstateSummary & { latitude: number; longitude: number } {
  const { latitude, longitude } = estate;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export interface MapSelection {
  visible: EstateSummary[];
  missingCoordinates: number;
}

export function selectMapEstates(
  estates: EstateSummary[],
  districtId: string,
): MapSelection {
  let missingCoordinates = 0;
  const visible: EstateSummary[] = [];

  for (const estate of estates) {
    if (districtId && estate.district_id !== districtId) continue;
    if (hasCoordinates(estate)) {
      visible.push(estate);
    } else {
      missingCoordinates += 1;
    }
  }

  return { visible, missingCoordinates };
}

export type LatLngBounds = [[number, number], [number, number]];

export function boundsFor(estates: EstateSummary[]): LatLngBounds | null {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const estate of estates) {
    if (!hasCoordinates(estate)) continue;
    found = true;
    minLat = Math.min(minLat, estate.latitude);
    maxLat = Math.max(maxLat, estate.latitude);
    minLng = Math.min(minLng, estate.longitude);
    maxLng = Math.max(maxLng, estate.longitude);
  }

  return found
    ? [
        [minLat, minLng],
        [maxLat, maxLng],
      ]
    : null;
}

export const HK_CENTER: [number, number] = [22.36, 114.14];
export const DEFAULT_ZOOM = 11;
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface MapCluster {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  estates: Array<EstateSummary & { latitude: number; longitude: number }>;
  bucket: PriceBucket;
  mixedBuckets: boolean;
  bounds: LatLngBounds;
}

export interface ClusterOptions {
  /** Grid cell size in screen pixels at the current zoom. */
  cellSize?: number;
  /** At and above this zoom, show every estate as an individual marker. */
  maxZoom?: number;
}

export const CLUSTER_CELL_SIZE = 64;
export const CLUSTER_MAX_ZOOM = 15;

const TILE_SIZE = 256;

function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y:
      (0.5 -
        Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) *
      scale,
  };
}

function dominantBucket(estates: EstateSummary[]): {
  bucket: PriceBucket;
  mixed: boolean;
} {
  const counts = new Map<string, { bucket: PriceBucket; count: number }>();
  for (const estate of estates) {
    const bucket = priceBucket(mapPrice(estate));
    const current = counts.get(bucket.id);
    if (current) {
      current.count += 1;
    } else {
      counts.set(bucket.id, { bucket, count: 1 });
    }
  }
  const ordered = [...counts.values()].sort(
    (left, right) => right.count - left.count,
  );
  return {
    bucket: ordered[0]?.bucket ?? NO_PRICE_BUCKET,
    mixed: counts.size > 1,
  };
}

type LocatedEstate = EstateSummary & {
  latitude: number;
  longitude: number;
};

/**
 * Group estates into a deterministic screen-space grid at the given zoom.
 *
 * The grid is anchored to the Web Mercator world, so panning does not make
 * clusters jump; zooming does. Single-estate groups are returned with
 * `count: 1` so the map can render a normal marker.
 */
export function clusterMapEstates(
  estates: EstateSummary[],
  zoom: number,
  options: ClusterOptions = {},
): MapCluster[] {
  const cellSize = options.cellSize ?? CLUSTER_CELL_SIZE;
  const maxZoom = options.maxZoom ?? CLUSTER_MAX_ZOOM;
  const points: LocatedEstate[] = estates.filter(hasCoordinates);

  if (points.length === 0) return [];

  if (zoom >= maxZoom) {
    return points.map((estate) => ({
      id: `estate-${estate.estate_id}`,
      latitude: estate.latitude,
      longitude: estate.longitude,
      count: 1,
      estates: [estate],
      bucket: priceBucket(mapPrice(estate)),
      mixedBuckets: false,
      bounds: [
        [estate.latitude, estate.longitude],
        [estate.latitude, estate.longitude],
      ],
    }));
  }

  const groups = new Map<string, LocatedEstate[]>();
  for (const estate of points) {
    const projected = project(estate.latitude, estate.longitude, zoom);
    const key = `${Math.floor(projected.x / cellSize)}:${Math.floor(
      projected.y / cellSize,
    )}`;
    const group = groups.get(key);
    if (group) {
      group.push(estate);
    } else {
      groups.set(key, [estate]);
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      let minLat = group[0].latitude;
      let maxLat = group[0].latitude;
      let minLng = group[0].longitude;
      let maxLng = group[0].longitude;
      let latSum = 0;
      let lngSum = 0;
      for (const estate of group) {
        minLat = Math.min(minLat, estate.latitude);
        maxLat = Math.max(maxLat, estate.latitude);
        minLng = Math.min(minLng, estate.longitude);
        maxLng = Math.max(maxLng, estate.longitude);
        latSum += estate.latitude;
        lngSum += estate.longitude;
      }
      const dominant = dominantBucket(group);
      return {
        id: `cluster-${zoom}-${key}`,
        latitude: latSum / group.length,
        longitude: lngSum / group.length,
        count: group.length,
        estates: group,
        bucket: dominant.bucket,
        mixedBuckets: dominant.mixed,
        bounds: [
          [minLat, minLng],
          [maxLat, maxLng],
        ] as LatLngBounds,
      };
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.latitude - right.latitude ||
        left.longitude - right.longitude,
    );
}
