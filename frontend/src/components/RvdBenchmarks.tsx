import { useEffect, useMemo, useState } from "react";
import type { Manifest, RvdBenchmarks as RvdData } from "../types";
import { loadRvdBenchmarks } from "../lib/dashboard";
import {
  buildRvdClassSeries,
  RVD_CLASSES,
  RVD_CLASS_DEFINITIONS,
  RVD_MEASURES,
  RVD_REGIONS,
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

function unitLabel(
  unit: "index" | "hkd_m2" | "percent",
  measure: RvdMeasure,
): string {
  if (unit === "index") return "index · 1999 = 100";
  if (unit === "percent") return "% return";
  return measure === "rent" ? "HKD/m² per month" : "HKD/m²";
}

function measureUnit(
  measure: RvdMeasure,
): "index" | "hkd_m2" | "percent" {
  if (measure === "price_index" || measure === "rent_index") return "index";
  if (measure === "yield") return "percent";
  return "hkd_m2";
}

export function RvdBenchmarks({ manifest }: Props) {
  const [data, setData] = useState<RvdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [measure, setMeasure] = useState<RvdMeasure>("price_index");
  const [regionCode, setRegionCode] = useState("hk");
  const [selectedClasses, setSelectedClasses] =
    useState<string[]>(RVD_CLASSES);

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

  const classSeries = useMemo(
    () =>
      buildRvdClassSeries(
        data,
        measure,
        regionCode,
        selectedClasses,
      ),
    [data, measure, regionCode, selectedClasses],
  );
  const unit = classSeries[0]?.unit ?? measureUnit(measure);
  const geometry = useMemo(
    () =>
      buildMultiLineGeometry(
        classSeries.map((series) => ({
          id: series.propertyClass,
          label: series.label,
          points: series.points,
        })),
      ),
    [classSeries],
  );
  const provisionalMonths = useMemo(
    () =>
      [...new Set(classSeries.flatMap((series) => series.provisionalMonths))]
        .sort(),
    [classSeries],
  );
  const firstMonth =
    classSeries
      .map((series) => series.points[0]?.month)
      .filter((month): month is string => Boolean(month))
      .sort()[0] ?? null;
  const lastMonth =
    classSeries
      .map((series) => series.points[series.points.length - 1]?.month)
      .filter((month): month is string => Boolean(month))
      .sort()
      .pop() ?? null;
  const provisionalRange =
    provisionalMonths.length > 0
      ? `${formatMonth(provisionalMonths[0])} – ${formatMonth(
          provisionalMonths[provisionalMonths.length - 1],
        )}`
      : null;
  const showRegion = measure === "rent" || measure === "price";

  const toggleClass = (propertyClass: string) => {
    setSelectedClasses((current) => {
      if (current.includes(propertyClass)) {
        return current.length === 1
          ? current
          : current.filter((item) => item !== propertyClass);
      }
      return RVD_CLASSES.filter(
        (item) => current.includes(item) || item === propertyClass,
      );
    });
  };

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
          estates. Classes A–E are based on <strong>saleable area</strong>,
          while HKP data uses net area and estate transactions, so these
          figures are benchmarks — not estate valuations.
        </p>
        <dl className="rvd-class-definitions">
          {RVD_CLASS_DEFINITIONS.map((item) => (
            <div key={item.id}>
              <dt>Class {item.id}</dt>
              <dd>{item.label}</dd>
            </div>
          ))}
        </dl>
        <p>
          Rents and prices are in HKD/m². Divide by 10.7639 for HKD/ft².
          Provisional months are marked. Suppressed values are omitted, not
          zero; the line connects the available months.
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
            onChange={(event) => setMeasure(event.target.value as RvdMeasure)}
          >
            {RVD_MEASURES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
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

      <fieldset className="rvd-classes">
        <legend>Classes</legend>
        {RVD_CLASSES.map((propertyClass) => (
          <label
            key={propertyClass}
            className={`rvd-class-chip ${
              selectedClasses.includes(propertyClass)
                ? "rvd-class-chip-active"
                : ""
            }`}
          >
            <input
              type="checkbox"
              checked={selectedClasses.includes(propertyClass)}
              onChange={() => toggleClass(propertyClass)}
            />
            Class {propertyClass}
          </label>
        ))}
      </fieldset>

      {loading ? (
        <InlineLoading label="Loading RVD benchmarks…" />
      ) : error ? (
        <InlineError
          title="RVD benchmarks are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : classSeries.length === 0 || !geometry ? (
        <EmptyNotice title="No RVD data for this selection">
          <p>
            The snapshot has no RVD rows for this measure, class, and region.
          </p>
        </EmptyNotice>
      ) : (
        <>
          <div className="rvd-latest-grid">
            {classSeries.map((series) => {
              const latest = series.points[series.points.length - 1];
              return (
                <div key={series.propertyClass} className="rvd-latest-item">
                  <strong>{series.label}</strong>
                  <span className="rvd-latest-value">
                    {formatRvdValue(series.unit, latest.value)}
                  </span>
                  <span className="muted">
                    {formatMonth(latest.month)}
                  </span>
                  {series.unit === "hkd_m2" ? (
                    <span className="muted">
                      {formatCompactHkd(rvdHkdM2ToFt2(latest.value))}
                      {measure === "rent" ? "/ft²/mo" : "/ft²"}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rvd-meta">
            <span>{unitLabel(unit, measure)}</span>
            <span>
              {formatMonth(firstMonth)} – {formatMonth(lastMonth)}
            </span>
            <span>{formatNumber(classSeries.length)} classes</span>
            {provisionalRange ? (
              <span className="rvd-provisional">
                Provisional: {provisionalRange}
              </span>
            ) : null}
          </div>

          <LineChart
            geometry={geometry}
            formatValue={(value) => formatRvdValue(unit, value)}
            ariaLabel={`RVD ${measure} by property class`}
            showDots={false}
            caption={`RVD aggregate benchmark by saleable-area class; ${
              unit === "hkd_m2"
                ? `values in HKD/m²${measure === "rent" ? " per month" : ""} (divide by 10.7639 for HKD/ft²)`
                : unit === "percent"
                  ? "percentage returns"
                  : "index, 1999 = 100"
            }.`}
          />
        </>
      )}
    </section>
  );
}
