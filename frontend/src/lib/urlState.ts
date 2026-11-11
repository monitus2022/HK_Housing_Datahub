/** Read and write the `estate` query parameter used for deep links. */

export function estateIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("estate");
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function withEstateParam(
  search: string,
  estateId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (estateId) {
    params.set("estate", estateId);
  } else {
    params.delete("estate");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
