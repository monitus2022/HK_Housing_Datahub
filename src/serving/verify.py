"""Verify a local serving snapshot against its manifest."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Optional

from logger import housing_logger

REQUIRED_MANIFEST_KEYS = [
    "schema_version",
    "build_id",
    "generated_at",
    "data_through",
    "coverage",
    "row_counts",
    "files",
    "source",
]


def verify_snapshot(snapshot_dir: Path | str) -> list[str]:
    """Return a list of problems; an empty list means the snapshot is valid."""
    directory = Path(snapshot_dir)
    errors: list[str] = []
    if not directory.is_dir():
        return [f"Snapshot directory not found: {directory}"]

    manifest_path = directory / "manifest.json"
    if not manifest_path.exists():
        return [f"Manifest not found: {manifest_path}"]

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [f"Manifest is not valid JSON: {exc}"]

    if not isinstance(manifest, dict):
        return ["Manifest root must be a JSON object."]

    for key in REQUIRED_MANIFEST_KEYS:
        if key not in manifest:
            errors.append(f"Manifest missing key: {key}")

    build_id = manifest.get("build_id")
    if build_id and build_id != directory.name:
        errors.append(
            f"Manifest build_id {build_id!r} does not match directory "
            f"{directory.name!r}."
        )

    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        errors.append("Manifest files must be a non-empty object.")
        return errors

    for logical_name, relative_path in files.items():
        if not isinstance(relative_path, str):
            errors.append(f"File path for {logical_name!r} is not a string.")
            continue
        path = Path(relative_path)
        if path.is_absolute() or ".." in path.parts:
            errors.append(
                f"File path for {logical_name!r} is not a safe relative path: "
                f"{relative_path!r}"
            )
            continue
        target = directory / path
        if not target.exists():
            errors.append(f"Missing file for {logical_name!r}: {relative_path}")
            continue
        if target.stat().st_size == 0:
            errors.append(f"Empty file for {logical_name!r}: {relative_path}")
            continue
        if target.suffix == ".json":
            try:
                json.loads(target.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                errors.append(
                    f"File for {logical_name!r} is not valid JSON: {exc}"
                )
        elif target.name.endswith(".json.gz"):
            try:
                with gzip.open(target, "rt", encoding="utf-8") as handle:
                    json.load(handle)
            except (OSError, ValueError) as exc:
                errors.append(
                    f"File for {logical_name!r} is not valid gzipped JSON: {exc}"
                )

    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify a serving snapshot.")
    parser.add_argument(
        "--snapshot-dir",
        required=True,
        help="Directory containing manifest.json and the referenced files.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    errors = verify_snapshot(args.snapshot_dir)
    if errors:
        for error in errors:
            housing_logger.error(error)
        return 1
    housing_logger.info(f"Snapshot verified: {args.snapshot_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
