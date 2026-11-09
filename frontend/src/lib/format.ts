const hkd = new Intl.NumberFormat("en-HK", {
  style: "currency",
  currency: "HKD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-HK");

const date = new Intl.DateTimeFormat("en-HK", {
  dateStyle: "medium",
});

export function formatHkd(value: number | null): string {
  return value === null || Number.isNaN(value) ? "—" : hkd.format(value);
}

export function formatNumber(value: number | null): string {
  return value === null || Number.isNaN(value) ? "—" : number.format(value);
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

export function formatShare(part: number, total: number): string {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}
