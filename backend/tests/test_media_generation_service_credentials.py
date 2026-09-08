from __future__ import annotations

import os

import pytest

from core.media import generation_service as generation_module
from core.media.generation_service import MediaGenerationService
from core.utils.config import config


class _FakeGenAI:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def Client(self, **kwargs):  # noqa: N802 - keep SDK-style method name
        self.calls.append(kwargs)
        return {"kwargs": kwargs}


def _patch_genai(monkeypatch: pytest.MonkeyPatch) -> _FakeGenAI:
    fake = _FakeGenAI()
    monkeypatch.setattr(generation_module, "genai", fake)
    # Only truthiness matters for availability check.
    monkeypatch.setattr(generation_module, "genai_types", object())
    return fake


def test_normalize_model_routes_bare_gemini_to_habitat_when_key_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "HABITAT_API_KEY", "habitat-test-key")
    service = MediaGenerationService()

    assert (
        service._normalize_model_name("gemini-3.1-flash-image-preview")
        == "habitat/gemini-3.1-flash-image-preview"
    )


def test_normalize_model_keeps_bare_gemini_without_habitat_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "HABITAT_API_KEY", None)
    service = MediaGenerationService()

    assert (
        service._normalize_model_name("gemini-3.1-flash-image-preview")
        == "habitat/gemini-3.1-flash-image-preview"
    )


@pytest.mark.asyncio
async def test_vertex_directory_credentials_raises_without_api_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    fake_genai = _patch_genai(monkeypatch)
    creds_dir = tmp_path / "gcp-sa.json"
    creds_dir.mkdir()

    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(creds_dir))
    monkeypatch.setattr(config, "VERTEXAI_PROJECT", "demo-project")
    monkeypatch.setattr(config, "VERTEXAI_LOCATION", "global")
    monkeypatch.setattr(config, "VERTEXAI_CREDENTIALS", None)
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)

    service = MediaGenerationService()
    with pytest.raises(RuntimeError, match="points to a directory"):
        service._get_client()

    assert fake_genai.calls == []


@pytest.mark.asyncio
async def test_vertex_directory_credentials_falls_back_to_api_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    fake_genai = _patch_genai(monkeypatch)
    creds_dir = tmp_path / "gcp-sa.json"
    creds_dir.mkdir()

    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(creds_dir))
    monkeypatch.setattr(config, "VERTEXAI_PROJECT", "demo-project")
    monkeypatch.setattr(config, "VERTEXAI_LOCATION", "global")
    monkeypatch.setattr(config, "VERTEXAI_CREDENTIALS", None)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "gemini-test-key")

    service = MediaGenerationService()
    client = service._get_client()

    assert fake_genai.calls == [{"api_key": "gemini-test-key"}]
    assert client["kwargs"]["api_key"] == "gemini-test-key"


@pytest.mark.asyncio
async def test_vertex_credentials_file_from_config_is_resolved(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    fake_genai = _patch_genai(monkeypatch)
    creds_file = tmp_path / "service-account.json"
    creds_file.write_text("{}", encoding="utf-8")

    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.setattr(config, "VERTEXAI_PROJECT", "demo-project")
    monkeypatch.setattr(config, "VERTEXAI_LOCATION", "global")
    monkeypatch.setattr(config, "VERTEXAI_CREDENTIALS", str(creds_file))
    monkeypatch.setattr(config, "GEMINI_API_KEY", None)

    service = MediaGenerationService()
    service._get_client()

    assert fake_genai.calls == [
        {
            "vertexai": True,
            "project": "demo-project",
            "location": "global",
        }
    ]
    assert os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") == str(creds_file.resolve())


@pytest.mark.asyncio
async def test_habitat_generation_requires_habitat_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "HABITAT_API_KEY", None)
    service = MediaGenerationService()

    with pytest.raises(RuntimeError, match="HABITAT_API_KEY"):
        await service._generate_single_image_habitat(
            generation_module.MediaGenerationRequest(
                prompt="test",
                model="habitat/gpt-image-2",
            )
        )


@pytest.mark.asyncio
async def test_aiping_generation_requires_aiping_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "AIPING_API_KEY", None)
    service = MediaGenerationService()

    with pytest.raises(RuntimeError, match="AIPING_API_KEY"):
        await service._generate_single_image_aiping(
            generation_module.MediaGenerationRequest(
                prompt="test",
                model="aiping/doubao-seedream-4.5",
            )
        )


class _FakeHttpResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, calls: list[dict], payload: dict, **_kwargs) -> None:
        self._calls = calls
        self._payload = payload

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, headers=None, files=None, json=None):
        self._calls.append(
            {
                "url": url,
                "headers": headers,
                "files": files,
                "json": json,
            }
        )
        return _FakeHttpResponse(self._payload)


@pytest.mark.asyncio
async def test_habitat_edit_requests_single_image_per_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "HABITAT_API_KEY", "habitat-test-key")
    monkeypatch.setattr(config, "HABITAT_API_BASE", "https://api.aihabitat.live/v1")

    calls: list[dict] = []
    payload = {"data": [{"b64_json": "AQ=="}]}
    monkeypatch.setattr(
        generation_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeAsyncClient(calls=calls, payload=payload, **kwargs),
    )

    async def _fake_download(
        self, reference_id: str, account_id: str | None
    ) -> bytes:  # noqa: ARG001
        return b"img"

    monkeypatch.setattr(MediaGenerationService, "_download_reference_image", _fake_download)

    service = MediaGenerationService()
    await service._generate_habitat_image_edit(
        generation_module.MediaGenerationRequest(
            prompt="edit",
            quantity=5,
            model="habitat/gpt-image-2",
            reference_image_ids=["ref-1"],
            account_id="acc-1",
        )
    )

    assert calls
    assert calls[0]["files"]["n"] == (None, "1")
