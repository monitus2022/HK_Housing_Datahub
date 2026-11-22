/** Natural-language gazetteer: place resolution with candidate hints.
 *
 * Sits on top of the P1 hierarchy in `geo.ts` and the curated vocabularies in
 * `gazetteer.json`. Resolution is a ladder, cheapest and most certain first:
 *
 *   1. out of scope        "shenzhen"        -> REFUSE
 *   2. abbreviation        "tko"             -> Tseung Kwan O
 *   3. direction + anchor  "east" + Region 10 -> Eastern
 *   4. exact / alias       "Happy Valley"    -> Mid-Levels Central / Admiralty
 *   5. fuzzy + margin      "shaitn"          -> Sha Tin
 *
 * Ambiguity is never resolved by guessing. When two unrelated places tie, the
 * outcome is `ambiguous` with both candidates so the UI can ask. When two
 * candidates are the same place at different levels, the broader one wins.
 *
 * Abbreviations and direction cells are curated data, not inferred: `KT` is
 * Kwun Tong *or* Kowloon Tong, and no scoring function can tell which a user
 * meant.
 */
import raw from "./gazetteer.json";
import {
  districtById,
  DISTRICTS,
  normalisePlace,
  REGIONS,
  regionById,
  SUBREGIONS,
  subregionById,
  type GeoScope,
} from "./geo";

export type PlaceLevel = "region" | "subregion" | "district";

export type ResolutionVia =
  | "exact"
  | "abbreviation"
  | "direction"
  | "fuzzy";

export interface PlaceCandidate {
  level: PlaceLevel;
  id: string;
  /** English label, most specific available. */
  label: string;
  zh: string | null;
  /** Ready to merge into `EstateFilters`. */
  scope: GeoScope;
  estates: number;
}

export type PlaceOutcome =
  | { kind: "resolved"; candidate: PlaceCandidate; via: ResolutionVia }
  | {
      kind: "ambiguous";
      term: string;
      candidates: PlaceCandidate[];
      via: ResolutionVia;
    }
  | { kind: "out-of-scope"; term: string }
  | { kind: "unresolved"; term: string };

export interface GazetteerTerm {
  en: string;
  zh: string;
  estates: number;
}

export interface SchoolNet {
  id: string;
  en: string;
  zh: string;
  estates: number;
}

export const MTR_LINES: GazetteerTerm[] = raw.mtrLines;
export const SCHOOL_NETS: SchoolNet[] = raw.schoolNets;

/**
 * The dashboard's normalisation, plus `&` -> `and` so "Central & Western"
 * matches the curated "Central And Western".
 */
export function normalise(text: string): string {
  return normalisePlace(text.replace(/&/g, " and "));
}

function candidateFor(level: PlaceLevel, id: string): PlaceCandidate | null {
  if (level === "region") {
    const region = regionById(id);
    if (!region) return null;
    return {
      level,
      id,
      label: region.en,
      zh: region.zh,
      scope: { regionId: id },
      estates: region.estates,
    };
  }
  if (level === "subregion") {
    const subregion = subregionById(id);
    if (!subregion) return null;
    return {
      level,
      id,
      label: subregion.en,
      zh: subregion.zh,
      scope: { regionId: subregion.regionId, subregionId: id },
      estates: subregion.estates,
    };
  }
  const district = districtById(id);
  if (!district) return null;
  const subregion = subregionById(district.subregionId);
  return {
    level,
    id,
    label: district.en,
    zh: district.zh,
    scope: {
      regionId: subregion?.regionId,
      subregionId: district.subregionId,
      districtId: id,
    },
    estates: district.estates,
  };
}

/** Parent of a candidate, one level up. */
function parentOf(candidate: PlaceCandidate): PlaceCandidate | null {
  if (candidate.level === "district") {
    const district = districtById(candidate.id);
    return district ? candidateFor("subregion", district.subregionId) : null;
  }
  if (candidate.level === "subregion") {
    const subregion = subregionById(candidate.id);
    return subregion ? candidateFor("region", subregion.regionId) : null;
  }
  return null;
}

function isDescendant(
  candidate: PlaceCandidate,
  ancestor: PlaceCandidate,
): boolean {
  let current = parentOf(candidate);
  while (current) {
    if (current.level === ancestor.level && current.id === ancestor.id) {
      return true;
    }
    current = parentOf(current);
  }
  return false;
}

interface IndexEntry {
  key: string;
  candidate: PlaceCandidate;
}

const ENTRIES: IndexEntry[] = [];
const PLACE_INDEX = new Map<string, PlaceCandidate>();

function add(key: string | null | undefined, candidate: PlaceCandidate | null) {
  if (!key || !candidate) return;
  const normalised = normalise(key);
  if (!normalised) return;
  ENTRIES.push({ key: normalised, candidate });
  // First wins, and regions are added before subregions before districts, so a
  // label that exists at two levels resolves to the broader scope.
  if (!PLACE_INDEX.has(normalised)) PLACE_INDEX.set(normalised, candidate);
}

// Order matters: broadest level first.
for (const region of REGIONS) {
  const candidate = candidateFor("region", region.id);
  add(region.en, candidate);
  add(region.zh, candidate);
}
for (const subregion of SUBREGIONS) {
  const candidate = candidateFor("subregion", subregion.id);
  add(subregion.en, candidate);
  add(subregion.zh, candidate);
}
for (const district of DISTRICTS) {
  const candidate = candidateFor("district", district.id);
  add(district.en, candidate);
  add(district.zh, candidate);
  for (const alias of district.aliases) add(alias, candidate);
}

