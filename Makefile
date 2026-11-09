.PHONY: test quality quality-strict lint

test:
	pytest -q

quality:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none

quality-strict:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

lint:
	ruff check \
		src/main.py \
		src/quality \
		src/processors/agency \
		src/models/agency/sql_db.py \
		src/orchestrators \
		scripts \
		tests
