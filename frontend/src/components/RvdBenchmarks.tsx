import { useEffect, useMemo, useState } from "react";
import type { Manifest, RvdBenchmarks as RvdData } from "../types";
import { loadRvdBenchmarks } from "../lib/dashboard";
import {
  buildRvdSeries,
  RVD_MEASURES,
  RVD_REGIONS,
  rvdClassesForMeasure,
  rvdHkdM2ToFt2,
  type RvdMeasure,
} from "../lib/rvd";
import { buildMultiLineGeometry } from "../lib/trends";
import {
  formatCompactHkd,
  formatMonth,
  formatNumber,
} from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";
import { LineChart } from "./LineChart";

interface Props {
  manifest: Manifest;
}

function formatRvdValue(
  unit: "index" | "hkd_m2" | "percent",
  value: number,
): string {
  if (unit === "index") return value.toFixed(0);
  if (unit === "percent") return `${value.toFixed(2)}%`;
  return `${formatCompactHkd(value)}/m²`;
}

function unitLabel(unit: "index" | "hkd_m2" | "percent"): string {
  if (unit === "index") return "index · 1999 = 100";
  if (unit === "percent") return "% return";
  return "HKD/m²";
}

export function RvdBenchmarks({ manifest }: Props) {
  const [data, setData] = useState<RvdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [measure, setMeasure] = useState<RvdMeasure>("price_index");
  const [propertyClass, setPropertyClass] = useState("ALL");
  const [regionCode, setRegionCode] = useState("hk");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadRvdBenchmarks(manifest)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load RVD benchmarks.",
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
    const classes = rvdClassesForMeasure(measure);
    if (!classes.includes(propertyClass)) {
      setPropertyClass(classes[0]);
    }
  }, [measure, propertyClass]);

  const result = useMemo(
    () => buildRvdSeries(data, { measure, propertyClass, regionCode }),
    [data, measure, propertyClass, regionCode],
  );
  const geometry = useMemo(
    () =>
      buildMultiLineGeometry([
        { id: "rvd", label: result.title, points: result.points },
      ]),
    [result],
  );
  const latest = result.points[result.points.length - 1] ?? null;
  const classes = rvdClassesForMeasure(measure);
  const showRegion = measure === "rent" || measure === "price";
  const provisionalRange =
    result.provisionalMonths.length > 0
      ? `${formatMonth(result.provisionalMonths[0])} – ${formatMonth(
          result.provisionalMonths[result.provisionalMonths.length - 1],
        )}`
      : null;

  return (
    <section className="trend-rvd" aria-label="Official RVD benchmarks">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RVD benchmarks · Aggregate</p>
          <h3>Official market benchmarks</h3>
          <p className="muted">
            Private domestic statistics from the Rating and Valuation
            Department. Not estate-level data.
          </p>
        </div>
        <p className="result-count">RVD</p>
      </div>

      <details className="rvd-about">
        <summary>How to read this</summary>
        <p>
          RVD publishes region and property-class aggregates, not individual
          estates. Classes A–E are based on saleable area, while HKP data uses
          net area and estate transactions, so these figures are benchmarks —
          not estate valuations.
        </p>
        <p>
          Rents and prices are in HKD/m². Divide by 10.7639 for HKD/ft².
          Provisional months are marked. Suppressed values appear as gaps, not
          zero.
        </p>
        <p>
          Source:{" "}
          <a
            href="https://www.rvd.gov.hk/en/publications/property_market_statistics.html"
            target="_blank"
            rel="noreferrer"
          >
            RVD Property Market Statistics
          </a>
          . Table-level caveats are in the Catalogue tab under “RVD
          benchmarks”.
        </p>
      </details>

      <div className="controls rvd-controls">
        <label className="field">
          <span>Measure</span>
          <select
            value={measure}
            onChange={(event) =>
              setMeasure(event.target.value as RvdMeasure)
            }
          >
            {RVD_MEASURES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Class</span>
          <select
            value={propertyClass}
            onChange={(event) => setPropertyClass(event.target.value)}
          >
            {classes.map((value) => (
              <option key={value} value={value}>
                {value === "ALL"
                  ? "All classes"
                  : value === "ABC" || value === "DE"
                    ? `Classes ${value}`
                    : `Class ${value}`}
              </option>
            ))}
          </select>
        </label>
        {showRegion ? (
          <label className="field">
            <span>Region</span>
            <select
              value={regionCode}
              onChange={(event) => setRegionCode(event.target.value)}
            >
              {RVD_REGIONS.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {loading ? (
        <InlineLoading label="Loading RVD benchmarks…" />
      ) : error ? (
        <InlineError
          title="RVD benchmarks are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : !latest || !geometry ? (
        <EmptyNotice title="No RVD data for this selection">
          <p>
            The snapshot has no RVD rows for this measure, class, and region.
          </p>
        </EmptyNotice>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <p className="stat-label">Latest</p>
              <p className="stat-value stat-value-small">
                {formatRvdValue(result.unit, latest.value)}
              </p>
              <p className="stat-note">
                {formatMonth(latest.month)} · {unitLabel(result.unit)}
              </p>
            </div>
            {result.unit === "hkd_m2" ? (
              <div className="stat-tile">
                <p className="stat-label">Per square foot</p>
                <p className="stat-value stat-value-small">
                  {formatCompactHkd(rvdHkdM2ToFt2(latest.value))}
                </p>
                <p className="stat-note">HKD/ft² conversion</p>
              </div>
            ) : null}
            <div className="stat-tile">
              <p className="stat-label">Observations</p>
              <p className="stat-value">
                {formatNumber(result.points.length)}
              </p>
              <p className="stat-note">
                {formatMonth(result.points[0]?.month ?? null)} –{" "}
                {formatMonth(latest.month)}
              </p>
            </div>
            {provisionalRange ? (
              <div className="stat-tile stat-tile-warn">
                <p className="stat-label">Provisional</p>
                <p className="stat-value stat-value-small">
                  {result.provisionalMonths.length} months
                </p>
                <p className="stat-note">{provisionalRange}</p>
              </div>
            ) : null}
          </div>

          <LineChart
            geometry={geometry}
            formatValue={(value) => formatRvdValue(result.unit, value)}
            ariaLabel={result.title}
            showDots={false}
            caption={`${result.title}. RVD aggregate benchmark; ${
              result.unit === "hkd_m2"
                ? "values in HKD/m² (divide by 10.7639 for HKD/ft²)"
                : result.unit === "percent"
                  ? "percentage returns"
                  : "index, 1999 = 100"
            }.`}
          />
        </>
      )}
    </section>
  );
}
