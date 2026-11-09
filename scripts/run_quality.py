#!/usr/bin/env python3
"""Run the quality checks from the repository root."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from quality.run import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
