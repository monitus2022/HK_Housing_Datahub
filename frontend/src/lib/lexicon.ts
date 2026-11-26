/** Deterministic natural-language lexicon for the estate search.
 *
 * One utterance becomes one query spec. There is no session, no memory and no
 * model: the same sentence always produces the same filters, and everything the
 * lexicon did *not* understand is reported back instead of being dropped.
 *
 * The parser consumes phrases in a fixed order — bedrooms, area (including
 * vague-size defaults and a bare-size fallback), price, sort words, unsupported
 * concepts, MTR lines, school nets, then a place — and removes each phrase it
 * understands. Whatever is left is either shown as unrecognised, or matched
 * fuzzily as a whole. A phrase that is recognised but has no data behind it
 * (sea view, quiet, "near MTR") goes to `ignored` rather than being silently
 * treated as free text: the result set must reflect what the user asked for, or
 * say what it could not do.
 *
 * Geography is delegated to `gazetteer.ts`, so the lexicon never invents a
 * place. Ambiguous places produce hints and apply nothing for the location
 * slot; the user's other slots still apply.
 */
import { EMPTY_ESTATE_FILTERS, type EstateFilters } from "./filters";
import type { SortKey } from "./estates";
import { DEFAULT_SEARCH_STATE, type SearchState } from "./searchState";
import {
  MTR_LINES,
  SCHOOL_NETS,
  normalise,
  resolvePhrase,
  type PlaceCandidate,
  type PlaceOutcome,
} from "./gazetteer";

/** How many hints one parse may offer. */
const HINT_LIMIT = 4;

export interface NlSlot {
  /** Dimension name, e.g. "Area". */
  field: string;
  /** Human-readable value, e.g. "400–700 ft²". */
  value: string;
  /** True when a vague phrase was filled with a marked default. */
  defaulted?: boolean;
}

export type NlHint =
  | {
      kind: "place";
      label: string;
      detail: string;
      level: "region" | "subregion" | "district";
      /** Full location scope, so a subregion hint clears a stale district. */
      scope: { regionId: string; subregionId: string; districtId: string };
    }
  | {
      kind: "size";
      label: string;
      detail: string;
      level: "size";
      band: { minNetArea: string; maxNetArea: string };
    };

export interface NlEstateMatch {
  name: string;
  /** How many loaded estates carry this name (some names repeat). */
  count: number;
}

export interface NlSpec {
  filters: EstateFilters;
  sort: SortKey;
  applied: NlSlot[];
  ignored: string[];
  unrecognised: string[];
  hints: NlHint[];
  /** The estate the sentence names, if any; applied as the text query. */
  estate: NlEstateMatch | null;
}

export type NlKind = "applied" | "ambiguous" | "refused" | "unresolved";

export interface NlParse {
  kind: NlKind;
  /** Replacement state for "applied" and "ambiguous"; also carries `ignored`
   * disclosure for an unresolved sentence that understood a concept. */
  spec: NlSpec | null;
  /** The question to ask when kind is "ambiguous". */
  question: string | null;
  /** Offending phrase for "refused" and "unresolved". */
  term: string | null;
  /** Direction word ("east") when the location or its ambiguity came from a
   * direction cell; hints use it to re-anchor the utterance. */
  direction: string | null;
  /** The normalised utterance, re-parsed when a hint supplies an anchor. */
  input: string;
}

export interface NlEstateName {
  estate_name_en: string;
  estate_name_zh: string;
}

export interface NlOptions {
  /** Current cascade region, used to anchor direction words. */
  regionId?: string;
  /**
   * Estates already loaded by the dashboard. Passing them lets the parser
   * recognise an estate name; it is never fetched or bundled here.
   */
  estates?: readonly NlEstateName[];
}

/** Words that only glue a sentence together. Dropped before reporting. */
const GLUE = new Set([
  "a",
  "an",
  "and",
  "any",
  "apartment",
  "apartments",
  "around",
  "at",
  "by",
  "close",
  "flat",
  "flats",
  "for",
  "from",
  "home",
  "homes",
  "in",
  "inside",
  "near",
  "of",
  "on",
  "or",
  "place",
  "property",
  "station",
  "the",
  "to",
  "unit",
  "units",
  "with",
  "within",
]);

