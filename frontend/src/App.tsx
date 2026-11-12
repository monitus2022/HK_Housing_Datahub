import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardData, EstateSummary } from "./types";
import { loadDashboard } from "./lib/dashboard";
import { formatDate } from "./lib/format";
import { EstateSearch } from "./components/EstateSearch";
import { EstateDetail } from "./components/EstateDetail";
import { DistrictTrends } from "./components/DistrictTrends";
import { EstateMap } from "./components/EstateMap";
import { RecentTransactions } from "./components/RecentTransactions";
import { DataCatalogView } from "./components/DataCatalog";
import { MarketOverview } from "./components/MarketOverview";
import { estateIdFromSearch, withEstateParam } from "./lib/urlState";
import {
  DEFAULT_SEARCH_STATE,
  searchStateToSearch,
} from "./lib/searchState";
import { EMPTY_ESTATE_FILTERS } from "./lib/filters";

type View =
  | "overview"
  | "search"
  | "trends"
  | "map"
  | "transactions"
  | "catalogue";

const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "search", label: "Estates" },
  { id: "trends", label: "Trends" },
  { id: "map", label: "Map" },
  { id: "transactions", label: "Transactions" },
  { id: "catalogue", label: "Catalogue" },
];

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<EstateSummary | null>(null);
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [trendFocus, setTrendFocus] = useState({
    districtId: "",
    nonce: 0,
  });
  const [mapFocus, setMapFocus] = useState<{
    estateId: string;
    nonce: number;
  } | null>(null);
  const initialEstateId = useRef<string | null>(
    estateIdFromSearch(window.location.search),
  );
  const closeDetail = useCallback(() => setSelected(null), []);
  const openTrends = useCallback((districtId: string) => {
    setTrendFocus((current) => ({
      districtId,
      nonce: current.nonce + 1,
    }));
    setView("trends");
  }, []);

  const showOnMap = useCallback((estate: EstateSummary) => {
    setMapFocus((current) => ({
      estateId: estate.estate_id,
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setSelected(null);
    setView("map");
  }, []);

  const openEstatesForDistrict = useCallback((districtId: string) => {
    const next = searchStateToSearch(
      {
        ...DEFAULT_SEARCH_STATE,
        filters: { ...EMPTY_ESTATE_FILTERS, districtId },
      },
      "",
    );
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${next}`,
    );
    setSelected(null);
    setView("search");
  }, []);

  useEffect(() => {
    const estateId = initialEstateId.current;
    if (!data || !estateId) return;
    initialEstateId.current = null;
    const match = data.estates.find((estate) => estate.estate_id === estateId);
    if (match) {
      setView("search");
      setSelected(match);
    } else {
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${withEstateParam(
          window.location.search,
          null,
        )}`,
      );
    }
  }, [data]);

  useEffect(() => {
    // Do not strip an initial deep link before the snapshot has loaded.
    if (initialEstateId.current !== null) return;
    const current = estateIdFromSearch(window.location.search);
    const next = selected?.estate_id ?? null;
    if (next === current) return;
    const search = withEstateParam(window.location.search, next);
    const url = `${window.location.pathname}${search}`;
    if (next) {
      window.history.pushState({}, "", url);
    } else {
      window.history.replaceState({}, "", url);
    }
  }, [selected]);

  useEffect(() => {
    const handlePop = () => {
      const estateId = estateIdFromSearch(window.location.search);
      if (!estateId) {
        setSelected(null);
        return;
      }
      setSelected(
        data?.estates.find((estate) => estate.estate_id === estateId) ?? null,
      );
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadDashboard()
      .then((dashboard) => {
        if (!cancelled) setData(dashboard);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the dashboard snapshot.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Hong Kong housing data</p>
          <h1>HK Housing Datahub</h1>
          <p className="hero-lede">
            A static view of Hong Kong housing data. Start with the market
            overview, then search estates, compare trends, explore the map, and
            browse recent transactions.
          </p>
          {data ? (
            <p className="hero-meta">
              Snapshot {data.manifest.build_id} · generated{" "}
              {formatDate(data.manifest.generated_at.slice(0, 10))} · data
              through {formatDate(data.manifest.data_through.transactions)}
            </p>
          ) : null}
        </div>
      </header>

      <main className="content">
        {loading ? (
          <div className="status-card" role="status">
            <div className="spinner" aria-hidden="true" />
            <p>Loading the latest snapshot…</p>
          </div>
        ) : null}

        {error ? (
          <div className="status-card status-error" role="alert">
            <h2>Could not load the snapshot</h2>
            <p>{error}</p>
            <p className="muted">
              Set <code>VITE_DASHBOARD_BASE_URL</code> to the public host and
              make sure the bucket allows CORS and public reads.
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : null}

        {data && !error ? (
          <>
            <div
              className="view-tabs"
              role="tablist"
              aria-label="Dashboard views"
              onKeyDown={(event) => {
                const currentIndex = VIEWS.findIndex(
                  (item) => item.id === view,
                );
                let nextIndex: number | null = null;
                if (event.key === "ArrowRight") {
                  nextIndex = (currentIndex + 1) % VIEWS.length;
                } else if (event.key === "ArrowLeft") {
                  nextIndex =
                    (currentIndex - 1 + VIEWS.length) % VIEWS.length;
                } else if (event.key === "Home") {
                  nextIndex = 0;
                } else if (event.key === "End") {
                  nextIndex = VIEWS.length - 1;
                }
                if (nextIndex === null) return;
                event.preventDefault();
                const next = VIEWS[nextIndex];
                setView(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}
            >
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-selected={view === item.id}
                  aria-controls="view-panel"
                  tabIndex={view === item.id ? 0 : -1}
                  className={`view-tab ${view === item.id ? "view-tab-active" : ""}`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id="view-panel"
              aria-labelledby={`tab-${view}`}
            >
              {view === "overview" ? (
                <MarketOverview
                  manifest={data.manifest}
                  estates={data.estates}
                  onOpenTrends={openTrends}
                />
              ) : null}
              {view === "search" ? (
                <EstateSearch
                  estates={data.estates}
                  onSelect={setSelected}
                />
              ) : null}
              {view === "trends" ? (
                <DistrictTrends
                  manifest={data.manifest}
                  focusDistrict={trendFocus}
                />
              ) : null}
              {view === "map" ? (
                <EstateMap
                  estates={data.estates}
                  onSelect={setSelected}
                  focusEstate={mapFocus}
                  onOpenEstates={openEstatesForDistrict}
                />
              ) : null}
              {view === "transactions" ? (
                <RecentTransactions
                  manifest={data.manifest}
                  estates={data.estates}
                  onSelectEstate={setSelected}
                />
              ) : null}
              {view === "catalogue" ? (
                <DataCatalogView manifest={data.manifest} />
              ) : null}
            </div>
          </>
        ) : null}
      </main>

      <footer className="footer">
        <p>
          Data from Hong Kong Property and Wikipedia. For educational,
          non-commercial use. Not an official or authoritative source.
        </p>
        {data ? (
          <p>
            Build {data.manifest.build_id} · sources:{" "}
            {data.manifest.source.join(", ")}
          </p>
        ) : null}
      </footer>

      {selected && data ? (
        <EstateDetail
          manifest={data.manifest}
          estate={selected}
          onClose={closeDetail}
          onShowOnMap={showOnMap}
        />
      ) : null}
    </div>
  );
}
