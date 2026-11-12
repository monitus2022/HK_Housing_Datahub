import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { EstateSummary } from "../types";
import { listDistricts } from "../lib/estates";
import {
  boundsFor,
  CLUSTER_MAX_ZOOM,
  clusterMapEstates,
  DEFAULT_ZOOM,
  hasCoordinates,
  mapFocusAction,
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
  focusEstate?: { estateId: string; nonce: number } | null;
  onOpenEstates?: (districtId: string) => void;
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

export function EstateMap({
  estates,
  onSelect,
  focusEstate,
  onOpenEstates,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const focusedMarkerRef = useRef<L.CircleMarker | null>(null);
  const appliedFocusRef = useRef<number | null>(null);
  const openedTooltipRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  const [districtId, setDistrictId] = useState("");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [renderedGroups, setRenderedGroups] = useState(0);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const districts = useMemo(() => listDistricts(estates), [estates]);
  const selection = useMemo(
    () => selectMapEstates(estates, districtId),
    [estates, districtId],
  );
  const clusters = useMemo(
    () => clusterMapEstates(selection.visible, zoom),
    [selection, zoom],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      center: HK_CENTER,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: true,
      worldCopyJump: true,
      zoomAnimation: false,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      minZoom: 9,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    map.on("zoomend", () => {
      setZoom(map.getZoom());
      setViewportVersion((value) => value + 1);
    });
    map.on("moveend", () => setViewportVersion((value) => value + 1));
    map.on("resize", () => setViewportVersion((value) => value + 1));
    mapRef.current = map;

    return () => {
      map.stop();
      map.off();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      appliedFocusRef.current = null;
      openedTooltipRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    focusedMarkerRef.current = null;
    const focusId = focusEstate?.estateId;
    const viewBounds = map.getBounds().pad(0.15);
    const visibleClusters = clusters.filter((cluster) =>
      viewBounds.contains([cluster.latitude, cluster.longitude]),
    );
    setRenderedGroups(visibleClusters.length);

    for (const cluster of visibleClusters) {
      if (cluster.count === 1) {
        const estate = cluster.estates[0];
        const isFocused = estate.estate_id === focusId;
        const marker = L.circleMarker(
          [estate.latitude, estate.longitude],
          {
            radius: isFocused ? 8 : 5,
            weight: isFocused ? 3 : 1,
            color: isFocused ? "#123f3a" : "#ffffff",
            fillColor: cluster.bucket.color,
            fillOpacity: 0.92,
            className: isFocused ? "map-marker-focus" : undefined,
          },
        );

        marker.bindTooltip(tooltipElement(estate), {
          direction: "top",
          offset: [0, -6],
          opacity: 1,
        });
        marker.on("click", () => onSelectRef.current(estate));
        marker.addTo(layer);
        if (isFocused) focusedMarkerRef.current = marker;
        continue;
      }

      const marker = L.marker([cluster.latitude, cluster.longitude], {
        icon: L.divIcon({
          className: "map-cluster-icon",
          html: `<span style="background:${cluster.bucket.color}">${cluster.count}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        title: `${cluster.count} estates. Activate to zoom in.`,
      });
      const priceLabel = cluster.mixedBuckets
        ? "mixed price buckets"
        : cluster.bucket.label;
      marker.bindTooltip(
        `${cluster.count} estates · ${priceLabel} · click to zoom`,
        { direction: "top", offset: [0, -20], opacity: 1 },
      );
      marker.on("click", () => {
        const activeMap = mapRef.current;
        if (!activeMap) return;
        const nextZoom = Math.min(
          CLUSTER_MAX_ZOOM,
          activeMap.getZoom() + 2,
        );
        activeMap.setView(
          [cluster.latitude, cluster.longitude],
          nextZoom,
          { animate: true },
        );
      });
      marker.addTo(layer);
      marker
        .getElement()
        ?.setAttribute(
          "aria-label",
          `${cluster.count} estates. Activate to zoom in.`,
        );
    }

    if (
      focusedMarkerRef.current &&
      focusEstate &&
      openedTooltipRef.current !== focusEstate.nonce
    ) {
      focusedMarkerRef.current.openTooltip();
      openedTooltipRef.current = focusEstate.nonce;
    }
  }, [clusters, focusEstate, viewportVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Do not start a fit animation while a focus request is still pending.
    if (
      mapFocusAction(
        focusEstate?.nonce,
        appliedFocusRef.current,
        districtId,
      ) !== "skip"
    ) {
      return;
    }
    const bounds = boundsFor(selection.visible);
    if (bounds) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    } else {
      map.setView(HK_CENTER, DEFAULT_ZOOM);
    }
  }, [selection, focusEstate, districtId]);

  useEffect(() => {
    const map = mapRef.current;
    const action = mapFocusAction(
      focusEstate?.nonce,
      appliedFocusRef.current,
      districtId,
    );
    if (!map || action === "skip") return;
    if (action === "clear-district") {
      setDistrictId("");
      return;
    }
    const estate = estates.find(
      (item) => item.estate_id === focusEstate?.estateId,
    );
    if (!estate || !hasCoordinates(estate)) {
      if (focusEstate) appliedFocusRef.current = focusEstate.nonce;
      return;
    }
    if (focusEstate) appliedFocusRef.current = focusEstate.nonce;
    map.setView(
      [estate.latitude, estate.longitude],
      CLUSTER_MAX_ZOOM,
      { animate: false },
    );
  }, [focusEstate, estates, districtId]);

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
            Estates plotted at their coordinates. Nearby estates are grouped
            into numbered clusters; zoom in to split them. Colour shows the
            12-month average net-ft price (latest transaction as a fallback);
            select a marker to open the estate detail panel.
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
        {districtId && onOpenEstates ? (
          <button
            type="button"
            className="button"
            onClick={() => onOpenEstates(districtId)}
          >
            View estates in this district
          </button>
        ) : null}
      </div>

      <p className="muted map-status">
        {zoom < CLUSTER_MAX_ZOOM
          ? `${formatNumber(renderedGroups)} groups in view · ${formatNumber(clusters.length)} across selection`
          : `${formatNumber(renderedGroups)} markers in view · ${formatNumber(selection.visible.length)} mapped`}
      </p>

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
          id="estate-map-region"
          className="map-canvas"
          role="region"
          aria-label="Map of Hong Kong estates"
          tabIndex={-1}
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
          <p className="map-legend-note">
            Cluster colour follows the most common price bucket in the group.
          </p>
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
