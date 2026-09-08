import os
from core.utils.logger import logger

# Get configuration from environment
tracing_enabled = os.getenv("LANGCHAIN_TRACING_V2", "false").lower() in ("true", "t", "yes", "y", "1")
api_key = os.getenv("LANGCHAIN_API_KEY")
project_name = os.getenv("LANGCHAIN_PROJECT")
endpoint = os.getenv("LANGCHAIN_ENDPOINT", "https://api.smith.langchain.com")

# Determine if LangSmith should be enabled
enabled = bool(tracing_enabled and api_key)

logger.debug(f"🔍 LangSmith Environment Check:")
logger.debug(f"  - Tracing Enabled: {'✅ Yes' if tracing_enabled else '❌ No'}")
logger.debug(f"  - API Key: {'✅ Set' if api_key else '❌ Missing'}")
logger.debug(f"  - Project: {project_name or '❌ Not set'}")
logger.debug(f"  - Endpoint: {endpoint}")
logger.debug(f"  - Enabled: {enabled}")

# Set environment variables for LangChain/LangSmith
if enabled:
    logger.debug(f"🔍 Configuring LangSmith tracing")
    try:
        # Set environment variables that LangChain will read
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = api_key
        if project_name:
            os.environ["LANGCHAIN_PROJECT"] = project_name
        os.environ["LANGCHAIN_ENDPOINT"] = endpoint

        logger.info(f"✅ LangSmith tracing enabled")
        logger.info(f"🔗 Project: {project_name or 'default'}")
        logger.info(f"🔗 Endpoint: {endpoint}")

        # Test the connection if langsmith is available
        try:
            from langsmith import Client

            client = Client(api_key=api_key, api_url=endpoint)
            # Test connection
            try:
                # Simple ping to verify credentials
                client.list_projects(limit=1)
                logger.info(f"🔗 LangSmith authentication successful")
            except Exception as auth_error:
                logger.warning(f"⚠️ LangSmith auth check failed: {auth_error}")
        except ImportError:
            logger.warning("⚠️ langsmith package not installed - tracing may not work")
            logger.warning("   Install with: pip install langsmith")
            enabled = False
        except Exception as e:
            logger.warning(f"⚠️ Failed to initialize LangSmith client: {e}")

    except Exception as e:
        logger.error(f"❌ Failed to configure LangSmith: {e}")
        enabled = False
else:
    if not tracing_enabled:
        logger.debug("⚠️ LangSmith disabled - LANGCHAIN_TRACING_V2 is not enabled")
    elif not api_key:
        logger.debug("⚠️ LangSmith disabled - missing LANGCHAIN_API_KEY")


def is_langsmith_enabled() -> bool:
    """
    Check if LangSmith tracing is enabled.

    Returns:
        bool: True if LangSmith is enabled, False otherwise
    """
    return enabled


def get_langsmith_config() -> dict:
    """
    Get LangSmith configuration details.

    Returns:
        dict: Configuration dictionary with enabled status, project, and endpoint
    """
    return {
        "enabled": enabled,
        "project": project_name,
        "endpoint": endpoint,
        "api_key_set": bool(api_key),
    }
