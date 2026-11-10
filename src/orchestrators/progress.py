"""Progress lines and a machine-readable status file for long pipelines.

The agency pipeline runs for roughly an hour, so operators need a heartbeat
without tailing a wall of DEBUG output. ``ProgressReporter`` writes one INFO
line per partition and updates an atomically replaced JSON status file that
external watchers can read.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Protocol


class InfoLogger(Protocol):
    def info(self, message: str) -> None: ...

    def warning(self, message: str) -> None: ...


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def format_duration(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def estimate_eta(
    elapsed_seconds: float, items_done: int, items_total: int
) -> Optional[float]:
    """Seconds remaining at the current rate, or None before the first item."""
    if items_total <= 0 or items_done <= 0:
        return None
    if items_done >= items_total:
        return 0.0
    return max(0.0, elapsed_seconds / items_done * (items_total - items_done))


def format_progress(
    *,
    stage: str,
    partition: int,
    partitions: int,
    items_done: int,
    items_total: int,
    elapsed_seconds: float,
    eta_seconds: Optional[float] = None,
) -> str:
    percent = (partition / partitions * 100) if partitions else 0.0
    parts = [
        f"{stage}: partition {partition}/{partitions} ({percent:.0f}%)",
        f"{items_done:,}/{items_total:,} items",
        f"elapsed {format_duration(elapsed_seconds)}",
    ]
    eta = eta_seconds
    if eta is not None:
        parts.append(f"ETA {format_duration(eta)}")
    return ", ".join(parts)


def write_status(path: Path | str, payload: dict[str, Any]) -> None:
    """Write JSON atomically so readers never see a partial file."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f"{target.name}.", suffix=".tmp", dir=target.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, 0o644)
        os.replace(temp_name, target)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


class ProgressReporter:
    """Log partition progress and mirror it into a JSON status file."""

    def __init__(
        self,
        *,
        run_id: str,
        mode: str,
        status_path: Path | str,
        logger: Optional[InfoLogger] = None,
    ):
        self.run_id = run_id
        self.mode = mode
        self.status_path = Path(status_path)
        self.logger = logger
        self._started_monotonic = time.monotonic()
        self._stage_started_monotonic = self._started_monotonic
        self._stage: Optional[str] = None
        self._started_at = _utc_now()
        self._payload: dict[str, Any] = {
            "run_id": run_id,
            "mode": mode,
            "status": "running",
            "stage": None,
            "partition": 0,
            "partitions": 0,
            "items_done": 0,
            "items_total": 0,
            "percent": 0.0,
            "started_at": self._started_at.isoformat(),
            "updated_at": self._started_at.isoformat(),
            "finished_at": None,
            "elapsed_seconds": 0.0,
            "stage_elapsed_seconds": 0.0,
            "eta_seconds": None,
            "error": None,
        }

    def start(self) -> None:
        self._safe_write()

    def begin_stage(self, stage: str) -> None:
        """Reset the stage clock and counters before a stage's first partition."""
        self._stage = stage
        self._stage_started_monotonic = time.monotonic()
        self._payload.update(
            {
                "stage": stage,
                "partition": 0,
                "partitions": 0,
                "items_done": 0,
                "items_total": 0,
                "percent": 0.0,
                "updated_at": _utc_now().isoformat(),
                "stage_elapsed_seconds": 0.0,
                "eta_seconds": None,
            }
        )
        self._safe_write()

    def update(
        self,
        *,
        stage: str,
        partition: int,
        partitions: int,
        items_done: int,
        items_total: int,
    ) -> None:
        stage_changed = stage != self._stage
        if stage_changed:
            self._stage = stage
            self._stage_started_monotonic = time.monotonic()

        now = time.monotonic()
        elapsed = now - self._started_monotonic
        stage_elapsed = now - self._stage_started_monotonic
        eta = (
            None
            if stage_changed
            else estimate_eta(stage_elapsed, items_done, items_total)
        )
        percent = (partition / partitions * 100) if partitions else 0.0
        self._payload.update(
            {
                "stage": stage,
                "partition": partition,
                "partitions": partitions,
                "items_done": items_done,
                "items_total": items_total,
                "percent": round(percent, 1),
                "updated_at": _utc_now().isoformat(),
                "elapsed_seconds": round(elapsed, 1),
                "stage_elapsed_seconds": round(stage_elapsed, 1),
                "eta_seconds": None if eta is None else round(eta, 1),
            }
        )
        self._safe_write()
        if self.logger is not None:
            self.logger.info(
                format_progress(
                    stage=stage,
                    partition=partition,
                    partitions=partitions,
                    items_done=items_done,
                    items_total=items_total,
                    elapsed_seconds=elapsed,
                    eta_seconds=eta,
                )
            )

    def finish(self, status: str, error: Optional[str] = None) -> None:
        elapsed = time.monotonic() - self._started_monotonic
        self._payload.update(
            {
                "status": status,
                "updated_at": _utc_now().isoformat(),
                "finished_at": _utc_now().isoformat(),
                "elapsed_seconds": round(elapsed, 1),
                "eta_seconds": (
                    0.0
                    if status == "success" and self._payload.get("partition")
                    else None
                ),
                "error": error,
            }
        )
        self._safe_write()

    def _safe_write(self) -> None:
        try:
            write_status(self.status_path, self._payload)
        except OSError as exc:
            # A heartbeat failure must not abort an hour-long crawl.
            if self.logger is not None:
                self.logger.warning(
                    f"Could not write pipeline status file "
                    f"{self.status_path}: {exc}"
                )
