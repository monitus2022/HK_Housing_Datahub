.PHONY: test quality quality-strict lint marts

# `make publish-dry` is added in Phase 6 with scripts/publish_dashboard.py.

test:
	pytest -q

quality:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none

quality-strict:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

marts:
	python scripts/build_marts.py --db data/agency/agency_data.db

lint:
	ruff check \
		src/main.py \
		src/analytics \
		src/quality \
		src/processors/agency \
		src/models/agency/sql_db.py \
		src/orchestrators \
		scripts \
		tests
