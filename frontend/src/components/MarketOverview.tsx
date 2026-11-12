import { useEffect, useMemo, useState } from "react";
import type { DistrictMonthly, EstateSummary, Manifest } from "../types";
import { loadDistrictMonthly } from "../lib/dashboard";
import {
  buildDistrictLeague,
  buildMarketPulse,
  buildOverviewKpis,
  buildScatterGeometry,
  buildYieldPoints,
  DEFAULT_SCATTER_OPTIONS,
} from "../lib/overview";
import { buildMultiLineGeometry } from "../lib/trends";
import {
  formatCompactHkd,
  formatMonth,
  formatNumber,
  formatPercent,
  formatShare,
} from "../lib/format";
import { EmptyNotice, InlineError, InlineLoading } from "./Status";
import { LineChart } from "./LineChart";

interface Props {
  manifest: Manifest;
  estates: EstateSummary[];
  onOpenTrends: (districtId: string) => void;
}

function formatYield(value: number | null): string {
  return value === null || Number.isNaN(value)
    ? "—"
    : `${value.toFixed(2)}%`;
}

export function MarketOverview({
  manifest,
  estates,
  onOpenTrends,
}: Props) {
  const [rows, setRows] = useState<DistrictMonthly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadDistrictMonthly(manifest)
      .then((data) => {
        if (!cancelled) setRows(data);
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

  const kpis = useMemo(() => buildOverviewKpis(estates), [estates]);
  const pulse = useMemo(
    () => (rows ? buildMarketPulse(rows) : null),
    [rows],
  );
  const pulseGeometry = useMemo(
    () =>
      pulse
        ? buildMultiLineGeometry([
            {
              id: "sale",
              label: "Sale price",
              points: pulse.saleSeries,
            },
            {
              id: "rent",
              label: "Rent",
              points: pulse.rentSeries,
            },
          ])
        : null,
    [pulse],
  );
  const league = useMemo(
    () => (rows ? buildDistrictLeague(rows) : []),
    [rows],
  );
  const yieldPoints = useMemo(() => buildYieldPoints(league), [league]);
  const scatter = useMemo(
    () => buildScatterGeometry(yieldPoints, DEFAULT_SCATTER_OPTIONS),
    [yieldPoints],
  );

  return (
    <section className="overview-page" aria-label="Market overview">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h2>Hong Kong housing at a glance</h2>
          <p className="muted">
            Estate-level medians, the sale-versus-rent pulse, and the latest
            district picture from the current snapshot. No new statistics are
            computed on the server.
          </p>
        </div>
        <p className="result-count">
          {kpis.asOfMonth ? formatMonth(kpis.asOfMonth) : "No recent sales"}
        </p>
      </div>

      <section className="overview" aria-label="Market indicators">
        <article className="card">
          <p className="card-label">Median sale price</p>
          <p className="card-value">
            {formatCompactHkd(kpis.medianPrice)}
          </p>
          <p className="card-note">
            HKD/ft² over 12 months · {formatNumber(kpis.estatesWithSales)}{" "}
            estates
          </p>
        </article>
        <article className="card">
          <p className="card-label">Median rent</p>
          <p className="card-value">{formatCompactHkd(kpis.medianRent)}</p>
          <p className="card-note">
            HKD/ft² over 12 months · {formatNumber(kpis.estatesWithRent)}{" "}
            estates
          </p>
        </article>
        <article className="card">
          <p className="card-label">Gross yield proxy</p>
          <p className="card-value">{formatYield(kpis.medianYield)}</p>
          <p className="card-note">Annual rent ÷ price, median estate</p>
        </article>
        <article className="card">
          <p className="card-label">Sale transactions</p>
          <p className="card-value">
            {formatNumber(kpis.transactions12m)}
          </p>
          <p className="card-note">Trailing 12 months</p>
        </article>
        <article className="card">
          <p className="card-label">Rent transactions</p>
          <p className="card-value">
            {formatNumber(kpis.rentTransactions12m)}
          </p>
          <p className="card-note">Trailing 12 months</p>
        </article>
      </section>

      <div className="overview-layout">
        <section className="panel overview-pulse">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Market pulse</p>
              <h3>Sale prices and rents</h3>
            </div>
            {pulse?.baseMonth ? (
              <p className="result-count">
                Base {formatMonth(pulse.baseMonth)}
              </p>
            ) : null}
          </div>
          {loading ? (
            <InlineLoading label="Loading the market pulse…" />
          ) : error ? (
            <InlineError
              title="The market pulse is unavailable"
              message={error}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          ) : pulseGeometry ? (
            <LineChart
              geometry={pulseGeometry}
              formatValue={(value) => value.toFixed(0)}
              ariaLabel="Hong Kong sale price and rent indexed to 100"
              caption="District averages weighted by transaction count and indexed to 100 at the first month where sale and rent overlap. Rent history covers roughly the last three years."
            />
          ) : (
            <EmptyNotice title="No overlapping sale and rent history">
              <p>
                The snapshot needs at least one month with both sale and rent
                values to build this chart.
              </p>
            </EmptyNotice>
          )}
        </section>

        <section className="panel overview-coverage">
          <p className="eyebrow">Coverage</p>
          <h3>What the snapshot contains</h3>
          <dl className="coverage-list">
            <div>
              <dt>Estates</dt>
              <dd>{formatNumber(manifest.coverage.estates)}</dd>
            </div>
            <div>
              <dt>With transactions</dt>
              <dd>
                {formatNumber(manifest.coverage.with_transactions)}
                <span className="muted">
                  {" "}
                  ·{" "}
                  {formatShare(
                    manifest.coverage.with_transactions,
                    manifest.coverage.estates,
                  )}
                </span>
              </dd>
            </div>
            <div>
              <dt>With market data</dt>
              <dd>
                {formatNumber(manifest.coverage.with_market)}
                <span className="muted">
                  {" "}
                  ·{" "}
                  {formatShare(
                    manifest.coverage.with_market,
                    manifest.coverage.estates,
                  )}
                </span>
              </dd>
            </div>
            <div>
              <dt>With wiki text</dt>
              <dd>
                {formatNumber(manifest.coverage.with_wiki)}
                <span className="muted">
                  {" "}
                  ·{" "}
                  {formatShare(
                    manifest.coverage.with_wiki,
                    manifest.coverage.estates,
                  )}
                </span>
              </dd>
            </div>
          </dl>
          <p className="muted coverage-note">
            Sales through {formatMonth(manifest.data_through.transactions)} ·
            market data through {formatMonth(manifest.data_through.market)} ·
            build <code>{manifest.build_id}</code>
          </p>
        </section>
      </div>

      <div className="overview-layout overview-layout-even">
        <section className="panel overview-league">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Districts</p>
              <h3>Latest district prices</h3>
            </div>
            <p className="result-count">{league.length} districts</p>
          </div>
          {loading ? (
            <InlineLoading label="Loading district rankings…" />
          ) : error ? (
            <InlineError
              title="District rankings are unavailable"
              message={error}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          ) : league.length === 0 ? (
            <EmptyNotice title="No district sale data">
              <p>This snapshot has no positive district sale prices yet.</p>
            </EmptyNotice>
          ) : (
            <div className="table-wrap overview-league-table">
              <table className="estate-table">
                <thead>
                  <tr>
                    <th scope="col">District</th>
                    <th scope="col" className="numeric">
                      Price
                    </th>
                    <th scope="col" className="numeric">
                      12m
                    </th>
                    <th scope="col" className="numeric">
                      Yield
                    </th>
                    <th scope="col" className="numeric">
                      Tx
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {league.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenTrends(entry.id)}
                        >
                          {entry.nameEn}
                        </button>
                        {entry.nameZh ? (
                          <span className="estate-name-zh">
                            {entry.nameZh}
                          </span>
                        ) : null}
                      </td>
                      <td className="numeric">
                        {formatCompactHkd(entry.price)}
                      </td>
                      <td
                        className={`numeric ${
                          entry.changePct === null
                            ? ""
                            : entry.changePct >= 0
                              ? "stat-up"
                              : "stat-down"
                        }`}
                      >
                        {formatPercent(entry.changePct)}
                      </td>
                      <td className="numeric">
                        {formatYield(entry.yieldPct)}
                      </td>
                      <td className="numeric">
                        {formatNumber(entry.txCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel overview-yield">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Yield</p>
              <h3>Price versus gross yield</h3>
            </div>
          </div>
          {loading ? (
            <InlineLoading label="Loading the yield comparison…" />
          ) : error ? (
            <InlineError
              title="The yield comparison is unavailable"
              message={error}
              onRetry={() => setReloadToken((value) => value + 1)}
            />
          ) : scatter ? (
            <figure className="chart-figure">
              <svg
                className="scatter-chart"
                viewBox={`0 0 ${DEFAULT_SCATTER_OPTIONS.width} ${DEFAULT_SCATTER_OPTIONS.height}`}
                role="img"
                aria-label="Latest district sale price versus gross rental yield"
              >
                {scatter.yTicks.map((tick) => (
                  <g key={tick.value}>
                    <line
                      x1={DEFAULT_SCATTER_OPTIONS.paddingLeft}
                      x2={
                        DEFAULT_SCATTER_OPTIONS.width -
                        DEFAULT_SCATTER_OPTIONS.paddingRight
                      }
                      y1={tick.position}
                      y2={tick.position}
                      className="chart-grid"
                    />
                    <text
                      x={DEFAULT_SCATTER_OPTIONS.paddingLeft - 10}
                      y={tick.position + 4}
                      textAnchor="end"
                      className="chart-axis-label"
                    >
                      {tick.value.toFixed(1)}%
                    </text>
                  </g>
                ))}
                {scatter.xTicks.map((tick) => (
                  <text
                    key={tick.value}
                    x={tick.position}
                    y={
                      DEFAULT_SCATTER_OPTIONS.height -
                      DEFAULT_SCATTER_OPTIONS.paddingBottom +
                      18
                    }
                    textAnchor="middle"
                    className="chart-axis-label"
                  >
                    {formatCompactHkd(tick.value)}
                  </text>
                ))}
                {scatter.points.map((item) => (
                  <circle
                    key={item.point.id}
                    cx={item.x}
                    cy={item.y}
                    r={4 + Math.min(9, Math.sqrt(item.point.txCount) * 1.3)}
                    className="scatter-dot"
                  >
                    <title>
                      {item.point.nameEn}: {formatCompactHkd(item.point.price)}{" "}
                      · {formatYield(item.point.yieldPct)} yield ·{" "}
                      {formatNumber(item.point.txCount)} transactions
                    </title>
                  </circle>
                ))}
                <text
                  x={
                    DEFAULT_SCATTER_OPTIONS.width -
                    DEFAULT_SCATTER_OPTIONS.paddingRight
                  }
                  y={DEFAULT_SCATTER_OPTIONS.height - 6}
                  textAnchor="end"
                  className="chart-axis-title"
                >
                  Latest price (HKD/ft²)
                </text>
                <text
                  x={DEFAULT_SCATTER_OPTIONS.paddingLeft}
                  y={12}
                  className="chart-axis-title"
                >
                  Yield (%)
                </text>
              </svg>
              <figcaption className="muted">
                Latest district sale price against gross yield, with bubble
                size showing the latest month's sale transactions. Yield is a
                proxy: annualised average rent ÷ average sale price.
              </figcaption>
            </figure>
          ) : (
            <EmptyNotice title="Not enough overlapping price and rent data">
              <p>
                At least one district needs a positive sale price and rent in
                the snapshot.
              </p>
            </EmptyNotice>
          )}
        </section>
      </div>
    </section>
  );
}
