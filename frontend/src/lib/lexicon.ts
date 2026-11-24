/** Deterministic natural-language lexicon for the estate search.
 *
 * One utterance becomes one query spec. There is no session, no memory and no
 * model: the same sentence always produces the same filters, and everything the
 * lexicon did *not* understand is reported back instead of being dropped.
 *
 * The parser consumes phrases in a fixed order — prices, areas, bedrooms, sort
 * words, MTR lines, school nets, then a place — and removes each phrase it
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
  /** Full replacement state for "applied" and "ambiguous". */
  spec: NlSpec | null;
  /** The question to ask when kind is "ambiguous". */
  question: string | null;
  /** Offending phrase for "refused" and "unresolved". */
  term: string | null;
  /** The normalised utterance, echoed back for the disclosure row. */
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

/** Line names, plus the shorthand people actually type. */
const MTR_ALIASES: { phrase: string; value: string }[] = [
  ...MTR_LINES.map((line) => ({
    phrase: normalise(line.en),
    value: line.en,
  })),
  { phrase: "tko line", value: "Tseung Kwan O Line" },
  { phrase: "east rail", value: "East Rail Line" },
  { phrase: "tuen ma", value: "Tuen Ma Line" },
  { phrase: "tung chung", value: "Tung Chung Line" },
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

function scale(unit: string | undefined): number {
  switch ((unit ?? "m").toLowerCase()) {
    case "k":
    case "thousand":
      return 1_000;
    case "million":
    case "mil":
    case "m":
    default:
      return 1_000_000;
  }
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
  const input = normalise(text);
  if (!input) {
    return {
      kind: "unresolved",
      spec: null,
      question: null,
      term: "",
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
      input,
    };
  }

  const spec = emptySpec(DEFAULT_SEARCH_STATE.sort);
  const patch: Partial<EstateFilters> = {};
  let rest = input;
  let location: PlaceOutcome | null = null;

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

  if (!patch.minNetArea && !patch.maxNetArea) {
    // Vague size words get a marked default rather than being dropped: the
    // quartiles of the snapshot are 382 / 533 / 734 ft², so these bands cover
    // the middle, the small and the large half of the market.
    const middle = consume(
      rest,
      /(?:^| )(?:middle|mid|medium) ?(?:size|sized)(?= |$)/,
    );
    const small = middle
      ? null
      : consume(rest, /(?:^| )(?:small|compact|tiny)(?= |$)/);
    const large =
      middle || small
        ? null
        : consume(rest, /(?:^| )(?:large|big|spacious)(?= |$)/);
    if (middle) {
      patch.minNetArea = "400";
      patch.maxNetArea = "700";
      spec.applied.push({
        field: "Area",
        value: areaLabel("400", "700"),
        defaulted: true,
      });
      rest = middle.rest;
    } else if (small) {
      patch.maxNetArea = "400";
      spec.applied.push({
        field: "Area",
        value: areaLabel("", "400"),
        defaulted: true,
      });
      rest = small.rest;
    } else if (large) {
      patch.minNetArea = "700";
      spec.applied.push({
        field: "Area",
        value: areaLabel("700", ""),
        defaulted: true,
      });
      rest = large.rest;
    }
  }

  const priceRange = consume(
    rest,
    /(?:^| )\$?(\d+(?:\.\d+)?) ?(m|k|million|mil) ?(?:-|to)? ?\$?(\d+(?:\.\d+)?) ?(m|k|million|mil)(?= |$)/,
  );
  if (priceRange) {
    const low = Number(priceRange.match[1]) * scale(priceRange.match[2]);
    const high = Number(priceRange.match[3]) * scale(priceRange.match[4]);
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
      /(?:under|below|less than|up to|max|cheaper than) ?\$?(\d+(?:\.\d+)?) ?(m|k|million|mil)(?= |$)/,
    );
    if (priceMax) {
      patch.maxPrice = String(
        Math.round(Number(priceMax.match[1]) * scale(priceMax.match[2])),
      );
      spec.applied.push({
        field: "Price",
        value: `≤ ${moneyLabel(patch.maxPrice)}`,
      });
      rest = priceMax.rest;
    } else {
      const priceMin = consume(
        rest,
        /(?:over|above|more than|at least|min|from) ?\$?(\d+(?:\.\d+)?) ?(m|k|million|mil)(?= |$)/,
      );
      if (priceMin) {
        patch.minPrice = String(
          Math.round(Number(priceMin.match[1]) * scale(priceMin.match[2])),
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
        spec.applied.push({ field: "School net", value: names[0] });
      } else if (names.length > 1) {
        spec.ignored.push(
          `School net ${netId.match[1]} spans ${names.join(" and ")}`,
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
    question =
      ambiguous.via === "direction"
        ? "East of which region?"
        : "Which place did you mean?";
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
  spec.unrecognised = leftovers;

  const appliedAnything = spec.applied.length > 0;
  if (question) {
    return {
      kind: "ambiguous",
      spec,
      question,
      term: ambiguous?.term ?? null,
      input,
    };
  }
  if (!appliedAnything) {
    return {
      kind: "unresolved",
      spec: null,
      question: null,
      term: leftovers.join(" ") || null,
      input,
    };
  }
  return { kind: "applied", spec, question: null, term: null, input };
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
