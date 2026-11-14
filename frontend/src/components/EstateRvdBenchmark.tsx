import { useEffect, useState } from "react";
import type {
  EstateSummary,
  Manifest,
  RvdBenchmarks as RvdData,
} from "../types";
import { loadRvdBenchmarks } from "../lib/dashboard";
import { buildEstateRvdBenchmark } from "../lib/rvd";
import { formatCompactHkd, formatMonth } from "../lib/format";

interface Props {
  manifest: Manifest;
  estate: EstateSummary;
}

type LoadState = "loading" | "ready" | "error";

function BenchmarkStat({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="detail-stat">
      <dt>{label}</dt>
      <dd>
        {primary}
        {secondary ? (
          <span className="detail-rvd-secondary">{secondary}</span>
        ) : null}
      </dd>
    </div>
  );
}

export function EstateRvdBenchmark({ manifest, estate }: Props) {
  const [data, setData] = useState<RvdData | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    loadRvdBenchmarks(manifest)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setState("ready");
      })
      .catch(() => {
        // The benchmark is optional context; never break the drawer for it.
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [manifest]);

  if (state === "error") return null;

  const benchmark =
    state === "ready"
      ? buildEstateRvdBenchmark(
          data,
          estate.region_name_en,
          estate.latest_net_area,
        )
      : null;
  const hasArea =
    estate.latest_net_area !== null && estate.latest_net_area > 0;
  const isProvisional = Boolean(
    benchmark?.rent?.isProvisional ||
      benchmark?.price?.isProvisional ||
      benchmark?.yieldPct?.isProvisional,
  );

  return (
    <section className="detail-rvd" aria-label="RVD regional benchmark">
      <div className="detail-rvd-heading">
        <h3>RVD regional benchmark</h3>
        {benchmark ? (
          <span className="rvd-class-pill">
            Class {benchmark.propertyClass}
          </span>
        ) : null}
      </div>

      {state === "loading" ? (
        <p className="muted">Loading benchmark…</p>
      ) : !benchmark ? (
        <p className="muted">
          {hasArea
            ? "No RVD benchmark is available for this region and class."
            : "No recorded net area, so an RVD class benchmark cannot be selected."}
        </p>
      ) : (
        <>
          <p className="muted detail-rvd-subtitle">
            {benchmark.regionLabel} · Class {benchmark.propertyClass} ·{" "}
            {benchmark.classDefinition} · {formatMonth(benchmark.asOfMonth)}
          </p>
          <dl className="detail-grid detail-rvd-grid">
            {benchmark.rent ? (
              <BenchmarkStat
                label="RVD avg rent"
                primary={`${formatCompactHkd(benchmark.rent.hkdFt2)}/ft²/mo`}
                secondary={`${formatCompactHkd(benchmark.rent.hkdM2)}/m²`}
              />
            ) : null}
            {benchmark.price ? (
              <BenchmarkStat
                label="RVD avg price"
                primary={`${formatCompactHkd(benchmark.price.hkdFt2)}/ft²`}
                secondary={`${formatCompactHkd(benchmark.price.hkdM2)}/m²`}
              />
            ) : null}
            {benchmark.yieldPct ? (
              <BenchmarkStat
                label="RVD yield (territory)"
                primary={`${benchmark.yieldPct.value.toFixed(2)}%`}
              />
            ) : null}
          </dl>
          {isProvisional ? (
            <p className="rvd-provisional">Provisional RVD month</p>
          ) : null}
          <p className="drawer-note">
            Official RVD average for private domestic units in this region and
            saleable-area class. The class is inferred from this estate's HKP
            net area, which is not the same measure as RVD saleable area. Use it
            as market context, not as this estate's rent or valuation.
          </p>
        </>
      )}
    </section>
  );
}