/** Phrases we understand as a concept but cannot express as a filter. */
const UNSUPPORTED: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:sea|harbour|harbor|mountain|park|river) ?view\b/, label: "View (no view data)" },
  { pattern: /\bquiet\b/, label: "Quiet (no noise data)" },
  { pattern: /\b(?:pet|pets) ?friendly\b/, label: "Pet policy (no data)" },
  { pattern: /\b(?:furnished|unfurnished)\b/, label: "Furnishing (no data)" },
  { pattern: /\b(?:car ?park|parking)\b/, label: "Parking (no data)" },
  { pattern: /\b(?:near|close to|next to) ?(?:the )?mtr\b/, label: "MTR proximity (line-level data only)" },
  { pattern: /(?:^| )mtr(?: station)?(?= |$)/, label: "MTR proximity (line-level data only)" },
  { pattern: /\b(?:good|great|top|best) ?schools?\b/, label: "School quality (net membership only)" },
  { pattern: /(?:^| )(?:海景|海景房|維港景|山景|河景)(?= |$)/, label: "View (no view data)" },
  { pattern: /(?:^| )(?:安靜|清靜|寧靜)(?= |$)/, label: "Quiet (no noise data)" },
  { pattern: /(?:^| )(?:車位|停車位)(?= |$)/, label: "Parking (no data)" },
  { pattern: /(?:^| )(?:近地鐵|近港鐵|地鐵站|港鐵站)(?= |$)/, label: "MTR proximity (line-level data only)" },
  { pattern: /(?:^| )(?:好校網|名校網)(?= |$)/, label: "School quality (net membership only)" },
  { pattern: /(?:^| )(?:連傢俬|有傢俬|包傢俬)(?= |$)/, label: "Furnishing (no data)" },
  { pattern: /(?:^| )(?:寵物|可養寵物)(?= |$)/, label: "Pet policy (no data)" },
  { pattern: /(?:^| )(?:新樓|新盤)(?= |$)/, label: "Building age (no age filter)" },
];

const BEDROOM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  "一": 1,
  "二": 2,
  "兩": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
};

const SORT_WORDS: { pattern: RegExp; key: SortKey; label: string }[] = [
  {
    pattern: /(?:^| )(?:cheapest|cheap|budget|lowest price|lowest priced)(?= |$)/,
    key: "latest_price",
    label: "Cheapest first",
  },
  {
    pattern:
      /(?:^| )(?:most active|busiest|most liquid|highest turnover|most transactions)(?= |$)/,
    key: "tx_count_12m",
    label: "Most active first",
  },
  {
    pattern:
      /(?:^| )(?:newest|most recent|latest deal|latest transaction|recent)(?= |$)/,
    key: "latest_tx_date",
    label: "Latest transaction first",
  },
  {
    pattern: /(?:^| )(?:alphabetical|by name|a to z)(?= |$)/,
    key: "name",
    label: "Alphabetical",
  },
  {
    pattern: /(?:^| )(?:最平|最便宜|最抵|平啲)(?= |$)/,
    key: "latest_price",
    label: "Cheapest first",
  },
  {
    pattern: /(?:^| )(?:最活躍|最旺|最多成交|成交最多)(?= |$)/,
    key: "tx_count_12m",
    label: "Most active first",
  },
  {
    pattern: /(?:^| )(?:最新|最近成交|最新成交)(?= |$)/,
    key: "latest_tx_date",
    label: "Latest transaction first",
  },
  {
    pattern: /(?:^| )(?:按名稱|字母順序|按字母)(?= |$)/,
    key: "name",
    label: "Alphabetical",
  },
];

/** Default applied by "new" / 新樓, from the snapshot: 96 estates since 2021. */
const NEW_BUILD_YEARS = 5;

type SizeBand = "small" | "middle" | "large";

/** Defaults applied by a vague size word, from the snapshot quartiles. */
const SIZE_BANDS: Record<SizeBand, { min: string; max: string }> = {
  small: { min: "", max: "400" },
  middle: { min: "400", max: "700" },
  large: { min: "700", max: "" },
};

/**
 * Neighbouring bands offered as hints while a default is applied, so a user who
 * disagrees can move one step without typing numbers.
 */
const SIZE_ALTERNATIVES: Record<SizeBand, { min: string; max: string }[]> = {
  small: [
    { min: "", max: "300" },
    { min: "300", max: "450" },
  ],
  middle: [
    { min: "300", max: "500" },
    { min: "500", max: "700" },
    { min: "700", max: "900" },
  ],
  large: [
    { min: "700", max: "900" },
    { min: "900", max: "1200" },
  ],
};

/** 大/細/中 are only size words next to 單位; a bare 大 would eat 大埔. */
const CJK_SIZE_BANDS: Record<string, SizeBand> = {
  "大": "large",
  "細": "small",
  "中": "middle",
  "中型": "middle",
};

/** Line names, plus the shorthand people actually type.
 *
 * Shorthand must not collide with a place: "Tung Chung" is a district, so the
 * line is only recognised when the user says "Tung Chung Line".
 */
const MTR_ALIASES: { phrase: string; value: string }[] = [
  ...MTR_LINES.flatMap((line) => {
    const forms = [normalise(line.en)];
    if (line.zh) {
      forms.push(normalise(line.zh));
      // Both forms are typed: 東鐵綫 and 東鐵線.
      forms.push(normalise(line.zh.replace(/綫/g, "線")));
    }
    return forms.map((phrase) => ({ phrase, value: line.en }));
  }),
  { phrase: "tko line", value: "Tseung Kwan O Line" },
  { phrase: "east rail", value: "East Rail Line" },
  { phrase: "tuen ma", value: "Tuen Ma Line" },
  { phrase: "south island", value: "South Island Line" },
  { phrase: "island line", value: "Island Line" },
].sort((left, right) => right.phrase.length - left.phrase.length);

interface Consumption {
  rest: string;
  match: RegExpMatchArray;
}

