from core.application.services.degraded_state_service import DegradedStateService
from core.domains.agent.degraded_state import DegradedState


def test_degraded_state_service_dedupes_and_replaces_existing_flags() -> None:
    service = DegradedStateService()

    flags = service.append_flag(
        [],
        DegradedState(
            code="intent_low_confidence",
            component="resolve_intent",
            severity="warning",
            user_visible=False,
            message="first",
        ),
    )
    flags = service.append_flag(
        flags,
        {
            "code": "intent_low_confidence",
            "component": "resolve_intent",
            "severity": "error",
            "user_visible": True,
            "message": "updated",
            "metadata": {"confidence": 0.2},
        },
    )

    assert len(flags) == 1
    assert flags[0]["severity"] == "error"
    assert flags[0]["user_visible"] is True
    assert service.has_user_visible_flags(flags) is True
