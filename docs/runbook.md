# Runbook

Operational notes for running, resuming, and troubleshooting the datahub. For
architecture and schema details, see
[`architecture.md`](architecture.md) and
[`data-dictionary.md`](data-dictionary.md).

## Current entrypoint

`src/main.py` is a manual toggle board. The current state is:

- **Enabled:** read-only data-quality checks, then the RAG embedding pipeline.
- **Disabled:** agency pipeline, wiki pipeline, cloud upload.

That is why `python src/main.py` reports quality and processes wiki embeddings,
but does not refresh the SQLite database. The quality step is report-only in
`main.py`; use `scripts/run_quality.py --fail-on critical` to gate.

**Known caveat:** RAG reruns are not idempotent. The embedding pipeline uses
Chroma `collection.add()`. In Chroma 0.5.5, adding an existing ID logs a
warning and skips it rather than raising. A rerun can therefore appear to
succeed while leaving stale chunks and embeddings in place. This is tracked in
issue #17. Until it is fixed, delete or rename `data/chroma_db/` before a full
rebuild, or run against a fresh Chroma path.

## Local setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Only needed for cloud upload; local data processing works without it.
cp .env.template .env
```

The reference data is in `data/` and is gitignored. The agency database is about
320 MB.

## Run the stages

The orchestrator methods can be called directly from Python with `src` on the
path. Run from the repo root.

### Agency pipeline (network, long)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import AgencyOrchestrator

orchestrator = AgencyOrchestrator(
    debug_mode=False,
    keep_latest_transaction_only=False,
)
orchestrator.run_estates_info_data_pipeline()
PY
```

### Wiki pipeline (network, writes partition JSON)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import WikiOrchestrator

WikiOrchestrator().run_estate_wiki_data_pipeline()
PY
```

### RAG embeddings (CPU; rebuild caveat above)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import RAGOrchestrator

RAGOrchestrator().run_text_embedding_pipeline()
PY
```

### Legacy cloud upload (requires credentials)

```bash
python - <<'PY'
import sys
sys.path.insert(0, "src")
from orchestrators import CloudUploadOrchestrator

CloudUploadOrchestrator().upload_files_from_data_folder()
PY
```

This uploader walks all of `data/`, including the SQLite database and Chroma
store. It is not the serving path; Phase 6 replaces it with a small versioned
snapshot. Do not point it at a public bucket.

## Debug mode

`AgencyOrchestrator(debug_mode=True)` limits the estate list to the first 20
estates. It still makes live network requests and still writes to the configured
database, so use a copy if you do not want to touch the reference DB.

```python
orchestrator = AgencyOrchestrator(debug_mode=True)
```

For a truly offline smoke test, use the payload fixtures under
`docs/api_responses/` and the processor methods directly. The current `tests/`
suite covers upserts, composite keys, `pk_map` consistency, and run metadata
with a temporary SQLite database; broader fixture coverage is Phase 4.

## Resume and rerun behaviour

Current behaviour:

- Estate IDs are cached in `data/agency/estate_ids.txt`. If the file exists and
  `force_refetch_estate_ids` is false, the crawler reuses it.
- Agency writes use SQLite upserts keyed on the model primary key. Rerunning a
  partition leaves row counts unchanged and refreshes non-key columns. Duplicate
  keys inside one batch are handled by the upsert.
- The old process-local `pk_sets` deduplication was removed; duplicate inputs
  are now absorbed by the upsert instead of growing an in-memory set.
- `close_session()` is called once at the end of the agency pipeline, not inside
  the per-partition building loop.
- Each pipeline run gets a UUID and a row in `pipeline_runs` with start/end
  timestamps, mode, status, record counts, and any error message.
