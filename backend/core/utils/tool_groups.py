from typing import Dict, List, Any, Optional
from dataclasses import dataclass

@dataclass
class ToolMethod:
    name: str
    display_name: str
    description: str
    enabled: bool = True
    is_core: bool = False

@dataclass
class ToolGroup:
    name: str
    display_name: str
    description: str
    tool_class: str
    methods: List[ToolMethod]
    enabled: bool = True
    is_core: bool = False

TOOL_GROUPS: Dict[str, ToolGroup] = {
    # Cloud-based web search tool (replaces sandbox web search)
    "web_search_tool": ToolGroup(
        name="web_search_tool",
        display_name="Web Search",
        description="Search the web and scrape content for research (cloud APIs)",
        tool_class="WebSearchTool",
        methods=[
            ToolMethod(
                name="web_search",
                display_name="Web Search",
                description="Search the web using Tavily API",
                enabled=True
            ),
            ToolMethod(
                name="scrape_webpage",
                display_name="Scrape Webpage",
                description="Scrape webpage content using Firecrawl",
                enabled=True
            ),
        ]
    ),

    
    "expand_message_tool": ToolGroup(
        name="expand_message_tool",
        display_name="Message Expansion",
        description="Expand truncated messages from conversations",
        tool_class="ExpandMessageTool",
        is_core=True,
        methods=[
            ToolMethod(
                name="expand_message",
                display_name="Expand Message",
                description="Expand truncated messages",
                enabled=True,
                is_core=True
            ),
        ]
    ),
    
    # Removed all sandbox-based deployment/port/image-search tools

    "data_providers_tool": ToolGroup(
        name="data_providers_tool",
        display_name="Data Providers",
        description="Access to data providers and external APIs",
        tool_class="DataProvidersTool",
        methods=[
            ToolMethod(
                name="get_data_provider_endpoints",
                display_name="Get Data Provider Endpoints",
                description="List available data provider endpoints",
                enabled=True
            ),
            ToolMethod(
                name="execute_data_provider_call",
                display_name="Execute Data Provider Call",
                description="Execute calls to external data providers",
                enabled=True
            ),
        ]
    ),

    "agent_config_tool": ToolGroup(
        name="agent_config_tool",
        display_name="Agent Configuration",
        description="Configure agent settings, tools, and integrations",
        tool_class="AgentConfigTool",
        methods=[
            ToolMethod(
                name="update_agent",
                display_name="Update Agent",
                description="Update agent configuration and settings",
                enabled=True
            ),
            ToolMethod(
                name="get_current_agent_config",
                display_name="Get Agent Config",
                description="Get current agent configuration",
                enabled=True
            ),
        ]
    ),

    "mcp_search_tool": ToolGroup(
        name="mcp_search_tool",
        display_name="MCP Search",
        description="Search and discover MCP servers and integrations",
        tool_class="MCPSearchTool",
        methods=[
            ToolMethod(
                name="search_mcp_servers",
                display_name="Search MCP Servers",
                description="Search for available MCP server integrations",
                enabled=True
            ),
            ToolMethod(
                name="get_app_details",
                display_name="Get App Details",
                description="Get detailed information about MCP apps",
                enabled=True
            ),
            ToolMethod(
                name="discover_user_mcp_servers",
                display_name="Discover User MCP Servers",
                description="Discover user's available MCP servers",
                enabled=True
            ),
        ]
    ),

    "credential_profile_tool": ToolGroup(
        name="credential_profile_tool",
        display_name="Credential Management",
        description="Manage credential profiles for secure authentication",
        tool_class="CredentialProfileTool",
        methods=[
            ToolMethod(
                name="get_credential_profiles",
                display_name="Get Credential Profiles",
                description="List all available credential profiles",
                enabled=True
            ),
            ToolMethod(
                name="create_credential_profile",
                display_name="Create Credential Profile",
                description="Create new credential profiles for authentication",
                enabled=True
            ),
            ToolMethod(
                name="configure_profile_for_agent",
                display_name="Configure Profile for Agent",
                description="Configure credential profile for agent use",
                enabled=True
            ),
            ToolMethod(
                name="delete_credential_profile",
                display_name="Delete Credential Profile",
                description="Delete existing credential profiles",
                enabled=True
            ),
        ]
    ),

    "trigger_tool": ToolGroup(
        name="trigger_tool",
        display_name="Triggers",
        description="Create and manage scheduled and event-based triggers",
        tool_class="TriggerTool",
        methods=[
            ToolMethod(
                name="create_scheduled_trigger",
                display_name="Create Scheduled Trigger",
                description="Create a scheduled trigger for an agent",
                enabled=True,
            ),
            ToolMethod(
                name="get_scheduled_triggers",
                display_name="Get Scheduled Triggers",
                description="List scheduled triggers for an agent",
                enabled=True,
            ),
            ToolMethod(
                name="delete_scheduled_trigger",
                display_name="Delete Scheduled Trigger",
                description="Delete a scheduled trigger",
                enabled=True,
            ),
            ToolMethod(
                name="toggle_scheduled_trigger",
                display_name="Toggle Scheduled Trigger",
                description="Enable or disable a scheduled trigger",
                enabled=True,
            ),
            ToolMethod(
                name="list_event_trigger_apps",
                display_name="List Event Trigger Apps",
                description="List apps that support event triggers",
                enabled=True,
            ),
            ToolMethod(
                name="list_app_event_triggers",
                display_name="List App Event Triggers",
                description="List trigger types for an app",
                enabled=True,
            ),
            ToolMethod(
                name="create_event_trigger",
                display_name="Create Event Trigger",
                description="Create a Composio event trigger",
                enabled=True,
            ),
        ],
    ),

    # Removed sandbox knowledge base, design, presentation outline, file upload, docs tools

    # agent_creation_tool removed

    # Removed sandbox browser automation groups

    "people_search_tool": ToolGroup(
        name="people_search_tool",
        display_name="People Search",
        description="Search for people using LinkedIn",
        tool_class="PeopleSearchTool",
        methods=[
            ToolMethod(
                name="people_search",
                display_name="People Search",
                description="Search for people using LinkedIn",
                enabled=True
            ),
        ]
    ),

    "company_search_tool": ToolGroup(
        name="company_search_tool",
        display_name="Company Search",
        description="Search for companies using natural language queries",
        tool_class="CompanySearchTool",
        methods=[
            ToolMethod(
                name="company_search",
                display_name="Company Search",
                description="Search for companies using natural language queries",
                enabled=True
            ),
        ]
    ),

    # Removed sandbox web dev and templates tools

    "computer_use_tool": ToolGroup(
        name="computer_use_tool",
        display_name="Computer Automation",
        description="Automate computer interactions including GUI control",
        tool_class="ComputerUseTool",
        methods=[
            ToolMethod(
                name="screenshot",
                display_name="Take Screenshot",
                description="Capture screenshot of current screen",
                enabled=True
            ),
            ToolMethod(
                name="click",
                display_name="Click",
                description="Click at coordinates or on elements",
                enabled=True
            ),
            ToolMethod(
                name="type",
                display_name="Type Text",
                description="Type text into active element",
                enabled=True
            ),
            ToolMethod(
                name="key",
                display_name="Press Keys",
                description="Press keyboard keys and shortcuts",
                enabled=True
            ),
            ToolMethod(
                name="scroll",
                display_name="Scroll",
                description="Scroll in specified direction",
                enabled=True
            ),
        ]
    ),

    "message_tool": ToolGroup(
        name="message_tool",
        display_name="User Communication",
        description="Enhanced communication tools for user interaction",
        tool_class="MessageTool",
        is_core=True,
        methods=[
            ToolMethod(
                name="ask",
                display_name="Ask Question",
                description="Ask users questions during task execution",
                enabled=True,
                is_core=True
            ),
            ToolMethod(
                name="web_browser_takeover",
                display_name="Request Browser Takeover",
                description="Request user takeover of browser interaction",
                enabled=True
            ),
            ToolMethod(
                name="complete",
                display_name="Complete Task",
                description="Signal task completion and enter complete state",
                enabled=True,
                is_core=True
            ),
            ToolMethod(
                name="wait",
                display_name="Wait",
                description="Pause execution for specified duration",
                enabled=True
            ),
        ]
    ),

    "skills_tool": ToolGroup(
        name="skills_tool",
        display_name="Skills",
        description="Skill registry and execution utilities",
        tool_class="SkillsTool",
        methods=[
            ToolMethod(
                name="list_skills",
                display_name="List Skills",
                description="List built-in and user-defined skills",
                enabled=True,
            ),
            ToolMethod(
                name="install_skill",
                display_name="Install Skill",
                description="Install a skill from GitHub, manual markdown, or marketplace",
                enabled=True,
            ),
            ToolMethod(
                name="run_skill",
                display_name="Run Skill",
                description="Run a skill by id and return structured output",
                enabled=True,
            ),
        ],
    ),
}

