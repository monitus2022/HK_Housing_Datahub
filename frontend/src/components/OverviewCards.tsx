import type { Manifest } from "../types";
import { formatDate, formatNumber, formatShare } from "../lib/format";

interface Props {
  manifest: Manifest;
}

export function OverviewCards({ manifest }: Props) {
  const { coverage, data_through: dataThrough } = manifest;

  return (
    <section className="overview" aria-label="Dataset overview">
      <article className="card">
        <p className="card-label">Estates</p>
        <p className="card-value">{formatNumber(coverage.estates)}</p>
        <p className="card-note">In the reference snapshot</p>
      </article>
      <article className="card">
        <p className="card-label">With transactions</p>
        <p className="card-value">
          {formatNumber(coverage.with_transactions)}
        </p>
        <p className="card-note">
          {formatShare(coverage.with_transactions, coverage.estates)} of estates
        </p>
      </article>
      <article className="card">
        <p className="card-label">With market data</p>
        <p className="card-value">{formatNumber(coverage.with_market)}</p>
        <p className="card-note">
          {formatShare(coverage.with_market, coverage.estates)} of estates
        </p>
      </article>
      <article className="card">
        <p className="card-label">With wiki data</p>
        <p className="card-value">{formatNumber(coverage.with_wiki)}</p>
        <p className="card-note">
          {formatShare(coverage.with_wiki, coverage.estates)} of estates
        </p>
      </article>
      <article className="card card-wide">
        <p className="card-label">Data through</p>
        <p className="card-value card-value-small">
          {formatDate(dataThrough.transactions)}
        </p>
        <p className="card-note">
          Market data through {formatDate(dataThrough.market)}
        </p>
      </article>
      <article className="card">
        <p className="card-label">Snapshot build</p>
        <p className="card-value card-value-small card-mono">
          {manifest.build_id}
        </p>
        <p className="card-note">
          Generated {formatDate(manifest.generated_at.slice(0, 10))}
        </p>
      </article>
    </section>
  );
}
