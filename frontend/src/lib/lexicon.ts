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

export interface NlHint {
  label: string;
  detail: string;
  /** "size" hints replace the area band; place hints replace the location. */
  level: "region" | "subregion" | "district" | "size";
  filters: EstateFilters;
  sort: SortKey;
}

export interface NlSpec {
  filters: EstateFilters;
  sort: SortKey;
  applied: NlSlot[];
  ignored: string[];
  unrecognised: string[];
  hints: NlHint[];
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

export interface NlOptions {
  /** Current cascade region, used to anchor direction words. */
  regionId?: string;
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
  { pattern: /\b(?:new build|newly built|brand new)\b/, label: "Building age (no age filter)" },
  { pattern: /\b(?:car ?park|parking)\b/, label: "Parking (no data)" },
  { pattern: /\b(?:near|close to|next to) ?(?:the )?mtr\b/, label: "MTR proximity (line-level data only)" },
  { pattern: /(?:^| )mtr(?: station)?(?= |$)/, label: "MTR proximity (line-level data only)" },
  { pattern: /\b(?:good|great|top|best) ?schools?\b/, label: "School quality (net membership only)" },
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
  "三": 3,
  "四": 4,
  "五": 5,
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
];

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
  ...MTR_LINES.map((line) => ({
    phrase: normalise(line.en),
    value: line.en,
  })),
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

/** Remove one span, keeping the rest of the phrase separable. */
function removeSpan(rest: string, span: string): string {
  return rest.replace(span, " ");
}

function roomValue(count: number): string {
  return count >= 4 ? "4+" : String(count);
}

function hintFor(
  candidate: PlaceCandidate,
  filters: EstateFilters,
  sort: SortKey,
): NlHint {
  return {
    label: candidate.label,
    detail: `${candidate.level} · ${candidate.estates} estates`,
    level: candidate.level,
    filters,
    sort,
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
    const cjk = consume(rest, /(?:^| )(\d|一|二|三|四|五) ?房(?= |$)/);
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

  let sizeAlternatives: { min: string; max: string }[] = [];
  if (!patch.minNetArea && !patch.maxNetArea) {
    // Vague size words get a marked default rather than being dropped: the
    // quartiles of the snapshot are 382 / 533 / 734 ft², so these bands cover
    // the middle, the small and the large half of the market.
    const middle = consume(
      rest,
      /(?:^| )(?:middle|mid|medium) ?(?:size|sized)?(?= |$)/,
    );
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
      /(?:school net|schoolnet|net) ?(?:no ?)?(\d{1,2})(?= |$)/,
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

  // "school net" with no number or name names the concept but no value.
  if (!patch.schoolNet) {
    const bareNet = consume(rest, /(?:school net|schoolnet)(?= |$)/);
    if (bareNet) {
      spec.ignored.push("School net without a number or name");
      rest = bareNet.rest;
    }
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
  if (!location && leftovers.length > 0) {
    // The whole leftover phrase, typo tolerance included. "shatn" is one typo
    // away from Sha Tin; "qwepoiqwepoi" is not close to anything.
    const phrase = leftovers.join(" ");
    if (phrase.length >= 4) {
      const outcome = resolvePhrase(phrase, { regionId: options.regionId });
      if (outcome.kind === "resolved" || outcome.kind === "ambiguous") {
        location = outcome;
        leftovers = [];
      }
    }
  }

  const otherFilters: EstateFilters = { ...EMPTY_ESTATE_FILTERS, ...patch };
  const ambiguous = location?.kind === "ambiguous" ? location : null;
  let question: string | null = null;

  if (location?.kind === "resolved") {
    const candidate = location.candidate;
    const scope = candidate.scope;
    patch.regionId = scope.regionId ?? "";
    patch.subregionId = scope.subregionId ?? "";
    patch.districtId = scope.districtId ?? "";
    spec.applied.push({
      field: "Location",
      value: `${candidate.label}${candidate.zh ? ` · ${candidate.zh}` : ""}`,
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
      .map((candidate) =>
        hintFor(
          candidate,
          {
            ...otherFilters,
            regionId: candidate.scope.regionId ?? "",
            subregionId: candidate.scope.subregionId ?? "",
            districtId: candidate.scope.districtId ?? "",
          },
          spec.sort,
        ),
      );
  }

  spec.filters = { ...EMPTY_ESTATE_FILTERS, ...patch };
  spec.unrecognised = leftovers.map(unfoldDots);

  // Band alternatives come after place hints, so a question stays first while
  // the user can also correct the size without retyping the sentence.
  for (const alternative of sizeAlternatives) {
    spec.hints.push({
      label: areaLabel(alternative.min, alternative.max),
      detail: "area band",
      level: "size",
      filters: {
        ...spec.filters,
        minNetArea: alternative.min,
        maxNetArea: alternative.max,
      },
      sort: spec.sort,
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

/** Undo the decimal sentinel for anything shown to the user. */
function unfoldDots(text: string): string {
  return text.replace(/(\d)dot(\d)/g, "$1.$2");
}

/** The direction word inside a span, for the question and hint refinement. */
function directionWord(span: string): string | null {
  return (
    span
      .split(" ")
      .find((word) => ["east", "west", "north", "south"].includes(word)) ?? null
  );
}

/**
 * Re-parse the same utterance with an anchor, used when a hint supplies the
 * region an unanchored direction was missing.
 */
export function withRegion(parse: NlParse, regionId: string): NlParse {
  return parseQuery(parse.input, { regionId });
}

/** Whole-phrase membership that respects word boundaries. */
function hasPhrase(rest: string, phrase: string): boolean {
  return ` ${rest} `.includes(` ${phrase} `);
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
    query: "",
    sort: spec.sort,
    filters: { ...spec.filters },
  };
}