/** Find a pattern, then remove the matched text from the remaining utterance. */
function consume(rest: string, pattern: RegExp): Consumption | null {
  const match = rest.match(pattern);
  if (!match || match.index === undefined) return null;
  const restAfter =
    rest.slice(0, match.index) + " " + rest.slice(match.index + match[0].length);
  return { rest: restAfter, match };
}

function moneyLabel(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return value;
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `HK$${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (amount >= 1_000) return `HK$${Math.round(amount / 1_000)}k`;
  return `HK$${Math.round(amount)}`;
}

function areaLabel(minimum: string, maximum: string): string {
  if (minimum && maximum) return `${minimum}–${maximum} ft²`;
  if (minimum) return `≥ ${minimum} ft²`;
  return `≤ ${maximum} ft²`;
}

function scale(unit: string): number {
  switch (unit.toLowerCase()) {
    case "k":
      return 1_000;
    default:
      return 1_000_000;
  }
}

/** "6dot5" is 6.5: normalisation strips punctuation, so the point is spelled. */
function toNumber(raw: string): number {
  return Number(raw.replace("dot", "."));
}

const CJK_DIGITS: Record<string, number> = {
  "零": 0,
  "〇": 0,
  "一": 1,
  "二": 2,
  "兩": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};

const CJK_UNITS: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };

/** "五百萬" -> 5,000,000. Arabic forms like "1dot5萬" go through `toNumber`. */
function parseCjkNumber(raw: string): number | null {
  if (/^\d+(?:dot\d+)?$/.test(raw)) return toNumber(raw);
  let section = 0;
  let digit = 0;
  let seen = false;
  for (const char of raw) {
    if (char in CJK_DIGITS) {
      digit = CJK_DIGITS[char];
      seen = true;
      continue;
    }
    if (char in CJK_UNITS) {
      // 十/百/千 with no leading digit mean one of them: 十 means 10.
      section += (digit || 1) * CJK_UNITS[char];
      digit = 0;
      seen = true;
      continue;
    }
    // 萬/億 are stripped by `cjkMoney` before this runs, so a unit here means
    // the amount put a unit inside the numeral ("一億五千萬" is not supported).
    return null;
  }
  return seen ? section + digit : null;
}

/** A money expression with an explicit 萬/億 unit. */
const CJK_MONEY =
  "((?:\\d+(?:dot\\d+)?|[零〇一二兩两三四五六七八九十百千]+)(?:萬|万|億|亿))";

function cjkMoney(raw: string): number | null {
  const match = raw.match(/^(.*?)(萬|万|億|亿)$/);
  if (!match) return null;
  const amount = parseCjkNumber(match[1]);
  if (amount === null || amount <= 0) return null;
  const factor = match[2] === "億" || match[2] === "亿" ? 100_000_000 : 10_000;
  // Round like the English paths: 1.5萬 is 15,000, not 14999.999999999998.
  return Math.round(amount * factor);
}

/** "600萬以下", "五百萬以上", "500萬至800萬" -> a price patch. */
function takeCjkPrice(
  rest: string,
): { rest: string; patch: Partial<EstateFilters>; label: string } | null {
  const range = consume(
    rest,
    // "~" and "-" are stripped by normalisation, so only the spoken words survive.
    new RegExp(`(?:^| )${CJK_MONEY} ?(?:至|到)? ?${CJK_MONEY}(?= |$)`),
  );
  if (range) {
    const low = cjkMoney(range.match[1]);
    const high = cjkMoney(range.match[2]);
    if (low !== null && high !== null && low <= high) {
      return {
        rest: range.rest,
        patch: { minPrice: String(low), maxPrice: String(high) },
        label: `${moneyLabel(String(low))} – ${moneyLabel(String(high))}`,
      };
    }
  }

  const ceiling = consume(
    rest,
    new RegExp(`(?:^| )${CJK_MONEY} ?(?:以下|或以下|以內|以内|樓下|楼下)(?= |$)`),
  );
  if (ceiling) {
    const value = cjkMoney(ceiling.match[1]);
    if (value !== null) {
      return {
        rest: ceiling.rest,
        patch: { maxPrice: String(value) },
        label: `≤ ${moneyLabel(String(value))}`,
      };
    }
  }

  const floor = consume(
    rest,
    new RegExp(`(?:^| )${CJK_MONEY} ?(?:以上|或以上|起)(?= |$)`),
  );
  if (floor) {
    const value = cjkMoney(floor.match[1]);
    if (value !== null) {
      return {
        rest: floor.rest,
        patch: { minPrice: String(value) },
        label: `≥ ${moneyLabel(String(value))}`,
      };
    }
  }

  return null;
}

/** Remove one span, keeping the rest of the phrase separable. */
function removeSpan(rest: string, span: string): string {
  return rest.replace(span, " ");
}

function roomValue(count: number): string {
  return count >= 4 ? "4+" : String(count);
}

/** Longest name the matcher will consider, and the shortest key it will trust.
 *  Six words covers "Mei Foo Sun Chuen"-style names; three characters stops a
 *  two-character fragment matching half the market.
 */
const ESTATE_MAX_WORDS = 6;
const ESTATE_MIN_CHARS = 3;

/** The name index costs one pass over ~9,750 rows, so cache it per array. */
const ESTATE_INDEX = new WeakMap<
  readonly NlEstateName[],
  Map<string, NlEstateMatch>
>();

function estateIndex(
  estates: readonly NlEstateName[],
): Map<string, NlEstateMatch> {
  const cached = ESTATE_INDEX.get(estates);
  if (cached) return cached;
  const index = new Map<string, NlEstateMatch>();
  for (const estate of estates) {
    for (const raw of [estate.estate_name_en, estate.estate_name_zh]) {
      const key = normalise(raw ?? "");
      if (!key) continue;
      const existing = index.get(key);
      if (existing) existing.count += 1;
      else index.set(key, { name: (raw ?? "").trim(), count: 1 });
    }
  }
  ESTATE_INDEX.set(estates, index);
  return index;
}

/**
 * Build the name index ahead of the first submit. ~59 ms for 9,750 estates, so
 * the app warms it while idle rather than on the keystroke-to-results path.
 */
export function warmEstateIndex(estates: readonly NlEstateName[]): void {
  if (estates.length > 0) estateIndex(estates);
}

/** Longest estate-name span in the sentence, exact match only. */
function takeEstate(
  rest: string,
  estates: readonly NlEstateName[] | undefined,
): { rest: string; match: NlEstateMatch } | null {
  if (!estates || estates.length === 0) return null;
  const index = estateIndex(estates);
  const words = rest.split(" ").filter(Boolean);
  for (let size = Math.min(ESTATE_MAX_WORDS, words.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const span = words.slice(start, start + size).join(" ");
      const key = normalise(span);
      if (key.length < ESTATE_MIN_CHARS) continue;
      const match = index.get(key);
      if (match) {
        // Remove by position: a literal replace could hit an earlier prefix of a
        // longer token instead of the span that matched.
        const kept = [...words.slice(0, start), ...words.slice(start + size)];
        return { rest: kept.join(" "), match };
      }
    }
  }
  return null;
}

function hintFor(candidate: PlaceCandidate): NlHint {
  return {
    kind: "place",
    label: candidate.label,
    detail: `${candidate.level} · ${candidate.estates} estates`,
    level: candidate.level,
    scope: {
      regionId: candidate.scope.regionId ?? "",
      subregionId: candidate.scope.subregionId ?? "",
      districtId: candidate.scope.districtId ?? "",
    },
  };
}

/** Resolve the longest place span that is not a fuzzy guess. */
function takePlace(
  rest: string,
  anchorRegionId?: string,
): { rest: string; outcome: PlaceOutcome; span: string } | null {
  const words = rest.split(" ").filter(Boolean);
  for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const span = words.slice(start, start + size).join(" ");
      const outcome = resolvePhrase(span, { regionId: anchorRegionId });
      if (outcome.kind === "unresolved") continue;
      if (outcome.kind === "out-of-scope") continue;
      // Typo tolerance is only offered for the whole leftover phrase, so an
      // arbitrary two-word window cannot be reshaped into a place.
      if (outcome.via === "fuzzy") continue;
      return { rest: removeSpan(rest, span), outcome, span };
    }
  }
  return null;
}

function leftoverWords(rest: string): string[] {
  return rest.split(" ").filter((word) => word && !GLUE.has(word));
}

function emptySpec(sort: SortKey): NlSpec {
  return {
    filters: { ...EMPTY_ESTATE_FILTERS },
    sort,
    applied: [],
    ignored: [],
    unrecognised: [],
    hints: [],
    estate: null,
  };
}

/**
 * Parse one utterance into one query spec.
 *
 * `options.regionId` anchors direction words using the visible cascade, so
 * "east" with Region 10 already selected resolves to Eastern.
 */
export function parseQuery(text: string, options: NlOptions = {}): NlParse {
  // Keep decimal points that would otherwise be stripped as punctuation:
  // "6.5m" becomes "6dot5m", and the price patterns read the word back.
  const input = normalise(text.replace(/(\d)\.(\d)/g, "$1dot$2"));
  if (!input) {
    return {
      kind: "unresolved",
      spec: null,
      question: null,
      term: "",
      direction: null,
      input,
    };
  }

  // A place outside Hong Kong refuses the whole query: applying the other slots
  // would produce a plausible-looking result set for a question we cannot
  // answer.
  const refusing = input
    .split(" ")
    .find((word) => resolvePhrase(word).kind === "out-of-scope");
  if (refusing) {
    return {
      kind: "refused",
      spec: null,
      question: null,
      term: refusing,
      direction: null,
      input,
    };
  }

  const spec = emptySpec(DEFAULT_SEARCH_STATE.sort);
  const patch: Partial<EstateFilters> = {};
  let rest = input;
  let location: PlaceOutcome | null = null;
  let direction: string | null = null;

  // --- dimension predicates -------------------------------------------------

  const bedrooms = consume(
    rest,
    /(?:^| )(\d+|one|two|three|four|five|six) ?(?:bed|beds|bedroom|bedrooms|br|room|rooms)(?= |$)/,
  );
  if (bedrooms) {
    const raw = bedrooms.match[1];
    const count = Number(raw) || BEDROOM_WORDS[raw] || 0;
    if (count > 0) {
      patch.bedrooms = roomValue(count);
      spec.applied.push({ field: "Bedrooms", value: raw });
      rest = bedrooms.rest;
    }
  }
  if (!patch.bedrooms) {
    const cjk = consume(rest, /(?:^| )(\d|一|二|三|四|五|六|兩|两) ?房(?= |$)/);
    if (cjk) {
      const raw = cjk.match[1];
      const count = Number(raw) || BEDROOM_WORDS[raw] || 0;
      if (count > 0) {
        patch.bedrooms = roomValue(count);
        spec.applied.push({ field: "Bedrooms", value: `${count}` });
        rest = cjk.rest;
      }
    }
  }

  const areaRange = consume(
    rest,
    /(?:^| )(\d{2,5}) ?(?:-|to)? ?(\d{2,5}) ?(?:sq ?ft|sqft|square feet|ft)(?= |$)/,
  );
  if (areaRange) {
    patch.minNetArea = areaRange.match[1];
    patch.maxNetArea = areaRange.match[2];
    spec.applied.push({
      field: "Area",
      value: areaLabel(patch.minNetArea, patch.maxNetArea),
    });
    rest = areaRange.rest;
  } else {
    const areaMax = consume(
      rest,
      /(?:under|below|less than|up to|max) ?(\d{2,5}) ?(?:sq ?ft|sqft|square feet|ft)(?= |$)/,
    );
    if (areaMax) {
      patch.maxNetArea = areaMax.match[1];
      spec.applied.push({
        field: "Area",
        value: areaLabel("", patch.maxNetArea),
      });
      rest = areaMax.rest;
    } else {
      const areaMin = consume(
        rest,
        /(?:over|above|more than|at least|min|from) ?(\d{2,5}) ?(?:sq ?ft|sqft|square feet|ft)(?= |$)/,
      );
      if (areaMin) {
        patch.minNetArea = areaMin.match[1];
        spec.applied.push({
          field: "Area",
          value: areaLabel(patch.minNetArea, ""),
        });
        rest = areaMin.rest;
      }
    }
  }

  // "new" means a recent build, not a recent transaction; "recent" stays a sort
  // word. 新盤 is primary-market wording the data cannot answer.
  const newBuild = consume(
    rest,
    /(?:^| )(?:new build|newly built|brand new|new)(?= |$)/,
  );
  if (newBuild) {
    patch.maxBuildingAge = String(NEW_BUILD_YEARS);
    spec.applied.push({
      field: "Building age",
      value: `≤ ${NEW_BUILD_YEARS} years (default)`,
      defaulted: true,
    });
    rest = newBuild.rest;
  } else {
    const primary = consume(rest, /(?:^| )(?:新盤|新樓盤)(?= |$)/);
    if (primary) {
      spec.ignored.push(
        "Primary market (new launches) is not in the data; use 新樓 for a recent build",
      );
      rest = primary.rest;
    } else {
      const cjkNew = consume(rest, /(?:^| )新樓(?= |$)/);
      if (cjkNew) {
        patch.maxBuildingAge = String(NEW_BUILD_YEARS);
        spec.applied.push({
          field: "Building age",
          value: `≤ ${NEW_BUILD_YEARS} years (default)`,
          defaulted: true,
        });
        rest = cjkNew.rest;
      }
    }
  }

  let sizeAlternatives: { min: string; max: string }[] = [];
  if (!patch.minNetArea && !patch.maxNetArea) {
    // Vague size words get a marked default rather than being dropped: the
    // quartiles of the snapshot are 382 / 533 / 734 ft², so these bands cover
    // the middle, the small and the large half of the market.
    // "mid" must not eat a place: "mid levels central" is a district, so the
    // abbreviation only counts as a size word next to "size"/"sized".
    const middle =
      consume(
        rest,
        /(?:^| )(?:middle|medium) ?(?:size|sized)?(?= |$)/,
      ) ?? consume(rest, /(?:^| )mid ?(?:size|sized)(?= |$)/);
    const small = middle
      ? null
      : consume(
          rest,
          /(?:^| )(?:small|compact|tiny) ?(?:size|sized)?(?= |$)/,
        );
    const large =
      middle || small
        ? null
        : consume(
            rest,
            /(?:^| )(?:large|big|spacious) ?(?:size|sized)?(?= |$)/,
          );
    const cjk =
      middle || small || large
        ? null
        : consume(rest, /(?:^| )(中型|大|細|中) ?單位(?= |$)/);
    const consumed = middle ?? small ?? large ?? cjk;
    const band: SizeBand | null = middle
      ? "middle"
      : small
        ? "small"
        : large
          ? "large"
          : cjk
            ? (CJK_SIZE_BANDS[cjk.match[1]] ?? null)
            : null;
    if (consumed && band) {
      const sizeBand = SIZE_BANDS[band];
      patch.minNetArea = sizeBand.min;
      patch.maxNetArea = sizeBand.max;
      spec.applied.push({
        field: "Area",
        value: areaLabel(sizeBand.min, sizeBand.max),
        defaulted: true,
      });
      sizeAlternatives = SIZE_ALTERNATIVES[band];
      rest = consumed.rest;
    }
  }

  const cjkPrice = takeCjkPrice(rest);
  if (cjkPrice) {
    Object.assign(patch, cjkPrice.patch);
    spec.applied.push({ field: "Price", value: cjkPrice.label });
    rest = cjkPrice.rest;
  } else {
    const priceRange = consume(
      rest,
      /(?:^| )\$?(\d+(?:dot\d+)?) ?(m|k|million|mil) ?(?:-|to)? ?\$?(\d+(?:dot\d+)?) ?(m|k|million|mil)(?= |$)/,
    );
    if (priceRange) {
      const low = toNumber(priceRange.match[1]) * scale(priceRange.match[2]);
      const high = toNumber(priceRange.match[3]) * scale(priceRange.match[4]);
      patch.minPrice = String(Math.round(low));
      patch.maxPrice = String(Math.round(high));
      spec.applied.push({
        field: "Price",
        value: `${moneyLabel(patch.minPrice)} – ${moneyLabel(patch.maxPrice)}`,
      });
      rest = priceRange.rest;
    } else {
      const priceMax = consume(
        rest,
        /(?:under|below|less than|up to|max|cheaper than) ?\$?(\d+(?:dot\d+)?) ?(m|k|million|mil)(?= |$)/,
      );
      if (priceMax) {
        patch.maxPrice = String(
          Math.round(toNumber(priceMax.match[1]) * scale(priceMax.match[2])),
        );
        spec.applied.push({
          field: "Price",
          value: `≤ ${moneyLabel(patch.maxPrice)}`,
        });
        rest = priceMax.rest;
      } else {
        const priceMin = consume(
          rest,
          /(?:over|above|more than|at least|min|from) ?\$?(\d+(?:dot\d+)?) ?(m|k|million|mil)(?= |$)/,
        );
        if (priceMin) {
          patch.minPrice = String(
            Math.round(toNumber(priceMin.match[1]) * scale(priceMin.match[2])),
          );
          spec.applied.push({
            field: "Price",
            value: `≥ ${moneyLabel(patch.minPrice)}`,
          });
          rest = priceMin.rest;
        }
      }
    }
  }

  // "600萬" alone names an amount but not a direction; saying so beats assuming
  // a ceiling, which is what a "never silently guess" parser must not do.
  if (!patch.minPrice && !patch.maxPrice) {
    const bareCjkPrice = consume(
      rest,
      new RegExp(`(?:^| )${CJK_MONEY}(?= |$)`),
    );
    if (bareCjkPrice) {
      spec.ignored.push(
        `Price ${bareCjkPrice.match[1]} without 以下/以上 (say "${bareCjkPrice.match[1]}以下")`,
      );
      rest = bareCjkPrice.rest;
    }
  }

  for (const entry of SORT_WORDS) {
    const hit = consume(rest, entry.pattern);
    if (!hit) continue;
    spec.sort = entry.key;
    spec.applied.push({ field: "Sort", value: entry.label });
    rest = hit.rest;
    break;
  }

  // --- recognisable but unsupported concepts -------------------------------

  for (const entry of UNSUPPORTED) {
    const hit = consume(rest, entry.pattern);
    if (!hit) continue;
    spec.ignored.push(entry.label);
    rest = hit.rest;
  }

  if (!patch.minNetArea && !patch.maxNetArea) {
    // A lone size names the dimension but not a direction. Say both forms work
    // instead of dropping three words into Unrecognised.
    const bareArea = consume(
      rest,
      /(?:^| )(\d{2,5}) ?(?:sq ?ft|sqft|square feet|ft)(?= |$)/,
    );
    if (bareArea) {
      const size = bareArea.match[1];
      spec.ignored.push(
        `Size ${size} ft² without a range (say "under ${size} ft²" or "${size}-700 ft²")`,
      );
      rest = bareArea.rest;
    }
  }

  // --- MTR lines and school nets -------------------------------------------

  for (const alias of MTR_ALIASES) {
    if (!hasPhrase(rest, alias.phrase)) continue;
    patch.mtrLine = alias.value;
    spec.applied.push({ field: "MTR line", value: alias.value });
    rest = removeSpan(rest, alias.phrase);
    break;
  }

  if (!patch.mtrLine) {
    const netId = consume(
      rest,
      /(?:school net|schoolnet|net|校網|學校網) ?(?:no ?)?(\d{1,2})(?= |$)/,
    );
    if (netId) {
      const names = [
        ...new Set(
          SCHOOL_NETS.filter((net) => net.id === netId.match[1]).map(
            (net) => net.en,
          ),
        ),
      ].filter(Boolean);
      rest = netId.rest;
      if (names.length === 1) {
        patch.schoolNet = names[0];
        spec.applied.push({
          field: "School net",
          value: `${names[0]} (all nets with this name)`,
        });
      } else if (names.length > 1) {
        spec.ignored.push(
          `School net ${netId.match[1]} spans ${names.join(" and ")}`,
        );
      } else {
        spec.ignored.push(
          `School net ${netId.match[1]} is not in this snapshot`,
        );
      }
    } else {
      const netName = rest.match(/(?:school net|schoolnet) ([a-z &]+)/);
      if (netName) {
        const wanted = normalise(netName[1]);
        const match = SCHOOL_NETS.find((net) => normalise(net.en) === wanted);
        if (match) {
          patch.schoolNet = match.en;
          spec.applied.push({ field: "School net", value: match.en });
          rest = removeSpan(rest, netName[0]);
        }
      }
    }
  }

  // "40校網": Chinese puts the number first.
  if (!patch.schoolNet) {
    const suffixNet = consume(rest, /(?:^| )(\d{1,2}) ?(?:校網|學校網)(?= |$)/);
    if (suffixNet) {
      const netId = suffixNet.match[1];
      const names = [
        ...new Set(
          SCHOOL_NETS.filter((net) => net.id === netId).map((net) => net.en),
        ),
      ].filter(Boolean);
      rest = suffixNet.rest;
      if (names.length === 1) {
        patch.schoolNet = names[0];
        spec.applied.push({
          field: "School net",
          value: `${names[0]} (all nets with this name)`,
        });
      } else if (names.length > 1) {
        spec.ignored.push(`School net ${netId} spans ${names.join(" and ")}`);
      } else {
        spec.ignored.push(`School net ${netId} is not in this snapshot`);
      }
    }
  }

  // "school net" with no number or name names the concept but no value.
  if (!patch.schoolNet) {
    const bareNet = consume(rest, /(?:school net|schoolnet|校網|學校網)(?= |$)/);
    if (bareNet) {
      spec.ignored.push("School net without a number or name");
      rest = bareNet.rest;
    }
  }

  // --- estate name ----------------------------------------------------------
  // Before the place lookup: "Mei Foo Sun Chuen" is an estate that starts with a
  // district name, and splitting it would apply the district and drop the rest.

  const estateHit = takeEstate(rest, options.estates);
  if (estateHit) {
    spec.estate = estateHit.match;
    spec.applied.push({
      field: "Estate",
      value:
        estateHit.match.count > 1
          ? `${estateHit.match.name} (${estateHit.match.count} estates)`
          : estateHit.match.name,
    });
    rest = estateHit.rest;
  }

  // --- location -------------------------------------------------------------

  const placed = takePlace(rest, options.regionId);
  if (placed) {
    location = placed.outcome;
    const outcome = placed.outcome;
    if (
      (outcome.kind === "resolved" || outcome.kind === "ambiguous") &&
      outcome.via === "direction"
    ) {
      direction = directionWord(placed.span);
    }
    rest = placed.rest;
  }

  let leftovers = leftoverWords(rest);
  let fuzzyPhrase = "";
  if (!location && leftovers.length > 0) {
    // The whole leftover phrase, typo tolerance included. "shatn" is one typo
    // away from Sha Tin; "qwepoiqwepoi" is not close to anything.
    const phrase = leftovers.join(" ");
    if (phrase.length >= 4) {
      const outcome = resolvePhrase(phrase, { regionId: options.regionId });
      if (outcome.kind === "resolved" || outcome.kind === "ambiguous") {
        location = outcome;
        fuzzyPhrase = phrase;
        leftovers = [];
      }
    }
  }

  const ambiguous = location?.kind === "ambiguous" ? location : null;
  let question: string | null = null;

  if (location?.kind === "resolved") {
    const candidate = location.candidate;
    const scope = candidate.scope;
    patch.regionId = scope.regionId ?? "";
    patch.subregionId = scope.subregionId ?? "";
    patch.districtId = scope.districtId ?? "";
    // A joined label ("Yau Yat Chuen / Shek Kip Mei") reads as a multiple
    // choice, so show the component the user actually typed - including when the
    // whole-phrase typo fallback found it.
    const typedSpan = placed?.span ?? fuzzyPhrase;
    const typed =
      typedSpan && candidate.label.includes(" / ")
        ? componentOf(candidate.label, typedSpan)
        : "";
    spec.applied.push({
      field: "Location",
      value:
        typed ||
        `${candidate.label}${candidate.zh ? ` · ${candidate.zh}` : ""}`,
    });
  } else if (ambiguous) {
    const label = direction
      ? `${direction[0].toUpperCase()}${direction.slice(1)}`
      : "Which";
    if (ambiguous.via === "direction") {
      // Direction cells hold subregions, so the second question must ask for a
      // subregion or it contradicts its own hint labels.
      const level = ambiguous.candidates.every(
        (candidate) => candidate.level === "region",
      )
        ? "region"
        : "subregion";
      question = `${label} of which ${level}?`;
    } else {
      question = "Which place did you mean?";
    }
    spec.hints = ambiguous.candidates
      .slice(0, HINT_LIMIT)
      .map((candidate) => hintFor(candidate));
  }

  spec.filters = { ...EMPTY_ESTATE_FILTERS, ...patch };
  spec.unrecognised = leftovers.map(unfoldDots);

  // Band alternatives come after place hints, so a question stays first while
  // the user can also correct the size without retyping the sentence.
  for (const alternative of sizeAlternatives) {
    spec.hints.push({
      kind: "size",
      label: areaLabel(alternative.min, alternative.max),
      detail: "area band",
      level: "size",
      band: {
        minNetArea: alternative.min,
        maxNetArea: alternative.max,
      },
    });
  }

  const appliedAnything = spec.applied.length > 0;
  if (question) {
    return {
      kind: "ambiguous",
      spec,
      question,
      term: ambiguous?.term ?? null,
      direction,
      input,
    };
  }
  if (!appliedAnything) {
    // Keep the spec when it carries disclosure, so "sea view" alone still
    // reports what was ignored instead of a bare "nothing understood".
    const disclosed = spec.ignored.length > 0;
    return {
      kind: "unresolved",
      spec: disclosed ? spec : null,
      question: null,
      term: unfoldDots(leftovers.join(" ")) || null,
      direction: null,
      input,
    };
  }
  return {
    kind: "applied",
    spec,
    question: null,
    term: null,
    direction,
    input,
  };
}

/** Restore capital letters to a normalised span ("shek kip mei"). */
function tidyCase(span: string): string {
  return span.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

/**
 * The component of a joined label that the user typed, in its canonical
 * spelling. Title-casing the normalised span would turn "Jardine's Lookout"
 * into "Jardine S Lookout", so prefer the label's own text.
 */
function componentOf(label: string, typed: string): string {
  const wanted = normalise(typed);
  const part = label
    .split(" / ")
    .find((candidate) => normalise(candidate) === wanted);
  // One label ships with two spaces before the slash ("Mid-Levels Central  /").
  return part?.trim() ?? tidyCase(typed);
}

/** Undo the decimal sentinel for anything shown to the user. */
function unfoldDots(text: string): string {
  return text.replace(/(\d)dot(\d)/g, "$1.$2");
}

/** The direction word inside a span, for the question and hint refinement. */
const CJK_DIRECTION_WORDS: Record<string, string> = {
  "東": "east",
  "南": "south",
  "西": "west",
  "北": "north",
};

function directionWord(span: string): string | null {
  const english = span
    .split(" ")
    .find((word) => ["east", "west", "north", "south"].includes(word));
  if (english) return english;
  // Chinese has no space to split on, and puts the word last: 港島東.
  return CJK_DIRECTION_WORDS[span.slice(-1)] ?? null;
}

/** Whole-phrase membership that respects word boundaries. */
function hasPhrase(rest: string, phrase: string): boolean {
  return ` ${rest} `.includes(` ${phrase} `);
}

/**
 * Apply a hint to the spec that is currently on screen.
 *
 * Hints carry only the slot they replace, so a chosen band and a chosen place
 * compose in either order instead of one overwriting the other with whatever the
 * parse saw at the time.
 */
export function hintSpec(spec: NlSpec, hint: NlHint): NlSpec {
  if (hint.kind === "size") {
    return {
      ...spec,
      filters: {
        ...spec.filters,
        minNetArea: hint.band.minNetArea,
        maxNetArea: hint.band.maxNetArea,
      },
      applied: [
        ...spec.applied.filter((slot) => slot.field !== "Area"),
        { field: "Area", value: hint.label },
      ],
      hints: spec.hints.filter((item) => item.kind !== "size"),
    };
  }
  return {
    ...spec,
    filters: { ...spec.filters, ...hint.scope },
    applied: [
      ...spec.applied.filter((slot) => slot.field !== "Location"),
      { field: "Location", value: hint.label },
    ],
    hints: spec.hints.filter((item) => item.kind !== "place"),
  };
}

/**
 * Re-parse an unanchored direction with the region the user picked.
 *
 * A band the user chose (rather than a default) survives the re-parse: the
 * refined sentence would otherwise fall back to the vague-size default.
 */
export function refineDirection(
  parse: NlParse,
  regionId: string,
  options: NlOptions = {},
): NlParse {
  // Only a direction can be anchored; anything else is returned untouched.
  if (!parse.direction) return parse;
  // Re-parsing must see the same inputs, or an estate named in the sentence
  // disappears and its prefix can leak as a district.
  const refined = parseQuery(parse.input, { ...options, regionId });
  const chosen = parse.spec?.applied.find(
    (slot) => slot.field === "Area" && !slot.defaulted,
  );
  if (!refined.spec || !chosen) return refined;
  return {
    ...refined,
    spec: {
      ...refined.spec,
      filters: {
        ...refined.spec.filters,
        minNetArea: parse.spec?.filters.minNetArea ?? "",
        maxNetArea: parse.spec?.filters.maxNetArea ?? "",
      },
      applied: [
        ...refined.spec.applied.filter((slot) => slot.field !== "Area"),
        { field: "Area", value: chosen.value },
      ],
      hints: refined.spec.hints.filter((item) => item.kind !== "size"),
    },
  };
}

/**
 * Turn a spec into the state the search view should show.
 *
 * Every submit replaces the query: one utterance is one query spec. Slots the
 * sentence does not mention are cleared, so a previous query cannot silently
 * narrow the new one.
 */
export function specToState(spec: NlSpec): SearchState {
  return {
    // filterEstates already narrows on this text, so an estate name needs no
    // new filter field.
    query: spec.estate?.name ?? "",
    sort: spec.sort,
    filters: { ...spec.filters },
  };
}
