.PHONY: test quality quality-strict lint marts publish-dry frontend-check

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

frontend-check:
	npm --prefix frontend ci
	npm --prefix frontend run typecheck
	npm --prefix frontend test
	npm --prefix frontend run build

lint:
	ruff check \
		src/main.py \
		src/logger.py \
		src/analytics \
		src/catalog \
		src/quality \
		src/serving \
		src/processors/agency \
		src/processors/rag \
		src/processors/rvd \
		src/models/agency/sql_db.py \
		src/models/agency/migrations.py \
		src/models/agency/outputs.py \
		src/models/rvd \
		src/orchestrators \
		scripts \
		tests
