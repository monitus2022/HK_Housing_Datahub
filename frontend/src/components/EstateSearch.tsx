import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { EstateSummary } from "../types";
import {
  filterEstates,
  paginate,
  sortEstates,
  type SortKey,
} from "../lib/estates";
import {
  districtsInScope,
  REGIONS,
  scopeForDistrict,
  scopeLabel,
  subregionById,
  subregionsInRegion,
} from "../lib/geo";
import {
  activeFilterCount,
  listMtrLines,
  listSchoolNets,
  EMPTY_ESTATE_FILTERS,
  type EstateFilters,
} from "../lib/filters";
import {
  DEFAULT_SEARCH_STATE,
  searchStateFromParams,
  searchStateToSearch,
  type SearchState,
} from "../lib/searchState";
import {
  hintSpec,
  parseQuery,
  warmEstateIndex,
  refineDirection,
  specToState,
  type NlHint,
  type NlParse,
} from "../lib/lexicon";
import {
  formatCompactHkd,
  formatDate,
  formatHkd,
  formatNumber,
} from "../lib/format";
import { wikiUrl } from "../lib/wiki";
import { isRowActivation } from "../lib/activation";

const PAGE_SIZE = 25;

/** Longest utterance the box accepts; the lexicon is not a chat window. */
const NL_MAX_LENGTH = 120;

const NL_ENABLED = import.meta.env.VITE_FEATURE_NL_SEARCH === "true";

/**
 * Builds the estate-name index while the browser is idle. A separate component
 * so the flag-off build drops it, and the index builder, entirely: ~59 ms for
 * 9,750 names is not work the non-NL build should ever do.
 */
function NlEstateWarmer({ estates }: { estates: EstateSummary[] }) {
  useEffect(() => {
    if (estates.length === 0) return;
    if (typeof globalThis.requestIdleCallback === "function") {
      const handle = globalThis.requestIdleCallback(() => warmEstateIndex(estates));
      return () => {
        if (typeof globalThis.cancelIdleCallback === "function") {
          globalThis.cancelIdleCallback(handle);
        }
      };
    }
    const timer = setTimeout(() => warmEstateIndex(estates), 200);
    return () => clearTimeout(timer);
  }, [estates]);
  return null;
}

interface Props {
  estates: EstateSummary[];
  onSelect: (estate: EstateSummary) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "latest_price", label: "Latest price" },
  { value: "tx_count_12m", label: "Most active (12m)" },
  { value: "latest_tx_date", label: "Latest transaction" },
];

const BEDROOM_OPTIONS = ["1", "2", "3", "4+"];

function flag(label: string, active: boolean, title: string) {
  return (
    <span
      className={`flag ${active ? "flag-on" : "flag-off"}`}
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  );
}

function wikiFlag(estate: EstateSummary) {
  const url = wikiUrl(estate.wiki_title);
  if (!url) {
    return flag("W", estate.has_wiki === 1, "Has wiki data");
  }
  return (
    <a
      className={`flag flag-link ${
        estate.has_wiki === 1 ? "flag-on" : "flag-off"
      }`}
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open the Chinese Wikipedia page"
      aria-label={`Open the Wikipedia page for ${estate.estate_name_en}`}
      onClick={(event) => event.stopPropagation()}
    >
      W
    </a>
  );
}

function rangeLabel(
  minimum: string,
  maximum: string,
  formatter: (value: number | null) => string,
): string {
  const low = minimum ? formatter(Number(minimum)) : null;
  const high = maximum ? formatter(Number(maximum)) : null;
  if (low && high) return `${low} – ${high}`;
  if (low) return `≥ ${low}`;
  return `≤ ${high}`;
}

