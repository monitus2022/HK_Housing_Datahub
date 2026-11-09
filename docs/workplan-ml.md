# Hedonic Price Model Workplan

> **Agent instruction:** Read this file fully before changing code. This work is a
> separate, optional phase that starts **after** `docs/workplan-tidy.md` and the
> dashboard serving layer are in place. Work on branch `feat/hedonic-model`
> created from `dev`. Do not refetch data. Do not commit the SQLite database,
> model binaries, or large artifacts. Complete phases in order and report after
> each phase.

## 1. Mission

Build a reproducible, domain-appropriate **hedonic price-per-net-square-foot
model** on the HK Housing transaction data, evaluate it with a temporal split
against strong baselines, interpret it, and integrate batch predictions into the
serving layer for the dashboard.

This is not a "predict house price" notebook. It is a small, honest ML system:

- A documented modeling table built from the existing SQLite DB.
- A time-based split with no future leakage.
- Baselines that are hard to beat.
- Out-of-time metrics by district, price band, and year.
- SHAP-based interpretation.
- Batch inference into an analytics mart.
- A model card and a dashboard view.
- Tests that catch leakage and schema drift.

## 2. Why this task

The dataset has 1.07M transactions, rich unit/building/estate attributes, and a
realistic location hierarchy. Price per net sq ft is the natural target because:

- It normalizes away unit size, making comparisons across estates meaningful.
- It is the metric buyers and analysts actually use.
- It supports interpretable features (area, age, floor, district, MTR, school
  net, facilities).
- It fits the existing static dashboard: predictions can be batch-scored and
  exported, with no live API.

Do **not** build a generic "property price predictor" with a random split and an
R² headline. That is the cliché this workplan is designed to avoid.

## 3. Verified data facts (2026-11-09)

Source: `data/agency/agency_data.db` (not committed).

| Fact | Value |
|---|---:|
| Transactions | 1,071,268 |
| Transactions joining unit → building → estate → district | 1,071,268 |
| Transactions with `price > 0` and `net_area > 0` | 1,056,973 |
| Units | 1,229,204 |
| Units with `net_area <= 0` or null | 302,139 (302,085 `<= 0` + 54 null) |
| Units with null `bedroom` | 591,313 (48%) |
| Estates with null `first_op_date` | 892 (417 with transactions) |
| Estates with null coordinates | 632 |
| Estates with MTR line data | 798 |
| Estates with school net data | 9,219 |
| Estates with facility data | 1,089 |
| Units with feature rows | 338,394 |
| Units with more than one transaction | 351,373 |
| Transaction date range | 1996-01 to 2025-10 |
| Price per net sq ft, median | ~8,020 HKD |
| Price per net sq ft, p1 / p99 | ~1,868 / ~30,597 |
| Price per net sq ft, max | ~1,890,482 (outlier) |

Non-numeric floor values exist: `G`, `UG`, `LG`, `PH`, `WB`, `-`, empty, etc.
Handle them explicitly rather than coercing them silently to null.

## 4. Target and scope

### Target

```text
target = price / net_area          # HKD per net square foot
```

Use `net_area > 0` and `price > 0` only.

### Scope

- Single-row, transaction-level regression.
- Sale transactions only. The current `transactions` table has no transaction-type
  column; treat it as sale transactions. Do not mix in rental aggregates from
  `estate_monthly_market_info`.
- No multi-turn, no causal claims, no price forecasting.
- No deep learning. Use gradient-boosted trees.

### Out of scope

- Rent prediction (unit-level rent data is not available).
- Time-series forecasting of market indices.
- Recommendation systems.
- Causal inference ("MTR adds X% to price").
- A production valuation or appraisal product.

## 5. Dataset construction

### Grain

One row per transaction (`tx_id`). Each row carries unit, building, estate,
district, and time features known at or before the transaction date.

### Filters

Apply and document:

1. `price > 0`
2. `net_area > 0`
3. `tx_date` within the modeling window (recommend 2010-01-01 onward).
4. Target outliers: keep `target` within a documented domain range. Recommended:
   `[1_000, 50_000]` HKD/net sq ft. This keeps ~99.9% of rows and removes data
   errors like the 1.89M value. Also report how many rows were removed.
5. Drop rows with a null district or estate join (currently none, but assert it).

