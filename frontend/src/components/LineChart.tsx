import { DEFAULT_CHART_OPTIONS, type MultiLineGeometry } from "../lib/trends";
import { formatMonth } from "../lib/format";

const SERIES_COLORS = ["var(--accent)", "#d97706", "#2563eb", "#7c3aed"];

interface Props {
  geometry: MultiLineGeometry;
  formatValue: (value: number) => string;
  ariaLabel: string;
  caption?: string;
  showDots?: boolean;
}

export function LineChart({
  geometry,
  formatValue,
  ariaLabel,
  caption,
  showDots = true,
}: Props) {
  const dots = geometry.series.flatMap((series) => series.points);
  const first = dots.reduce(
    (earliest, point) => (point.x < earliest.x ? point : earliest),
    dots[0],
  );
  const last = dots.reduce(
    (latest, point) => (point.x > latest.x ? point : latest),
    dots[0],
  );

  return (
    <figure className="chart-figure">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${DEFAULT_CHART_OPTIONS.width} ${DEFAULT_CHART_OPTIONS.height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {geometry.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={DEFAULT_CHART_OPTIONS.paddingLeft}
              x2={
                DEFAULT_CHART_OPTIONS.width -
                DEFAULT_CHART_OPTIONS.paddingRight
              }
              y1={tick.y}
              y2={tick.y}
              className="chart-grid"
            />
            <text
              x={DEFAULT_CHART_OPTIONS.paddingLeft - 10}
              y={tick.y + 4}
              textAnchor="end"
              className="chart-axis-label"
            >
              {formatValue(tick.value)}
            </text>
          </g>
        ))}

        {geometry.series.map((series, index) => (
          <g key={series.id}>
            <path
              d={series.linePath}
              fill="none"
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {showDots
              ? series.points.map((item) => (
              <circle
                key={`${series.id}-${item.point.month}`}
                cx={item.x}
                cy={item.y}
                r={2.4}
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              >
                <title>
                  {series.label} · {formatMonth(item.point.month)}:{" "}
                  {formatValue(item.point.value)}
                </title>
              </circle>
                ))
              : null}
          </g>
        ))}

        <text
          x={DEFAULT_CHART_OPTIONS.paddingLeft}
          y={DEFAULT_CHART_OPTIONS.height - 10}
          className="chart-axis-label"
        >
          {formatMonth(first.point.month)}
        </text>
        <text
          x={
            DEFAULT_CHART_OPTIONS.width - DEFAULT_CHART_OPTIONS.paddingRight
          }
          y={DEFAULT_CHART_OPTIONS.height - 10}
          textAnchor="end"
          className="chart-axis-label"
        >
          {formatMonth(last.point.month)}
        </text>
      </svg>

      <div className="chart-legend">
        {geometry.series.map((series, index) => (
          <span key={series.id}>
            <i
              className="chart-legend-swatch"
              style={{
                background: SERIES_COLORS[index % SERIES_COLORS.length],
              }}
              aria-hidden="true"
            />
            {series.label}
          </span>
        ))}
      </div>
      {caption ? <figcaption className="muted">{caption}</figcaption> : null}
    </figure>
  );
}
