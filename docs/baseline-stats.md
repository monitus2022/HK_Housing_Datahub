# Baseline Statistics — 2026-11-09

Reference snapshot for the tidy-up workplan. All database queries were
read-only against `data/agency/agency_data.db`. No data or secrets were
modified.

- Repository: `monitus2022/HK_Housing_Datahub`
- Base branch: `dev` @ `92bc704`. `origin/main` contains `dev` plus the merge
  commits through PR #12: `origin/main` is 3 commits ahead of `dev`, and
  `dev..origin/main` is empty. The local `main` ref was stale (33 commits behind
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
| Has `first_op_date` | 8,856 | 90.9% |
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

This is an uncommitted local choice and is preserved intentionally in the
Phase 0 commit. RAG reruns are **not** idempotent today: the embedding pipeline
uses Chroma `collection.add()`, which raises when IDs already exist. Fixing
that belongs to a later phase.

## Known gaps confirmed at snapshot time

- No `tests/` directory.
- `.github/workflows/ci-cd.yml` is empty.
- `bulk_insert_cache_into_db_tables()` uses `bulk_save_objects()` with no
  upsert.
- Deduplication uses process-local `pk_sets` only.
- `src/config/settings.py` instantiates `CloudStorageSecrets()` at import time,
  so importing the config requires cloud credentials.
- The old cloud uploader walks all of `data/`, including the SQLite DB and
  Chroma store.
- No `.dockerignore`; the Dockerfile uses `COPY . .`.

## Reproduce

Table counts:

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("file:data/agency/agency_data.db?mode=ro", uri=True)
for (t,) in con.execute(
    "select name from sqlite_master where type='table' order by name"
):
    n = con.execute(f'select count(*) from "{t}"').fetchone()[0]
    print(f"{t:35s} {n:>12,}")
PY
```

Date ranges, coverage, and target quantiles:

```bash
python3 - <<'PY'
import sqlite3
con = sqlite3.connect("file:data/agency/agency_data.db?mode=ro", uri=True)
q = lambda s: con.execute(s).fetchone()[0]

print("tx range", con.execute("select min(tx_date), max(tx_date) from transactions").fetchone())
print("market range", con.execute("select min(record_date), max(record_date) from estate_monthly_market_info").fetchone())
print("estates", q("select count(*) from estates"))
print("with buildings", q("select count(distinct estate_id) from buildings"))
print("with transactions", q("""
  select count(distinct e.estate_id) from estates e
  join buildings b on e.estate_id = b.estate_id
  join units u on b.building_id = u.building_id
  join transactions t on u.unit_id = t.unit_id
"""))
print("with market", q("select count(distinct estate_id) from estate_monthly_market_info"))
print("with school nets", q("select count(distinct estate_id) from estate_school_nets"))
print("with facilities", q("select count(distinct estate_id) from estate_facilities"))
print("with mtr", q("select count(distinct estate_id) from estate_mtr_lines"))
print("with first_op_date", q("select count(*) from estates where first_op_date is not null"))
print("with coords", q("select count(*) from estates where latitude is not null and longitude is not null"))
print("units net_area > 0", q("select count(*) from units where net_area > 0"))
print("units bedroom present", q("select count(*) from units where bedroom is not null"))
print("units with features", q("select count(distinct unit_id) from unit_features"))
print("tx price>0 net_area>0", q("""
  select count(*) from transactions t join units u on t.unit_id = u.unit_id
  where t.price > 0 and u.net_area > 0
"""))

rows = con.execute("""
  select t.price / u.net_area as p
  from transactions t join units u on t.unit_id = u.unit_id
  where t.price > 0 and u.net_area > 0
  order by p
""").fetchall()
n = len(rows)
for pct in (0.01, 0.50, 0.99):
    print(f"p{int(pct*100):02d}", rows[int(n * pct)][0])
print("max", rows[-1][0])
PY
```

Wiki/Chroma counts:

```bash
python3 - <<'PY'
import glob, json, sqlite3
total = 0
for path in sorted(glob.glob("data/wiki/*.json")):
    n = len(json.load(open(path)))
    total += n
    print(path, n)
print("wiki estates", total)
con = sqlite3.connect("file:data/chroma_db/chroma.sqlite3?mode=ro", uri=True)
print("chroma embeddings", con.execute("select count(*) from embeddings").fetchone()[0])
PY
```