const OUT_OF_SCOPE = new Set(raw.outOfScope.map(normalise));

interface RawAbbreviation {
  term: string;
  candidates: { level: PlaceLevel; id: string }[];
}

const ABBREVIATIONS = new Map<string, PlaceCandidate[]>(
  (raw.abbreviations as RawAbbreviation[]).map((entry) => [
    normalise(entry.term),
    entry.candidates
      .map((candidate) => candidateFor(candidate.level, candidate.id))
      .filter((candidate): candidate is PlaceCandidate => candidate !== null),
  ]),
);

const DIRECTIONS = new Map<string, Map<string, string[]>>();
for (const cell of raw.directions) {
  const byRegion = DIRECTIONS.get(cell.direction) ?? new Map<string, string[]>();
  byRegion.set(cell.regionId, cell.subregionIds);
  DIRECTIONS.set(cell.direction, byRegion);
}

function dedupe(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  const unique: PlaceCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.level}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

/**
 * Drop candidates that are the same place as a broader candidate in the list.
 * "Sha Tin" is both a subregion and a district label, so a typo matching both
 * should resolve to the subregion rather than asking a pointless question.
 */
function collapse(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const unique = dedupe(candidates);
  return unique.filter(
    (candidate) =>
      !unique.some(
        (other) =>
          other !== candidate && isDescendant(candidate, other),
      ),
  );
}

function finish(
  term: string,
  candidates: PlaceCandidate[],
  via: ResolutionVia,
): PlaceOutcome {
  const principal = collapse(candidates);
  if (principal.length === 0) return { kind: "unresolved", term };
  if (principal.length === 1) {
    return { kind: "resolved", candidate: principal[0], via };
  }
  return { kind: "ambiguous", term, candidates: principal, via };
}

/** Levenshtein distance. */
export function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** How many edits a term of this length may be off by. */
export function maxDistance(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

function fuzzy(term: string): PlaceOutcome {
  let best = Number.POSITIVE_INFINITY;
  const tied: PlaceCandidate[] = [];
  for (const entry of ENTRIES) {
    const distance = editDistance(term, entry.key);
    if (distance < best) {
      best = distance;
      tied.length = 0;
      tied.push(entry.candidate);
    } else if (distance === best) {
      tied.push(entry.candidate);
    }
  }
  if (best > maxDistance(term.length)) return { kind: "unresolved", term };
  return finish(term, tied, "fuzzy");
}

function directionOutcome(
  term: string,
  anchorRegionId?: string,
): PlaceOutcome | null {
  const parts = term.split(" ");
  let direction: string | null = null;
  let regionFromTerm: string | undefined;

  if (parts.length === 1) {
    if (DIRECTIONS.has(parts[0])) direction = parts[0];
  } else {
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (DIRECTIONS.has(last)) {
      // "hong kong island east"
      direction = last;
      regionFromTerm = parts.slice(0, -1).join(" ");
    } else if (DIRECTIONS.has(first)) {
      // "east kowloon"
      direction = first;
      regionFromTerm = parts.slice(1).join(" ");
    }
  }
  if (!direction) return null;

  let regionId = anchorRegionId;
  if (regionFromTerm) {
    const region = PLACE_INDEX.get(regionFromTerm);
    // "east somewhere" with an unknown anchor is not a direction phrase.
    if (!region || region.level !== "region") return null;
    regionId = region.id;
  }

  const cells = DIRECTIONS.get(direction);
  if (!cells) return null;

  if (regionId) {
    const subregionIds = cells.get(regionId) ?? [];
    // A recognised direction with no cell for this region ("north" on Hong
    // Kong Island) is unresolved, not a silent fall-through to a same-named
    // district.
    if (subregionIds.length === 0) return { kind: "unresolved", term };
    return finish(
      term,
      subregionIds
        .map((id) => candidateFor("subregion", id))
        .filter((candidate): candidate is PlaceCandidate => candidate !== null),
      "direction",
    );
  }

  // Unanchored: offer one candidate per region that has a cell, rather than the
  // union of every subregion. "east" should ask "east of what?", not present
  // five subregions.
  const regions = [...cells.entries()]
    .filter(([, subregionIds]) => subregionIds.length > 0)
    .map(([id]) => candidateFor("region", id))
    .filter((candidate): candidate is PlaceCandidate => candidate !== null);
  return finish(term, regions, "direction");
}

/**
 * Resolve a phrase to a place, or to the candidates that need a human choice.
 *
 * `regionId` anchors direction words: it is the current cascade selection, or a
 * region named in the same utterance.
 */
export function resolvePhrase(
  text: string,
  options: { regionId?: string } = {},
): PlaceOutcome {
  const term = normalise(text);
  if (!term) return { kind: "unresolved", term };

  if (OUT_OF_SCOPE.has(term)) return { kind: "out-of-scope", term };

  const abbreviation = ABBREVIATIONS.get(term);
  if (abbreviation) return finish(term, abbreviation, "abbreviation");

  const direction = directionOutcome(term, options.regionId);
  if (direction) return direction;

  const exact = PLACE_INDEX.get(term);
  if (exact) return { kind: "resolved", candidate: exact, via: "exact" };

  return fuzzy(term);
}
