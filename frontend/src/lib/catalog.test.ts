import { describe, expect, it } from "vitest";
import type { CatalogDataset } from "../types";
import { datasetBadge, isExternalDataset } from "./catalog";

function dataset(
  overrides: Partial<Pick<CatalogDataset, "table_count" | "row_count" | "artifacts">>,
): Pick<CatalogDataset, "table_count" | "row_count" | "artifacts"> {
  return {
    table_count: 0,
    row_count: 0,
    artifacts: null,
    ...overrides,
  };
}

describe("datasetBadge", () => {
  it("shows table and row counts for SQLite datasets", () => {
    expect(datasetBadge(dataset({ table_count: 15, row_count: 3600326 }))).toBe(
      "15 tables · 3,600,326 rows",
    );
    expect(datasetBadge(dataset({ table_count: 1, row_count: 3 }))).toBe(
      "1 table · 3 rows",
    );
  });

  it("describes artifact-only datasets instead of zero tables", () => {
    expect(
      datasetBadge(dataset({ artifacts: ["a.json", "b.json"] })),
    ).toBe("External · 2 artifacts");
    expect(datasetBadge(dataset({ artifacts: ["chroma/"] }))).toBe(
      "External · 1 artifact",
    );
  });

  it("falls back when there are neither tables nor artifacts", () => {
    expect(datasetBadge(dataset({}))).toBe("No tables");
  });
});

describe("isExternalDataset", () => {
  it("is true only for datasets without relational tables", () => {
    expect(isExternalDataset({ table_count: 0 })).toBe(true);
    expect(isExternalDataset({ table_count: 7 })).toBe(false);
  });
});
