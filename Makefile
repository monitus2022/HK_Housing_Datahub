.PHONY: test quality quality-strict lint marts publish-dry

test:
	pytest -q

quality:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none

quality-strict:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

marts:
	python scripts/build_marts.py --db data/agency/agency_data.db

publish-dry:
	python scripts/publish_dashboard.py --db data/agency/agency_data.db --dry-run

lint:
	ruff check \
		src/main.py \
		src/analytics \
		src/quality \
		src/serving \
		src/processors/agency \
		src/models/agency/sql_db.py \
		src/orchestrators \
		scripts \
		tests
