from __future__ import annotations

import pytest

from core.domains.automation.model import (
    can_transition_run_status,
    make_provider_event_dedupe_key,
    validate_run_status_transition,
)


def test_make_provider_event_dedupe_key_stable_for_json_order() -> None:
    payload_a = {"b": 2, "a": {"x": 1, "y": [3, 4]}}
    payload_b = {"a": {"y": [3, 4], "x": 1}, "b": 2}

    key_a = make_provider_event_dedupe_key(
        provider="composio",
        external_event_id=None,
        event_type="slack.message",
        payload=payload_a,
        signature_timestamp="1730000000",
    )
    key_b = make_provider_event_dedupe_key(
        provider="composio",
        external_event_id=None,
        event_type="slack.message",
        payload=payload_b,
        signature_timestamp="1730000000",
    )

    assert key_a == key_b


def test_make_provider_event_dedupe_key_prefers_external_event_id() -> None:
    key_a = make_provider_event_dedupe_key(
        provider="composio",
        external_event_id="evt_1",
        event_type="calendar.created",
        payload={"x": 1},
    )
    key_b = make_provider_event_dedupe_key(
        provider="composio",
        external_event_id="evt_1",
        event_type="calendar.created",
        payload={"x": 2},
    )

    assert key_a == key_b


def test_run_status_transition_guard() -> None:
    assert can_transition_run_status("queued", "running") is True
    assert can_transition_run_status("completed", "running") is False

    validate_run_status_transition("queued", "running")

    with pytest.raises(ValueError):
        validate_run_status_transition("completed", "running")
