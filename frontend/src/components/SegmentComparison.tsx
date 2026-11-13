import { useEffect, useMemo, useState } from "react";
import type { Manifest, SegmentSummary } from "../types";
import { loadSegmentSummary } from "../lib/dashboard";
import {
  buildSegmentBars,
  type SegmentMetric,
} from "../lib/segments";
import { formatCompactHkd, formatDate, formatNumber } from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";

interface Props {
  manifest: Manifest;
}

const SEGMENT_TYPES = [
  { id: "bedroom", label: "Bedrooms" },
  { id: "area_band", label: "Net area" },
  { id: "age_band", label: "Estate age" },
  { id: "mtr_line", label: "MTR line" },
  { id: "school_net", label: "School net" },
] as const;

const METRICS: { id: SegmentMetric; label: string }[] = [
  { id: "sale", label: "Median sale price" },
  { id: "rent", label: "Median rent" },
  { id: "yield", label: "Gross yield proxy" },
];

function formatSegmentValue(metric: SegmentMetric, value: number): string {
  return metric === "yield"
    ? `${value.toFixed(2)}%`
    : formatCompactHkd(value);
}

export function SegmentComparison({ manifest }: Props) {
  const [rows, setRows] = useState<SegmentSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [segmentType, setSegmentType] = useState<string>("bedroom");
  const [metric, setMetric] = useState<SegmentMetric>("sale");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadSegmentSummary(manifest)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load segment statistics.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, reloadToken]);

  const bars = useMemo(
    () =>
      rows ? buildSegmentBars(rows, segmentType, metric, 12) : [],
    [rows, segmentType, metric],
  );
  const maxValue = useMemo(
    () => Math.max(1, ...bars.map((bar) => bar.metricValue)),
    [bars],
  );
  const windowStart = rows?.[0]?.window_start ?? null;
  const windowEnd = rows?.[0]?.window_end ?? null;
  const segmentLabel =
    SEGMENT_TYPES.find((item) => item.id === segmentType)?.label ??
    segmentType;

  return (
    <section className="trend-segments" aria-label="Segment comparison">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Segments</p>
          <h3>Compare {segmentLabel.toLowerCase()}</h3>
          <p className="muted">
            Trailing 12 months: {formatDate(windowStart)} –{" "}
            {formatDate(windowEnd)}. Medians use positive net-ft prices;
            “Unknown” rows are hidden by default.
          </p>
        </div>
      </div>

      <div className="controls">
        <label className="field">
          <span>Segment</span>
          <select
            value={segmentType}
            onChange={(event) => setSegmentType(event.target.value)}
          >
            {SEGMENT_TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Metric</span>
          <select
            value={metric}
            onChange={(event) =>
              setMetric(event.target.value as SegmentMetric)
            }
          >
            {METRICS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <InlineLoading label="Loading segment statistics…" />
      ) : error ? (
        <InlineError
          title="Segment statistics are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : bars.length === 0 ? (
        <EmptyNotice title="No segment data for this selection">
          <p>
            This snapshot has no positive {metric} values for {segmentLabel}.
          </p>
        </EmptyNotice>
      ) : (
        <ol className="segment-bar-list" role="list">
          {bars.map((bar) => (
            <li key={bar.value} className="segment-bar-row">
              <div className="segment-bar-label">
                <strong>{bar.value}</strong>
                <span>{formatNumber(bar.count)} tx</span>
              </div>
              <div className="segment-bar-track" aria-hidden="true">
                <span
                  className={`segment-bar-fill segment-bar-${metric}`}
                  style={{
                    width: `${(bar.metricValue / maxValue) * 100}%`,
                  }}
                />
              </div>
              <div className="segment-bar-value">
                {formatSegmentValue(metric, bar.metricValue)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
