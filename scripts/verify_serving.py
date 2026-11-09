#!/usr/bin/env python3
"""Verify a serving snapshot from the repository root."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from serving.verify import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
