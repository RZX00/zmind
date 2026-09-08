import json
from typing import Any, Dict, List

from core.services.supabase import DBConnection


async def get_all_user_triggers(user_id: str) -> List[Dict[str, Any]]:
    db = DBConnection()
    await db.initialize()
    client = await db.client

    agents_result = (
        await client.table("agents")
        .select("agent_id,name,description,icon_name,icon_color,icon_background")
        .eq("account_id", user_id)
        .execute()
    )
    agents = agents_result.data or []
    if not agents:
        return []

    agent_map = {row["agent_id"]: row for row in agents if row.get("agent_id")}
    agent_ids = list(agent_map.keys())
    if not agent_ids:
        return []

    try:
        triggers_result = (
            await client.table("agent_triggers")
            .select(
                "trigger_id,agent_id,trigger_type,provider_id,name,description,is_active,config,created_at,updated_at"
            )
            .in_("agent_id", agent_ids)
            .order("updated_at", desc=True)
            .execute()
        )
    except Exception as e:
        # Backward compatibility: some environments may not yet include provider_id.
        if "provider_id" in str(e) and "does not exist" in str(e):
            triggers_result = (
                await client.table("agent_triggers")
                .select(
                    "trigger_id,agent_id,trigger_type,name,description,is_active,config,created_at,updated_at"
                )
                .in_("agent_id", agent_ids)
                .order("updated_at", desc=True)
                .execute()
            )
        else:
            raise
    rows = triggers_result.data or []

    results = []
    for row in rows:
        config = row.get("config", {})
        if isinstance(config, str):
            try:
                config = json.loads(config)
            except json.JSONDecodeError:
                config = {}
        agent = agent_map.get(row.get("agent_id"), {})

        results.append({
            "trigger_id": row["trigger_id"],
            "agent_id": row["agent_id"],
            "trigger_type": row["trigger_type"],
            "provider_id": row.get("provider_id", ""),
            "name": row["name"],
            "description": row.get("description"),
            "is_active": row.get("is_active", False),
            "webhook_url": None,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "config": config,
            "agent_name": agent.get("name", "Untitled Agent"),
            "agent_description": agent.get("description", ""),
            "icon_name": agent.get("icon_name"),
            "icon_color": agent.get("icon_color"),
            "icon_background": agent.get("icon_background"),
        })

    return results
