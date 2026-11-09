#!/usr/bin/env python3
"""Serve a local serving snapshot for frontend development.

Routes:
    GET /dashboard/manifest.json
    GET /dashboard/{build_id}/manifest.json
    GET /dashboard/{build_id}/{file}

The server adds permissive CORS and the correct gzip content encoding so the
Vite dev server can fetch the snapshot without R2.
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


def content_type_for(path: Path) -> str:
    if path.name.endswith(".json") or path.name.endswith(".json.gz"):
        return "application/json"
    return "application/octet-stream"


def resolve_snapshot_path(snapshot_dir: Path, relative: str) -> Path | None:
    """Resolve a requested snapshot file without escaping the snapshot root."""
    if not relative or relative.startswith(("/", "\\")):
        return None
    root = snapshot_dir.resolve()
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


class SnapshotHandler(BaseHTTPRequestHandler):
    snapshot_dir: Path
    build_id: str

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        request_path = urlparse(self.path).path
        if request_path in (
            "/dashboard/manifest.json",
            f"/dashboard/{self.build_id}/manifest.json",
        ):
            target = self.snapshot_dir / "manifest.json"
        elif request_path.startswith(f"/dashboard/{self.build_id}/"):
            relative = request_path[len(f"/dashboard/{self.build_id}/") :]
            target = resolve_snapshot_path(self.snapshot_dir, relative)
            if target is None:
                self._not_found()
                return
        else:
            self._not_found()
            return

        if not target.is_file():
            self._not_found()
            return

        payload = target.read_bytes()
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", content_type_for(target))
        if target.name.endswith(".gz"):
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _not_found(self) -> None:
        self.send_response(404)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Not found\n")

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[snapshot] {self.address_string()} - {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a local snapshot.")
    parser.add_argument("--snapshot-dir", required=True)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    snapshot_dir = Path(args.snapshot_dir).resolve()
    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    SnapshotHandler.snapshot_dir = snapshot_dir
    SnapshotHandler.build_id = manifest["build_id"]

    server = ThreadingHTTPServer((args.host, args.port), SnapshotHandler)
    print(
        f"Serving {snapshot_dir} at http://{args.host}:{args.port} "
        f"(build {SnapshotHandler.build_id})"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
