from core.prompts.prompt import SYSTEM_PROMPT
from core.ai_models.registry import DEFAULT_FREE_MODEL

# Zmind default configuration - simplified and centralized
ZMIND_CONFIG = {
    "name": "Zmind",
    "description": "Zmind 是由真知科技团队打造的多模态智能助手，具备苏格拉底式引导与强大的工具调用能力，帮助你在明确任务上高效执行、在探索性问题上深化思考。",
    "avatar": "🌞",
    "avatar_color": "#F59E0B",
    "model": DEFAULT_FREE_MODEL,
    "system_prompt": SYSTEM_PROMPT,
    "configured_mcps": [],
    "custom_mcps": [],
    "native_tools": {
        "web_search_tool": True,
        "upload_file_tool": True,
        "data_providers_tool": True,
        "mcp_search_tool": True,
        "credential_profile_tool": True,
        "trigger_tool": True,
    },
    "is_default": True
}
