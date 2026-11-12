import { useEffect, useRef } from "react";
import type { EstateSummary, Manifest } from "../types";
import { formatDate, formatHkd, formatNumber } from "../lib/format";
import { EstateHistory } from "./EstateHistory";
import { wikiUrl } from "../lib/wiki";
import { hasCoordinates } from "../lib/map";

interface Props {
  manifest: Manifest;
  estate: EstateSummary;
  onClose: () => void;
  onShowOnMap?: (estate: EstateSummary) => void;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="detail-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function EstateDetail({
  manifest,
  estate,
  onClose,
  onShowOnMap,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const wikiHref = wikiUrl(estate.wiki_title);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estate-detail-title"
      >
        <button
          ref={closeRef}
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close estate details"
        >
          Close
        </button>

        <p className="eyebrow">Estate</p>
        <h2 id="estate-detail-title">{estate.estate_name_en}</h2>
        <p className="drawer-subtitle">{estate.estate_name_zh}</p>
        <p className="muted">
          {estate.district_name_en}
          {estate.region_name_en ? ` · ${estate.region_name_en}` : ""}
        </p>

        <div className="flags flags-large">
          <span
            className={`flag ${estate.has_transactions ? "flag-on" : "flag-off"}`}
          >
            Transactions
          </span>
          <span
            className={`flag ${estate.has_market ? "flag-on" : "flag-off"}`}
          >
            Market
          </span>
          {wikiHref ? (
            <a
              className={`flag flag-link ${
                estate.has_wiki ? "flag-on" : "flag-off"
              }`}
              href={wikiHref}
              target="_blank"
              rel="noreferrer"
            >
              Wiki
            </a>
          ) : (
            <span
              className={`flag ${estate.has_wiki ? "flag-on" : "flag-off"}`}
            >
              Wiki
            </span>
          )}
        </div>

        {hasCoordinates(estate) && onShowOnMap ? (
          <button
            type="button"
            className="button drawer-map-action"
            onClick={() => onShowOnMap(estate)}
          >
            Show on map
          </button>
        ) : null}

        <dl className="detail-grid">
          <Stat
            label="Latest transaction"
            value={formatDate(estate.latest_tx_date)}
          />
          <Stat label="Latest price" value={formatHkd(estate.latest_tx_price)} />
          <Stat
            label="Latest net ft price"
            value={formatHkd(estate.latest_tx_net_ft_price)}
          />
          <Stat
            label="12-month transactions"
            value={formatNumber(estate.tx_count_12m)}
          />
          <Stat
            label="12-month avg net ft price"
            value={formatHkd(estate.avg_net_ft_price_12m)}
          />
          <Stat
            label="12-month avg net ft rent"
            value={formatHkd(estate.avg_net_ft_rent_12m)}
          />
          <Stat
            label="12-month rentals"
            value={formatNumber(estate.rent_count_12m ?? null)}
          />
          <Stat
            label="Latest net ft rent"
            value={formatHkd(estate.latest_rent_net_ft_price ?? null)}
          />
          <Stat
            label="Latest rent date"
            value={formatDate(estate.latest_rent_date ?? null)}
          />
          <Stat
            label="Latest market month"
            value={formatDate(estate.latest_market_date)}
          />
          <Stat
            label="First occupation"
            value={formatDate(estate.first_op_date)}
          />
          <Stat
            label="Coordinates"
            value={
              estate.latitude !== null && estate.longitude !== null
                ? `${estate.latitude.toFixed(4)}, ${estate.longitude.toFixed(4)}`
                : "—"
            }
          />
          <Stat label="Estate ID" value={estate.estate_id} />
        </dl>

        <EstateHistory manifest={manifest} estate={estate} />

        <p className="drawer-note">
          Snapshot values. This is not a valuation or investment advice.
        </p>
      </aside>
    </div>
  );
}
