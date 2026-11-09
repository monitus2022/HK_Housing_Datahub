import { useEffect, useRef } from "react";
import type { EstateSummary } from "../types";
import { formatDate, formatHkd, formatNumber } from "../lib/format";

interface Props {
  estate: EstateSummary;
  onClose: () => void;
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

export function EstateDetail({ estate, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
          <span className={`flag ${estate.has_wiki ? "flag-on" : "flag-off"}`}>
            Wiki
          </span>
        </div>

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

        <p className="drawer-note">
          Snapshot values. This is not a valuation or investment advice.
        </p>
      </aside>
    </div>
  );
}
