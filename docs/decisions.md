# Architecture Decisions

Short ADR-style notes for the trade-offs made during the tidy-up.

## ADR-001: SQLite for the local/portfolio platform

**Context:** The batch pipeline is single-writer, the reference database is
about 320 MB, and the target is a portfolio project with a static dashboard.

**Decision:** Keep SQLite for raw data, quality-check results, marts, and run
metadata. Document Postgres as the production alternative when concurrent
writers, a live API, or multi-user access are required.

**Consequences:** Zero-ops local setup and simple backups. SQLite does not
support concurrent writers or horizontal scaling; WAL helps readers only.

## ADR-002: Idempotent upserts instead of staging tables

**Context:** The original loader used `bulk_save_objects()` with process-local
`pk_sets`. Reruns could duplicate rows or fail on primary-key conflicts, and the
sets could grow to millions of tuples.

**Decision:** Use SQLite `ON CONFLICT DO UPDATE` keyed on the SQLAlchemy model's
primary key, with duplicate keys inside a batch resolved by the upsert. Remove
`pk_sets`.

**Consequences:** Reruns are idempotent and memory use is bounded. Partial
upserts update only supplied columns and require all NOT NULL columns. Staging
tables + merge remain a better option if the source ever needs complex
validation before commit.

## ADR-003: Materialized marts instead of live dashboard queries

**Context:** Dashboard queries would otherwise join estates, buildings, units,
transactions, and monthly market data over 1M+ rows, repeatedly, with different
date-window logic.

**Decision:** Materialize five marts in SQLite and rebuild them as a batch step.
Document each mart's grain.

**Consequences:** Fast, stable reads and a clear export contract. Marts are
stale until the builder runs; `mart_estate_monthly` is large (~592k rows) and
should move to Parquet if the full series is exported.

## ADR-004: Static versioned snapshot on R2 instead of a live API

**Context:** The consumer is a static data display, not an interactive
valuation or query product. Uptime, latency, and write credentials should stay
off the browser.

**Decision:** Publish a versioned snapshot under `dashboard/{build_id}/`, with a
short-cache `dashboard/manifest.json` pointer. Data files are immutable and
long-cache. The frontend reads the manifest first.

**Consequences:** Cheap CDN-friendly serving and atomic builds. There is no live
querying, and a refresh requires rebuilding/publishing. Public read access and
CORS must be configured on the bucket.

## ADR-005: Gzip JSON rather than Parquet for the v1 snapshot

**Context:** The three raw JSON data files were ~13 MB total, above the ~5 MB
serving target. The frontend is not built yet, so the contract can be defined
now.

**Decision:** Gzip `estate_summary`, `district_monthly`, and `coverage` JSON;
serve them with `Content-Encoding: gzip`. Keep `manifest.json` and
`overview.json` plain. Defer Parquet for the large `mart_estate_monthly` and
`mart_transaction_recent` exports.

**Consequences:** The snapshot is ~950 KB and browsers decompress transparently.
The frontend must use `manifest.files` rather than hardcoded names. Parquet can
be added later without changing the manifest shape.

## ADR-006: Gate the legacy raw uploader

**Context:** The old uploader walked all of `data/`, including the ~320 MB SQLite
database and the Chroma store, and could accidentally publish raw data.

**Decision:** `CloudUploadOrchestrator.upload_files_from_data_folder()` raises
unless constructed with `allow_raw_upload=True`. The serving publisher is the
only supported path.

**Consequences:** Accidental large/raw uploads are prevented. Operators who
still need a private raw backup must opt in explicitly.