export function EstateSearch({ estates, onSelect }: Props) {
  const [state, setState] = useState<SearchState>(() =>
    searchStateFromParams(window.location.search),
  );
  const [page, setPage] = useState(1);
  const [nlText, setNlText] = useState("");
  const [nlParse, setNlParse] = useState<NlParse | null>(null);
  const deferredQuery = useDeferredValue(state.query);
  const { filters, sort } = state;

  const subregionOptions = useMemo(
    () => subregionsInRegion(filters.regionId),
    [filters.regionId],
  );
  const districtOptions = useMemo(
    () =>
      districtsInScope({
        regionId: filters.regionId,
        subregionId: filters.subregionId,
      }),
    [filters.regionId, filters.subregionId],
  );
  // Indexing ~9,750 names costs ~59 ms; do it while the browser is idle so the
  // first submit does not pay for it.
  const mtrLines = useMemo(() => listMtrLines(estates), [estates]);
  const schoolNets = useMemo(() => listSchoolNets(estates), [estates]);
  const filterCount = activeFilterCount(filters);
  const supportsFilters = useMemo(
    () =>
      estates.some(
        (estate) =>
          estate.latest_net_area !== undefined ||
          estate.mtr_lines !== undefined,
      ),
    [estates],
  );
  const effectiveFilters = supportsFilters ? filters : EMPTY_ESTATE_FILTERS;
  const filtered = useMemo(
    () => filterEstates(estates, deferredQuery, effectiveFilters),
    [estates, deferredQuery, effectiveFilters],
  );
  const sorted = useMemo(() => sortEstates(filtered, sort), [filtered, sort]);
  const pageData = useMemo(
    () => paginate(sorted, page, PAGE_SIZE),
    [sorted, page],
  );

  useEffect(() => {
    const next = searchStateToSearch(state, window.location.search);
    if (next !== window.location.search) {
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${next}`,
      );
    }
  }, [state]);

  useEffect(() => {
    const handlePop = () => {
      // Back/forward is a different query, so the previous disclosure is stale.
      setNlParse(null);
      setState(searchStateFromParams(window.location.search));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, filters, sort]);

  const updateFilter = (patch: Partial<EstateFilters>) => {
    // A manual edit is a new query, so the previous sentence's interpretation
    // no longer describes what is on screen.
    setNlParse(null);
    setState((current) => ({
      ...current,
      filters: { ...current.filters, ...patch },
    }));
  };

  const clearAll = () => {
    setNlParse(null);
    setState(DEFAULT_SEARCH_STATE);
  };

  const submitNl = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const parse = parseQuery(text, {
      regionId: state.filters.regionId,
      estates,
    });
    setNlText(text);
    setNlParse(parse);
    // Only a parsed spec replaces the query. A refusal or an unresolved
    // sentence leaves the current result set untouched.
    if (parse.spec && (parse.kind === "applied" || parse.kind === "ambiguous")) {
      setState(specToState(parse.spec));
    }
  };

  const applyHint = (hint: NlHint) => {
    const current = nlParse?.spec;
    if (!nlParse || !current) return;
    // A direction without a region produced region-level hints. Re-parsing the
    // same sentence with the chosen region turns "east" into East Kowloon
    // instead of silently applying all of Kowloon. Subregion hints are already
    // the answer, so they apply directly.
    if (hint.kind === "place" && hint.level === "region" && nlParse.direction) {
      const refined = refineDirection(nlParse, hint.scope.regionId, {
        estates,
      });
      if (refined.spec) {
        setNlParse(refined);
        setState(specToState(refined.spec));
        return;
      }
    }
    const next = hintSpec(current, hint);
    // Answering the place question leaves the band hints; choosing a band leaves
    // the place question open.
    const stillAsking =
      nlParse.kind === "ambiguous" &&
      next.hints.some((item) => item.kind === "place");
    setState(specToState(next));
    setNlParse({
      ...nlParse,
      kind: stillAsking ? "ambiguous" : "applied",
      question: stillAsking ? nlParse.question : null,
      spec: next,
    });
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.regionId || filters.subregionId || filters.districtId) {
    chips.push({
      label: scopeLabel(filters),
      // One chip for one cascade: the label shows the most specific level, and
      // clearing it returns to all estates rather than silently falling back
      // to a parent that the district selection derived.
      clear: () =>
        updateFilter({ regionId: "", subregionId: "", districtId: "" }),
    });
  }
  if (filters.minPrice || filters.maxPrice) {
    chips.push({
      label: `Price ${rangeLabel(
        filters.minPrice,
        filters.maxPrice,
        formatCompactHkd,
      )}`,
      clear: () => updateFilter({ minPrice: "", maxPrice: "" }),
    });
  }
  if (filters.minNetFtPrice || filters.maxNetFtPrice) {
    chips.push({
      label: `Net ft ${rangeLabel(
        filters.minNetFtPrice,
        filters.maxNetFtPrice,
        formatCompactHkd,
      )}`,
      clear: () =>
        updateFilter({ minNetFtPrice: "", maxNetFtPrice: "" }),
    });
  }
  if (filters.minNetArea || filters.maxNetArea) {
    chips.push({
      label: `Area ${rangeLabel(
        filters.minNetArea,
        filters.maxNetArea,
        (value) => (value === null ? "" : `${formatNumber(value)} ft²`),
      )}`,
      clear: () => updateFilter({ minNetArea: "", maxNetArea: "" }),
    });
  }
  if (filters.bedrooms) {
    chips.push({
      label: `${filters.bedrooms} bed`,
      clear: () => updateFilter({ bedrooms: "" }),
    });
  }
  if (filters.mtrLine) {
    chips.push({
      label: filters.mtrLine,
      clear: () => updateFilter({ mtrLine: "" }),
    });
  }
  if (filters.schoolNet) {
    chips.push({
      label: `School ${filters.schoolNet}`,
      clear: () => updateFilter({ schoolNet: "" }),
    });
  }

  return (
    <section className="panel" aria-label="Estate search">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Explore</p>
          <h2>Estate search</h2>
          <p className="muted">
            Search by name, region, subregion, district, price, size, MTR line,
            or school net, then open an estate for its price history and recent
            transactions.
          </p>
        </div>
        <p className="result-count">
          {formatNumber(sorted.length)} estates
        </p>
      </div>

      {NL_ENABLED ? <NlEstateWarmer estates={estates} /> : null}
      {NL_ENABLED ? (
        <form
          className="nl-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitNl(nlText);
          }}
        >
          <label className="field field-grow">
            <span>Describe a search</span>
            <input
              type="text"
              value={nlText}
              maxLength={NL_MAX_LENGTH}
              onChange={(event) => setNlText(event.target.value)}
              placeholder="e.g. 2 bedroom flat in TKO"
              autoComplete="off"
              aria-describedby="nl-help"
            />
          </label>
          <button
            type="submit"
            className="button"
            disabled={!nlText.trim()}
          >
            Apply
          </button>
          <p className="nl-help" id="nl-help">
            One sentence, one search. It runs in your browser, and anything it
            cannot use is listed below rather than guessed.
          </p>
        </form>
      ) : null}

      {NL_ENABLED && nlParse ? (
        <div className="nl-result" role="status">
          {nlParse.kind === "refused" ? (
            <p className="nl-note nl-note-warn">
              “{nlParse.term}” is outside Hong Kong’s housing market, so nothing
              was applied.
            </p>
          ) : null}
          {nlParse.kind === "unresolved" ? (
            <p className="nl-note nl-note-warn">
              No filter could be read from that sentence
              {nlParse.term ? ` (“${nlParse.term}”)` : ""}, so nothing changed.
            </p>
          ) : null}
          {nlParse.spec && nlParse.spec.hints.length > 0 ? (
            <div className="nl-note">
              <p>
                {nlParse.kind === "ambiguous" && nlParse.question
                  ? nlParse.question
                  : "Different size?"}
              </p>
              <div className="nl-hints">
                {nlParse.spec.hints.map((hint) => (
                  <button
                    key={`${hint.level}-${hint.label}-${hint.detail}`}
                    type="button"
                    className="nl-hint"
                    onClick={() => applyHint(hint)}
                  >
                    {hint.label} <span>{hint.detail}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {nlParse.spec && nlParse.spec.applied.length > 0 ? (
            <p className="nl-note">
              Interpreted as:{" "}
              {nlParse.spec.applied.map((slot, index) => (
                <span key={`${slot.field}-${index}`}>
                  {index > 0 ? " · " : ""}
                  {slot.field}: {slot.value}
                  {slot.defaulted ? " (default)" : ""}
                </span>
              ))}
            </p>
          ) : null}
          {nlParse.spec && nlParse.spec.ignored.length > 0 ? (
            <p className="nl-note">
              Ignored: {nlParse.spec.ignored.join("; ")}
            </p>
          ) : null}
          {nlParse.spec && nlParse.spec.unrecognised.length > 0 ? (
            <p className="nl-note">
              Unrecognised: {nlParse.spec.unrecognised.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="controls">
        <label className="field field-grow">
          <span>Search</span>
          <input
            type="search"
            value={state.query}
            onChange={(event) => {
              setNlParse(null);
              setState((current) => ({
                ...current,
                query: event.target.value,
              }));
            }}
            placeholder="Estate, district, or estate ID"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Region</span>
          <select
            value={filters.regionId}
            onChange={(event) =>
              updateFilter({
                regionId: event.target.value,
                subregionId: "",
                districtId: "",
              })
            }
          >
            <option value="">All regions</option>
            {REGIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.en}
                {item.zh ? ` · ${item.zh}` : ""} (
                {formatNumber(item.estates)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subregion</span>
          <select
            value={filters.subregionId}
            onChange={(event) => {
              const value = event.target.value;
              // Mirror the district handler: a subregion fills its region so
              // the cascade and the URL agree before and after a reload.
              updateFilter({
                subregionId: value,
                districtId: "",
                regionId: value
                  ? (subregionById(value)?.regionId ?? "")
                  : filters.regionId,
              });
            }}
          >
            <option value="">All subregions</option>
            {subregionOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.en}
                {item.zh ? ` · ${item.zh}` : ""} (
                {formatNumber(item.estates)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>District</span>
          <select
            value={filters.districtId}
            onChange={(event) => {
              const value = event.target.value;
              // Picking a district fills its parents so the cascade never
              // shows "All regions" above a chosen district.
              const scope = scopeForDistrict(value);
              updateFilter({
                districtId: value,
                regionId: scope?.regionId ?? filters.regionId,
                subregionId: scope?.subregionId ?? filters.subregionId,
              });
            }}
          >
            <option value="">All districts</option>
            {districtOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.en}
                {item.zh ? ` · ${item.zh}` : ""} (
                {formatNumber(item.estates)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) => {
              setNlParse(null);
              setState((current) => ({
                ...current,
                sort: event.target.value as SortKey,
              }));
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {supportsFilters ? (
      <details className="filter-panel" open={filterCount > 0}>
        <summary>
          Filters{filterCount > 0 ? ` (${filterCount})` : ""}
        </summary>
        <div className="filter-grid">
          <label className="field">
            <span>Min price (HKD)</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.minPrice}
              onChange={(event) =>
                updateFilter({ minPrice: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Max price (HKD)</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.maxPrice}
              onChange={(event) =>
                updateFilter({ maxPrice: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Min net ft price</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.minNetFtPrice}
              onChange={(event) =>
                updateFilter({ minNetFtPrice: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Max net ft price</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.maxNetFtPrice}
              onChange={(event) =>
                updateFilter({ maxNetFtPrice: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Min net area (ft²)</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.minNetArea}
              onChange={(event) =>
                updateFilter({ minNetArea: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Max net area (ft²)</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={filters.maxNetArea}
              onChange={(event) =>
                updateFilter({ maxNetArea: event.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Bedrooms (latest)</span>
            <select
              value={filters.bedrooms}
              onChange={(event) =>
                updateFilter({ bedrooms: event.target.value })
              }
            >
              <option value="">Any</option>
              {BEDROOM_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>MTR line</span>
            <select
              value={filters.mtrLine}
              onChange={(event) =>
                updateFilter({ mtrLine: event.target.value })
              }
            >
              <option value="">Any line</option>
              {mtrLines.map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>School net</span>
            <select
              value={filters.schoolNet}
              onChange={(event) =>
                updateFilter({ schoolNet: event.target.value })
              }
            >
              <option value="">Any net</option>
              {schoolNets.map((net) => (
                <option key={net} value={net}>
                  {net}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted filter-hint">
          Bedrooms and area use the latest transaction; estates without a usable
          value (about 47% of units lack a bedroom) are excluded while that filter
          is active.
        </p>
      </details>
      ) : (
        <p className="muted">
          This snapshot does not include filter fields. Rebuild and republish
          it to enable filters.
        </p>
      )}

      {supportsFilters && chips.length > 0 ? (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map((chip, index) => (
            <button
              key={`${chip.label}-${index}`}
              type="button"
              className="filter-chip"
              onClick={chip.clear}
            >
              {chip.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="button button-quiet" onClick={clearAll}>
            Clear all
          </button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No estates match these filters.</p>
          <button type="button" className="button button-quiet" onClick={clearAll}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="estate-table">
              <thead>
                <tr>
                  <th scope="col">Estate</th>
                  <th scope="col">District</th>
                  <th scope="col">Latest transaction</th>
                  <th scope="col" className="numeric">
                    Price
                  </th>
                  <th scope="col" className="numeric">
                    Net ft price
                  </th>
                  <th scope="col" className="numeric">
                    12m tx
                  </th>
                  <th scope="col">Flags</th>
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((estate) => (
                  <tr
                    key={estate.estate_id}
                    className="estate-row"
                    tabIndex={0}
                    onClick={() => onSelect(estate)}
                    onKeyDown={(event) => {
                      if (!isRowActivation(event)) return;
                      event.preventDefault();
                      onSelect(estate);
                    }}
                    aria-label={`Open ${estate.estate_name_en}`}
                  >
                    <td>
                      <span className="estate-name">
                        {estate.estate_name_en}
                      </span>
                      <span className="estate-name-zh">
                        {estate.estate_name_zh}
                      </span>
                    </td>
                    <td>{estate.district_name_en}</td>
                    <td>{formatDate(estate.latest_tx_date)}</td>
                    <td className="numeric">
                      {formatHkd(estate.latest_tx_price)}
                    </td>
                    <td className="numeric">
                      {formatHkd(estate.latest_tx_net_ft_price)}
                    </td>
                    <td className="numeric">
                      {formatNumber(estate.tx_count_12m)}
                    </td>
                    <td>
                      <span className="flags">
                        {flag(
                          "M",
                          estate.has_market === 1,
                          "Has monthly market data",
                        )}
                        {flag(
                          "T",
                          estate.has_transactions === 1,
                          "Has transactions",
                        )}
                        {wikiFlag(estate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination" aria-label="Pagination">
            <button
              type="button"
              className="button"
              disabled={pageData.page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>
              Page {pageData.page} of {pageData.totalPages}
            </span>
            <button
              type="button"
              className="button"
              disabled={pageData.page === pageData.totalPages}
              onClick={() =>
                setPage((current) =>
                  Math.min(pageData.totalPages, current + 1),
                )
              }
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
