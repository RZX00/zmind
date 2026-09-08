from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.runtime.files_api import (
    _normalize_runtime_relative_path,
    _runtime_storage_key,
    _runtime_storage_prefix,
    _runtime_workspace_path,
)


def test_normalize_runtime_relative_path_strips_workspace_prefix() -> None:
    assert _normalize_runtime_relative_path("/workspace/docs/spec.md") == "docs/spec.md"
    assert _normalize_runtime_relative_path("workspace/docs/spec.md") == "docs/spec.md"


def test_normalize_runtime_relative_path_allows_root_for_listing() -> None:
    assert _normalize_runtime_relative_path("/workspace", allow_empty=True) == ""
    assert _normalize_runtime_relative_path("", allow_empty=True) == ""


def test_normalize_runtime_relative_path_rejects_traversal() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _normalize_runtime_relative_path("/workspace/../secrets.txt")
    assert exc_info.value.status_code == 400


def test_runtime_key_helpers() -> None:
    prefix = _runtime_storage_prefix("acc_1", "proj_1")
    assert prefix == "acc_1/runtime/proj_1/"
    assert _runtime_storage_key("acc_1", "proj_1", "docs/spec.md") == "acc_1/runtime/proj_1/docs/spec.md"


def test_runtime_workspace_path_helper() -> None:
    assert _runtime_workspace_path("") == "/workspace"
    assert _runtime_workspace_path("docs/spec.md") == "/workspace/docs/spec.md"
