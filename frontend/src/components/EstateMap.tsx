import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { EstateSummary } from "../types";
import { listDistricts } from "../lib/estates";
import {
  boundsFor,
  DEFAULT_ZOOM,
  HK_CENTER,
  mapPrice,
  mapPriceSource,
  NO_PRICE_BUCKET,
  PRICE_BUCKETS,
  priceBucket,
  selectMapEstates,
  TILE_ATTRIBUTION,
  TILE_URL,
} from "../lib/map";
import { formatCompactHkd, formatNumber } from "../lib/format";
import { EmptyNotice } from "./Status";

interface Props {
  estates: EstateSummary[];
  onSelect: (estate: EstateSummary) => void;
}

function tooltipElement(estate: EstateSummary): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "map-tooltip";

  const title = document.createElement("strong");
  title.textContent = estate.estate_name_en;
  wrapper.append(title);

  const price = document.createElement("span");
  const source = mapPriceSource(estate);
  const priceLabel =
    source === "average"
      ? "12-month avg net ft price"
      : source === "latest"
        ? "latest net ft price"
        : "no price data";
  price.textContent =
    source === "none"
      ? priceLabel
      : `${formatCompactHkd(mapPrice(estate))} ${priceLabel}`;
  wrapper.append(price);

  const district = document.createElement("span");
  district.textContent = estate.district_name_en;
  wrapper.append(district);

  return wrapper;
}

export function EstateMap({ estates, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  const [districtId, setDistrictId] = useState("");

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const districts = useMemo(() => listDistricts(estates), [estates]);
  const selection = useMemo(
    () => selectMapEstates(estates, districtId),
    [estates, districtId],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: HK_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: true,
      worldCopyJump: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      minZoom: 9,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    for (const estate of selection.visible) {
      if (estate.latitude === null || estate.longitude === null) continue;
      const bucket = priceBucket(mapPrice(estate));
      const marker = L.circleMarker([estate.latitude, estate.longitude], {
        radius: 5,
        weight: 1,
        color: "#ffffff",
        fillColor: bucket.color,
        fillOpacity: 0.92,
      });

      marker.bindTooltip(tooltipElement(estate), {
        direction: "top",
        offset: [0, -6],
        opacity: 1,
      });
      marker.on("click", () => onSelectRef.current(estate));
      marker.addTo(layer);
    }

    const bounds = boundsFor(selection.visible);
    if (bounds) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    } else {
      map.setView(HK_CENTER, DEFAULT_ZOOM);
    }
  }, [selection]);

  const fitToData = () => {
    const map = mapRef.current;
    const bounds = boundsFor(selection.visible);
    if (!map) return;
    if (bounds) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    } else {
      map.setView(HK_CENTER, DEFAULT_ZOOM);
    }
  };

  return (
    <section className="panel" aria-label="Estate map">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Map</p>
          <h2>Estate map</h2>
          <p className="muted">
            Estates plotted at their coordinates. Colour shows the 12-month
            average net-ft price (latest transaction as a fallback); select a
            marker to open the estate detail panel.
          </p>
        </div>
        <p className="result-count">
          {formatNumber(selection.visible.length)} mapped
        </p>
      </div>

      <div className="controls">
        <label className="field">
          <span>District</span>
          <select
            value={districtId}
            onChange={(event) => setDistrictId(event.target.value)}
          >
            <option value="">All districts</option>
            {districts.map((district) => (
              <option key={district.id} value={district.id}>
                {district.nameEn}
                {district.nameZh ? ` · ${district.nameZh}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button" onClick={fitToData}>
          Fit to data
        </button>
      </div>

      <div className="map-shell">
        {selection.visible.length === 0 ? (
          <div className="map-empty-overlay">
            <EmptyNotice title="No estates with coordinates in this district">
              <p>
                Coordinates are missing for{" "}
                {formatNumber(selection.missingCoordinates)} matching estates,
                so they cannot be plotted. The map is kept mounted so it works
                again when you pick another district.
              </p>
            </EmptyNotice>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="map-canvas"
          role="region"
          aria-label="Map of Hong Kong estates"
        />
        <div className="map-legend" aria-label="Net ft price legend">
          <p className="map-legend-title">
            12-month avg net ft price (latest fallback)
          </p>
          {[...PRICE_BUCKETS, NO_PRICE_BUCKET].map((bucket) => (
            <span key={bucket.id} className="map-legend-item">
              <span
                className="map-legend-swatch"
                style={{ background: bucket.color }}
                aria-hidden="true"
              />
              {bucket.label}
            </span>
          ))}
        </div>
      </div>

      {selection.missingCoordinates > 0 && selection.visible.length > 0 ? (
        <p className="muted">
          {formatNumber(selection.missingCoordinates)} matching estates have no
          coordinates and are not shown.
        </p>
      ) : null}
    </section>
  );
}
