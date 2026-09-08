from __future__ import annotations

from datetime import datetime, timezone

from core.infrastructure.projections.projection_worker import (
    _is_after_cursor,
    _is_unregistered_event_error,
)


def test_projection_cursor_requires_strictly_newer_timestamp_without_event_id() -> None:
    cursor_ts = datetime(2026, 2, 27, 0, 0, 0, tzinfo=timezone.utc)
    assert _is_after_cursor(cursor_ts, "evt-2", cursor_ts, None) is False
    assert (
        _is_after_cursor(
            datetime(2026, 2, 27, 0, 0, 1, tzinfo=timezone.utc),
            "evt-1",
            cursor_ts,
            None,
        )
        is True
    )


def test_projection_cursor_uses_event_id_tie_breaker() -> None:
    cursor_ts = datetime(2026, 2, 27, 0, 0, 0, tzinfo=timezone.utc)
    assert _is_after_cursor(cursor_ts, "evt-11", cursor_ts, "evt-10") is True
    assert _is_after_cursor(cursor_ts, "evt-09", cursor_ts, "evt-10") is False


def test_projection_unregistered_event_error_detection() -> None:
    assert _is_unregistered_event_error(ValueError("event_type not registered: AgentRunStarted")) is True
    assert _is_unregistered_event_error(ValueError("schema_version mismatch")) is False
