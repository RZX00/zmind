from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx

from core.ai_models.registry import DEFAULT_FREE_MODEL
from core.composio_integration.composio_profile_service import ComposioProfileService
from core.composio_integration.composio_trigger_service import ComposioTriggerService
from core.services.supabase import DBConnection
from core.tools.base import Tool, ToolResult, openapi_schema
from core.triggers.scheduling import QStashConfigurationError
from core.triggers.trigger_service import TriggerType, get_trigger_service
from core.utils.logger import logger


class TriggerTool(Tool):
    def __init__(
        self,
        *,
        thread_id: str,
        db_connection: Optional[DBConnection] = None,
        agent_id: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> None:
        super().__init__()
        self.thread_id = thread_id
        self.db = db_connection or DBConnection()
        self.agent_id = agent_id
        self.account_id = account_id

    async def _get_current_account_id(self) -> str:
        if self.account_id:
            return str(self.account_id)

        client = await self.db.client
        result = (
            await client.table("threads")
            .select("account_id")
            .eq("thread_id", self.thread_id)
            .limit(1)
            .execute()
        )
        if result.data and len(result.data) > 0 and result.data[0].get("account_id"):
            self.account_id = str(result.data[0]["account_id"])
            return self.account_id
        raise ValueError("Unable to resolve account context for trigger operation")

    async def _get_account_workers(self) -> List[Dict[str, Any]]:
        account_id = await self._get_current_account_id()
        client = await self.db.client
        result = (
            await client.table("agents")
            .select("agent_id,name,is_default,metadata,created_at,updated_at")
            .eq("account_id", account_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    async def _resolve_target_worker(
        self,
        agent_id: Optional[str] = None,
        worker_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        workers = await self._get_account_workers()
        if not workers:
            raise ValueError("No workers found for this account")

        target_worker: Optional[Dict[str, Any]] = None

        if worker_name:
            requested_name = worker_name.strip().lower()
            exact_matches = [
                worker
                for worker in workers
                if (worker.get("name") or "").strip().lower() == requested_name
            ]
            if len(exact_matches) == 1:
                target_worker = exact_matches[0]
            elif len(exact_matches) > 1:
                raise ValueError(
                    f"Multiple workers named '{worker_name}' found. Please use agent_id."
                )
            else:
                partial_matches = [
                    worker
                    for worker in workers
                    if requested_name in (worker.get("name") or "").strip().lower()
                ]
                if len(partial_matches) == 1:
                    target_worker = partial_matches[0]
                elif len(partial_matches) > 1:
                    names = ", ".join((worker.get("name") or "") for worker in partial_matches[:5])
                    raise ValueError(
                        f"Multiple workers match '{worker_name}': {names}. Please use agent_id."
                    )
                else:
                    raise ValueError(f"Worker named '{worker_name}' not found")

        if not target_worker and agent_id:
            requested_agent_id = agent_id.strip()
            if requested_agent_id.lower() in {"current", "self"} and self.agent_id:
                requested_agent_id = str(self.agent_id)
            elif requested_agent_id.lower() == "default":
                explicit_defaults = [worker for worker in workers if worker.get("is_default")]
                if explicit_defaults:
                    target_worker = explicit_defaults[0]
                else:
                    default_workers = [
                        worker
                        for worker in workers
                        if isinstance(worker.get("metadata"), dict)
                        and bool(worker["metadata"].get("is_zmind_default"))
                    ]
                    if default_workers:
                        target_worker = default_workers[0]

            if not target_worker:
                for worker in workers:
                    if str(worker.get("agent_id")) == requested_agent_id:
                        target_worker = worker
                        break
                if not target_worker:
                    raise ValueError("Worker not found or access denied")

        if not target_worker and self.agent_id:
            for worker in workers:
                if str(worker.get("agent_id")) == str(self.agent_id):
                    target_worker = worker
                    break

        if not target_worker:
            target_worker = workers[0]

        return target_worker

    async def _assert_agent_access(self, agent_id: str) -> None:
        account_id = await self._get_current_account_id()
        client = await self.db.client
        result = (
            await client.table("agents")
            .select("agent_id")
            .eq("agent_id", agent_id)
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise ValueError("Worker not found or access denied")

    @staticmethod
    def _extract_variables(text: str) -> List[str]:
        matches = re.findall(r"\{\{(\w+)\}\}", text or "")
        seen: set[str] = set()
        output: List[str] = []
        for item in matches:
            if item not in seen:
                output.append(item)
                seen.add(item)
        return output

    async def _sync_triggers_to_version_config(self, agent_id: str) -> None:
        try:
            client = await self.db.client

            agent_result = (
                await client.table("agents")
                .select("current_version_id")
                .eq("agent_id", agent_id)
                .single()
                .execute()
            )
            if not agent_result.data or not agent_result.data.get("current_version_id"):
                return

            current_version_id = agent_result.data["current_version_id"]
            triggers_result = (
                await client.table("agent_triggers").select("*").eq("agent_id", agent_id).execute()
            )
            triggers = triggers_result.data or []
            version_result = (
                await client.table("agent_versions")
                .select("config")
                .eq("version_id", current_version_id)
                .single()
                .execute()
            )
            if not version_result.data:
                return

            config = version_result.data.get("config") or {}
            config["triggers"] = triggers
            await (
                client.table("agent_versions")
                .update({"config": config})
                .eq("version_id", current_version_id)
                .execute()
            )
        except Exception as e:
            logger.warning(f"Failed to sync triggers to version config: {e}")

    @staticmethod
    def _is_uuid_like(value: Optional[str]) -> bool:
        if not value:
            return False
        try:
            UUID(str(value).strip())
            return True
        except (ValueError, TypeError, AttributeError):
            return False

    @staticmethod
    def _is_connected_account_id(value: Optional[str]) -> bool:
        return bool(value and isinstance(value, str) and value.strip().startswith("ca_"))

    @staticmethod
    def _extract_composio_trigger_id(obj: Dict[str, Any]) -> Optional[str]:
        if not isinstance(obj, dict):
            return None

        candidate = (
            obj.get("id")
            or obj.get("trigger_id")
            or obj.get("triggerId")
            or obj.get("nano_id")
            or obj.get("nanoId")
            or obj.get("triggerNanoId")
        )
        if candidate:
            return str(candidate)

        for key in ("trigger", "trigger_instance", "triggerInstance", "data", "result"):
            nested = obj.get(key)
            if isinstance(nested, dict):
                nested_id = TriggerTool._extract_composio_trigger_id(nested)
                if nested_id:
                    return nested_id
            if isinstance(nested, list) and nested:
                nested_id = TriggerTool._extract_composio_trigger_id(nested[0] if isinstance(nested[0], dict) else {})
                if nested_id:
                    return nested_id
        return None

    async def _coerce_composio_trigger_config(
        self,
        *,
        slug: str,
        headers: Dict[str, str],
        trigger_config: Dict[str, Any],
        api_base: str,
    ) -> Dict[str, Any]:
        coerced = dict(trigger_config or {})
        type_url = f"{api_base}/api/v3/triggers_types/{slug}"
        try:
            async with httpx.AsyncClient(timeout=10) as http_client:
                response = await http_client.get(type_url, headers=headers)
            if response.status_code != 200:
                return coerced

            schema_data = response.json() if response.content else {}
            schema = (schema_data or {}).get("config") or {}
            props = (schema or {}).get("properties") or {}
            for key, prop in props.items():
                if key not in coerced:
                    continue
                value = coerced[key]
                ptype = prop.get("type") if isinstance(prop, dict) else None
                try:
                    if ptype == "array" and isinstance(value, str):
                        coerced[key] = [value]
                    elif ptype == "integer" and isinstance(value, str) and value.isdigit():
                        coerced[key] = int(value)
                    elif ptype == "number" and isinstance(value, str):
                        coerced[key] = float(value)
                    elif ptype == "boolean" and isinstance(value, str):
                        coerced[key] = value.lower() in {"true", "1", "yes"}
                    elif ptype == "string":
                        if isinstance(value, (list, tuple)):
                            coerced[key] = ",".join(str(item) for item in value)
                        elif not isinstance(value, str):
                            coerced[key] = str(value)
                except Exception:
                    continue
        except Exception:
            return coerced
        return coerced

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "create_scheduled_trigger",
                "description": "Create a scheduled trigger for an agent using a cron expression.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                        "worker_name": {"type": "string"},
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                        "cron_expression": {"type": "string"},
                        "agent_prompt": {"type": "string"},
                        "model": {"type": "string"},
                    },
                    "required": ["name", "cron_expression", "agent_prompt"],
                },
            },
        }
    )
    async def create_scheduled_trigger(
        self,
        name: str,
        cron_expression: str,
        agent_prompt: str,
        description: Optional[str] = None,
        model: Optional[str] = None,
        agent_id: Optional[str] = None,
        worker_name: Optional[str] = None,
    ) -> ToolResult:
        try:
            if not agent_prompt or not agent_prompt.strip():
                return self.fail_response("agent_prompt is required")

            target_worker = await self._resolve_target_worker(agent_id=agent_id, worker_name=worker_name)
            target_agent_id = str(target_worker.get("agent_id"))
            target_worker_name = target_worker.get("name") or "Worker"

            variables = self._extract_variables(agent_prompt)
            trigger_config: Dict[str, Any] = {
                "cron_expression": cron_expression,
                "provider_id": "schedule",
                "agent_prompt": agent_prompt,
                "model": model or DEFAULT_FREE_MODEL,
            }
            if variables:
                trigger_config["trigger_variables"] = variables

            trigger_service = get_trigger_service(self.db)
            trigger = await trigger_service.create_trigger(
                agent_id=target_agent_id,
                provider_id="schedule",
                name=name,
                config=trigger_config,
                description=description,
            )
            await self._sync_triggers_to_version_config(target_agent_id)

            return self.success_response(
                {
                    "message": f"Scheduled trigger '{name}' created successfully",
                    "agent_id": target_agent_id,
                    "worker_name": target_worker_name,
                    "trigger": {
                        "trigger_id": trigger.trigger_id,
                        "name": trigger.name,
                        "description": trigger.description,
                        "cron_expression": cron_expression,
                        "model": trigger_config["model"],
                        "is_active": trigger.is_active,
                        "variables": variables,
                    },
                }
            )
        except (ValueError, QStashConfigurationError) as e:
            return self.fail_response(str(e))
        except Exception as e:
            logger.error(f"Error creating scheduled trigger: {e}", exc_info=True)
            return self.fail_response("Error creating scheduled trigger")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "get_scheduled_triggers",
                "description": "List scheduled triggers for the current or selected agent.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                        "worker_name": {"type": "string"},
                    },
                },
            },
        }
    )
    async def get_scheduled_triggers(
        self,
        agent_id: Optional[str] = None,
        worker_name: Optional[str] = None,
    ) -> ToolResult:
        try:
            target_worker = await self._resolve_target_worker(agent_id=agent_id, worker_name=worker_name)
            target_agent_id = str(target_worker.get("agent_id"))

            trigger_service = get_trigger_service(self.db)
            triggers = await trigger_service.get_agent_triggers(target_agent_id)
            schedule_triggers = [item for item in triggers if item.trigger_type == TriggerType.SCHEDULE]

            return self.success_response(
                {
                    "message": f"Found {len(schedule_triggers)} scheduled trigger(s)",
                    "triggers": [
                        {
                            "trigger_id": item.trigger_id,
                            "name": item.name,
                            "description": item.description,
                            "cron_expression": item.config.get("cron_expression"),
                            "agent_prompt": item.config.get("agent_prompt"),
                            "model": item.config.get("model", DEFAULT_FREE_MODEL),
                            "is_active": item.is_active,
                        }
                        for item in schedule_triggers
                    ],
                }
            )
        except ValueError as e:
            return self.fail_response(str(e))
        except Exception as e:
            logger.error(f"Error getting scheduled triggers: {e}", exc_info=True)
            return self.fail_response("Error getting scheduled triggers")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "delete_scheduled_trigger",
                "description": "Delete a scheduled trigger by ID.",
                "parameters": {
                    "type": "object",
                    "properties": {"trigger_id": {"type": "string"}},
                    "required": ["trigger_id"],
                },
            },
        }
    )
    async def delete_scheduled_trigger(self, trigger_id: str) -> ToolResult:
        try:
            trigger_service = get_trigger_service(self.db)
            trigger = await trigger_service.get_trigger(trigger_id)
            if not trigger:
                return self.fail_response("Trigger not found")

            await self._assert_agent_access(trigger.agent_id)
            if trigger.trigger_type != TriggerType.SCHEDULE:
                return self.fail_response("Trigger is not a scheduled trigger")

            success = await trigger_service.delete_trigger(trigger_id)
            if not success:
                return self.fail_response("Failed to delete trigger")

            await self._sync_triggers_to_version_config(trigger.agent_id)
            return self.success_response(
                {"message": f"Scheduled trigger '{trigger.name}' deleted successfully"}
            )
        except ValueError as e:
            return self.fail_response(str(e))
        except Exception as e:
            logger.error(f"Error deleting scheduled trigger: {e}", exc_info=True)
            return self.fail_response("Error deleting scheduled trigger")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "toggle_scheduled_trigger",
                "description": "Enable or disable a scheduled trigger.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "trigger_id": {"type": "string"},
                        "is_active": {"type": "boolean"},
                    },
                    "required": ["trigger_id", "is_active"],
                },
            },
        }
    )
    async def toggle_scheduled_trigger(self, trigger_id: str, is_active: bool) -> ToolResult:
        try:
            trigger_service = get_trigger_service(self.db)
            trigger = await trigger_service.get_trigger(trigger_id)
            if not trigger:
                return self.fail_response("Trigger not found")

            await self._assert_agent_access(trigger.agent_id)
            if trigger.trigger_type != TriggerType.SCHEDULE:
                return self.fail_response("Trigger is not a scheduled trigger")

            updated = await trigger_service.update_trigger(trigger_id=trigger_id, is_active=is_active)
            await self._sync_triggers_to_version_config(updated.agent_id)

            status = "enabled" if is_active else "disabled"
            return self.success_response(
                {
                    "message": f"Scheduled trigger '{updated.name}' has been {status}",
                    "trigger": {
                        "trigger_id": updated.trigger_id,
                        "name": updated.name,
                        "is_active": updated.is_active,
                    },
                }
            )
        except ValueError as e:
            return self.fail_response(str(e))
        except Exception as e:
            logger.error(f"Error toggling scheduled trigger: {e}", exc_info=True)
            return self.fail_response("Error toggling scheduled trigger")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "list_event_trigger_apps",
                "description": "List apps that support Composio event triggers.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    )
    async def list_event_trigger_apps(self) -> ToolResult:
        try:
            trigger_service = ComposioTriggerService()
            response = await trigger_service.list_apps_with_triggers()
            return self.success_response(
                {
                    "message": f"Found {response['total']} app(s) with triggers",
                    "items": response["items"],
                    "total": response["total"],
                }
            )
        except Exception as e:
            logger.error(f"Error listing event trigger apps: {e}", exc_info=True)
            return self.fail_response("Error listing event trigger apps")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "list_app_event_triggers",
                "description": "List event triggers for a Composio toolkit slug.",
                "parameters": {
                    "type": "object",
                    "properties": {"toolkit_slug": {"type": "string"}},
                    "required": ["toolkit_slug"],
                },
            },
        }
    )
    async def list_app_event_triggers(self, toolkit_slug: str) -> ToolResult:
        try:
            trigger_service = ComposioTriggerService()
            response = await trigger_service.list_triggers_for_app(toolkit_slug)
            return self.success_response(
                {
                    "message": f"Found {response['total']} trigger(s) for {toolkit_slug}",
                    "items": response["items"],
                    "toolkit": response["toolkit"],
                    "total": response["total"],
                }
            )
        except Exception as e:
            logger.error(f"Error listing triggers for app {toolkit_slug}: {e}", exc_info=True)
            return self.fail_response("Error listing app event triggers")

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "create_event_trigger",
                "description": "Create a Composio event trigger and bind it to an agent.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                        "worker_name": {"type": "string"},
                        "slug": {"type": "string"},
                        "profile_id": {"type": "string"},
                        "trigger_config": {"type": "object", "additionalProperties": True},
                        "name": {"type": "string"},
                        "agent_prompt": {"type": "string"},
                        "connected_account_id": {"type": "string"},
                        "model": {"type": "string"},
                    },
                    "required": ["slug", "profile_id", "agent_prompt"],
                },
            },
        }
    )
    async def create_event_trigger(
        self,
        slug: str,
        profile_id: Optional[str] = None,
        agent_prompt: Optional[str] = None,
        trigger_config: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        connected_account_id: Optional[str] = None,
        model: Optional[str] = None,
        agent_id: Optional[str] = None,
        worker_name: Optional[str] = None,
    ) -> ToolResult:
        try:
            if not slug:
                return self.fail_response("slug is required")
            if not profile_id:
                return self.fail_response("profile_id is required")
            if not agent_prompt:
                return self.fail_response("agent_prompt is required")

            target_worker = await self._resolve_target_worker(agent_id=agent_id, worker_name=worker_name)
            target_agent_id = str(target_worker.get("agent_id"))
            target_worker_name = target_worker.get("name") or "Worker"

            account_id = await self._get_current_account_id()
            profile_service = ComposioProfileService(self.db)

            resolved_profile_id = (profile_id or "").strip() or None
            resolved_connected_account_id = (connected_account_id or "").strip() or None
            if not resolved_profile_id and self._is_uuid_like(resolved_connected_account_id):
                resolved_profile_id = resolved_connected_account_id
                resolved_connected_account_id = None
            if not resolved_profile_id:
                return self.fail_response("profile_id is required")

            if resolved_connected_account_id and not self._is_connected_account_id(resolved_connected_account_id):
                return self.fail_response(
                    "Invalid connected_account_id format. Expected value like 'ca_...'."
                )

            profile_config = await profile_service.get_profile_config(
                resolved_profile_id,
                account_id=account_id,
            )
            composio_user_id = profile_config.get("user_id")
            if not composio_user_id:
                return self.fail_response("Composio profile is missing user_id")

            derived_connected_account_id = profile_config.get("connected_account_id")
            if not resolved_connected_account_id:
                resolved_connected_account_id = derived_connected_account_id
            if not resolved_connected_account_id:
                return self.fail_response(
                    "Connected account is missing for this profile. Reconnect the integration and try again."
                )

            toolkit_slug = profile_config.get("toolkit_slug")
            if not toolkit_slug and slug:
                toolkit_slug = slug.split("_")[0].lower() if "_" in slug else "composio"
            qualified_name = (
                f"composio.{toolkit_slug}"
                if toolkit_slug and toolkit_slug != "composio"
                else "composio"
            )

            api_base = os.getenv("COMPOSIO_API_BASE", "https://backend.composio.dev").rstrip("/")
            api_key = os.getenv("COMPOSIO_API_KEY")
            if not api_key:
                return self.fail_response("COMPOSIO_API_KEY not configured")
            headers = {"x-api-key": api_key, "Content-Type": "application/json"}

            coerced_config = await self._coerce_composio_trigger_config(
                slug=slug,
                headers=headers,
                trigger_config=trigger_config or {},
                api_base=api_base,
            )

            body = {
                "user_id": composio_user_id,
                "trigger_config": coerced_config,
                "connected_account_id": resolved_connected_account_id,
            }

            upsert_url = f"{api_base}/api/v3/trigger_instances/{slug}/upsert"
            async with httpx.AsyncClient(timeout=20) as http_client:
                response = await http_client.post(upsert_url, headers=headers, json=body)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                detail = response.json() if "application/json" in response.headers.get("content-type", "") else response.text
                return self.fail_response(f"Composio upsert error: {detail}")

            created = response.json() if response.content else {}
            composio_trigger_id = self._extract_composio_trigger_id(created if isinstance(created, dict) else {})
            if not composio_trigger_id:
                return self.fail_response("Failed to get Composio trigger id from response")

            variables = self._extract_variables(agent_prompt)
            trigger_payload: Dict[str, Any] = {
                "provider_id": "composio",
                "composio_trigger_id": composio_trigger_id,
                "trigger_slug": slug,
                "qualified_name": qualified_name,
                "profile_id": resolved_profile_id,
                "connected_account_id": resolved_connected_account_id,
                "agent_prompt": agent_prompt,
                "model": model or DEFAULT_FREE_MODEL,
                **coerced_config,
            }
            if variables:
                trigger_payload["trigger_variables"] = variables

            trigger_service = get_trigger_service(self.db)
            trigger = await trigger_service.create_trigger(
                agent_id=target_agent_id,
                provider_id="composio",
                name=name or slug,
                config=trigger_payload,
                description=f"Composio event: {slug}",
            )
            await self._sync_triggers_to_version_config(target_agent_id)

            return self.success_response(
                {
                    "message": f"Event trigger '{trigger.name}' created successfully",
                    "trigger": {
                        "trigger_id": trigger.trigger_id,
                        "provider": "composio",
                        "slug": slug,
                        "agent_id": target_agent_id,
                        "worker_name": target_worker_name,
                        "profile_id": resolved_profile_id,
                        "connected_account_id": resolved_connected_account_id,
                        "model": trigger_payload["model"],
                        "is_active": trigger.is_active,
                        "variables": variables,
                    },
                }
            )
        except ValueError as e:
            return self.fail_response(str(e))
        except Exception as e:
            logger.error(f"Error creating event trigger: {e}", exc_info=True)
            return self.fail_response("Error creating event trigger")
