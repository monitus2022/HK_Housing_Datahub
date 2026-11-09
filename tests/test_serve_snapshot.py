"""Tests for the local snapshot dev server path resolver."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parent.parent / "scripts" / "serve_snapshot.py"
)
SPEC = importlib.util.spec_from_file_location("serve_snapshot", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

resolve_snapshot_path = module.resolve_snapshot_path


def test_resolve_snapshot_path_accepts_files_inside_root(tmp_path):
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    (snapshot / "manifest.json").write_text("{}", encoding="utf-8")
    nested = snapshot / "data"
    nested.mkdir()
    (nested / "file.json").write_text("{}", encoding="utf-8")

    assert resolve_snapshot_path(snapshot, "manifest.json") == (
        snapshot / "manifest.json"
    ).resolve()
    assert resolve_snapshot_path(snapshot, "data/file.json") == (
        nested / "file.json"
    ).resolve()


def test_resolve_snapshot_path_rejects_traversal_and_absolute_paths(tmp_path):
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    (snapshot / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")

    for relative in [
        "../secret.txt",
        "data/../../secret.txt",
        "/etc/passwd",
        "//etc/passwd",
        "\\etc\\passwd",
        "",
        "missing.json",
    ]:
        assert resolve_snapshot_path(snapshot, relative) is None, relative
