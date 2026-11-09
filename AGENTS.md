# Agent Rules — HK_Housing_Datahub

This file is the project-level contract for agents working in this repository.
It is intentionally short. The phase-level details live in
`docs/workplan-tidy.md`.

## Project context

- Python 3.12 ETL project for Hong Kong housing data.
- Entry point: `src/main.py`.
- Main packages: `src/crawlers/`, `src/processors/`, `src/models/`,
  `src/orchestrators/`, `src/config/`.
- Existing local data lives under `data/` and is **never committed**.
- SQL schema: `src/models/agency/sql_db.py`; diagram: `docs/db.dbml`.
- Reference API payloads: `docs/api_responses/`.
- Current scope: `docs/workplan-tidy.md` only. The ML workplan
  (`docs/workplan-ml.md`) is deferred and must not be started without an
  explicit request.

## Working rules

1. **One phase per branch and PR.**
   - Branch from `dev`: `chore/tidy-phase-<N>-<slug>`.
   - PR base is always `dev`, never `main`.
   - Never push directly to `main`. Never merge a PR. A human merges after
     manual approval.
2. **Create or reuse a GitHub issue for the phase before coding.** The issue
   must state the phase, scope, acceptance criteria, and the workplan section
   it implements. Reference the issue in the PR body.
3. **Do not run the full crawl.** Use `docs/api_responses/` fixtures and the
   existing `data/agency/agency_data.db` read-only. If a write is required,
   copy the DB to a temp path first.
4. **Never commit** `data/`, `*.db`, `.env`, `logs/`, `venv/`, `.DS_Store`,
   Chroma stores, or any secret. Respect `.gitignore`.
5. **Keep existing interfaces working** unless the phase explicitly changes
   them: `src/main.py`, config keys, model/table names, orchestrator method
   names.
6. **No new heavy infrastructure** (Kafka, Spark, Airflow, a full dbt project).
   Prefer the standard library, existing SQLAlchemy/pandas/pydantic/boto3.
7. **Tests must be offline.** No network, no cloud credentials, no writes to
   the real DB. If a module currently prevents that, fix the module rather than
   patching the environment into it.
8. **Update documentation in the same PR** when behavior, commands, schema, or
   limitations change.
9. **Commit style:** Conventional Commits, e.g.
   `feat: add idempotent agency upserts`, `docs: add baseline stats`.
   Keep commits reviewable; split changes larger than roughly 300 lines of
   production code.
10. **Stop and report after each phase.** Do not start the next phase until the
    current PR is approved and merged (or the human explicitly says to
    continue).

## Required pre-PR review

Before opening a PR, launch the `reviewer` subagent with:

- the issue number and title,
- the branch name and base commit,
- the commit SHA(s) to review,
- the phase acceptance criteria.

The reviewer runs the checks and returns exactly one verdict:

- `VERDICT: APPROVE` — allowed to open the PR.
- `VERDICT: REQUEST_CHANGES` — fix the findings, commit, and re-run the
  reviewer. Do not open the PR with unresolved findings.

Paste a short summary of the reviewer verdict into the PR body and add it as a
PR comment.

## Checks

Run the checks that exist for the current phase. The target end state is:

```bash
source venv/bin/activate
pytest -q
ruff check src tests
```

Until `tests/` and CI exist, at minimum run the phase-specific commands listed
in the workplan and record them in the PR.

## Phase 0 baseline

See `docs/baseline-stats.md` for the verified database counts, date ranges,
coverage, and the current `src/main.py` toggle state. Treat that file as the
reference snapshot for all later phases.
