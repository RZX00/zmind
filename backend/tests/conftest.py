from __future__ import annotations

import sys
from pathlib import Path

# Ensure `core` package is importable when running tests from any working dir.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

