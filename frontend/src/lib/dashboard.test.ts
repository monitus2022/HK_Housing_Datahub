import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../types";
import { loadDashboard } from "./dashboard";

const manifest: Manifest = {
  schema_version: 1,
  build_id: "build-1",
  generated_at: "2026-01-01T00:00:00+00:00",
  data_through: { transactions: "2025-10-21", market: "2025-08-31" },
  coverage: {
    estates: 1,
    with_transactions: 1,
    with_market: 1,
    with_wiki: 0,
  },
  row_counts: { mart_estate_summary: 1 },
  files: { estate_summary: "estate_summary.json.gz" },
  source: ["HKP"],
};

const estates = [
  {
    estate_id: "E1",
    estate_name_en: "Estate One",
    estate_name_zh: "屋苑一",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadDashboard", () => {
  it("fetches the manifest, then the versioned estate file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(jsonResponse(estates));
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadDashboard();

    expect(result.manifest).toEqual(manifest);
    expect(result.estates).toEqual(estates);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/dashboard/manifest.json");
    expect(fetchMock.mock.calls[1][0]).toContain(
      "/dashboard/build-1/estate_summary.json.gz",
    );
  });

  it("falls back to manual gzip decompression when the server returns raw .gz bytes", async () => {
    const gzipped = gzipSync(Buffer.from(JSON.stringify(estates)));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(manifest))
      .mockResolvedValueOnce(
        new Response(gzipped, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadDashboard();

    expect(result.estates).toEqual(estates);
  });

  it("rejects a manifest without an estate_summary file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...manifest, files: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadDashboard()).rejects.toThrow("estate_summary");
  });

  it("reports HTTP failures with the snapshot hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response("not found", { status: 404 })),
    );

    await expect(loadDashboard()).rejects.toThrow(
      "Request failed (404) for /dashboard/manifest.json",
    );
  });
});