- RAG writes are still not idempotent: existing IDs are skipped, not refreshed
  (issue #17).
- Wiki partition files are overwritten per partition, but the aggregated file
  is overwritten at the end of a successful run.

Reruns against the same SQLite database are safe for the agency tables. RAG
rebuilds still need a fresh Chroma path or the issue #17 fix.

## Inspect data

Read-only table counts and coverage:

```bash
python3 scripts/baseline_stats.py
```

Ad-hoc SQL (read-only):

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("file:data/agency/agency_data.db?mode=ro", uri=True)
for row in con.execute("select count(*) from transactions"):
    print(row)
PY
```

## Quality reports

Run the checks (read-only):

```bash
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical
```

Outputs:

```text
data/quality/latest.json
data/quality/{run_id}.json
data/quality/latest.md
```

The JSON report contains a `summary` block and a `checks` array. Exit code `1`
means the selected gate failed; `2` means the database is missing. Use
`--fail-on warning` to gate on warnings too, or `--fail-on none` for a
report-only run.

`src/main.py` calls the checks in report-only mode before the RAG step. The
reference DB currently has one critical finding (160 `buildings.phase_id ->
phases.phase_id` orphans) and three warnings (non-positive areas, estate
coverage, transaction estates without market data). See
[`quality.md`](quality.md) for the check list and thresholds.

## Publish serving data

Phase 6 will add:

```bash
python scripts/publish_dashboard.py --dry-run
python scripts/publish_dashboard.py
python scripts/verify_serving.py
```

The intended contract is a versioned snapshot under
`data/serving/{build_id}/` with a `manifest.json`, then an R2 upload under
`dashboard/{build_id}/` with the manifest updated last. Until Phase 6, use the
legacy uploader only for private storage.

## Tests and checks

```bash
# Core test environment (no RAG/cloud extras)
pip install -r requirements-core.txt -r requirements-dev.txt

# Available now
python3 scripts/baseline_stats.py
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none
pytest -q
ruff check src/main.py src/quality src/processors/agency \
  src/models/agency/sql_db.py src/orchestrators scripts tests

# Shortcuts
make test
make lint
make quality
make quality-strict
```

`tests/` contains the Phase 2–4 tests (44 total): upserts, run metadata,
quality checks, response models, table mapping, and duplicate-input dedupe. The
CI workflow (`.github/workflows/ci-cd.yml`) installs core + dev dependencies,
checks that `config` imports without `.env`, compiles, runs `pytest`, and runs
ruff on the touched modules.

## Common failures

| Symptom | Likely cause | Action |
|---|---|---|
| `ModuleNotFoundError: config` | `src` is not on `sys.path` | Run from the repo root with `sys.path.insert(0, "src")`, or use `python src/main.py` (which puts `src` on the path). |
| `Missing cloud storage credentials` | Upload attempted without `.env` keys | Set `cloud_storage_access_key_id`, `cloud_storage_secret_access_key`, and `cloudflare_account_id` (for R2) in `.env`. Local processing does not need them. |
| RAG rerun appears to succeed but old chunks remain | Chroma 0.5.5 `add()` skips existing IDs | Delete/rename `data/chroma_db/` or use a fresh path; upsert is tracked in issue #17. |
| Quality gate exits 1 with `buildings.phase_id -> phases.phase_id` orphans | Building rows use a source "phase" that is not a real phase | Inspect `data/quality/latest.md`; repair the mapping or accept report-only mode until fixed. |
| `database is locked` | Concurrent SQLite writers | Use one writer at a time; WAL helps readers but does not allow concurrent writers. |
| Estate returns 404 | Estate removed or unavailable | The crawler logs and skips; rerun later or inspect the ID list. |
| Building returns 502 | Source API transient failure | The shared request wrapper retries 3 times with a 2 s pause; rerun the building partition later. |
| No wiki page found | Title variation/disambiguation/HK check failed | Inspect the estate name; the crawler tries Chinese title variations and skips ambiguous pages. |
| Wiki partition is empty | All estates in the partition failed | Check the logs and network; rerun that partition after fixing the source issue. |
| `.env` missing | Local config | Not required for imports or local processing; copy `.env.template` only when using cloud upload. |

## Logs

Logs go to the console and to `logs/hk_housing_datahub.log` (ERROR level for the
file). `logs/` is gitignored.

## Safety rules

- Do not commit `data/`, `*.db`, `.env`, `logs/`, `venv/`, or `.DS_Store`.
- Do not run the full crawl just to test a transformation; use fixtures.
- Do not modify the reference `agency_data.db`; copy it first.
- Do not upload the raw `data/` tree to a public bucket.
- Do not merge a PR to `main` from an agent session; a human does that.
