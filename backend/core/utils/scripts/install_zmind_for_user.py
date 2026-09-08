"""
Zmind Agent Installation Script for Individual Users

Usage:
    python install_zmind_for_user.py user@example.com
    python install_zmind_for_user.py user@example.com --replace
"""

import asyncio
from typing import Optional

from core.utils.logger import logger
from core.utils.zmind_default_agent_service import ZmindDefaultAgentService
from core.services.supabase import DBConnection


class ZmindUserInstaller:
    def __init__(self, db: Optional[DBConnection] = None):
        self.db = db or DBConnection()
        self.service = ZmindDefaultAgentService(self.db)

    async def get_user_id_by_email(self, email: str) -> Optional[str]:
        """Look up user_id from email."""
        client = await self.db.client
        result = await client.table('auth.users').select('id').eq('email', email).maybe_single().execute()
        if result.data:
            return result.data['id']
        return None

    async def install(self, email: str, replace: bool = False):
        """Install Zmind agent for a user by email."""
        user_id = await self.get_user_id_by_email(email)
        if not user_id:
            print(f"❌ No user found for email {email}")
            return

        print(f"🚀 Installing Zmind agent...")
        agent_id = await self.service.install_default_agent_for_user(
            account_id=user_id,
            replace_existing=replace
        )
        if agent_id:
            print(f"✅ Successfully installed Zmind agent!")
        else:
            print(f"❌ Failed to install Zmind agent for {email}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Install Zmind agent for a user by email",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("email", help="User email address")
    parser.add_argument("--replace", action="store_true", help='Replace existing default agent if present')

    args = parser.parse_args()
    installer = ZmindUserInstaller()
    await installer.install(args.email, replace=args.replace)


if __name__ == "__main__":
    asyncio.run(main())
