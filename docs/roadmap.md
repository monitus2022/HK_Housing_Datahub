# Roadmap

The tidy-up (Phases 0–8) is the baseline. This file tracks work beyond it.

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

- **Frontend** — a separate static site that reads `dashboard/manifest.json`.
  Planned views: estate list/search, estate detail, district price trends,
  coverage/data-freshness, and a clear error/fallback state.
- **R2 public access and CORS** — configure the bucket/custom domain for the
  frontend origin. The CLI upload is verified; browser access is not.
- **Parquet exports** — add `mart_estate_monthly` (~592k rows) and
  `mart_transaction_recent` (~73k rows) if the dashboard needs full history or a
  recent-transactions table.
- **Live API (optional)** — only if interactive querying is required. The
  static snapshot is the default.

## RAG / retrieval

- **RAG idempotency (#17)** — use Chroma `upsert()` or a versioned collection
  per build; handle orphaned chunks when source text changes. Deferred because
  the static dashboard does not depend on Chroma.

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