Do not filter on the target using statistics computed from the test period. If
using percentile clipping, compute thresholds on the training period only and
apply them to validation/test.

### Split strategy

Use a **time-based split**, not a random split:

| Split | Period | Purpose |
|---|---|---|
| Train | 2010-01-01 to 2022-12-31 | Fit model and baselines |
| Validation | 2023-01-01 to 2024-12-31 | Early stopping and model selection |
| Test | 2025-01-01 onward | Final out-of-time evaluation |

If the 2025 test set is too small for a slice, extend it to the last 12 months
and document the change. Do not tune on the test set.

For cross-validation inside the training period, use **rolling-origin** folds or
`GroupKFold` grouped by `building_id` (or `estate_id`) to reduce leakage from
repeated transactions in the same building.

### Leakage rules

Never use these as features:

- `price` (target numerator)
- `net_ft_price` (target)
- `last_tx_date`, `gain` (future/transaction outcome information)
- `tx_id`, `unit_id`, `building_id` as raw identifiers
- Any feature computed from the full dataset that includes the target period
- Estate-level target statistics computed over all years and attached to earlier
  rows

If you add a prior-transaction feature or an estate-level target encoding, it
must be **as-of** the transaction date and computed only from earlier data.
Treat that as a v2 enhancement, not v1.

## 6. Features

### Numeric

- `net_area`
- `area`
- `efficiency = net_area / area` (guard `area > 0`; missing otherwise)
- `building_age_years = max(0, (tx_date - first_op_date).days / 365.25)`
- `floor_num` (parsed; see mapping below)
- `bedroom` (with `bedroom_missing` flag)
- `sitting_room` (with `sitting_room_missing` flag)
- `tx_year`, `tx_month`, `tx_quarter`
- `months_since_2010` (linear time trend)

### Categorical

- `region_id`
- `subregion_id`
- `district_id`
- `estate_id` (high cardinality; document the risk and use group-aware CV)
- `phase_id` or `has_phase`
- `floor_raw` (optional; only if the model handles categoricals natively)

### Binary / count features

- `has_mtr`, `mtr_line_count`
- `has_school_net`, `school_net_count`
- `has_facilities`, `facility_count`
- `has_balcony`, `has_utility_platform`, `has_carpark`, `has_roof`,
  `has_garden`, `has_duplex`
- `has_unit_features`
- `has_first_op_date` (missing indicator)
- `has_coordinates` (optional; do not use lat/lon directly in v1)

### Floor mapping

Parse numeric floors as numbers. Map common special values explicitly:

| Raw | Value |
|---|---:|
| `G` | 0 |
| `UG` | 0.5 |
| `LG`, `LG1`, `LG2` | -1, -2, ... |
| `PH`, `PENTHOUSE` | top-floor sentinel (e.g., 99) |
| `-`, empty, unknown | null + `floor_missing = 1` |

Keep the raw floor as a categorical feature if using LightGBM. Do not silently
drop special floors.

### Excluded columns

`price`, `net_ft_price`, `last_tx_date`, `gain`, `tx_id`, `unit_id`,
`building_id`, `address_zh`, `address_en`, raw names, and any target-derived
aggregate.

## 7. Baselines

Every model must beat these, or the result is not interesting:

1. Global median `target` from the training period.
2. District median `target` from the training period.
3. Estate median `target` from the training period, with a district-median
   fallback for unseen estates.
4. Linear regression on a small numeric feature set (optional but useful).

Report baseline metrics on the same test rows as the model. The estate-median
baseline is the one that matters.

## 8. Model

Start simple; do not tune for weeks.

1. **LightGBM regressor** with native categorical support.
2. Target transform: `log1p(target)` is recommended for skew; convert predictions
   back to HKD/net sq ft before computing metrics. If using log target, still
   report metrics in original units.
3. Objective: `regression_l1` (MAE) or Huber; metric `mae`.
4. Early stopping on the validation period.
5. Small, documented hyperparameter search:
   - `learning_rate` in `[0.03, 0.05, 0.1]`
   - `num_leaves` in `[31, 63, 127]`
   - `min_data_in_leaf` in `[50, 100, 200]`
   - `feature_fraction` in `[0.7, 0.9]`
   - `bagging_fraction` in `[0.7, 0.9]`
   Do not add Optuna in v1 unless the search is already scripted and fast.
