import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { EstateSummary } from "../types";
import {
  filterEstates,
  listDistricts,
  paginate,
  sortEstates,
  type SortKey,
} from "../lib/estates";
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
  formatCompactHkd,
  formatDate,
  formatHkd,
  formatNumber,
} from "../lib/format";

const PAGE_SIZE = 25;

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
  const deferredQuery = useDeferredValue(state.query);
  const { filters, sort } = state;

  const districts = useMemo(() => listDistricts(estates), [estates]);
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
      setState(searchStateFromParams(window.location.search));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, filters, sort]);

  const updateFilter = (patch: Partial<EstateFilters>) => {
    setState((current) => ({
      ...current,
      filters: { ...current.filters, ...patch },
    }));
  };

  const clearAll = () => {
    setState(DEFAULT_SEARCH_STATE);
  };

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.districtId) {
    const district = districts.find((item) => item.id === filters.districtId);
    chips.push({
      label: district?.nameEn ?? filters.districtId,
      clear: () => updateFilter({ districtId: "" }),
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
            Search by name, district, price, size, MTR line, or school net,
            then open an estate for its price history and recent transactions.
          </p>
        </div>
        <p className="result-count">
          {formatNumber(sorted.length)} estates
        </p>
      </div>

      <div className="controls">
        <label className="field field-grow">
          <span>Search</span>
          <input
            type="search"
            value={state.query}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                query: event.target.value,
              }))
            }
            placeholder="Estate, district, or estate ID"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>District</span>
          <select
            value={filters.districtId}
            onChange={(event) =>
              updateFilter({ districtId: event.target.value })
            }
          >
            <option value="">All districts</option>
            {districts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nameEn}
                {item.nameZh ? ` · ${item.nameZh}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                sort: event.target.value as SortKey,
              }))
            }
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
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(estate);
                      }
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
                        {flag("W", estate.has_wiki === 1, "Has wiki data")}
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
