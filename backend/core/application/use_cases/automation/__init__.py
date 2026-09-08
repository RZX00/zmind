"""Automation use-case exports with lazy imports.

This avoids importing infrastructure-heavy modules at package import time.
"""

from __future__ import annotations

from typing import Any

__all__ = ["CreateAutomationUseCase", "IngestProviderEventUseCase", "QueueAutomationRunUseCase"]


def __getattr__(name: str) -> Any:
    if name == "CreateAutomationUseCase":
        from .create_automation import CreateAutomationUseCase

        return CreateAutomationUseCase
    if name == "IngestProviderEventUseCase":
        from .ingest_provider_event import IngestProviderEventUseCase

        return IngestProviderEventUseCase
    if name == "QueueAutomationRunUseCase":
        from .queue_automation_run import QueueAutomationRunUseCase

        return QueueAutomationRunUseCase
    raise AttributeError(name)
