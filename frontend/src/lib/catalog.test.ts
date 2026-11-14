import { describe, expect, it } from "vitest";
import type { CatalogDataset } from "../types";
import { datasetBadge } from "./catalog";

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

  it("prefers table counts when a dataset also has artifacts", () => {
    expect(
      datasetBadge(
        dataset({
          table_count: 4,
          row_count: 18135,
          artifacts: ["data/rvd/his_data_*.xls"],
        }),
      ),
    ).toBe("4 tables · 18,135 rows");
  });

  it("falls back when there are neither tables nor artifacts", () => {
    expect(datasetBadge(dataset({}))).toBe("No tables");
  });
});
