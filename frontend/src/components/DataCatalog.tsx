import { useEffect, useMemo, useState } from "react";
import type { CatalogDataset, DataCatalog, Manifest } from "../types";
import { loadCatalog } from "../lib/dashboard";
import { formatDate, formatNumber } from "../lib/format";
import { InlineError, InlineLoading } from "./Status";

interface Props {
  manifest: Manifest;
}

function layerLabel(layer: string): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

export function DataCatalogView({ manifest }: Props) {
  const [catalog, setCatalog] = useState<DataCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadCatalog(manifest)
      .then((data) => {
        if (cancelled) return;
        setCatalog(data);
        setSelectedId((current) => current || data.datasets[0]?.id || "");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the data catalogue.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifest]);

  const selected = useMemo<CatalogDataset | null>(() => {
    if (!catalog) return null;
    return (
      catalog.datasets.find((dataset) => dataset.id === selectedId) ??
      catalog.datasets[0] ??
      null
    );
  }, [catalog, selectedId]);

  return (
    <section className="panel" aria-label="Data catalogue">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h2>Data catalogue</h2>
          <p className="muted">
            Datasets, grains, provenance, freshness, coverage, caveats, and
            column-level detail for this datahub.
          </p>
        </div>
        {catalog ? (
          <p className="result-count">
            {formatNumber(catalog.database.table_count)} tables
          </p>
        ) : null}
      </div>

      {loading ? <InlineLoading label="Loading the data catalogue…" /> : null}
      {error && !loading ? (
        <InlineError title="Catalogue is unavailable" message={error} />
      ) : null}

      {catalog && !loading && !error ? (
        <>
          <div className="catalog-summary">
            <span>
              Generated {formatDate(catalog.generated_at.slice(0, 10))} ·{" "}
              {formatNumber(catalog.database.row_count)} rows
            </span>
            {catalog.quality ? (
              <span
                className={`catalog-quality catalog-quality-${catalog.quality.status}`}
              >
                Quality: {catalog.quality.status} ·{" "}
                {catalog.quality.critical_failures} critical
              </span>
            ) : null}
            {catalog.manifest ? (
              <span>Snapshot {catalog.manifest.build_id}</span>
            ) : null}
            {catalog.manifest?.data_through?.transactions ? (
              <span>
                Data through{" "}
                {formatDate(catalog.manifest.data_through.transactions)}
              </span>
            ) : null}
          </div>

          <div className="catalog-layout">
            <nav className="catalog-datasets" aria-label="Datasets">
              {catalog.datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  className={`catalog-dataset ${
                    selected?.id === dataset.id ? "catalog-dataset-active" : ""
                  }`}
                  onClick={() => setSelectedId(dataset.id)}
                >
                  <span className="catalog-dataset-name">{dataset.name}</span>
                  <span className="catalog-dataset-meta">
                    {layerLabel(dataset.layer)} ·{" "}
                    {formatNumber(dataset.table_count)} tables ·{" "}
                    {formatNumber(dataset.row_count)} rows
                  </span>
                </button>
              ))}
            </nav>

            {selected ? (
              <article className="catalog-detail">
                <header>
                  <p className="eyebrow">{layerLabel(selected.layer)}</p>
                  <h3>{selected.name}</h3>
                  <p>{selected.description}</p>
                </header>

                <dl className="catalog-meta">
                  {selected.source ? (
                    <>
                      <dt>Source</dt>
                      <dd>{selected.source}</dd>
                    </>
                  ) : null}
                  {selected.refresh ? (
                    <>
                      <dt>Refresh</dt>
                      <dd>{selected.refresh}</dd>
                    </>
                  ) : null}
                  {selected.licence ? (
                    <>
                      <dt>Licence</dt>
                      <dd>{selected.licence}</dd>
                    </>
                  ) : null}
                  {selected.owner ? (
                    <>
                      <dt>Owner</dt>
                      <dd>{selected.owner}</dd>
                    </>
                  ) : null}
                  <dt>Tables</dt>
                  <dd>
                    {formatNumber(selected.table_count)} ·{" "}
                    {formatNumber(selected.row_count)} rows
                  </dd>
                </dl>

                {selected.artifacts && selected.artifacts.length > 0 ? (
                  <div className="catalog-artifacts">
                    <strong>Artifacts:</strong>
                    <ul>
                      {selected.artifacts.map((artifact) => (
                        <li key={artifact}>
                          <code>{artifact}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {selected.caveats ? (
                  <p className="catalog-caveat">
                    <strong>Caveats:</strong> {selected.caveats}
                  </p>
                ) : null}

                {selected.tables.length === 0 ? (
                  <p className="muted">
                    This dataset has no relational tables; see the source
                    artifacts listed above.
                  </p>
                ) : (
                  <div className="catalog-tables">
                    {selected.tables.map((table) => (
                      <details key={table.name} className="catalog-table">
                        <summary>
                          <span>
                            <code>{table.name}</code>
                            {table.description ? ` — ${table.description}` : ""}
                          </span>
                          <span className="muted">
                            {formatNumber(table.row_count)} rows
                          </span>
                        </summary>
                        <div className="catalog-table-body">
                          <p className="muted">
                            Grain: {table.grain ?? "—"}
                          </p>
                          {table.caveats ? (
                            <p className="catalog-caveat">{table.caveats}</p>
                          ) : null}
                          <div className="table-wrap">
                            <table className="estate-table catalog-columns">
                              <thead>
                                <tr>
                                  <th scope="col">Column</th>
                                  <th scope="col">Type</th>
                                  <th scope="col">Null</th>
                                  <th scope="col" className="numeric">
                                    Nulls
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {table.columns.map((column) => (
                                  <tr key={column.name}>
                                    <td>
                                      <code>{column.name}</code>
                                      {column.primary_key
                                        ? " (PK)"
                                        : ""}
                                    </td>
                                    <td>{column.type ?? "—"}</td>
                                    <td>{column.nullable ? "yes" : "no"}</td>
                                    <td className="numeric">
                                      {formatNumber(column.null_count)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {table.foreign_keys.length > 0 ? (
                            <p className="muted catalog-fk">
                              Foreign keys:{" "}
                              {table.foreign_keys
                                .map(
                                  (fk) =>
                                    `${fk.column} → ${fk.references_table}.${fk.references_column}`,
                                )
                                .join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </article>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
