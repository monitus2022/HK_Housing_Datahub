import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../types";
import {
  loadDashboard,
  loadDistrictMonthly,
  loadEstateMonthly,
  loadRecentTransactions,
} from "./dashboard";

const manifest: Manifest = {
  schema_version: 2,
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
  files: {
    estate_summary: "estate_summary.json.gz",
    district_monthly: "district_monthly.json.gz",
    estate_monthly: "estate_monthly.json.gz",
    transaction_recent: "transaction_recent.json.gz",
  },
  source: ["HKP"],
};

const estates = [
  {
    estate_id: "E1",
    estate_name_en: "Estate One",
    estate_name_zh: "屋苑一",
  },
];

const districtRows = [
  {
    district_id: "D1",
    month: "2025-01",
    tx_count: 2,
    avg_net_ft_price: 12000,
  },
];

const transactions = [
  {
    tx_date: "2025-01-01",
    price: 5000000,
    net_ft_price: 12000,
    estate_id: "E1",
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

describe("on-demand dataset loaders", () => {
  it("loads district monthly data from the manifest file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(districtRows));
    vi.stubGlobal("fetch", fetchMock);

    const rows = await loadDistrictMonthly({
      ...manifest,
      build_id: "build-district",
    });

    expect(rows).toEqual(districtRows);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/dashboard/build-district/district_monthly.json.gz",
    );
  });

  it("loads estate monthly history from the manifest file", async () => {
    const history = {
      months: ["2025-01"],
      estates: { E1: [[0, 1, 12000]] },
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(history));
    vi.stubGlobal("fetch", fetchMock);

    const rows = await loadEstateMonthly({
      ...manifest,
      build_id: "build-history",
    });

    expect(rows).toEqual(history);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/dashboard/build-history/estate_monthly.json.gz",
    );
  });

  it("loads recent transactions from the manifest file", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(transactions));
    vi.stubGlobal("fetch", fetchMock);

    const rows = await loadRecentTransactions({
      ...manifest,
      build_id: "build-transactions",
    });

    expect(rows).toEqual(transactions);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/dashboard/build-transactions/transaction_recent.json.gz",
    );
  });

  it("caches a file per build and retries after a failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(districtRows))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse(transactions));
    vi.stubGlobal("fetch", fetchMock);

    const cachedManifest = { ...manifest, build_id: "build-cache" };
    await loadDistrictMonthly(cachedManifest);
    await loadDistrictMonthly(cachedManifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      loadRecentTransactions(cachedManifest),
    ).rejects.toThrow("network down");

    // A failed request is evicted, so a retry hits the network again.
    const rows = await loadRecentTransactions(cachedManifest);
    expect(rows).toEqual(transactions);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("explains when a snapshot predates a dataset file", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      loadDistrictMonthly({
        ...manifest,
        build_id: "build-old",
        files: { estate_summary: "estate_summary.json.gz" },
      }),
    ).rejects.toThrow("does not include district_monthly");
  });
});
