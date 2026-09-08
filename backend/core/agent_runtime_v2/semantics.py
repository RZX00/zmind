from __future__ import annotations

VALID_RESPONSE_MODES = frozenset({"auto", "preview", "confirm", "force_apply"})
DEFAULT_RESPONSE_MODE = "auto"

CONFIRMATION_TOKENS = frozenset(
    {
        "confirm",
        "yes",
        "apply",
        "go ahead",
        "continue",
        "ok",
        "okay",
        "确认",
        "继续",
        "执行",
        "应用",
        "开始",
        "好的",
    }
)


def normalize_response_mode(value: object) -> str:
    lowered = str(value or "").strip().lower()
    if lowered in VALID_RESPONSE_MODES:
        return lowered
    return DEFAULT_RESPONSE_MODE


def is_confirmation_message(value: object) -> bool:
    lowered = str(value or "").strip().lower()
    return lowered in CONFIRMATION_TOKENS
