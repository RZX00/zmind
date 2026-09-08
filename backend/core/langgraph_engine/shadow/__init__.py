"""
WS-E: QA & Shadow Infrastructure.

This package provides:
- Primary vs shadow comparators (explainable, traceable diffs)
- Rollback policies (hard gating thresholds)

Recording/replay entrypoints live in `backend/scripts/`.
"""

from .comparator import compare_legacy_streams
from .rollback_policy import RollbackDecision, RollbackPolicy, RollbackThresholds

__all__ = ["compare_legacy_streams", "RollbackDecision", "RollbackPolicy", "RollbackThresholds"]

