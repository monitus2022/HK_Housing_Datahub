import { useEffect, useMemo, useState } from "react";
import type { DistrictPriceBand, Manifest } from "../types";
import { loadDistrictPriceBands } from "../lib/dashboard";
import {
  buildBandGeometry,
  buildBandSeries,
  type BandMetric,
} from "../lib/bands";
import { DEFAULT_CHART_OPTIONS, type TrendWindow } from "../lib/trends";
import { formatCompactHkd, formatMonth, formatNumber } from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";

interface Props {
  manifest: Manifest;
  districtId: string;
  districtName: string;
  window: TrendWindow;
}

export function PriceBandsChart({
  manifest,
  districtId,
  districtName,
  window,
}: Props) {
  const [rows, setRows] = useState<DistrictPriceBand[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [metric, setMetric] = useState<BandMetric>("sale");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadDistrictPriceBands(manifest)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load district price distribution.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, reloadToken]);

  const series = useMemo(
    () => (rows ? buildBandSeries(rows, districtId, metric, window) : []),
    [rows, districtId, metric, window],
  );
  const geometry = useMemo(
    () => buildBandGeometry(series, DEFAULT_CHART_OPTIONS),
    [series],
  );
  const latest = series[series.length - 1] ?? null;

  return (
    <section className="trend-distribution" aria-label="Price distribution">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Distribution</p>
          <h3>Price spread in {districtName || "the selected district"}</h3>
        </div>
        <label className="field">
          <span>Metric</span>
          <select
            value={metric}
            onChange={(event) =>
              setMetric(event.target.value as BandMetric)
            }
          >
            <option value="sale">Sale</option>
            <option value="rent">Rent</option>
          </select>
        </label>
      </div>

      {loading ? (
        <InlineLoading label="Loading price distribution…" />
      ) : error ? (
        <InlineError
          title="Price distribution is unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : latest === null ? (
        <EmptyNotice title="No price distribution for this selection">
          <p>
            This district has no positive {metric} prices in the selected
            window. Try a wider window, another district, or the other metric.
          </p>
        </EmptyNotice>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <p className="stat-label">25th percentile</p>
              <p className="stat-value stat-value-small">
                {formatCompactHkd(latest.p25)}
              </p>
              <p className="stat-note">HKD/ft² · {formatMonth(latest.month)}</p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">Median</p>
              <p className="stat-value stat-value-small">
                {formatCompactHkd(latest.median)}
              </p>
              <p className="stat-note">
                {formatNumber(latest.count)} {metric} transactions
              </p>
            </div>
            <div className="stat-tile">
              <p className="stat-label">75th percentile</p>
              <p className="stat-value stat-value-small">
                {formatCompactHkd(latest.p75)}
              </p>
              <p className="stat-note">HKD/ft² · {formatMonth(latest.month)}</p>
            </div>
          </div>

          {geometry ? (
            <figure className="chart-figure">
              <svg
                className="trend-chart"
                viewBox={`0 0 ${DEFAULT_CHART_OPTIONS.width} ${DEFAULT_CHART_OPTIONS.height}`}
                role="img"
                aria-label={`${metric} price p25, median, and p75 for ${districtName}`}
              >
                <defs>
                  <linearGradient
                    id="price-band-fill"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--accent)"
                      stopOpacity="0.26"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--accent)"
                      stopOpacity="0.08"
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
                      {formatCompactHkd(tick.value)}
                    </text>
                  </g>
                ))}

                <path d={geometry.bandPath} fill="url(#price-band-fill)" />
                <path d={geometry.medianPath} className="chart-line" />
                {geometry.points.map((item) => (
                  <circle
                    key={item.point.month}
                    cx={item.x}
                    cy={item.yMedian}
                    r={2.4}
                    className="chart-dot"
                  >
                    <title>
                      {formatMonth(item.point.month)}: p25{" "}
                      {formatCompactHkd(item.point.p25)}, median{" "}
                      {formatCompactHkd(item.point.median)}, p75{" "}
                      {formatCompactHkd(item.point.p75)}
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
              <div className="chart-legend">
                <span>
                  <i
                    className="chart-legend-swatch"
                    style={{ background: "var(--accent)" }}
                    aria-hidden="true"
                  />
                  Median
                </span>
                <span>
                  <i
                    className="chart-legend-swatch chart-legend-band"
                    aria-hidden="true"
                  />
                  25th–75th percentile
                </span>
              </div>
              <figcaption className="muted">
                Monthly p25, median, and p75 of positive {metric} net-ft
                prices in {districtName}. The band shows how wide the middle
                half of transactions was.
              </figcaption>
            </figure>
          ) : null}
        </>
      )}
    </section>
  );
}
