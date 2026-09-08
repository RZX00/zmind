import asyncio
import argparse
from core.utils.logger import logger
from core.utils.zmind_default_agent_service import ZmindDefaultAgentService


class ZmindAgentManager:
    def __init__(self):
        self.service = ZmindDefaultAgentService()

    async def install_all(self):
        """Install default Zmind agent for all users who don't have one."""
        print("🚀 Installing Zmind default agent for all users who don't have it...")
        result = await self.service.install_for_all_users()
        print(f"\n✅ Successfully installed for {result['installed_count']} users")
        if result.get("failed_count"):
            print(f"❌ Failed for {result['failed_count']} users")
            for detail in result.get("details", []):
                print(f"- {detail}")

    async def install_user(self, account_id: str, replace_existing: bool = False):
        """Install Zmind agent for specific user."""
        print(f"🚀 Installing Zmind default agent for user {account_id}...")
        agent_id = await self.service.install_default_agent_for_user(account_id, replace_existing)
        if agent_id:
            print(f"✅ Successfully installed Zmind agent {agent_id} for user {account_id}")
        else:
            print(f"❌ Failed to install Zmind agent for user {account_id}")

    async def replace_user(self, account_id: str):
        """Replace Zmind agent for specific user (if corrupted)."""
        print(f"🔄 Replacing Zmind agent for user {account_id}...")
        agent_id = await self.service.install_default_agent_for_user(account_id, replace_existing=True)
        if agent_id:
            print(f"✅ Successfully replaced Zmind agent {agent_id} for user {account_id}")
        else:
            print(f"❌ Failed to replace Zmind agent for user {account_id}")

    async def stats(self):
        """Show Zmind agent statistics."""
        print("📊 Zmind Default Agent Statistics")
        stats = await self.service.get_default_agent_stats()
        for key, value in stats.items():
            print(f"{key}: {value}")

    async def config_info(self):
        """Show information about Zmind configuration (no sync needed)."""
        print("ℹ️  Zmind Configuration Information")
        print("🔧 Zmind agents automatically use the current configuration from zmind_config.py")
        print("💡 To update default agent behavior, modify backend/core/zmind_config.py")
        print("\n✅ All Zmind agents are always up-to-date with your latest configuration!")


def main():
    parser = argparse.ArgumentParser(
        description="Manage Zmind default agents across all users (Simplified)",
    )
    subparsers = parser.add_subparsers(dest='command')

    subparsers.add_parser('install-all', help='Install Zmind agent for all users who don\'t have it')
    subparsers.add_parser('stats', help='Show Zmind agent statistics')
    subparsers.add_parser('config-info', help='Show information about Zmind configuration')

    install_user_parser = subparsers.add_parser('install-user', help='Install Zmind agent for specific user')
    install_user_parser.add_argument('account_id', help='Account ID to install Zmind for')

    replace_user_parser = subparsers.add_parser('replace-user', help='Replace Zmind agent for specific user (if corrupted)')
    replace_user_parser.add_argument('account_id', help='Account ID to replace Zmind for')

    args = parser.parse_args()
    manager = ZmindAgentManager()

    if not args.command:
        parser.print_help()
        return

    logger.debug(f"Running command: {args.command}")
    if args.command == 'install-all':
        asyncio.run(manager.install_all())
    elif args.command == 'stats':
        asyncio.run(manager.stats())
    elif args.command == 'config-info':
        asyncio.run(manager.config_info())
    elif args.command == 'install-user':
        asyncio.run(manager.install_user(args.account_id))
    elif args.command == 'replace-user':
        asyncio.run(manager.replace_user(args.account_id))


if __name__ == "__main__":
    main()
