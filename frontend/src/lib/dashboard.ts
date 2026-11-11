import type {
  DashboardData,
  DataCatalog,
  DistrictMonthly,
  EstateMonthlyHistory,
  EstateSummary,
  Manifest,
  RecentTransaction,
} from "../types";

const baseUrl = (import.meta.env.VITE_DASHBOARD_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

function absolutePath(path: string): string {
  return `${baseUrl}${path}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(absolutePath(path), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}) for ${path}. ` +
        "Check VITE_DASHBOARD_BASE_URL and the bucket CORS/public-access settings.",
    );
  }

  // R2 serves gzip with Content-Encoding, so the browser decodes it. If a
  // local static server returns the .gz bytes without that header, fall back to
  // manual decompression. Only clone when that fallback could be needed.
  const encoding = (
    response.headers.get("content-encoding") ?? ""
  ).toLowerCase();
  const needsGzipFallback =
    path.endsWith(".gz") && !encoding.includes("gzip");
  const clone = needsGzipFallback ? response.clone() : null;

  try {
    return (await response.json()) as T;
  } catch (parseError) {
    if (!needsGzipFallback || !clone?.body) {
      throw parseError;
    }
    try {
      const decompressed = clone.body.pipeThrough(
        new DecompressionStream("gzip"),
      );
      return (await new Response(decompressed).json()) as T;
    } catch {
      throw new Error(
        `Could not parse ${path}. Check the snapshot URL, CORS, and gzip headers.`,
      );
    }
  }
}

const fileCache = new Map<string, Promise<unknown>>();

async function fetchVersionedJson<T>(
  manifest: Manifest,
  logicalName: string,
): Promise<T> {
  const cacheKey = `${manifest.build_id}:${logicalName}`;
  const cached = fileCache.get(cacheKey);
  if (cached) return cached as Promise<T>;

  const file = manifest.files[logicalName];

  if (!file) {
    throw new Error(
      `This snapshot does not include ${logicalName}. ` +
        "Rebuild and republish the snapshot from the current backend.",
    );
  }

  const promise = fetchJson<T>(`/dashboard/${manifest.build_id}/${file}`);
  fileCache.set(cacheKey, promise);
  // Drop failed requests so "Try again" can refetch.
  promise.catch(() => fileCache.delete(cacheKey));
  return promise;
}

/** Load the manifest and the required estate summary (the v1 contract). */
export async function loadDashboard(): Promise<DashboardData> {
  const manifest = await fetchJson<Manifest>("/dashboard/manifest.json");
  const estateFile = manifest.files.estate_summary;

  if (!estateFile) {
    throw new Error("Manifest is missing files.estate_summary.");
  }

  const estates = await fetchJson<EstateSummary[]>(
    `/dashboard/${manifest.build_id}/${estateFile}`,
  );

  return { manifest, estates };
}

/** District monthly trends. Loaded on demand by the trends view. */
export async function loadDistrictMonthly(
  manifest: Manifest,
): Promise<DistrictMonthly[]> {
  return fetchVersionedJson<DistrictMonthly[]>(manifest, "district_monthly");
}

/** Catalogue and data cards. Loaded on demand by the catalogue view. */
export async function loadCatalog(manifest: Manifest): Promise<DataCatalog> {
  return fetchVersionedJson<DataCatalog>(manifest, "catalog");
}

/** Estate-level monthly history. Loaded on demand by the estate view. */
export async function loadEstateMonthly(
  manifest: Manifest,
): Promise<EstateMonthlyHistory> {
  return fetchVersionedJson<EstateMonthlyHistory>(manifest, "estate_monthly");
}

/** Recent transactions. Loaded on demand by the transactions view. */
export async function loadRecentTransactions(
  manifest: Manifest,
): Promise<RecentTransaction[]> {
  return fetchVersionedJson<RecentTransaction[]>(
    manifest,
    "transaction_recent",
  );
}
