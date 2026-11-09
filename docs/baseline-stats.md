# Baseline Statistics — 2026-11-09

Reference snapshot for the tidy-up workplan. All database queries were
read-only against `data/agency/agency_data.db`. No data or secrets were
modified.

> **Snapshot note:** this file records the Phase 0 state. Phases 1–3
> subsequently made cloud-storage secrets lazy, added `.dockerignore`,
> reconciled the schema diagram, added idempotent agency upserts, added the
> `pipeline_runs` table, and added read-only quality checks and reports. See the
> README for current behavior; the numbers below remain the reference data
> snapshot.

- Repository: `monitus2022/HK_Housing_Datahub`
- Base branch: `dev` @ `92bc704`. `origin/main` contains `dev` plus the merge
  commits through PR #12: `origin/main` is 3 commits ahead of `dev`, and
  `origin/main..dev` is empty. The local `main` ref was stale (33 commits behind
  `origin/main`); compare against `origin/main` after `git fetch`.
- Working tree at snapshot time: `src/main.py` modified; both workplans
  untracked
- Database: `data/agency/agency_data.db` (~320 MB)
- Python: 3.12 (see `Dockerfile`)

## Table counts

| Table | Rows |
|---|---:|
| regions | 3 |
| subregions | 20 |
| districts | 60 |
| estates | 9,748 |
| estate_school_nets | 9,219 |
| estate_facilities | 4,257 |
| estate_mtr_lines | 798 |
| estate_monthly_market_info | 476,986 |
| facilities | 9 |
| phases | 516 |
| buildings | 29,911 |
| units | 1,229,204 |
| unit_features | 563,346 |
| transactions | 1,071,268 |

## Date ranges

| Table | Column | Min | Max |
|---|---|---|---|
| transactions | tx_date | 1996-01-01 16:00:00 | 2025-10-21 16:00:00 |
| estate_monthly_market_info | record_date | 1996-12-31 16:00:00 | 2025-08-31 16:00:00 |

The `16:00:00` component is a timezone artifact. Normalize with `date(...)` in
analytics SQL and document the assumption.

## Estate coverage

Total estates: **9,748**.

| Coverage | Estates | Share |
|---|---:|---:|
| Has buildings | 9,748 | 100.0% |
| Has transactions | 6,638 | 68.1% |
| Has monthly market data | 5,292 | 54.3% |
| Has school net data | 9,219 | 94.6% |
| Has MTR line data | 798 | 8.2% |
| Has facility data | 1,089 | 11.2% |
| Has `first_op_date` | 8,856 | 90.8% |
| Has coordinates | 9,116 | 93.5% |

## Unit and transaction coverage

| Metric | Value |
|---|---:|
| Units | 1,229,204 |
| Units with `net_area > 0` | 927,065 (75.4%) |
| Units with `bedroom` present | 637,891 (51.9%) |
| Units with feature rows | 338,394 (27.5%) |
| Units with more than one transaction | 351,373 |
| Transactions | 1,071,268 |
| Transactions with `price > 0` and `net_area > 0` | 1,056,973 (98.7%) |
| Distinct units with transactions | 719,895 |
| Transactions in 2024 or later | 69,302 |
| Transactions in 2025 | 33,140 |

Price per net sq ft for rows with `price > 0` and `net_area > 0`:
median ~8,020; p1 ~1,868; p99 ~30,597; max ~1,890,482.

## Wiki and Chroma

- Wiki partitions: 9 files under `data/wiki/` (~2.6 MB)
- Wiki estates: 822
- Chroma embeddings: 3,780 in `data/chroma_db/` (~44 MB)
- Partition sizes: 381, 115, 66, 60, 26, 4, 79, 88, 3

## Current entrypoint state

`src/main.py` currently:

- runs the RAG embedding pipeline;
- has the agency and wiki pipelines commented out;
- has the cloud upload commented out.

This was an uncommitted local choice and is preserved intentionally in the
Phase 0 commit. RAG reruns are **not** idempotent today: the embedding pipeline
uses Chroma `collection.add()`, which in Chroma 0.5.5 logs a warning and skips
IDs that already exist, so reruns can leave stale chunks. Tracked separately in
issue #17.

## Known gaps confirmed at snapshot time

- ~~No `tests/` directory.~~ Fixed in Phase 2: `tests/test_upsert.py` covers
  upserts, composite keys, `pk_map` consistency, and run metadata.
- `.github/workflows/ci-cd.yml` is empty (CI is Phase 4).
- ~~`bulk_insert_cache_into_db_tables()` uses `bulk_save_objects()` with no
  upsert.~~ Fixed in Phase 2: writes use SQLite upserts keyed on the model
  primary key.
- ~~Deduplication uses process-local `pk_sets` only.~~ Fixed in Phase 2:
  `pk_sets` were removed; duplicate keys are absorbed by the upsert.
- ~~`src/config/settings.py` instantiates `CloudStorageSecrets()` at import time,
  so importing the config requires cloud credentials.~~ Fixed in Phase 1:
  credential fields are optional and validated only on upload.
- The old cloud uploader walks all of `data/`, including the SQLite DB and
  Chroma store.
- ~~No `.dockerignore`; the Dockerfile uses `COPY . .`.~~ Fixed in Phase 1.

## Reproduce

The committed script prints every database metric in this document:

```bash
python3 scripts/baseline_stats.py
```

It opens the agency database with SQLite's `mode=ro` URI and the Chroma
database read-only, so it cannot modify either one. Pass `--db PATH` to point
at a different copy of the agency database; the wiki and Chroma paths are
resolved from the current working directory, so run it from the repo root.
