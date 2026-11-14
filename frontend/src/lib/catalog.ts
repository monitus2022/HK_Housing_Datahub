import type { CatalogDataset } from "../types";
import { formatNumber } from "./format";

/**
 * Short label for a catalogue dataset card.
 *
 * SQLite-backed datasets show their table and row counts. Artifact-only
 * datasets (wiki partitions, Chroma store, published snapshot) have no
 * relational tables, so showing `0 tables` reads as broken; describe them as
 * external artifacts instead.
 */
export function datasetBadge(
  dataset: Pick<CatalogDataset, "table_count" | "row_count" | "artifacts">,
): string {
  if (dataset.table_count > 0) {
    const tables = `${formatNumber(dataset.table_count)} ${
      dataset.table_count === 1 ? "table" : "tables"
    }`;
    return `${tables} · ${formatNumber(dataset.row_count)} rows`;
  }
  const artifacts = dataset.artifacts?.length ?? 0;
  if (artifacts === 0) return "No tables";
  return `External · ${formatNumber(artifacts)} artifact${
    artifacts === 1 ? "" : "s"
  }`;
}

/** Whether the dataset is stored outside the SQLite database. */
export function isExternalDataset(
  dataset: Pick<CatalogDataset, "table_count">,
): boolean {
  return dataset.table_count === 0;
}
