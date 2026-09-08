from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException

FILE_REMOVED_MESSAGE = "系统升级，相关文件请重新上传"


def api_error_detail(
    message: str,
    *,
    error_code: str,
    retryable: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "message": message,
        "error_code": error_code,
        "retryable": retryable,
    }
    if extra:
        payload.update(extra)
    return payload


def raise_api_error(
    status_code: int,
    message: str,
    *,
    error_code: str,
    retryable: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail=api_error_detail(
            message,
            error_code=error_code,
            retryable=retryable,
            extra=extra,
        ),
    )


def raise_file_removed(error_code: str = "FILE_REMOVED") -> None:
    raise_api_error(
        410,
        FILE_REMOVED_MESSAGE,
        error_code=error_code,
        retryable=False,
    )


def is_unique_violation(exc: Exception) -> bool:
    code = getattr(exc, "code", None) or getattr(exc, "sqlstate", None)
    if code == "23505":
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, str) and "23505" in details:
        return True
    msg = str(exc).lower()
    return "duplicate key value" in msg or "unique constraint" in msg or "23505" in msg
