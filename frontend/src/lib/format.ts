const hkd = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-HK");

const date = new Intl.DateTimeFormat("en-HK", {
  dateStyle: "medium",
});

const month = new Intl.DateTimeFormat("en-HK", {
  month: "short",
  year: "numeric",
});

export function formatHkd(value: number | null): string {
  return value === null || Number.isNaN(value) ? "—" : hkd.format(value);
}

export function formatCompactHkd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) {
    return `HK$${(value / 1_000_000_000).toFixed(1)}b`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `HK$${(value / 1_000_000).toFixed(1)}m`;
  }
  if (Math.abs(value) >= 1_000) {
    return `HK$${(value / 1_000).toFixed(1)}k`;
  }
  return hkd.format(value);
}

export function formatNumber(value: number | null): string {
  return value === null || Number.isNaN(value) ? "—" : number.format(value);
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

/** Format a `YYYY-MM` bucket as "Oct 2025". */
export function formatMonth(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}-01T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : month.format(parsed);
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatShare(part: number, total: number): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}
