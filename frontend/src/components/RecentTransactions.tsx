import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { EstateSummary, Manifest, RecentTransaction } from "../types";
import { loadRecentTransactions } from "../lib/dashboard";
import { listDistricts, paginate } from "../lib/estates";
import {
  EMPTY_FILTERS,
  filterTransactions,
  SORT_OPTIONS,
  sortTransactions,
  summarizeTransactions,
  type SortDirection,
  type TransactionFilters,
  type TransactionSortKey,
} from "../lib/transactions";
import {
  formatDate,
  formatHkd,
  formatNumber,
} from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";

const PAGE_SIZE = 25;

interface Props {
  manifest: Manifest;
  estates: EstateSummary[];
  onSelectEstate: (estate: EstateSummary) => void;
}

export function RecentTransactions({
  manifest,
  estates,
  onSelectEstate,
}: Props) {
  const [rows, setRows] = useState<RecentTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<TransactionSortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(filters.query);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadRecentTransactions(manifest)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load recent transactions.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, reloadToken]);

  const districts = useMemo(() => listDistricts(estates), [estates]);
  const estateById = useMemo(() => {
    const lookup = new Map<string, EstateSummary>();
    for (const estate of estates) lookup.set(estate.estate_id, estate);
    return lookup;
  }, [estates]);

  const activeFilters = useMemo<TransactionFilters>(
    () => ({ ...filters, query: deferredQuery }),
    [filters, deferredQuery],
  );

  const filtered = useMemo(
    () => (rows ? filterTransactions(rows, activeFilters) : []),
    [rows, activeFilters],
  );
  const sorted = useMemo(
    () => sortTransactions(filtered, sortKey, sortDirection),
    [filtered, sortKey, sortDirection],
  );
  const pageData = useMemo(
    () => paginate(sorted, page, PAGE_SIZE),
    [sorted, page],
  );
  const summary = useMemo(() => summarizeTransactions(filtered), [filtered]);

  const dateBounds = useMemo(() => {
    if (!rows || rows.length === 0) return { min: "", max: "" };
    let min = rows[0].tx_date;
    let max = rows[0].tx_date;
    for (const row of rows) {
      if (row.tx_date < min) min = row.tx_date;
      if (row.tx_date > max) max = row.tx_date;
    }
    return { min, max };
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, filters.districtId, filters.from, filters.to, sortKey, sortDirection]);

  const updateFilters = (patch: Partial<TransactionFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  return (
    <section className="panel" aria-label="Recent transactions">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Transactions</p>
          <h2>Recent transactions</h2>
          <p className="muted">
            Sales from the last 24 months relative to the snapshot's latest
            transaction date. Select a row to open the estate detail panel.
          </p>
        </div>
        <p className="result-count">{formatNumber(sorted.length)} rows</p>
      </div>

      {loading ? <InlineLoading label="Loading recent transactions…" /> : null}

      {error && !loading ? (
        <InlineError
          title="Recent transactions are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : null}

      {rows && !loading && !error && rows.length === 0 ? (
        <EmptyNotice title="This snapshot has no recent transactions">
          <p>
            The snapshot does not include any transaction rows, so there is
            nothing to filter. Rebuild the snapshot from the analytics marts.
          </p>
        </EmptyNotice>
      ) : null}

      {rows && rows.length > 0 && !loading && !error ? (
        <>
          <div className="controls">
            <label className="field field-grow">
              <span>Search</span>
              <input
                type="search"
                value={filters.query}
                onChange={(event) => updateFilters({ query: event.target.value })}
                placeholder="Estate, district, or estate ID"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>District</span>
              <select
                value={filters.districtId}
                onChange={(event) =>
                  updateFilters({ districtId: event.target.value })
                }
              >
                <option value="">All districts</option>
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={filters.from}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(event) => updateFilters({ from: event.target.value })}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={filters.to}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(event) => updateFilters({ to: event.target.value })}
              />
            </label>
          </div>

          <div className="stat-row">
            <div className="stat-tile">
              <p className="stat-label">Matching</p>
              <p className="stat-value">{formatNumber(summary.count)}</p>
              <p className="stat-note">
                {formatNumber(summary.districts)} districts
              </p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Total value</p>
              <p className="stat-value stat-value-small">
                {formatHkd(summary.totalPrice)}
              </p>
              <p className="stat-note">Sum of matching transaction prices</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Median net ft price</p>
              <p className="stat-value">
                {formatHkd(summary.medianNetFtPrice)}
              </p>
              <p className="stat-note">Per square foot, matching rows</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Sort</p>
              <div className="sort-inline">
                <select
                  aria-label="Sort transactions"
                  value={sortKey}
                  onChange={(event) =>
                    setSortKey(event.target.value as TransactionSortKey)
                  }
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setSortDirection((current) =>
                      current === "asc" ? "desc" : "asc",
                    )
                  }
                >
                  {sortDirection === "asc" ? "Ascending" : "Descending"}
                </button>
              </div>
            </div>
          </div>

          {sorted.length === 0 ? (
            <EmptyNotice title="No transactions match these filters">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Clear filters
              </button>
            </EmptyNotice>
          ) : (
            <>
              <div className="table-wrap">
                <table className="estate-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Estate</th>
                      <th scope="col">District</th>
                      <th scope="col" className="numeric">
                        Price
                      </th>
                      <th scope="col" className="numeric">
                        Net ft price
                      </th>
                      <th scope="col" className="numeric">
                        Net area
                      </th>
                      <th scope="col" className="numeric">
                        Bedrooms
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.items.map((row, index) => {
                      const estate = estateById.get(row.estate_id);
                      return (
                        <tr
                          key={`${row.tx_date}-${row.estate_id}-${(pageData.page - 1) * PAGE_SIZE + index}`}
                          className={estate ? "estate-row" : ""}
                          tabIndex={estate ? 0 : undefined}
                          onClick={() => estate && onSelectEstate(estate)}
                          onKeyDown={(event) => {
                            if (
                              estate &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              onSelectEstate(estate);
                            }
                          }}
                        >
                          <td>{formatDate(row.tx_date)}</td>
                          <td>
                            <span className="estate-name">
                              {row.estate_name_en}
                            </span>
                          </td>
                          <td>{row.district_name_en}</td>
                          <td className="numeric">{formatHkd(row.price)}</td>
                          <td className="numeric">
                            {formatHkd(row.net_ft_price)}
                          </td>
                          <td className="numeric">
                            {row.net_area === null
                              ? "—"
                              : `${formatNumber(row.net_area)} ft²`}
                          </td>
                          <td className="numeric">
                            {formatNumber(row.bedroom)}
                          </td>
                        </tr>
                      );
                    })}
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
        </>
      ) : null}
    </section>
  );
}
