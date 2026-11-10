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
