/** Build a Chinese Wikipedia URL from a page title. */
export function wikiUrl(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;
  const page = encodeURIComponent(trimmed.replace(/ /g, "_"));
  return `https://zh.wikipedia.org/wiki/${page}`;
}
