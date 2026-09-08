from __future__ import annotations

TERMINAL_STATUS_MAP = {
    "error": "failed",
    # Be permissive: some engines may emit a status_type-like terminal string.
    "run_completed": "completed",
    "run_failed": "failed",
    "run_error": "failed",
    "run_stopped": "stopped",
    "cancelled": "stopped",
}


def normalize_terminal_status(status: str) -> str:
    """
    Map engine-level terminal status into the legacy run status vocabulary.

    - "error" should be treated as "failed" (legacy workers publish ERROR control).
    - Other statuses are passed through unchanged.
    """

    return TERMINAL_STATUS_MAP.get(status, status)
