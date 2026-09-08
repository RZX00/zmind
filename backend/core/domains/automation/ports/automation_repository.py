from __future__ import annotations

from typing import Any, Dict, Optional, Protocol, Tuple, List

from core.domains.automation.model import (
    Automation,
    AutomationBinding,
    AutomationRun,
    AutomationRunAttempt,
    ProviderEvent,
)


class AutomationRepository(Protocol):
    async def create_automation(
        self,
        *,
        account_id: str,
        agent_id: Optional[str],
        name: str,
        description: Optional[str],
        trigger_type: str,
        provider: Optional[str],
        provider_binding_key: Optional[str],
        route_type: str,
        route_ref: Optional[str],
        is_active: bool,
        config: Dict[str, Any],
        created_by: Optional[str],
    ) -> Automation:
        ...

    async def get_automation(
        self,
        automation_id: str,
        *,
        account_id: Optional[str] = None,
    ) -> Optional[Automation]:
        ...

    async def list_automations(
        self,
        *,
        account_id: str,
        is_active: Optional[bool] = None,
        trigger_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Automation]:
        ...

    async def update_automation(
        self,
        *,
        automation_id: str,
        account_id: str,
        patch: Dict[str, Any],
    ) -> Optional[Automation]:
        ...

    async def delete_automation(self, *, automation_id: str, account_id: str) -> bool:
        ...

    async def create_binding(
        self,
        *,
        automation_id: str,
        account_id: str,
        provider: str,
        match_strategy: str,
        match_value: Dict[str, Any],
        is_active: bool = True,
    ) -> AutomationBinding:
        ...

    async def list_bindings(
        self,
        *,
        automation_id: str,
        only_active: bool = False,
    ) -> List[AutomationBinding]:
        ...

    async def upsert_provider_event(
        self,
        *,
        provider: str,
        dedupe_key: str,
        payload: Dict[str, Any],
        headers: Dict[str, Any],
        external_event_id: Optional[str],
        event_type: Optional[str],
        account_id: Optional[str],
        signature_valid: bool,
    ) -> Tuple[ProviderEvent, bool]:
        ...

    async def get_provider_event(self, provider_event_id: str) -> Optional[ProviderEvent]:
        ...

    async def list_active_event_automations(
        self,
        *,
        provider: str,
        provider_binding_key: Optional[str],
    ) -> List[Automation]:
        ...

    async def list_active_schedule_automations(
        self,
        *,
        account_id: Optional[str] = None,
    ) -> List[Automation]:
        ...

    async def update_provider_event_status(
        self,
        *,
        provider_event_id: str,
        status: str,
        processing_error: Optional[str] = None,
    ) -> Optional[ProviderEvent]:
        ...

    async def create_run(
        self,
        *,
        automation_id: str,
        account_id: str,
        trigger_source: str,
        provider_event_id: Optional[str],
        external_run_key: Optional[str],
        status: str,
        retry_count: int,
        max_retries: int,
        metadata: Dict[str, Any],
    ) -> Tuple[AutomationRun, bool]:
        ...

    async def get_run(self, run_id: str) -> Optional[AutomationRun]:
        ...

    async def get_latest_run_for_automation(
        self,
        *,
        automation_id: str,
        trigger_source: Optional[str] = None,
    ) -> Optional[AutomationRun]:
        ...

    async def list_runs(
        self,
        *,
        automation_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AutomationRun]:
        ...

    async def update_run_status(
        self,
        *,
        run_id: str,
        status: str,
        agent_run_id: Optional[str] = None,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        retry_count: Optional[int] = None,
    ) -> Optional[AutomationRun]:
        ...

    async def create_run_attempt(
        self,
        *,
        run_id: str,
        attempt_no: int,
        status: str,
        error_code: Optional[str],
        error_message: Optional[str],
        metadata: Dict[str, Any],
    ) -> Tuple[AutomationRunAttempt, bool]:
        ...

    async def update_run_attempt_status(
        self,
        *,
        attempt_id: str,
        status: str,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> Optional[AutomationRunAttempt]:
        ...

    async def list_run_attempts(self, *, run_id: str) -> List[AutomationRunAttempt]:
        ...
