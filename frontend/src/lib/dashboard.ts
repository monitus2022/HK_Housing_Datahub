import type { DashboardData, EstateSummary, Manifest } from "../types";

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
