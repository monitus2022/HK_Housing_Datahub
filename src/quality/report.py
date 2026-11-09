"""Write JSON and Markdown quality reports."""

from __future__ import annotations

import json
import re
from pathlib import Path

from .checks import QualityReport


def _safe_run_id(run_id: str) -> str:
    """Keep a run ID usable as a filename without allowing path traversal."""
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", run_id).strip("._")
    return safe or "run"


def write_reports(
    report: QualityReport, output_dir: Path | str
) -> dict[str, Path]:
    """Write latest.json, {run_id}.json, and latest.md."""
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)

    payload = report.to_dict()
    latest_json = directory / "latest.json"
    run_json = directory / f"{_safe_run_id(report.run_id)}.json"
    latest_md = directory / "latest.md"

    serialized = json.dumps(payload, indent=2, ensure_ascii=False)
    latest_json.write_text(serialized + "\n", encoding="utf-8")
    run_json.write_text(serialized + "\n", encoding="utf-8")
    latest_md.write_text(_render_markdown(report), encoding="utf-8")

    return {
        "latest_json": latest_json,
        "run_json": run_json,
        "latest_md": latest_md,
    }


def _render_markdown(report: QualityReport) -> str:
    lines = [
        "# Data Quality Report",
        "",
        f"- **Run ID:** `{report.run_id}`",
        f"- **Generated:** {report.generated_at}",
        f"- **Database:** `{report.database}`",
        f"- **Status:** `{report.status.upper()}`",
        f"- **Critical failures:** {len(report.critical_failures)}",
        f"- **Warning failures:** {len(report.warning_failures)}",
        "",
        "## Checks",
        "",
        "| Check | Severity | Result | Message |",
        "|---|---|---|---|",
    ]
    for check in report.checks:
        result = "PASS" if check.passed else "FAIL"
        message = check.message.replace("|", "\\|")
        lines.append(
            f"| `{check.name}` | {check.severity} | {result} | {message} |"
        )

    failed = [check for check in report.checks if not check.passed]
    if failed:
        lines.extend(["", "## Failed-check details", ""])
        for check in failed:
            lines.append(f"### `{check.name}`")
            lines.append("")
            lines.append("```json")
            lines.append(
                json.dumps(check.details, indent=2, ensure_ascii=False)
            )
            lines.append("```")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"
