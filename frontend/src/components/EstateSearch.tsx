import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { EstateSummary } from "../types";
import {
  filterEstates,
  listDistricts,
  paginate,
  sortEstates,
  type SortKey,
} from "../lib/estates";
import { formatDate, formatHkd, formatNumber } from "../lib/format";

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

export function EstateSearch({ estates, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("");
  const [sort, setSort] = useState<SortKey>("tx_count_12m");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  const districts = useMemo(() => listDistricts(estates), [estates]);
  const filtered = useMemo(
    () => filterEstates(estates, deferredQuery, district),
    [estates, deferredQuery, district],
  );
  const sorted = useMemo(() => sortEstates(filtered, sort), [filtered, sort]);
  const pageData = useMemo(
    () => paginate(sorted, page, PAGE_SIZE),
    [sorted, page],
  );

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, district, sort]);

  return (
    <section className="panel" aria-label="Estate search">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Explore</p>
          <h2>Estate search</h2>
          <p className="muted">
            Search by estate or district name, then open an estate for its
            latest transaction and 12-month context.
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Estate, district, or estate ID"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>District</span>
          <select
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
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
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No estates match that search.</p>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              setQuery("");
              setDistrict("");
            }}
          >
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
