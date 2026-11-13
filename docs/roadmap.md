# Roadmap

The tidy-up (Phases 0–6 and 8; Phase 7 is optional and deferred) is the
baseline. This file tracks work beyond it.

## Data pipeline

- **Incremental crawls** — persist a watermark and diff estate/building IDs so
  reruns only fetch changed payloads. Today reruns are idempotent but still
  refetch everything.
- **RVD benchmarks** — ingestion of official rents, prices, indices, and
  yields at region × property-class granularity is implemented, with a
  long-history benchmark panel in Trends. District rent already comes from HKP
  rentals.
- **Better Wikipedia coverage** — handle more title variants, English pages,
  disambiguation pages, and missing/renamed estates. Improve `has_wiki` beyond
  exact-name matching.
- **Scheduled runs and monitoring** — cron or a small orchestrator; extend
  `pipeline_runs` to marts/quality/serving; alert on stale data, quality
  regressions, and failed uploads.

## Data quality

- **Building→phase orphans** — fixed in the mapper (only real phases become
  `buildings.phase_id`) with `scripts/repair_orphan_phase_ids.py` for existing
  databases. Run the repair once on each existing DB to clear the critical
  quality gate; the mapper prevents new orphans.
- **Configurable thresholds** — expose quality thresholds via CLI/config rather
  than editing `DEFAULT_THRESHOLDS`.
- **Historical quality trends** — compare reports across runs and flag
  regressions, not just current state.

## Serving and frontend

- **Frontend visualization phases** — phase 1 is the visualization-first
  overview and trend workbench built from current marts: market KPIs,
  a district-filterable sale/rent pulse, top estates by transacted value,
  district league, yield scatter, and level/index/change trend
  views with district comparison. Map clustering adds zoom-aware groups and
  map/list linking. Phase 2 adds medians, percentiles, segment marts, and
  distribution charts, price-band charts, and segment comparisons. Remaining:
  broader accessibility/performance testing.
- **R2 public access and CORS** — configured: the snapshot is public at
  <https://hk-housing-datahub.monitus.org> and allows the
  `https://hk-housing.monitus.org` origin. See [`deployment.md`](deployment.md).
- **Parquet exports** — optional for external analytics only. The dashboard now
  gets `mart_estate_monthly` as compact JSON (~1.3 MB gzipped) and
  `mart_transaction_recent` as trimmed JSON (~2.1 MB gzipped).
- **Live API (optional)** — only if interactive querying is required. The
  static snapshot is the default.

## RAG / retrieval

- **RAG idempotency** — implemented (issue #17): chunks are upserted and IDs not
  present in the current wiki source are pruned after a complete run. Pruning is
  skipped when any input file fails to load or when a run yields no chunks.

## Modeling

- **Hedonic price-per-net-sq-ft model** — see `docs/workplan-ml.md`. Deferred;
  not part of the backend handoff.
- **Text-to-SQL** — only if a real conversational use case justifies it.

## Platform

- **Postgres/warehouse** — move to Postgres or a columnar warehouse if
  concurrent writers, larger-than-memory analytics, or a live API become
  requirements.
- **Packaging/deployment** — pinning a lockfile, image hardening, and a
  deployment target for the batch job.
