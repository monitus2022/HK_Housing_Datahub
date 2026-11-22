/** Hong Kong geography model: region -> subregion -> district.
 *
 * Generated into `geo.json` by `scripts/build_geo.py` from the estate mart.
 * The published snapshot already carries every id and English name, so the
 * dashboard can offer a three-level cascade without a schema or snapshot
 * change. Regions and subregions have no Chinese names in the source data;
 * the builder supplies 23 curated labels.
 *
 * Note: the dataset groups Tseung Kwan O under Kowloon. That is HKP market
 * segmentation, not official geography, and this module mirrors the data.
 */
import raw from "./geo.json";

export interface GeoRegion {
  id: string;
  en: string;
  zh: string | null;
  estates: number;
}

export interface GeoSubregion {
  id: string;
  en: string;
  zh: string | null;
  regionId: string;
  estates: number;
}

export interface GeoDistrict {
  id: string;
  en: string;
  zh: string | null;
  subregionId: string;
  estates: number;
  aliases: string[];
}

/** A partial location filter. Every field is optional; empty means "all". */
export interface GeoScope {
  regionId?: string;
  subregionId?: string;
  districtId?: string;
}

export const REGIONS: GeoRegion[] = raw.regions;
export const SUBREGIONS: GeoSubregion[] = raw.subregions;
export const DISTRICTS: GeoDistrict[] = raw.districts;

const REGION_BY_ID = new Map(REGIONS.map((region) => [region.id, region]));
const SUBREGION_BY_ID = new Map(
  SUBREGIONS.map((subregion) => [subregion.id, subregion]),
);
const DISTRICT_BY_ID = new Map(
  DISTRICTS.map((district) => [district.id, district]),
);

export function regionById(id: string): GeoRegion | undefined {
  return REGION_BY_ID.get(id);
}

export function subregionById(id: string): GeoSubregion | undefined {
  return SUBREGION_BY_ID.get(id);
}

export function districtById(id: string): GeoDistrict | undefined {
  return DISTRICT_BY_ID.get(id);
}

/** Subregions under a region; all subregions when `regionId` is empty. */
export function subregionsInRegion(regionId: string): GeoSubregion[] {
  if (!regionId) return SUBREGIONS;
  return SUBREGIONS.filter((subregion) => subregion.regionId === regionId);
}

/** Districts for the current cascade selection. */
export function districtsInScope(scope: GeoScope): GeoDistrict[] {
  if (scope.subregionId) {
    return DISTRICTS.filter(
      (district) => district.subregionId === scope.subregionId,
    );
  }
  if (scope.regionId) {
    const subregionIds = new Set(
      SUBREGIONS.filter(
        (subregion) => subregion.regionId === scope.regionId,
      ).map((subregion) => subregion.id),
    );
    return DISTRICTS.filter((district) =>
      subregionIds.has(district.subregionId),
    );
  }
  return DISTRICTS;
}

/** Full scope for a district, so a deep link can populate the cascade. */
export function scopeForDistrict(districtId: string): GeoScope | null {
  const district = DISTRICT_BY_ID.get(districtId);
  if (!district) return null;
  const subregion = SUBREGION_BY_ID.get(district.subregionId);
  return {
    regionId: subregion?.regionId,
    subregionId: district.subregionId,
    districtId: district.id,
  };
}

/**
 * Lowercase, NFKC-normalise and reduce punctuation to single spaces.
 * `Mid-Levels Central  / Admiralty` becomes `mid levels central admiralty`.
 */
export function normalisePlace(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function buildPlaceIndex(): Map<string, GeoScope> {
  const index = new Map<string, GeoScope>();
  const add = (label: string | null | undefined, scope: GeoScope) => {
    if (!label) return;
    const key = normalisePlace(label);
    if (key && !index.has(key)) index.set(key, scope);
  };

  for (const region of REGIONS) {
    const scope: GeoScope = { regionId: region.id };
    add(region.en, scope);
    add(region.zh, scope);
  }
  for (const subregion of SUBREGIONS) {
    const scope: GeoScope = {
      regionId: subregion.regionId,
      subregionId: subregion.id,
    };
    add(subregion.en, scope);
    add(subregion.zh, scope);
  }
  for (const district of DISTRICTS) {
    const scope: GeoScope = {
      regionId: SUBREGION_BY_ID.get(district.subregionId)?.regionId,
      subregionId: district.subregionId,
      districtId: district.id,
    };
    add(district.en, scope);
    add(district.zh, scope);
    for (const alias of district.aliases) add(alias, scope);
  }

  return index;
}

const PLACE_INDEX = buildPlaceIndex();

/**
 * Exact-match a place name, Chinese name or compound-label alias.
 *
 * When a label exists at two levels, the **broader** level wins: "Tsuen Wan"
 * and "Kowloon City" are both a subregion and a district, so they resolve to
 * the subregion and the filter returns a superset. That is deliberately the
 * fail-safe direction: too many results are recoverable, silently too few are
 * not. `geo.test.ts` pins the behaviour.
 *
 * Abbreviations such as "TKO" are deliberately absent: they arrive with the
 * gazetteer in P2, where the margin test can disambiguate collisions
 * ("KT" = Kwun Tong or Kowloon Tong, "TW" = Tsuen Wan or Tai Wai).
 */
export function resolvePlace(text: string): GeoScope | null {
  const key = normalisePlace(text);
  if (!key) return null;
  return PLACE_INDEX.get(key) ?? null;
}

/** Human-readable label for a scope, most specific level first. */
export function scopeLabel(scope: GeoScope): string {
  if (scope.districtId) {
    return districtById(scope.districtId)?.en ?? scope.districtId;
  }
  if (scope.subregionId) {
    return subregionById(scope.subregionId)?.en ?? scope.subregionId;
  }
  if (scope.regionId) {
    return regionById(scope.regionId)?.en ?? scope.regionId;
  }
  return "";
}