def get_tool_group(tool_name: str) -> Optional[ToolGroup]:
    return TOOL_GROUPS.get(tool_name)

def get_all_tool_groups() -> Dict[str, ToolGroup]:
    return TOOL_GROUPS

def get_enabled_methods_for_tool(tool_name: str, config: Dict[str, Any]) -> List[str]:
    tool_group = get_tool_group(tool_name)
    if not tool_group:
        return []
    
    tool_config = config.get(tool_name, True)
    
    if isinstance(tool_config, bool) and not tool_config:
        return []
    
    if tool_config is True:
        return [method.name for method in tool_group.methods if method.enabled]
    
    if isinstance(tool_config, dict):
        if not tool_config.get('enabled', True):
            return []
        
        methods_config = tool_config.get('methods', {})
        enabled_methods = []
        
        for method in tool_group.methods:
            method_enabled = method.enabled
            
            if method.name in methods_config:
                method_config = methods_config[method.name]
                if isinstance(method_config, bool):
                    method_enabled = method_config
                elif isinstance(method_config, dict):
                    method_enabled = method_config.get('enabled', method.enabled)
            
            if method_enabled:
                enabled_methods.append(method.name)
        
        return enabled_methods
    
    return [method.name for method in tool_group.methods if method.enabled]

def validate_tool_config(config: Dict[str, Any]) -> Dict[str, Any]:
    normalized_config = {}
    
    for tool_name, tool_config in config.items():
        tool_group = get_tool_group(tool_name)
        if not tool_group:
            normalized_config[tool_name] = tool_config
            continue
        
        if tool_group.is_core:
            normalized_config[tool_name] = True
            continue
        
        if isinstance(tool_config, bool):
            normalized_config[tool_name] = tool_config
        elif isinstance(tool_config, dict):
            validated_config = {
                'enabled': tool_config.get('enabled', True),
                'methods': {}
            }
            
            methods_config = tool_config.get('methods', {})
            for method in tool_group.methods:
                if method.name in methods_config:
                    method_config = methods_config[method.name]
                    if isinstance(method_config, bool):
                        validated_config['methods'][method.name] = method_config
                    elif isinstance(method_config, dict):
                        validated_config['methods'][method.name] = {
                            'enabled': method_config.get('enabled', method.enabled)
                        }
                    else:
                        validated_config['methods'][method.name] = method.enabled
                else:
                    validated_config['methods'][method.name] = method.enabled
            
            normalized_config[tool_name] = validated_config
        else:
            normalized_config[tool_name] = True
    
    return normalized_config
