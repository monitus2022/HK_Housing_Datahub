# Data Quality

The quality layer runs read-only checks against the agency SQLite database and
writes machine-readable and human-readable reports. It never modifies the
database.

## Run

```bash
# Convenience wrapper from the repo root
python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

# Equivalent module invocation
PYTHONPATH=src python -m quality.run --db data/agency/agency_data.db --fail-on critical
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `--db` | `data/agency/agency_data.db` | Database to inspect, opened with SQLite `mode=ro` |
| `--output-dir` | `data/quality` | Report directory |
| `--fail-on` | `critical` | `critical`, `warning`, or `none` |
| `--run-id` | timestamp | Override the generated run ID |

Exit codes:

- `0` — the selected gate passed.
- `1` — the selected gate failed (critical by default).
- `2` — the database file is missing.

## Outputs

```text
data/quality/latest.json       # latest report
data/quality/{run_id}.json     # immutable run report
data/quality/latest.md         # human-readable summary
```

The JSON contains a `summary` block (`status`, failure counts, total checks) and
a `checks` array. `status` is `pass`, `warn`, or `fail`.

## Critical checks

These indicate corruption or broken relationships and should block a publish:

| Check | What it verifies |
|---|---|
| `required_tables_nonempty` | Regions, subregions, districts, estates, buildings, units, transactions, and market tables exist and have rows |
| `duplicate_primary_keys` | No duplicate key groups in any known table |
| `foreign_key_orphans` | Estate/building/unit/transaction and lookup relationships resolve |
| `negative_prices` | No transaction has a negative price |
| `negative_areas` | No unit has a negative gross or net area |
| `transaction_dates_sane` | Transaction dates are non-null and between 1990-01-01 and tomorrow |

## Warning checks

These surface known limitations and coverage gaps:

| Check | What it verifies |
|---|---|
| `non_positive_areas` | Share of zero/non-positive gross and net areas |
| `estate_coverage` | Estates with buildings, transactions, and market data |
| `estates_without_buildings` | Estates with no building rows |
| `transactions_without_market` | Transaction estates with no monthly market data |
| `transaction_date_gaps` | Largest gap between distinct transaction dates |
| `null_rates` | Null share for configured fields |
| `zero_prices` | Transactions with a zero price |

Zero and non-positive areas are warnings rather than critical failures because
they are a known source limitation in the reference snapshot (about 24.0% of
units have `net_area <= 0`). A **negative** area is still critical.

## Thresholds

Thresholds live in `DEFAULT_THRESHOLDS` in `src/quality/checks.py`:

| Threshold | Default |
|---|---:|
| Non-positive `net_area` share | 20% |
| Non-positive `area` share | 30% |
| Estates with transactions | 50% |
| Estates with market data | 60% |
| Transaction estates without market data | 10% |
| Maximum transaction-date gap | 30 days |
| `units.net_area` null share | 5% |
| `units.bedroom` null share | 50% |
| `estates.first_op_date` null share | 10% |
| `estates` coordinate null share | 10% |
| `transactions.net_ft_price` null share | 10% |

Thresholds are not exposed as CLI flags yet; edit the defaults or pass a
`thresholds` mapping when calling `run_checks()`.

## Reference snapshot (Phase 3 baseline)

At the Phase 3 baseline, the reference database produced:

- **Status:** `fail`
- **Critical:** 1 — 160 `buildings.phase_id -> phases.phase_id` orphan rows
- **Warnings:** 3 — non-positive areas, estate coverage, transaction estates
  without market data

The orphan rows come from building rows whose source "phase" entry is not a real
phase: the mapper used to copy the pseudo-phase id (often the estate id) into
`buildings.phase_id`. The mapper now only sets `phase_id` for real phases, and
`scripts/repair_orphan_phase_ids.py` clears existing orphans. Older databases
keep the critical finding until that script runs. After the 2026-11 refresh the
reference DB reports `warn` with 0 critical and the same three warnings. Local
`src/main.py` runs the checks in report-only mode (`--fail-on none`) so a known
source-data issue does not block the RAG step. Use
`scripts/run_quality.py --fail-on critical` (or CI) to gate.
