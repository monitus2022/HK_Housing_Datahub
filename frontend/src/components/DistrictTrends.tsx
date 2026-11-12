import { useEffect, useMemo, useState } from "react";
import type { DistrictMonthly, Manifest } from "../types";
import { loadDistrictMonthly } from "../lib/dashboard";
import {
  applyTrendView,
  buildChartGeometry,
  buildMultiLineGeometry,
  buildTrendSeries,
  DEFAULT_CHART_OPTIONS,
  listTrendDistricts,
  METRIC_LABELS,
  METRIC_UNITS,
  summarizeTrend,
  VIEW_LABELS,
  WINDOWS,
  type TrendMetric,
  type TrendView,
  type TrendWindow,
} from "../lib/trends";
import {
  formatCompactHkd,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";
import { LineChart } from "./LineChart";

interface Props {
  manifest: Manifest;
  focusDistrict?: { districtId: string; nonce: number };
}

function summaryValue(metric: TrendMetric, value: number | null): string {
  if (value === null) return "—";
  return metric === "volume"
    ? formatNumber(Math.round(value))
    : formatCompactHkd(value);
}

function formatViewValue(
  metric: TrendMetric,
  view: TrendView,
  value: number | null,
): string {
  if (value === null) return "—";
  if (view === "index") return value.toFixed(0);
  if (view === "change") return formatPercent(value);
  return summaryValue(metric, value);
}

function viewUnit(metric: TrendMetric, view: TrendView): string {
  if (view === "index") return "index (base 100)";
  if (view === "change") return "% versus year earlier";
  return METRIC_UNITS[metric];
}

export function DistrictTrends({ manifest, focusDistrict }: Props) {
  const [rows, setRows] = useState<DistrictMonthly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [districtId, setDistrictId] = useState("");
  const [metric, setMetric] = useState<TrendMetric>("sale");
  const [window, setWindow] = useState<TrendWindow>("60");
  const [viewMode, setViewMode] = useState<TrendView>("level");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadDistrictMonthly(manifest)
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setDistrictId(
          (current) =>
            current ||
            focusDistrict?.districtId ||
            data[0]?.district_id ||
            "",
        );
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

  useEffect(() => {
    if (!focusDistrict?.districtId) return;
    setDistrictId(focusDistrict.districtId);
    document.getElementById("trends-heading")?.focus();
  }, [focusDistrict]);

  const districts = useMemo(() => (rows ? listTrendDistricts(rows) : []), [rows]);
  const levelSeries = useMemo(
    () => (rows ? buildTrendSeries(rows, districtId, metric, window) : []),
    [rows, districtId, metric, window],
  );
  const series = useMemo(
    () => applyTrendView(levelSeries, viewMode),
    [levelSeries, viewMode],
  );
  const summary = useMemo(() => summarizeTrend(series), [series]);
  const geometry = useMemo(
    () => buildChartGeometry(series, DEFAULT_CHART_OPTIONS),
    [series],
  );
  const comparison = useMemo(() => {
    if (!rows || compareIds.length === 0) return null;
    const ids = [districtId, ...compareIds].filter(
      (id, index, all) => id && all.indexOf(id) === index,
    );
    const names = new Map(districts.map((district) => [district.id, district.nameEn]));
    const lines = ids
      .map((id) => ({
        id,
        label: names.get(id) ?? id,
        points: applyTrendView(
          buildTrendSeries(rows, id, metric, window),
          viewMode,
        ),
      }))
      .filter((line) => line.points.length > 0);
    return buildMultiLineGeometry(lines, DEFAULT_CHART_OPTIONS);
  }, [rows, districtId, compareIds, districts, metric, window, viewMode]);

  const metricAvailable = levelSeries.length > 0;
  const metricName = METRIC_LABELS[metric].toLowerCase();
  const positiveMonths = series.filter((point) => point.value > 0).length;
  const viewCaption =
    viewMode === "index"
      ? "Each series is indexed to 100 at its first positive month in the window."
      : viewMode === "change"
        ? "Each point is the percentage change versus the nearest month at least 12 months earlier."
        : metric === "volume"
          ? "Transactions per month in the selected district and window."
          : `${METRIC_LABELS[metric]} in ${METRIC_UNITS[metric]}, averaged from transactions in each month.`;

  return (
    <section className="panel" aria-label="District price trends">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Trends</p>
          <h2 id="trends-heading" tabIndex={-1}>
            District price trends
          </h2>
          <p className="muted">
            Monthly average net-ft price and transaction volume by district.
            Windows end at the latest month with data for the selected metric.
            Rent uses HKP lease transactions and covers roughly the last three
            years; price metrics skip months without transactions and the chart
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
              <span>View</span>
              <select
                value={viewMode}
                onChange={(event) =>
                  setViewMode(event.target.value as TrendView)
                }
              >
                {(Object.keys(VIEW_LABELS) as TrendView[]).map((key) => (
                  <option key={key} value={key}>
                    {VIEW_LABELS[key]}
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

          <div className="compare-controls">
            <label className="field field-grow">
              <span>Compare districts</span>
              <select
                value=""
                onChange={(event) => {
                  const id = event.target.value;
                  if (!id) return;
                  setCompareIds((current) =>
                    current.includes(id) || id === districtId
                      ? current
                      : [...current, id].slice(0, 3),
                  );
                }}
              >
                <option value="">Add a district…</option>
                {districts
                  .filter(
                    (district) =>
                      district.id !== districtId &&
                      !compareIds.includes(district.id),
                  )
                  .map((district) => (
                    <option key={district.id} value={district.id}>
                      {district.nameEn}
                    </option>
                  ))}
              </select>
            </label>
            {compareIds.length > 0 ? (
              <div className="compare-chips">
                {compareIds.map((id) => {
                  const district = districts.find((item) => item.id === id);
                  return (
                    <span key={id} className="compare-chip">
                      {district?.nameEn ?? id}
                      <button
                        type="button"
                        aria-label={`Remove ${district?.nameEn ?? id} from the comparison`}
                        onClick={() =>
                          setCompareIds((current) =>
                            current.filter((item) => item !== id),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="muted compare-hint">
                Add up to three districts to compare on one chart.
              </p>
            )}
          </div>

          {!metricAvailable ? (
            <EmptyNotice title={`No ${metricName} data for this district`}>
              {metric === "rent" ? (
                <p>
                  The current snapshot has no positive rent values in this
                  district and window. Rent history comes from HKP lease
                  transactions and covers roughly the last three years.
                </p>
              ) : (
                <p>
                  The current snapshot has no positive {metricName} values in
                  this district and window. Try a wider window or another
                  district.
                </p>
              )}
            </EmptyNotice>
          ) : series.length === 0 ? (
            <EmptyNotice
              title={
                viewMode === "change"
                  ? "Not enough history for a 12-month change"
                  : "No positive values to index"
              }
            >
              <p>
                {viewMode === "change"
                  ? "This district has level data, but not at least two points a year apart in the selected window. Try a wider window."
                  : "This district has level data, but no positive values to use as an index base in the selected window."}
              </p>
            </EmptyNotice>
          ) : (
            <>
              <div className="stat-row">
                <div className="stat-tile">
                  <p className="stat-label">
                    {viewMode === "change" ? "Latest change" : "Latest"}
                  </p>
                  <p
                    className={`stat-value ${
                      viewMode === "change" && summary.latest !== null
                        ? summary.latest.value >= 0
                          ? "stat-up"
                          : "stat-down"
                        : ""
                    }`}
                  >
                    {formatViewValue(
                      metric,
                      viewMode,
                      summary.latest?.value ?? null,
                    )}
                  </p>
                  <p className="stat-note">
                    {formatMonth(summary.latest?.month ?? null)} ·{" "}
                    {viewUnit(metric, viewMode)}
                  </p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">
                    {viewMode === "change"
                      ? "Positive months"
                      : summary.changeIsAnnual
                        ? "12-month change"
                        : "Change"}
                  </p>
                  {viewMode === "change" ? (
                    <p className="stat-value">
                      {formatNumber(positiveMonths)} /{" "}
                      {formatNumber(summary.months)}
                    </p>
                  ) : (
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
                  )}
                  <p className="stat-note">
                    {viewMode === "change"
                      ? "Months with a positive annual change"
                      : summary.changeBasisMonth === null
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
                    {formatViewValue(metric, viewMode, summary.min)} –{" "}
                    {formatViewValue(metric, viewMode, summary.max)}
                  </p>
                  <p className="stat-note">Lowest and highest in the window</p>
                </div>
                <div className="stat-tile">
                  <p className="stat-label">Months</p>
                  <p className="stat-value">{formatNumber(summary.months)}</p>
                  <p className="stat-note">
                    {metric === "volume"
                      ? "Months with district data"
                      : `Latest ${
                          metric === "rent" ? "rent " : ""
                        }transactions: ${formatNumber(
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
                    aria-label={`${METRIC_LABELS[metric]} (${VIEW_LABELS[viewMode]}) for the selected district, ${summary.months} months`}
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
                          {formatViewValue(metric, viewMode, tick.value)}
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
                          {formatViewValue(metric, viewMode, item.point.value)}{" "}
                          {viewUnit(metric, viewMode)}
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
                  <figcaption className="muted">{viewCaption}</figcaption>
                </figure>
              ) : null}

              {comparison && compareIds.length > 0 ? (
                <section className="trend-comparison" aria-label="District comparison">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Comparison</p>
                      <h3>Selected district versus comparison</h3>
                    </div>
                    <p className="result-count">
                      {comparison.series.length} districts
                    </p>
                  </div>
                  <LineChart
                    geometry={comparison}
                    formatValue={(value) =>
                      formatViewValue(metric, viewMode, value)
                    }
                    ariaLabel={`${METRIC_LABELS[metric]} comparison for ${comparison.series.length} districts`}
                    caption={viewCaption}
                  />
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
