.PHONY: test quality quality-strict lint marts geo geo-check gazetteer gazetteer-check nl-dataset publish-dry frontend-check

test:
	pytest -q

quality:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on none

quality-strict:
	python scripts/run_quality.py --db data/agency/agency_data.db --fail-on critical

marts:
	python scripts/build_marts.py --db data/agency/agency_data.db

geo:
	python scripts/build_geo.py

geo-check:
	python scripts/build_geo.py --check

gazetteer:
	python scripts/build_gazetteer.py

gazetteer-check:
	python scripts/build_gazetteer.py --check

nl-dataset:
	python scripts/build_nl_dataset.py --count 6000 --report --sample 50

publish-dry:
	python scripts/publish_dashboard.py --db data/agency/agency_data.db --dry-run

frontend-check:
	npm --prefix frontend ci
	npm --prefix frontend run typecheck
	npm --prefix frontend test
	npm --prefix frontend run build

lint:
	ruff check src tests scripts
