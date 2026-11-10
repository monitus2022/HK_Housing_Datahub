import { useEffect, useMemo, useState } from "react";
import type { DistrictMonthly, Manifest } from "../types";
import { loadDistrictMonthly } from "../lib/dashboard";
import {
  buildChartGeometry,
  buildTrendSeries,
  DEFAULT_CHART_OPTIONS,
  listTrendDistricts,
  METRIC_LABELS,
  METRIC_UNITS,
  summarizeTrend,
  WINDOWS,
  type TrendMetric,
  type TrendWindow,
} from "../lib/trends";
import {
  formatCompactHkd,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";

interface Props {
  manifest: Manifest;
}

function formatValue(metric: TrendMetric, value: number): string {
  return metric === "volume"
    ? formatNumber(Math.round(value))
    : formatCompactHkd(value);
}

function summaryValue(metric: TrendMetric, value: number | null): string {
  if (value === null) return "—";
  return metric === "volume"
    ? formatNumber(Math.round(value))
    : formatCompactHkd(value);
}

export function DistrictTrends({ manifest }: Props) {
  const [rows, setRows] = useState<DistrictMonthly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [districtId, setDistrictId] = useState("");
  const [metric, setMetric] = useState<TrendMetric>("sale");
  const [window, setWindow] = useState<TrendWindow>("60");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadDistrictMonthly(manifest)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setDistrictId((current) => current || data[0]?.district_id || "");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load district monthly data.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, reloadToken]);

  const districts = useMemo(() => (rows ? listTrendDistricts(rows) : []), [rows]);
  const series = useMemo(
    () => (rows ? buildTrendSeries(rows, districtId, metric, window) : []),
    [rows, districtId, metric, window],
  );
  const summary = useMemo(() => summarizeTrend(series), [series]);
  const geometry = useMemo(
    () => buildChartGeometry(series, DEFAULT_CHART_OPTIONS),
    [series],
  );

  const metricAvailable = series.length > 0;
  const metricName = METRIC_LABELS[metric].toLowerCase();

  return (
    <section className="panel" aria-label="District price trends">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Trends</p>
          <h2>District price trends</h2>
          <p className="muted">
            Monthly average net-ft price and transaction volume by district.
            Windows end at the latest month with data for the selected metric.
            Price metrics skip months without transactions, and the chart
            leaves a gap for them.
          </p>
        </div>
        {summary.latest ? (
          <p className="result-count">
            {formatMonth(summary.latest.month)}
          </p>
        ) : null}
      </div>

      {loading ? <InlineLoading label="Loading district trends…" /> : null}

      {error && !loading ? (
        <InlineError
          title="District trends are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : null}

      {rows && !loading && !error && rows.length === 0 ? (
        <EmptyNotice title="This snapshot has no district monthly data">
          <p>
            The snapshot does not include any district monthly rows, so trends
            cannot be charted. Rebuild the snapshot from the analytics marts.
          </p>
        </EmptyNotice>
      ) : null}

      {rows && rows.length > 0 && !loading && !error ? (
        <>
          <div className="controls">
            <label className="field field-grow">
              <span>District</span>
              <select
                value={districtId}
                onChange={(event) => setDistrictId(event.target.value)}
              >
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.nameEn}
                    {district.nameZh ? ` · ${district.nameZh}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Metric</span>
              <select
                value={metric}
                onChange={(event) =>
                  setMetric(event.target.value as TrendMetric)
                }
              >
                {(Object.keys(METRIC_LABELS) as TrendMetric[]).map((key) => (
                  <option key={key} value={key}>
                    {METRIC_LABELS[key]}
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

          {!metricAvailable ? (
            <EmptyNotice title={`No ${metricName} data for this district`}>
              {metric === "rent" ? (
                <p>
                  The current snapshot has no positive rent values in this
                  district and window. Rent averages in the source data are
                  zero, so the rent metric stays empty until the source is
                  fixed.
                </p>
              ) : (
                <p>
                  The current snapshot has no positive {metricName} values in
                  this district and window. Try a wider window or another
                  district.
                </p>
              )}
            </EmptyNotice>
          ) : (
            <>
              <div className="stat-row">
                <div className="stat-tile">
                  <p className="stat-label">Latest</p>
                  <p className="stat-value">
                    {summaryValue(metric, summary.latest?.value ?? null)}
                  </p>
                  <p className="stat-note">
                    {formatMonth(summary.latest?.month ?? null)} ·{" "}
                    {METRIC_UNITS[metric]}
                  </p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">
                    {summary.changeIsAnnual ? "12-month change" : "Change"}
                  </p>
                  <p
                    className={`stat-value ${
                      summary.changePct === null
                        ? ""
                        : summary.changePct >= 0
                          ? "stat-up"
                          : "stat-down"
                    }`}
                  >
                    {formatPercent(summary.changePct)}
                  </p>
                  <p className="stat-note">
                    {summary.changeBasisMonth === null
                      ? "No earlier comparison month"
                      : summary.changeIsAnnual
                        ? `Versus ${formatMonth(summary.changeBasisMonth)}`
                        : `Versus ${formatMonth(
                            summary.changeBasisMonth,
                          )}, the nearest earlier month`}
                  </p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">Range</p>
                  <p className="stat-value stat-value-small">
                    {summaryValue(metric, summary.min)} –{" "}
                    {summaryValue(metric, summary.max)}
                  </p>
                  <p className="stat-note">Lowest and highest in the window</p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">Months</p>
                  <p className="stat-value">{formatNumber(summary.months)}</p>
                  <p className="stat-note">
                    {metric === "volume"
                      ? "Months with district data"
                      : `Latest transactions: ${formatNumber(
                          summary.latest?.txCount ?? null,
                        )}`}
                  </p>
                </div>
              </div>

              {geometry ? (
                <figure className="chart-figure">
                  <svg
                    className="trend-chart"
                    viewBox={`0 0 ${DEFAULT_CHART_OPTIONS.width} ${DEFAULT_CHART_OPTIONS.height}`}
                    role="img"
                    aria-label={`${METRIC_LABELS[metric]} for the selected district, ${summary.months} months`}
                  >
                    <defs>
                      <linearGradient
                        id="trend-fill"
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
                          x1={DEFAULT_CHART_OPTIONS.paddingLeft}
                          x2={
                            DEFAULT_CHART_OPTIONS.width -
                            DEFAULT_CHART_OPTIONS.paddingRight
                          }
                          y1={tick.y}
                          y2={tick.y}
                          className="chart-grid"
                        />
                        <text
                          x={DEFAULT_CHART_OPTIONS.paddingLeft - 10}
                          y={tick.y + 4}
                          textAnchor="end"
                          className="chart-axis-label"
                        >
                          {formatValue(metric, tick.value)}
                        </text>
                      </g>
                    ))}

                    <path d={geometry.areaPath} fill="url(#trend-fill)" />
                    <path d={geometry.linePath} className="chart-line" />

                    {geometry.points.map((item) => (
                      <circle
                        key={item.point.month}
                        cx={item.x}
                        cy={item.y}
                        r={2.4}
                        className="chart-dot"
                      >
                        <title>
                          {formatMonth(item.point.month)}:{" "}
                          {formatValue(metric, item.point.value)}{" "}
                          {METRIC_UNITS[metric]}
                        </title>
                      </circle>
                    ))}

                    <text
                      x={DEFAULT_CHART_OPTIONS.paddingLeft}
                      y={DEFAULT_CHART_OPTIONS.height - 10}
                      className="chart-axis-label"
                    >
                      {formatMonth(series[0]?.month ?? null)}
                    </text>
                    <text
                      x={
                        DEFAULT_CHART_OPTIONS.width -
                        DEFAULT_CHART_OPTIONS.paddingRight
                      }
                      y={DEFAULT_CHART_OPTIONS.height - 10}
                      textAnchor="end"
                      className="chart-axis-label"
                    >
                      {formatMonth(series[series.length - 1]?.month ?? null)}
                    </text>
                  </svg>
                  <figcaption className="muted">
                    {metric === "volume"
                      ? "Transactions per month in the selected district and window."
                      : `${METRIC_LABELS[metric]} in ${METRIC_UNITS[metric]}, averaged from transactions in each month.`}
                  </figcaption>
                </figure>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
