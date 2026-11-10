# Roadmap

The tidy-up (Phases 0–6 and 8; Phase 7 is optional and deferred) is the
baseline. This file tracks work beyond it.

## Data pipeline

- **Incremental crawls** — persist a watermark and diff estate/building IDs so
  reruns only fetch changed payloads. Today reruns are idempotent but still
  refetch everything.
- **RVD integration** — ingest Rating and Valuation Department market statistics
  alongside the HKP data. Normalize to the same district/month grain.
- **Better Wikipedia coverage** — handle more title variants, English pages,
  disambiguation pages, and missing/renamed estates. Improve `has_wiki` beyond
  exact-name matching.
- **Scheduled runs and monitoring** — cron or a small orchestrator; extend
  `pipeline_runs` to marts/quality/serving; alert on stale data, quality
  regressions, and failed uploads.

## Data quality

- **Fix the 160 building→phase orphans** — either stop mapping non-phase source
  entries as `phase_id` or add a repair step. Until then the critical quality
  gate is report-only in the local entrypoint.
- **Configurable thresholds** — expose quality thresholds via CLI/config rather
  than editing `DEFAULT_THRESHOLDS`.
- **Historical quality trends** — compare reports across runs and flag
  regressions, not just current state.

## Serving and frontend

- **Frontend v2** — implemented on `dev` with a release PR open to `main`:
  dataset overview, estate search and detail, district price trends, an estate
  map, and a recent-transactions table. The v2 snapshot with
  `transaction_recent` is published. Remaining: merge/deploy, then run broader
  accessibility/performance testing.
- **R2 public access and CORS** — configured: the snapshot is public at
  <https://hk-housing-datahub.monitus.org> and allows the
  `https://hk-housing.monitus.org` origin. See [`deployment.md`](deployment.md).
- **Parquet exports** — add `mart_estate_monthly` (~592k rows) if the dashboard
  needs full estate-monthly history. `mart_transaction_recent` is already
  exported as trimmed JSON (~1.6 MB gzipped).
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
