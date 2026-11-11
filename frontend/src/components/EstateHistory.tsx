import { useEffect, useMemo, useState } from "react";
import type {
  EstateMonthlyHistory,
  EstateSummary,
  Manifest,
  RecentTransaction,
} from "../types";
import { loadEstateMonthly, loadRecentTransactions } from "../lib/dashboard";
import {
  ESTATE_METRIC_LABELS,
  ESTATE_METRIC_UNITS,
  estateHistorySeries,
  type EstateHistoryMetric,
} from "../lib/estateHistory";
import {
  buildChartGeometry,
  DEFAULT_CHART_OPTIONS,
  summarizeTrend,
  WINDOWS,
  type TrendWindow,
} from "../lib/trends";
import {
  formatCompactHkd,
  formatDate,
  formatHkd,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../lib/format";
import { InlineError, InlineLoading } from "./Status";

interface Props {
  manifest: Manifest;
  estate: EstateSummary;
}

const CHART_OPTIONS = {
  ...DEFAULT_CHART_OPTIONS,
  width: 720,
  height: 240,
  paddingLeft: 58,
  paddingRight: 14,
  paddingTop: 14,
  paddingBottom: 28,
};

function formatValue(metric: EstateHistoryMetric, value: number): string {
  return metric === "volume"
    ? formatNumber(Math.round(value))
    : formatCompactHkd(value);
}

export function EstateHistory({ manifest, estate }: Props) {
  const [history, setHistory] = useState<EstateMonthlyHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [transactions, setTransactions] = useState<RecentTransaction[] | null>(
    null,
  );
  const [transactionsError, setTransactionsError] = useState<string | null>(
    null,
  );
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [metric, setMetric] = useState<EstateHistoryMetric>("sale");
  const [window, setWindow] = useState<TrendWindow>("60");

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    loadEstateMonthly(manifest)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setHistoryError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load estate history.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  useEffect(() => {
    let cancelled = false;
    setTransactionsLoading(true);
    setTransactionsError(null);
    loadRecentTransactions(manifest)
      .then((data) => {
        if (!cancelled) setTransactions(data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setTransactionsError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load recent transactions.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTransactionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  const series = useMemo(
    () =>
      history
        ? estateHistorySeries(history, estate.estate_id, metric, window)
        : [],
    [history, estate.estate_id, metric, window],
  );
  const summary = useMemo(() => summarizeTrend(series), [series]);
  const geometry = useMemo(
    () => buildChartGeometry(series, CHART_OPTIONS),
    [series],
  );
  const estateTransactions = useMemo(() => {
    if (!transactions) return [];
    return transactions
      .filter((row) => row.estate_id === estate.estate_id)
      .sort((left, right) => right.tx_date.localeCompare(left.tx_date));
  }, [transactions, estate.estate_id]);

  return (
    <div className="detail-history">
      <section aria-label="Estate price history">
        <div className="detail-section-heading">
          <h3>Price history</h3>
          <div className="detail-history-controls">
            <label className="field">
              <span>Metric</span>
              <select
                value={metric}
                onChange={(event) =>
                  setMetric(event.target.value as EstateHistoryMetric)
                }
              >
                {(
                  Object.keys(ESTATE_METRIC_LABELS) as EstateHistoryMetric[]
                ).map((key) => (
                  <option key={key} value={key}>
                    {ESTATE_METRIC_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Window</span>
              <select
                value={window}
                onChange={(event) =>
                  setWindow(event.target.value as TrendWindow)
                }
              >
                {WINDOWS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {metric === "rent" ? (
          <p className="muted detail-empty">
            Rent history comes from HKP lease transactions and covers roughly
            the last three years.
          </p>
        ) : null}

        {historyLoading ? <InlineLoading label="Loading price history…" /> : null}
        {historyError && !historyLoading ? (
          <InlineError
            title="Price history is unavailable"
            message={historyError}
          />
        ) : null}

        {history && !historyLoading && !historyError ? (
          series.length === 0 ? (
            <p className="muted detail-empty">
              No {ESTATE_METRIC_LABELS[metric].toLowerCase()} data for this
              estate in the selected window.
            </p>
          ) : (
            <>
              <div className="detail-history-stats">
                <span>
                  Latest{" "}
                  <strong>
                    {formatValue(
                      metric,
                      summary.latest?.value ?? 0,
                    )}
                  </strong>{" "}
                  · {formatMonth(summary.latest?.month ?? null)}
                </span>
                <span>
                  Change{" "}
                  <strong
                    className={
                      summary.changePct === null
                        ? ""
                        : summary.changePct >= 0
                          ? "stat-up"
                          : "stat-down"
                    }
                  >
                    {formatPercent(summary.changePct)}
                  </strong>
                  {summary.changeBasisMonth
                    ? ` vs ${formatMonth(summary.changeBasisMonth)}`
                    : ""}
                </span>
                <span>{formatNumber(summary.months)} months</span>
              </div>

              {geometry ? (
                <svg
                  className="detail-chart"
                  viewBox={`0 0 ${CHART_OPTIONS.width} ${CHART_OPTIONS.height}`}
                  role="img"
                  aria-label={`${ESTATE_METRIC_LABELS[metric]} for ${estate.estate_name_en}`}
                >
                  <defs>
                    <linearGradient
                      id="estate-trend-fill"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--accent)"
                        stopOpacity="0.28"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--accent)"
                        stopOpacity="0.02"
                      />
                    </linearGradient>
                  </defs>
                  {geometry.yTicks.map((tick) => (
                    <g key={tick.value}>
                      <line
                        x1={CHART_OPTIONS.paddingLeft}
                        x2={CHART_OPTIONS.width - CHART_OPTIONS.paddingRight}
                        y1={tick.y}
                        y2={tick.y}
                        className="chart-grid"
                      />
                      <text
                        x={CHART_OPTIONS.paddingLeft - 8}
                        y={tick.y + 4}
                        textAnchor="end"
                        className="chart-axis-label"
                      >
                        {formatValue(metric, tick.value)}
                      </text>
                    </g>
                  ))}
                  <path
                    d={geometry.areaPath}
                    fill="url(#estate-trend-fill)"
                  />
                  <path d={geometry.linePath} className="chart-line" />
                  {geometry.points.map((item) => (
                    <circle
                      key={item.point.month}
                      cx={item.x}
                      cy={item.y}
                      r={2.2}
                      className="chart-dot"
                    >
                      <title>
                        {formatMonth(item.point.month)}:{" "}
                        {formatValue(metric, item.point.value)}{" "}
                        {ESTATE_METRIC_UNITS[metric]}
                      </title>
                    </circle>
                  ))}
                  <text
                    x={CHART_OPTIONS.paddingLeft}
                    y={CHART_OPTIONS.height - 8}
                    className="chart-axis-label"
                  >
                    {formatMonth(series[0]?.month ?? null)}
                  </text>
                  <text
                    x={CHART_OPTIONS.width - CHART_OPTIONS.paddingRight}
                    y={CHART_OPTIONS.height - 8}
                    textAnchor="end"
                    className="chart-axis-label"
                  >
                    {formatMonth(series[series.length - 1]?.month ?? null)}
                  </text>
                </svg>
              ) : null}
            </>
          )
        ) : null}
      </section>

      <section aria-label="Estate recent transactions">
        <div className="detail-section-heading">
          <h3>Recent transactions</h3>
          {estateTransactions.length > 0 ? (
            <span className="muted">
              Latest {Math.min(8, estateTransactions.length)} of{" "}
              {formatNumber(estateTransactions.length)}
            </span>
          ) : null}
        </div>

        {transactionsLoading ? (
          <InlineLoading label="Loading transactions…" />
        ) : null}
        {transactionsError && !transactionsLoading ? (
          <InlineError
            title="Transactions are unavailable"
            message={transactionsError}
          />
        ) : null}

        {transactions && !transactionsLoading && !transactionsError ? (
          estateTransactions.length === 0 ? (
            <p className="muted detail-empty">
              No transactions in the last 24 months for this estate.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="estate-table detail-tx-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="numeric">
                      Price
                    </th>
                    <th scope="col" className="numeric">
                      Net ft price
                    </th>
                    <th scope="col" className="numeric">
                      Net area
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estateTransactions.slice(0, 8).map((row, index) => (
                    <tr key={`${row.tx_date}-${index}`}>
                      <td>{formatDate(row.tx_date)}</td>
                      <td className="numeric">{formatHkd(row.price)}</td>
                      <td className="numeric">{formatHkd(row.net_ft_price)}</td>
                      <td className="numeric">
                        {row.net_area === null
                          ? "—"
                          : `${formatNumber(row.net_area)} ft²`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
