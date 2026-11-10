"""Offline tests for pipeline progress reporting."""

from __future__ import annotations

import json

from orchestrators.progress import (
    ProgressReporter,
    estimate_eta,
    format_duration,
    format_progress,
    write_status,
)


class StubLogger:
    def __init__(self) -> None:
        self.messages: list[str] = []
        self.warnings: list[str] = []

    def info(self, message: str) -> None:
        self.messages.append(message)

    def warning(self, message: str) -> None:
        self.warnings.append(message)


def read_status(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_format_duration():
    assert format_duration(9) == "9s"
    assert format_duration(65) == "1m 5s"
    assert format_duration(3660) == "1h 1m"


def test_estimate_eta():
    assert estimate_eta(0, 0, 10) is None
    assert estimate_eta(10, 0, 10) is None
    assert estimate_eta(10, 5, 10) == 10
    assert estimate_eta(10, 10, 10) == 0


def test_format_progress_includes_counts_and_eta():
    line = format_progress(
        stage="estate info",
        partition=2,
        partitions=4,
        items_done=200,
        items_total=400,
        elapsed_seconds=120,
        eta_seconds=120,
    )
    assert "estate info: partition 2/4 (50%)" in line
    assert "200/400 items" in line
    assert "elapsed 2m 0s" in line
    assert "ETA 2m 0s" in line


def test_write_status_writes_to_nested_directory_without_temp_files(tmp_path):
    target = tmp_path / "nested" / "pipeline_status.json"

    write_status(target, {"status": "running", "items_done": 1})

    assert read_status(target)["status"] == "running"
    assert [p.name for p in target.parent.iterdir()] == ["pipeline_status.json"]


def test_reporter_resets_eta_per_stage(tmp_path, monkeypatch):
    import orchestrators.progress as progress_module

    now = [0.0]
    monkeypatch.setattr(progress_module.time, "monotonic", lambda: now[0])
    status = tmp_path / "pipeline_status.json"
    reporter = ProgressReporter(
        run_id="run-stage", mode="full", status_path=status
    )
    reporter.start()

    now[0] = 100.0
    reporter.begin_stage("estate info")
    reporter.update(
        stage="estate info",
        partition=1,
        partitions=1,
        items_done=100,
        items_total=100,
    )
    assert read_status(status)["eta_seconds"] == 0.0

    # A new stage must not reuse the run-wide elapsed time for its ETA.
    now[0] = 200.0
    reporter.begin_stage("buildings")
    now[0] = 300.0
    reporter.update(
        stage="buildings",
        partition=1,
        partitions=10,
        items_done=100,
        items_total=1000,
    )
    first_buildings = read_status(status)
    assert first_buildings["stage_elapsed_seconds"] == 100.0
    assert first_buildings["elapsed_seconds"] == 300.0
    # 100 items in 100s -> 900s for the remaining 900 items. Using the
    # run-wide 300s would have produced 2700s.
    assert first_buildings["eta_seconds"] == 900.0


def test_implicit_stage_change_omits_eta(tmp_path, monkeypatch):
    import orchestrators.progress as progress_module

    now = [0.0]
    monkeypatch.setattr(progress_module.time, "monotonic", lambda: now[0])
    status = tmp_path / "pipeline_status.json"
    reporter = ProgressReporter(
        run_id="run-implicit", mode="full", status_path=status
    )
    reporter.start()

    now[0] = 100.0
    reporter.update(
        stage="buildings",
        partition=1,
        partitions=4,
        items_done=100,
        items_total=1000,
    )

    # Without begin_stage the clock resets at this update, so an ETA would be
    # meaningless. Omit it instead of printing 0s.
    assert read_status(status)["eta_seconds"] is None


def test_status_write_failure_does_not_raise(tmp_path, monkeypatch):
    import orchestrators.progress as progress_module

    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(progress_module, "write_status", fail)
    logger = StubLogger()
    reporter = ProgressReporter(
        run_id="run-fail-write",
        mode="full",
        status_path=tmp_path / "status.json",
        logger=logger,
    )

    reporter.start()
    reporter.update(
        stage="estate info",
        partition=1,
        partitions=1,
        items_done=1,
        items_total=1,
    )
    reporter.finish("failed", "boom")

    assert len(logger.warnings) == 3


def test_reporter_writes_status_and_logs_each_update(tmp_path):
    status = tmp_path / "pipeline_status.json"
    logger = StubLogger()
    reporter = ProgressReporter(
        run_id="run-1", mode="full", status_path=status, logger=logger
    )

    reporter.start()
    assert read_status(status)["status"] == "running"

    reporter.begin_stage("estate info")
    reporter.update(
        stage="estate info",
        partition=1,
        partitions=4,
        items_done=100,
        items_total=400,
    )
    payload = read_status(status)
    assert payload["stage"] == "estate info"
    assert payload["partition"] == 1
    assert payload["percent"] == 25.0
    assert payload["items_done"] == 100
    assert payload["eta_seconds"] is not None
    assert len(logger.messages) == 1
    assert "estate info" in logger.messages[0]

    reporter.finish("success")
    payload = read_status(status)
    assert payload["status"] == "success"
    assert payload["finished_at"] is not None
    assert payload["eta_seconds"] == 0.0


def test_reporter_records_failure_context(tmp_path):
    status = tmp_path / "pipeline_status.json"
    reporter = ProgressReporter(
        run_id="run-2", mode="full", status_path=status
    )

    reporter.finish("failed", "boom")

    payload = read_status(status)
    assert payload["status"] == "failed"
    assert payload["error"] == "boom"
    assert payload["eta_seconds"] is None
