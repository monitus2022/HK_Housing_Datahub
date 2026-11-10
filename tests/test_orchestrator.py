"""Multi-partition orchestration tests with fake processors.

These tests avoid the network-touching crawler constructors by building an
`AgencyOrchestrator` instance without calling its `__init__` and injecting fake
processors and stage methods.
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace

import pytest

from orchestrators.agency import AgencyOrchestrator


class FakeProcessor:
    def __init__(self, estate_ids=None, building_ids=None):
        self.caches = {
            "estate_ids_cache": list(estate_ids or []),
            "building_ids_cache": list(building_ids or []),
        }
        self.started = []
        self.finished = []
        self.closed = 0

    def start_pipeline_run(self, run_id, mode="full"):
        self.started.append((run_id, mode))

    def finish_pipeline_run(
        self, run_id, status="success", record_counts=None, error_message=None
    ):
        self.finished.append(
            {
                "run_id": run_id,
                "status": status,
                "record_counts": record_counts,
                "error_message": error_message,
            }
        )

    def table_counts(self):
        return {"estates": len(self.caches["estate_ids_cache"])}

    def close_session(self):
        self.closed += 1


def build_orchestrator():
    orchestrator = object.__new__(AgencyOrchestrator)
    orchestrator.debug_mode = False
    orchestrator.allow_cleanup_db = False
    orchestrator.partition_size = 2
    orchestrator.estates_processor = FakeProcessor(
        estate_ids=[f"E{i}" for i in range(5)],
        building_ids=[f"B{i}" for i in range(4)],
    )
    orchestrator.buildings_processor = FakeProcessor()

    calls = []
    orchestrator._estate_ids = lambda: None
    orchestrator._estate_infos = lambda estate_ids: calls.append(
        ("estates", tuple(estate_ids))
    )
    orchestrator._estate_monthly_market_infos = lambda estate_ids: calls.append(
        ("market", tuple(estate_ids))
    )
    orchestrator._buildings = lambda building_ids: calls.append(
        ("buildings", tuple(building_ids))
    )
    return orchestrator, calls


def test_multi_partition_pipeline_closes_sessions_once():
    orchestrator, calls = build_orchestrator()

    orchestrator.run_estates_info_data_pipeline()

    assert calls == [
        ("estates", ("E0", "E1")),
        ("market", ("E0", "E1")),
        ("estates", ("E2", "E3")),
        ("market", ("E2", "E3")),
        ("estates", ("E4",)),
        ("market", ("E4",)),
        ("buildings", ("B0", "B1")),
        ("buildings", ("B2", "B3")),
    ]
    assert orchestrator.estates_processor.started[0][1] == "full"
    assert len(orchestrator.estates_processor.started) == 1
    assert orchestrator.estates_processor.finished[0]["status"] == "success"
    assert orchestrator.estates_processor.finished[0]["record_counts"] == {
        "estates": 5
    }
    assert orchestrator.estates_processor.closed == 1
    assert orchestrator.buildings_processor.closed == 1


def test_debug_mode_is_recorded():
    orchestrator, _ = build_orchestrator()
    orchestrator.debug_mode = True

    orchestrator.run_estates_info_data_pipeline()

    assert orchestrator.estates_processor.started[0][1] == "debug"


def test_pipeline_failure_finalizes_run_and_closes_sessions_once(caplog):
    orchestrator, _ = build_orchestrator()

    def fail(estate_ids):
        orchestrator._current_item = "E0"
        raise RuntimeError("boom")

    orchestrator._estate_infos = fail

    with caplog.at_level(logging.ERROR), pytest.raises(
        RuntimeError, match="boom"
    ):
        orchestrator.run_estates_info_data_pipeline()

    assert "stage=estate info" in caplog.text
    assert "item=E0" in caplog.text
    assert orchestrator.estates_processor.finished[0]["status"] == "failed"
    assert orchestrator.estates_processor.finished[0]["error_message"] == "boom"
    assert orchestrator.estates_processor.closed == 1
    assert orchestrator.buildings_processor.closed == 1


def test_buildings_tracks_the_nested_building_id():
    orchestrator = object.__new__(AgencyOrchestrator)
    orchestrator._current_item = None

    class Crawler:
        def fetch_buildings_by_building_ids(self, building_ids):
            return [
                SimpleNamespace(building=SimpleNamespace(id="B9")),
                SimpleNamespace(building=SimpleNamespace(id="B10")),
            ]

    class Processor:
        zh_table_configs = {}
        table_configs = {}

        def map_building_info_response_to_table_dicts(self, building_info_response):
            pass

        def upsert_cache_into_db_tables(self, config_maps):
            pass

        def clear_data_caches(self, cache_excluded=None):
            pass

    orchestrator.buildings_crawler = Crawler()
    orchestrator.buildings_processor = Processor()

    orchestrator._buildings(["B9", "B10"])

    assert orchestrator._current_item == "B10"


def test_market_stage_tracks_each_estate():
    orchestrator = object.__new__(AgencyOrchestrator)
    orchestrator._current_item = None

    class Crawler:
        def fetch_estate_monthly_market_info_by_estate_ids(self, estate_id):
            return []

    class Processor:
        zh_table_configs = {}
        table_configs = {}

        def upsert_cache_into_db_tables(self, config_maps):
            pass

        def clear_data_caches(self, cache_excluded=None):
            pass

    orchestrator.estates_crawler = Crawler()
    orchestrator.estates_processor = Processor()

    orchestrator._estate_monthly_market_infos(["E7"])

    assert orchestrator._current_item == "E7"


def test_pipeline_writes_progress_status(tmp_path):
    orchestrator, _ = build_orchestrator()
    orchestrator.estates_processor.agency_data_storage_path = tmp_path

    orchestrator.run_estates_info_data_pipeline()

    payload = json.loads(
        (tmp_path / "pipeline_status.json").read_text(encoding="utf-8")
    )
    assert payload["status"] == "success"
    assert payload["run_id"] == orchestrator.run_id
    assert payload["stage"] == "buildings"
    assert payload["items_total"] == 4