6. Fixed random seed. Save the feature list with the model.
7. Save `model.joblib`, `metrics.json`, `feature_importance.csv`, and the
   training configuration.

Optional v1.1: quantile models (`alpha=0.1`, `alpha=0.9`) for a prediction
interval, or conformal prediction on the validation set. Do not make this a
blocker.

## 9. Evaluation

### Primary metric

- **MAPE** on price per net sq ft, out-of-time (2025 test).

### Secondary metrics

- MAE
- Median absolute percentage error (MdAPE)
- R² (report, but do not headline it)

### Slices

Report metrics by:

- district (top 10 by transaction count)
- price band (e.g., <5k, 5–10k, 10–20k, >20k HKD/net sq ft)
- transaction year (2023, 2024, 2025)
- building age band
- net area band

### Required comparisons

| Model | MAPE | MAE | MdAPE |
|---|---:|---:|---:|
| Global median | | | |
| District median | | | |
| Estate median | | | |
| Linear regression | | | |
| LightGBM | | | |

### Interpretation

- Global SHAP summary (beeswarm or bar).
- One or two example waterfall plots for specific estates.
- Partial dependence for `net_area`, `building_age_years`, and `floor_num`.
- Feature importance table.

### Honesty rules

- Do not claim causality from SHAP. Say "associated with" or "the model uses".
- Report if the model fails to beat the estate-median baseline.
- Report data limitations: scraped source, missing fields, nominal prices, no
  inflation adjustment, market regime shift.
- Do not report only R².

## 10. Integration

### Artifacts

```text
artifacts/ml/{model_version}/
  model.joblib
  feature_list.json
  metrics.json
  feature_importance.csv
  shap_summary.png
  config.json
```

Gitignore `artifacts/`. Commit the metrics JSON and model card.

### Batch inference mart

Add `mart_valuation` (or `mart_estate_valuation`) to the analytics layer:

- `estate_id`
- `as_of_date` (latest transaction or market date)
- `predicted_net_ft_price`
- `prediction_low`, `prediction_high` (optional)
- `model_version`
- `sample_n` (number of scored units)
- `mape_12m` or `model_error_band` (from evaluation)

For the dashboard, aggregate unit-level predictions to an estate-level estimate
(e.g., median prediction for a reference unit profile or the latest transactions).
Document the aggregation.

### Serving export

Export a small `estate_valuation.json` and `model_metrics.json` to the serving
snapshot. The static dashboard shows:

- model estimate vs latest transaction per selected estate
- model error by district
- a short model card summary
- a clear “model estimate, not a professional valuation” disclaimer

No live API is required.

## 11. Phases

### Phase 0 — Data audit and baseline numbers (1 day)

Tasks:

1. Build a read-only audit script that reports the facts in section 3:
   row counts, null rates, target quantiles, join coverage, transactions per unit.
2. Save the output to `docs/ml-data-audit.md`.
3. Confirm the split periods and row counts per split.

Acceptance:

- Audit document exists and matches the actual DB.
- No data or DB file is modified.

### Phase 1 — Dataset builder (1–2 days)

Tasks:

1. Add `src/ml/build_dataset.py`.
2. Build a modeling table with the grain and features in sections 5–6.
3. Write `data/ml/modeling_table.parquet` (gitignored).
4. Add a `--sample` option for local development (e.g., 100k rows).
5. Add tests:
   - forbidden columns are absent,
   - rows with `price <= 0` or `net_area <= 0` are excluded,
   - split boundaries are correct,
   - target is finite and within the documented range,
   - categorical and missing indicators are populated.
6. Log row counts per split and per filter step.

Acceptance:

- The builder is deterministic and documented.
- `docs/ml-data-audit.md` includes the final row counts.
- Leakage tests pass.

### Phase 2 — Baselines (0.5–1 day)

Tasks:

1. Add `src/ml/baselines.py`.
2. Implement global, district, and estate median baselines using training-period
   statistics only.
3. Implement a small linear regression baseline.
4. Evaluate all baselines on validation and test.
5. Write `artifacts/ml/baselines/metrics.json`.

Acceptance:

- Baseline metrics exist for validation and test.
- Estate median is the strongest baseline or the result is documented.

