import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DistrictMonthly,
  EstateSummary,
  Manifest,
  RecentTransaction,
} from "../types";
import {
  loadDistrictMonthly,
  loadRecentTransactions,
} from "../lib/dashboard";
import {
  buildDistrictLeague,
  buildMarketPulse,
  buildOverviewKpis,
  buildScatterGeometry,
  buildTopEstatesByValue,
  buildYieldPoints,
  DEFAULT_SCATTER_OPTIONS,
  defaultSaleType,
  filterDistrictRows,
  hasSaleTypeData,
  saleTypeCoverage,
  type SaleTypeFilter,
} from "../lib/overview";
import {
  buildMultiLineGeometry,
  listTrendDistricts,
} from "../lib/trends";
import {
  formatCompactHkd,
  formatDate,
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
  onSelectEstate?: (estate: EstateSummary) => void;
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
  onSelectEstate,
}: Props) {
  const [rows, setRows] = useState<DistrictMonthly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [transactions, setTransactions] = useState<
    RecentTransaction[] | null
  >(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [txReloadToken, setTxReloadToken] = useState(0);
  const [txRequested, setTxRequested] = useState(false);
  const [saleType, setSaleType] = useState<SaleTypeFilter>("all");
  const [pulseDistrictId, setPulseDistrictId] = useState("");
  const topEstatesRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (loading) return;
    const check = () => {
      const node = topEstatesRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.top <= window.innerHeight + 120 && rect.bottom >= -120) {
        setTxRequested(true);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [loading]);

  useEffect(() => {
    if (!txRequested) return;
    let cancelled = false;
    setTxLoading(true);
    setTxError(null);

    loadRecentTransactions(manifest)
      .then((data) => {
        if (!cancelled) setTransactions(data);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setTxError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load recent transactions.",
        );
      })
      .finally(() => {
        if (!cancelled) setTxLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [manifest, txReloadToken, txRequested]);

  const kpis = useMemo(() => buildOverviewKpis(estates), [estates]);
  const districts = useMemo(
    () => (rows ? listTrendDistricts(rows) : []),
    [rows],
  );

  useEffect(() => {
    if (
      pulseDistrictId &&
      districts.length > 0 &&
      !districts.some((district) => district.id === pulseDistrictId)
    ) {
      setPulseDistrictId("");
    }
  }, [districts, pulseDistrictId]);
  const pulseDistrictName = useMemo(
    () =>
      districts.find((district) => district.id === pulseDistrictId)?.nameEn ??
      "",
    [districts, pulseDistrictId],
  );
  const pulse = useMemo(() => {
    if (!rows) return null;
    return buildMarketPulse(filterDistrictRows(rows, pulseDistrictId));
  }, [rows, pulseDistrictId]);
  const coverage = useMemo(
    () => (transactions ? saleTypeCoverage(transactions) : 0),
    [transactions],
  );
  const hasSaleTypes = useMemo(
    () => (transactions ? hasSaleTypeData(transactions) : false),
    [transactions],
  );
  useEffect(() => {
    if (transactions) setSaleType(defaultSaleType(coverage));
  }, [transactions, coverage]);
  const effectiveSaleType: SaleTypeFilter = hasSaleTypes ? saleType : "all";
  const coveragePct = Math.round(coverage * 1000) / 10;
  const topEstates = useMemo(
    () =>
      transactions
        ? buildTopEstatesByValue(
            transactions,
            10,
            12,
            manifest.data_through.transactions,
            effectiveSaleType,
          )
        : null,
    [transactions, manifest.data_through.transactions, effectiveSaleType],
  );
  const topEstatesLabel =
    effectiveSaleType === "second"
      ? "resale value"
      : effectiveSaleType === "first"
        ? "first-hand value"
        : "transacted value";
  const maxTopValue = useMemo(
    () =>
      Math.max(
        1,
        ...(topEstates?.entries.map((entry) => entry.totalValue) ?? []),
      ),
    [topEstates],
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
            Estate-level medians, the sale-versus-rent pulse, top transacted
            estates, and the latest district picture from the current snapshot.
            No new statistics are computed on the server.
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
            HKD/ft² per month over 12 months ·{" "}
            {formatNumber(kpis.estatesWithRent)} estates
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

      {error && !loading ? (
        <InlineError
          title="Market charts are unavailable"
          message={error}
          onRetry={() => setReloadToken((value) => value + 1)}
        />
      ) : null}

      <div className="overview-layout">
        <section className="panel overview-pulse">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Market pulse</p>
              <h3>Sale prices and rents</h3>
            </div>
            {pulse?.baseMonth ? (
              <p className="result-count">
                Common from {formatMonth(pulse.baseMonth)}
              </p>
            ) : null}
          </div>
          <div className="pulse-toolbar">
            <label className="field">
              <span>Area</span>
              <select
                value={pulseDistrictId}
                onChange={(event) =>
                  setPulseDistrictId(event.target.value)
                }
              >
                <option value="">All Hong Kong</option>
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.nameEn}
                    {district.nameZh ? ` · ${district.nameZh}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <InlineLoading label="Loading the market pulse…" />
          ) : error ? null : pulseGeometry ? (
            <LineChart
              geometry={pulseGeometry}
              formatValue={(value) => value.toFixed(0)}
              ariaLabel={`${pulseDistrictName || "Hong Kong"} sale price and rent indexed to 100`}
              caption={
                pulseDistrictId
                  ? `Monthly averages for ${pulseDistrictName}, indexed to 100. Both lines start at the first month where sale and rent overlap; rent history covers roughly the last three years.`
                  : "District averages weighted by transaction count and indexed to 100. Both lines start at the first month where sale and rent overlap; rent history covers roughly the last three years."
              }
            />
          ) : (
            <EmptyNotice
              title={
                pulseDistrictId
                  ? `No overlapping sale and rent history for ${pulseDistrictName}`
                  : "No overlapping sale and rent history"
              }
            >
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
            Sales through{" "}
            {formatMonth(manifest.data_through.transactions?.slice(0, 7) ?? null)} ·
            market data through{" "}
            {formatMonth(manifest.data_through.market?.slice(0, 7) ?? null)} ·
            build <code>{manifest.build_id}</code>
          </p>
        </section>
      </div>

      <section ref={topEstatesRef} className="panel overview-top-estates">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Value</p>
            <h3>Top estates by {topEstatesLabel}</h3>
          </div>
          <p className="result-count">
            {txRequested
              ? `${formatNumber(topEstates?.entries.length ?? 0)} estates`
              : "—"}
          </p>
        </div>
        {hasSaleTypes ? (
          <div className="top-estates-controls">
            <label className="field">
              <span>Sale type</span>
              <select
                value={saleType}
                onChange={(event) =>
                  setSaleType(event.target.value as SaleTypeFilter)
                }
              >
                <option value="second">2nd hand (resale)</option>
                <option value="first">1st hand</option>
                <option value="all">All sale types</option>
              </select>
            </label>
          </div>
        ) : null}
        {!txRequested ? (
          <p className="muted">
            Top estates load when this section enters view.
          </p>
        ) : txLoading ? (
          <InlineLoading label="Loading top estates…" />
        ) : txError ? (
          <InlineError
            title="Top estates are unavailable"
            message={txError}
            onRetry={() => setTxReloadToken((value) => value + 1)}
          />
        ) : !topEstates || topEstates.entries.length === 0 ? (
          <EmptyNotice
            title={`No positive ${topEstatesLabel} in the last 12 months`}
          >
            <p>
              Try another sale type or check that the snapshot includes
              positive transaction prices.
            </p>
          </EmptyNotice>
        ) : (
          <>
            <p className="muted top-estates-window">
              Trailing 12 months: {formatDate(topEstates.start)} –{" "}
              {formatDate(topEstates.end)}. Sum of positive{" "}
              {topEstatesLabel} per estate.
              {!hasSaleTypes
                ? " This snapshot does not include sale types; showing all sales."
                : coverage < 1
                  ? ` Sale types cover ${coveragePct}% of recent transactions; unclassified rows are excluded.`
                  : ""}
            </p>
            <ol className="top-estate-list" role="list">
              {topEstates.entries.map((entry, index) => {
                const estate = estates.find(
                  (item) => item.estate_id === entry.id,
                );
                return (
                  <li key={entry.id} className="top-estate-row">
                    <span className="top-estate-rank" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="top-estate-main">
                      <div className="top-estate-label">
                        {estate && onSelectEstate ? (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onSelectEstate(estate)}
                          >
                            {entry.name}
                          </button>
                        ) : (
                          <strong>{entry.name}</strong>
                        )}
                        <span className="muted" title={entry.district}>
                          {entry.district}
                        </span>
                      </div>
                      <div className="top-estate-track" aria-hidden="true">
                        <span
                          className="top-estate-bar"
                          style={{
                            width: `${Math.max(
                              2,
                              (entry.totalValue / maxTopValue) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="top-estate-value">
                      <strong>{formatCompactHkd(entry.totalValue)}</strong>
                      <span>
                        {formatNumber(entry.txCount)} tx
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <div className="overview-stack">
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
          ) : error ? null : league.length === 0 ? (
            <EmptyNotice title="No district sale data">
              <p>This snapshot has no positive district sale prices yet.</p>
            </EmptyNotice>
          ) : (
            <>
              <div className="table-wrap overview-league-table">
                <table className="estate-table">
                  <thead>
                    <tr>
                      <th scope="col">District</th>
                      <th scope="col" className="numeric">
                        Price
                      </th>
                      <th
                        scope="col"
                        className="numeric"
                        title="Nearest earlier month at least 12 months before each district's latest sale month"
                      >
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
                          title={
                            entry.changeBasisMonth
                              ? `Versus ${formatMonth(entry.changeBasisMonth)}`
                              : "No earlier comparison month"
                          }
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
              <p className="muted table-note">
                Latest available sale month per district; 12m compares with
                the nearest earlier month at least a year before it.
              </p>
            </>
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
          ) : error ? null : scatter ? (
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
