from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

from core.utils.logger import logger
from core.services.supabase import DBConnection
from core.zmind_config import ZMIND_CONFIG
from core.prompts.prompt import get_system_prompt


class ZmindDefaultAgentService:
    """Centralized helper for managing the built-in Zmind default agent across users."""

    def __init__(self, db: DBConnection = None):
        self._db = db or DBConnection()
        logger.debug("🔄 ZmindDefaultAgentService initialized")

    async def get_default_config(self) -> Dict[str, Any]:
        """Return the canonical ZMIND_CONFIG copy."""
        return ZMIND_CONFIG.copy()

    async def install_for_all_users(self) -> Dict[str, Any]:
        """Install the Zmind default agent for all users who don't already have it."""
        logger.debug("🚀 Installing Zmind agents for users who don't have them")

        try:
            client = await self._db.client

            accounts_result = await client.schema('basejump').table('accounts').select('id').eq('personal_account', True).execute()
            all_account_ids = {row['id'] for row in accounts_result.data} if accounts_result.data else set()

            existing_result = await client.table('agents').select('account_id').eq('metadata->>is_zmind_default', 'true').execute()
            existing_account_ids = {row['account_id'] for row in existing_result.data} if existing_result.data else set()

            missing_accounts = all_account_ids - existing_account_ids

            if not missing_accounts:
                return {
                    "installed_count": 0,
                    "failed_count": 0,
                    "details": ["All users already have the default Zmind agent"]
                }

            logger.debug(f"📦 Installing Zmind for {len(missing_accounts)} users")

            success_count = 0
            failed_count = 0
            errors = []

            for account_id in missing_accounts:
                try:
                    await self._create_default_agent_for_user(account_id)
                    success_count += 1
                    logger.debug(f"✅ Installed Zmind for user {account_id}")
                except Exception as e:
                    failed_count += 1
                    error_msg = f"Failed to install for user {account_id}: {str(e)}"
                    errors.append(error_msg)
                    logger.error(error_msg)

            return {
                "installed_count": success_count,
                "failed_count": failed_count,
                "details": errors if errors else [f"Successfully installed for {success_count} users"]
            }

        except Exception as e:
            error_msg = f"Installation operation failed: {str(e)}"
            logger.error(error_msg)
            return {
                "installed_count": 0,
                "failed_count": 0,
                "details": [error_msg]
            }

    async def install_default_agent_for_user(self, account_id: str, replace_existing: bool = False) -> Optional[str]:
        """Install the Zmind default agent for a specific user."""
        logger.debug(f"🔄 Installing Zmind agent for user: {account_id}")

        try:
            client = await self._db.client

            existing_agent_id = await self._find_existing_default_agent_id(client, account_id)

            if existing_agent_id:
                if replace_existing:
                    await self._delete_agent(existing_agent_id)
                    logger.debug("Deleted existing Zmind agent for replacement")
                else:
                    logger.debug(f"User {account_id} already has Zmind agent: {existing_agent_id}")
                    return existing_agent_id

            try:
                agent_id = await self._create_default_agent_for_user(account_id)
            except Exception as create_error:
                # Idempotency guard: if concurrent installs race, return the winner agent.
                if self._is_unique_violation(create_error):
                    existing_after_conflict = await self._find_existing_default_agent_id(client, account_id)
                    if existing_after_conflict:
                        logger.debug(
                            f"Detected concurrent/default-agent uniqueness conflict for {account_id}; "
                            f"reusing existing agent {existing_after_conflict}"
                        )
                        return existing_after_conflict
                raise create_error

            logger.debug(f"Successfully installed Zmind agent {agent_id} for user {account_id}")
            return agent_id

        except Exception as e:
            logger.error(f"Error in install_default_agent_for_user: {e}")
            return None

    @staticmethod
    def _is_unique_violation(error: Exception) -> bool:
        message = str(error).lower()
        return 'duplicate key value' in message or "'code': '23505'" in message or '"code": "23505"' in message

    async def _find_existing_default_agent_id(self, client, account_id: str) -> Optional[str]:
        existing_result = await (
            client.table('agents')
            .select('agent_id')
            .eq('account_id', account_id)
            .eq('metadata->>is_zmind_default', 'true')
            .limit(1)
            .execute()
        )
        if existing_result.data:
            return existing_result.data[0]['agent_id']
        return None

    async def get_default_agent_stats(self) -> Dict[str, Any]:
        """Get statistics about default Zmind agents."""
        try:
            client = await self._db.client

            total_result = await client.table('agents').select('agent_id', count='exact').eq('metadata->>is_zmind_default', 'true').execute()
            total_count = total_result.count or 0

            thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            recent_result = await client.table('agents').select('created_at').eq('metadata->>is_zmind_default', 'true').gte('created_at', thirty_days_ago).execute()
            recent_count = len(recent_result.data) if recent_result.data else 0

            return {
                "total_agents": total_count,
                "recent_installs": recent_count,
                "note": "Default Zmind agents always use the current central configuration"
            }

        except Exception as e:
            logger.error(f"Failed to get agent stats: {e}")
            return {"error": str(e)}

    async def _create_default_agent_for_user(self, account_id: str) -> str:
        """Create the default Zmind agent for a user."""
        client = await self._db.client

        agent_data = {
            "account_id": account_id,
            "name": ZMIND_CONFIG["name"],
            "description": ZMIND_CONFIG["description"],
            "is_default": True,
            "icon_name": "sun",
            "icon_color": "#F59E0B",
            "icon_background": "#FFF3CD",
            "metadata": {
                "is_zmind_default": True,
                "centrally_managed": True,
                "installation_date": datetime.now(timezone.utc).isoformat()
            },
            "version_count": 1
        }

        result = await client.table('agents').insert(agent_data).execute()

        if not result.data:
            raise Exception("Failed to create agent record")

        agent_id = result.data[0]['agent_id']

        await self._create_initial_version(agent_id, account_id)

        return agent_id

    async def _create_initial_version(self, agent_id: str, account_id: str) -> None:
        """Create initial version for default Zmind agent."""
        try:
            from core.versioning.version_service import get_version_service

            version_service = await get_version_service()
            await version_service.create_version(
                agent_id=agent_id,
                user_id=account_id,
                system_prompt=get_system_prompt(),
                configured_mcps=ZMIND_CONFIG["configured_mcps"],
                custom_mcps=ZMIND_CONFIG["custom_mcps"],
                native_tools=ZMIND_CONFIG["native_tools"],
                model=ZMIND_CONFIG["model"],
                version_name="v1",
                change_description="Initial Zmind agent installation"
            )

            logger.debug(f"Created initial version for Zmind agent {agent_id}")

        except Exception as e:
            logger.error(f"Failed to create initial version for Zmind agent {agent_id}: {e}")
            raise

    async def _delete_agent(self, agent_id: str) -> bool:
        """Delete an agent and clean up related data."""
        try:
            client = await self._db.client

            result = await client.table('agents').delete().eq('agent_id', agent_id).execute()
            return bool(result.data)
        except Exception as e:
            logger.error(f"Failed to delete agent {agent_id}: {e}")
            return False