### Phase 3 — Model training (1–2 days)

Tasks:

1. Add `src/ml/train.py`.
2. Train LightGBM with the split and features above.
3. Use early stopping on validation.
4. Run the small hyperparameter search; keep the best validation configuration.
5. Save the model, feature list, config, and metrics.
6. Add a `--fast` mode (small trees/rows) for smoke tests.

Acceptance:

- Model trains end-to-end from the parquet table.
- Model beats the estate-median baseline on validation MAPE, or the result is
  documented honestly.
- Artifacts are reproducible with a fixed seed.

### Phase 4 — Evaluation and interpretation (1 day)

Tasks:

1. Add `src/ml/evaluate.py`.
2. Compute MAPE, MAE, MdAPE, R² for validation and test.
3. Compute per-district, per-price-band, per-year, per-age-band, per-area-band
   slices.
4. Compare against all baselines.
5. Generate SHAP summary and feature importance.
6. Write `docs/model-card.md` with metrics and limitations.

Acceptance:

- Metrics table is complete for test.
- SHAP output exists.
- Model card states intended use, limitations, and non-causal caveats.

### Phase 5 — Batch inference and mart (1 day)

Tasks:

1. Add `src/ml/predict.py`.
2. Score the latest transaction per unit (or a documented reference set).
3. Aggregate to an estate-level estimate.
4. Write `mart_valuation` to SQLite.
5. Add indexes on `estate_id`, `as_of_date`.
6. Add tests for prediction range, missing-feature handling, and mart row counts.

Acceptance:

- `mart_valuation` has one row per estate (or documented grain).
- Predictions are finite and within a sane range.
- No test-period target values are used as features.

### Phase 6 — Serving and dashboard (0.5–1 day)

Tasks:

1. Export `estate_valuation.json` and `model_metrics.json` in the serving
   snapshot.
2. Update the manifest with file entries and model version.
3. Add a dashboard view:
   - estate estimate vs latest transaction,
   - model error by district,
   - model card summary and disclaimer.
4. If the dashboard is build-time static, include the metrics in the build.
   No live API.

Acceptance:

- Serving snapshot contains the valuation files.
- Dashboard displays estimates and error bands.
- The disclaimer is visible.

### Phase 7 — Tests, CI, docs (1 day)

Tasks:

1. Add `requirements-ml.txt` with `scikit-learn`, `lightgbm`, `shap`, `joblib`,
   `pyarrow`, and `matplotlib` (optional).
2. Add tests:
   - dataset schema and leakage,
   - baseline correctness on synthetic data,
   - training smoke test on a tiny fixture,
   - prediction range,
   - mart and serving export.
3. CI installs the ML requirements and runs the fast tests. Do not train on 1M
   rows in CI.
4. Update README with a short “Model” section and a metrics table.
5. Add `docs/ml.md` with run instructions.

Acceptance:

- `pytest` passes with and without the ML extras (skip ML tests if LightGBM is
  absent).
- CI is green.
- README links to the model card and metrics.

## 12. Definition of done

- A documented modeling table exists and is reproducible.
- Temporal split and leakage checks are enforced by tests.
- Baselines and the LightGBM model are evaluated on the 2025 test set.
- The model beats the estate-median baseline by a meaningful margin, or the
  negative result is documented.
- Metrics are reported by district, price band, and year.
- SHAP and feature importance are produced.
- `mart_valuation` and serving files exist.
- The dashboard shows model estimates, error, and a disclaimer.
- Model card, README, and run instructions are complete.
- No data, secrets, or large model binaries are committed.

## 13. What not to do

- Do not use a random train/test split.
- Do not use `net_ft_price`, `price`, `last_tx_date`, or `gain` as features.
- Do not compute target encodings over the full dataset.
- Do not report R² alone.
- Do not claim causality from SHAP.
- Do not claim the model is a professional valuation.
- Do not train on 1M rows in CI.
- Do not add a live prediction API in this workplan; batch inference is enough.
- Do not let this delay the dashboard or `owl-online`.

## 14. First action

Start with Phase 0. Produce `docs/ml-data-audit.md` and report:

- row counts per split,
- target quantiles after filtering,
- null rates for the features in section 6,
- any surprises that would change the feature list or split.

Do not write model code until the audit is reviewed.
