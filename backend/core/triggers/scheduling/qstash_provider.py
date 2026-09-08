from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from core.utils.logger import logger

from .ports import ScheduleProviderPort, ScheduleRegistration


class QStashConfigurationError(RuntimeError):
    pass


@dataclass(slots=True)
class QStashScheduleProvider(ScheduleProviderPort):
    token: str
    base_url: str = "https://qstash.upstash.io"
    request_timeout_sec: float = 20.0

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _build_cron_header(self, cron_expression: str, timezone: str) -> str:
        tz = (timezone or "UTC").strip() or "UTC"
        cron = (cron_expression or "").strip()
        if not cron:
            raise ValueError("cron_expression is required")
        if tz.upper() == "UTC":
            return cron
        return f"CRON_TZ={tz} {cron}"

    async def create_schedule(
        self,
        *,
        trigger_id: str,
        destination_url: str,
        cron_expression: str,
        timezone: str,
        payload: Dict[str, Any],
    ) -> ScheduleRegistration:
        encoded_destination = quote(destination_url, safe="")
        url = f"{self.base_url.rstrip('/')}/v2/schedules/{encoded_destination}"
        headers = self._headers()
        headers["Upstash-Cron"] = self._build_cron_header(cron_expression, timezone)
        headers["Upstash-Schedule-Id"] = str(trigger_id)
        headers["Upstash-Method"] = "POST"
        headers["Upstash-Forward-X-Trigger-Source"] = "schedule"

        trigger_secret = os.getenv("TRIGGER_WEBHOOK_SECRET", "").strip()
        if trigger_secret:
            headers["Upstash-Forward-X-Trigger-Secret"] = trigger_secret

        body_text = json.dumps(payload or {}, ensure_ascii=False)

        async with httpx.AsyncClient(timeout=self.request_timeout_sec) as client:
            response = await client.post(url, headers=headers, content=body_text.encode("utf-8"))

        if response.status_code >= 400:
            raise RuntimeError(
                f"qstash_create_schedule_failed:{response.status_code}:{response.text[:400]}"
            )

        data: Dict[str, Any] = {}
        try:
            data = response.json() if response.content else {}
        except Exception:
            data = {}

        schedule_id = (
            str(data.get("scheduleId"))
            if isinstance(data, dict) and data.get("scheduleId")
            else str(trigger_id)
        )

        return ScheduleRegistration(
            schedule_id=schedule_id,
            provider="qstash",
            metadata={
                "destination_url": destination_url,
                "next": data.get("next") if isinstance(data, dict) else None,
                "raw": data,
            },
        )

    async def pause_schedule(self, *, schedule_id: str) -> None:
        url = f"{self.base_url.rstrip('/')}/v2/schedules/{schedule_id}/pause"
        async with httpx.AsyncClient(timeout=self.request_timeout_sec) as client:
            response = await client.post(url, headers=self._headers())
        if response.status_code >= 400:
            raise RuntimeError(f"qstash_pause_schedule_failed:{response.status_code}:{response.text[:400]}")

    async def resume_schedule(self, *, schedule_id: str) -> None:
        url = f"{self.base_url.rstrip('/')}/v2/schedules/{schedule_id}/resume"
        async with httpx.AsyncClient(timeout=self.request_timeout_sec) as client:
            response = await client.post(url, headers=self._headers())
        if response.status_code >= 400:
            raise RuntimeError(f"qstash_resume_schedule_failed:{response.status_code}:{response.text[:400]}")

    async def delete_schedule(self, *, schedule_id: str) -> None:
        url = f"{self.base_url.rstrip('/')}/v2/schedules/{schedule_id}"
        async with httpx.AsyncClient(timeout=self.request_timeout_sec) as client:
            response = await client.delete(url, headers=self._headers())
        if response.status_code >= 400 and response.status_code != 404:
            raise RuntimeError(
                f"qstash_delete_schedule_failed:{response.status_code}:{response.text[:400]}"
            )


class NoopScheduleProvider(ScheduleProviderPort):
    async def create_schedule(
        self,
        *,
        trigger_id: str,
        destination_url: str,
        cron_expression: str,
        timezone: str,
        payload: Dict[str, Any],
    ) -> ScheduleRegistration:
        logger.warning(
            "qstash_not_configured_using_noop_schedule_provider",
            trigger_id=trigger_id,
            destination_url=destination_url,
        )
        return ScheduleRegistration(
            schedule_id=trigger_id,
            provider="noop",
            metadata={
                "destination_url": destination_url,
                "cron_expression": cron_expression,
                "timezone": timezone,
            },
        )

    async def pause_schedule(self, *, schedule_id: str) -> None:
        return None

    async def resume_schedule(self, *, schedule_id: str) -> None:
        return None

    async def delete_schedule(self, *, schedule_id: str) -> None:
        return None


def build_qstash_schedule_provider_from_env() -> ScheduleProviderPort:
    token = os.getenv("QSTASH_TOKEN", "").strip()
    base_url = os.getenv("QSTASH_BASE_URL", "https://qstash.upstash.io").strip()
    allow_noop = os.getenv("QSTASH_ALLOW_NOOP", "false").lower() in {"1", "true", "yes"}

    if not token:
        if allow_noop:
            return NoopScheduleProvider()
        raise QStashConfigurationError("QSTASH_TOKEN is not configured")

    return QStashScheduleProvider(token=token, base_url=base_url)
