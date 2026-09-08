import json
import traceback
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from .utils.cache import Cache
from .utils.logger import logger
from core.prompts.prompt_files import read_prompt_file_or_fallback, safe_format, escape_braces
from .utils.config import config
from .utils.auth_utils import verify_and_authorize_thread_access
from core.services import redis
from core.services.supabase import DBConnection
from core.services.llm import make_llm_api_call
from run_agent_background import update_agent_run_status, _cleanup_redis_response_list

DEFAULT_INLINE_MODEL = "habitat/gpt-5.6-sol"

# Load Lucide React icons once at module level for performance
try:
    from pathlib import Path
    icons_file_path = Path(__file__).parent.parent / 'lucide_icons_cleaned.json'
    with open(icons_file_path, 'r') as f:
        RELEVANT_ICONS = json.load(f)
    logger.info(f"Loaded {len(RELEVANT_ICONS)} Lucide React icons from file")
except Exception as e:
    logger.warning(f"Failed to load icons file: {e}. Using fallback icons.")
    # Fallback to essential icons if file loading fails
    RELEVANT_ICONS = [
        # Core AI/Agent icons
        "message-circle", "code", "brain", "sparkles", "zap", "rocket", "bot",
        "cpu", "microchip", "terminal", "workflow", "target", "lightbulb",
        
        # Data & Storage
        "database", "file", "files", "folder", "folders", "hard-drive", "cloud",
        "download", "upload", "save", "copy", "trash", "archive",
        
        # User & Communication
        "user", "users", "mail", "phone", "send", "reply", "bell", 
        "headphones", "mic", "video", "camera",
        
        # Navigation & UI
        "house", "globe", "map", "map-pin", "search", "filter", "settings",
        "menu", "grid2x2", "list", "layout-grid", "panel-left", "panel-right",
        
        # Actions & Tools
        "play", "pause", "refresh-cw", "rotate-cw", "wrench", "pen", "pencil", 
        "brush", "scissors", "hammer",
        
        # Status & Feedback
        "check", "x", "plus", "minus", "info", "thumbs-up", "thumbs-down", 
        "heart", "star", "flag", "bookmark",
        
        # Time & Calendar
        "clock", "calendar", "timer", "hourglass", "history",
        
        # Security & Privacy
        "shield", "lock", "key", "fingerprint", "eye",
        
        # Business & Productivity
        "briefcase", "building", "store", "shopping-cart", "credit-card",
        "chart-bar", "chart-pie", "trending-up", "trending-down",
        
        # Creative & Media
        "music", "image", "images", "film", "palette", "paintbrush",
        "speaker", "volume",
        
        # System & Technical
        "cog", "monitor", "laptop", "smartphone", "wifi", "bluetooth", 
        "usb", "plug", "battery", "power",
        
        # Nature & Environment
        "sun", "moon", "leaf", "flower", "mountain", "earth"
    ]

# Global variables (will be set by initialize function)
db = None
instance_id = None

# Helper for version service
async def _get_version_service():
    from .versioning.version_service import get_version_service
    return await get_version_service()

async def cleanup():
    """Clean up resources and stop running agents on shutdown."""
    logger.debug("Starting cleanup of agent API resources")

    # Use the instance_id to find and clean up this instance's keys
    try:
        if instance_id: # Ensure instance_id is set
            running_keys = await redis.keys(f"active_run:{instance_id}:*")
            logger.debug(f"Found {len(running_keys)} running agent runs for instance {instance_id} to clean up")

            for key in running_keys:
                # Key format: active_run:{instance_id}:{agent_run_id}
                parts = key.split(":")
                if len(parts) == 3:
                    agent_run_id = parts[2]
                    await stop_agent_run_with_helpers(agent_run_id, error_message=f"Instance {instance_id} shutting down")
                else:
                    logger.warning(f"Unexpected key format found: {key}")
        else:
            logger.warning("Instance ID not set, cannot clean up instance-specific agent runs.")

    except Exception as e:
        logger.error(f"Failed to clean up running agent runs: {str(e)}")

    # Close Redis connection
    await redis.close()
    logger.debug("Completed cleanup of agent API resources")

async def stop_agent_run_with_helpers(agent_run_id: str, error_message: Optional[str] = None):
    """Update database and publish stop signal to Redis."""
    logger.debug(f"Stopping agent run: {agent_run_id}")
    client = await db.client
    final_status = "failed" if error_message else "stopped"

    # Attempt to fetch final responses from Redis
    response_list_key = f"agent_run:{agent_run_id}:responses"
    try:
        all_responses_json = await redis.lrange(response_list_key, 0, -1)
        logger.debug(f"Fetched {len(all_responses_json)} responses from Redis for DB update on stop/fail: {agent_run_id}")
    except Exception as e:
        logger.error(f"Failed to fetch responses from Redis for {agent_run_id} during stop/fail: {e}")
        # Try fetching from DB as a fallback? Or proceed without responses? Proceeding without for now.

    # Update the agent run status in the database
    update_success = await update_agent_run_status(
        client, agent_run_id, final_status, error=error_message
    )

    if not update_success:
        logger.error(f"Failed to update database status for stopped/failed run {agent_run_id}")
        raise HTTPException(status_code=500, detail="Failed to update agent run status in database")

    # Send STOP signal to the global control channel
    global_control_channel = f"agent_run:{agent_run_id}:control"
    try:
        await redis.publish(global_control_channel, "STOP")
        logger.debug(f"Published STOP signal to global channel {global_control_channel}")
    except Exception as e:
        logger.error(f"Failed to publish STOP signal to global channel {global_control_channel}: {str(e)}")

    # Find all instances handling this agent run and send STOP to instance-specific channels
    try:
        instance_keys = await redis.keys(f"active_run:*:{agent_run_id}")
        logger.debug(f"Found {len(instance_keys)} active instance keys for agent run {agent_run_id}")

        for key in instance_keys:
            # Key format: active_run:{instance_id}:{agent_run_id}
            parts = key.split(":")
            if len(parts) == 3:
                instance_id_from_key = parts[1]
                instance_control_channel = f"agent_run:{agent_run_id}:control:{instance_id_from_key}"
                try:
                    await redis.publish(instance_control_channel, "STOP")
                    logger.debug(f"Published STOP signal to instance channel {instance_control_channel}")
                except Exception as e:
                    logger.warning(f"Failed to publish STOP signal to instance channel {instance_control_channel}: {str(e)}")
            else:
                 logger.warning(f"Unexpected key format found: {key}")

        # Clean up the response list immediately on stop/fail
        await _cleanup_redis_response_list(agent_run_id)

    except Exception as e:
        logger.error(f"Failed to find or signal active instances for {agent_run_id}: {str(e)}")

    logger.debug(f"Successfully initiated stop process for agent run: {agent_run_id}")

async def get_agent_run_with_access_check(client, agent_run_id: str, user_id: str):
    agent_run = await client.table('agent_runs').select('*, threads(account_id)').eq('id', agent_run_id).execute()
    if not agent_run.data:
        raise HTTPException(status_code=404, detail="Agent run not found")

    agent_run_data = agent_run.data[0]
    thread_id = agent_run_data['thread_id']
    account_id = agent_run_data['threads']['account_id']
    if account_id == user_id:
        return agent_run_data
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    return agent_run_data


async def generate_session_title(thread_id: str, session_index: int) -> None:
    """Generate and store a concise title for a given session using the first few messages as context.

    On failure, store a fallback derived from the first user message.
    """
    try:
        db_conn = DBConnection()
        client = await db_conn.client

        # Load messages for the target session
        res = await client.table('messages').select('type, content, metadata, created_at').eq('thread_id', thread_id).order('created_at', desc=False).limit(200).execute()
        rows = res.data or []

        def _sess_of(m):
            md = m.get('metadata') or {}
            if isinstance(md, str):
                try:
                    import json as _json
                    md = _json.loads(md)
                except Exception:
                    md = {}
            sv = md.get('session_index')
            if sv is None:
                sv = 0
            try:
                sv = int(sv)
            except Exception:
                sv = 0
            return sv

        sess_msgs = [r for r in rows if _sess_of(r) == int(session_index)]
        if not sess_msgs:
            return

        # Build a tiny prompt from first few messages
        user_snippet = None
        context_texts = []
        for r in sess_msgs[:8]:
            c = r.get('content')
            text = None
            if isinstance(c, dict):
                text = c.get('content')
            elif isinstance(c, str):
                try:
                    import json as _json
                    text = (_json.loads(c) or {}).get('content')
                except Exception:
                    text = None
            if isinstance(text, str) and text.strip():
                context_texts.append(text.strip())
                if r.get('type') == 'user' and not user_snippet:
                    user_snippet = text.strip()

        fallback = (user_snippet or 'Conversation').strip()[:30]

        title = None
        try:
            # Use a small model to generate 2-5 word title
            from core.services.llm import make_llm_api_call
            small_model = DEFAULT_INLINE_MODEL
            system = {"role": "system", "content": "Summarize a short 2-5 word title for this chat."}
            user = {"role": "user", "content": "\n\n".join(context_texts)[:800]}
            resp = await make_llm_api_call(messages=[system, user], model_name=small_model, temperature=0.2, max_tokens=24)
            if isinstance(resp, dict):
                title = (resp.get('choices', [{}])[0].get('message', {}).get('content') or '').strip()
                if not title:
                    title = fallback
            else:
                title = fallback
        except Exception:
            title = fallback

        # Persist to thread metadata.session_titles
        tr = await client.table('threads').select('metadata').eq('thread_id', thread_id).limit(1).execute()
        tmeta = (tr.data[0].get('metadata') if tr.data else {}) or {}
        if isinstance(tmeta, str):
            try:
                import json as _json
                tmeta = _json.loads(tmeta)
            except Exception:
                tmeta = {}
        titles = tmeta.get('session_titles') or {}
        if not isinstance(titles, dict):
            titles = {}
        titles[str(int(session_index))] = (title or fallback)[:60]
        await client.table('threads').update({'metadata': {**tmeta, 'session_titles': titles}}).eq('thread_id', thread_id).execute()
    except Exception as e:
        logger.warning(f"Failed to generate session title for {thread_id}#{session_index}: {e}")

async def generate_and_update_project_name(project_id: str, prompt: str):
    """Generates a project name and icon using an LLM and updates the database."""
    logger.debug(f"Starting background task to generate name and icon for project: {project_id}")
    try:
        db_conn = DBConnection()
        client = await db_conn.client

        model_name = DEFAULT_INLINE_MODEL
        
        # Use pre-loaded Lucide React icons (loaded once at module level)
        relevant_icons = RELEVANT_ICONS
        default_template = (
            "You are a helpful assistant that generates extremely concise titles (2-4 words maximum) and selects appropriate icons for chat threads based on the user's message.\n\n"
            "Available Lucide React icons to choose from:\n"
            "{icons}\n\n"
            "Respond with a JSON object containing:\n"
            "- \"title\": A concise 2-4 word title for the thread\n"
            "- \"icon\": The most appropriate icon name from the list above\n\n"
            "Example response:\n"
            "{{\"title\": \"Code Review Help\", \"icon\": \"code\"}}"
        )
        template = read_prompt_file_or_fallback(
            "internal/thread_title_icon.prompt.md",
            default_template,
        )
        system_prompt = safe_format(
            template,
            icons=escape_braces(", ".join(relevant_icons)),
        )

        user_message = f"Generate an extremely brief title (2-4 words only) and select the most appropriate icon for a chat thread that starts with this message: \"{prompt}\""
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]

        logger.debug(f"Calling LLM ({model_name}) for project {project_id} naming and icon selection.")
        response = await make_llm_api_call(
            messages=messages, 
            model_name=model_name, 
            max_tokens=1000, 
            temperature=0.7,
            response_format={"type": "json_object"}
        )

        generated_name = None
        selected_icon = None
        
        if response and response.get('choices') and response['choices'][0].get('message'):
            raw_content = response['choices'][0]['message'].get('content', '').strip()
            try:
                parsed_response = json.loads(raw_content)
                
                if isinstance(parsed_response, dict):
                    # Extract title
                    title = parsed_response.get('title', '').strip()
                    if title:
                        generated_name = title.strip('\'" \n\t')
                        logger.debug(f"LLM generated name for project {project_id}: '{generated_name}'")
                    
                    # Extract icon
                    icon = parsed_response.get('icon', '').strip()
                    if icon and icon in relevant_icons:
                        selected_icon = icon
                        logger.debug(f"LLM selected icon for project {project_id}: '{selected_icon}'")
                    else:
                        logger.warning(f"LLM selected invalid icon '{icon}' for project {project_id}, using default 'message-circle'")
                        selected_icon = "message-circle"
                else:
                    logger.warning(f"LLM returned non-dict JSON for project {project_id}: {parsed_response}")
                    
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse LLM JSON response for project {project_id}: {e}. Raw content: {raw_content}")
                # Fallback to extracting title from raw content
                cleaned_content = raw_content.strip('\'" \n\t{}')
                if cleaned_content:
                    generated_name = cleaned_content[:50]  # Limit fallback title length
                selected_icon = "message-circle"  # Default icon
        else:
            logger.warning(f"Failed to get valid response from LLM for project {project_id} naming. Response: {response}")

        if generated_name:
            # Store title and icon in dedicated fields
            update_data = {"name": generated_name}
            if selected_icon:
                update_data["icon_name"] = selected_icon
                logger.debug(f"Storing project {project_id} with title: '{generated_name}' and icon: '{selected_icon}'")
            else:
                logger.debug(f"Storing project {project_id} with title: '{generated_name}' (no icon)")
            
            update_result = await client.table('projects').update(update_data).eq("project_id", project_id).execute()
            if hasattr(update_result, 'data') and update_result.data:
                logger.debug(f"Successfully updated project {project_id} with clean title and dedicated icon field")
            else:
                logger.error(f"Failed to update project {project_id} in database. Update result: {update_result}")
        else:
            logger.warning(f"No generated name, skipping database update for project {project_id}.")

    except Exception as e:
        logger.error(f"Error in background naming task for project {project_id}: {str(e)}\n{traceback.format_exc()}")
    finally:
        # No need to disconnect DBConnection singleton instance here
        logger.debug(f"Finished background naming and icon selection task for project: {project_id}")

async def generate_agent_icon_and_colors(name: str, description: str = None) -> dict:
    """Generates an agent icon and colors using an LLM based on agent name and description."""
    logger.debug(f"Generating icon and colors for agent: {name}")
    try:
        model_name = DEFAULT_INLINE_MODEL
        
        # Use pre-loaded Lucide React icons (loaded once at module level)
        relevant_icons = RELEVANT_ICONS
        
        # Use exact colors from frontend presetColors array
        frontend_colors = [
            "#000000", "#FFFFFF", "#6366F1", "#10B981", "#F59E0B", 
            "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
            "#06B6D4", "#84CC16", "#F43F5E", "#A855F7", "#3B82F6"
        ]
        
        agent_context = f"Agent name: {name}"
        if description:
            agent_context += f"\nAgent description: {description}"
            
        default_template = (
            "You are a helpful assistant that selects appropriate icons and colors for AI agents based on their name and description.\n\n"
            "Available Lucide React icons to choose from:\n"
            "{icons}\n\n"
            "Available colors (hex codes):\n"
            "{colors}\n\n"
            "Respond with a JSON object containing:\n"
            "- \"icon\": The most appropriate icon name from the available icons\n"
            "- \"background_color\": A background color hex code from the available colors\n"
            "- \"text_color\": A text color hex code from the available colors (choose one that contrasts well with the background)\n\n"
            "Example response:\n"
            "{{\"icon\": \"youtube\", \"background_color\": \"#EF4444\", \"text_color\": \"#FFFFFF\"}}"
        )
        template = read_prompt_file_or_fallback(
            "internal/agent_icon_colors.prompt.md",
            default_template,
        )
        system_prompt = safe_format(
            template,
            icons=escape_braces(", ".join(relevant_icons)),
            colors=escape_braces(", ".join(frontend_colors)),
        )

        user_message = f"Select the most appropriate icon and color scheme for this AI agent:\n{agent_context}"
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]

        logger.debug(f"Calling LLM ({model_name}) for agent icon and color generation.")
        response = await make_llm_api_call(
            messages=messages, 
            model_name=model_name, 
            max_tokens=4000, 
            temperature=0.7,
            response_format={"type": "json_object"}
        )

        # Default fallback values
        result = {
            "icon_name": "bot",
            "icon_color": "#FFFFFF", 
            "icon_background": "#6366F1"
        }
        
        if response and response.get('choices') and response['choices'][0].get('message'):
            raw_content = response['choices'][0]['message'].get('content', '').strip()
            try:
                parsed_response = json.loads(raw_content)
                
                if isinstance(parsed_response, dict):
                    # Extract and validate icon
                    icon = parsed_response.get('icon', '').strip()
                    if icon and icon in relevant_icons:
                        result["icon_name"] = icon
                        logger.debug(f"LLM selected icon: '{icon}'")
                    else:
                        logger.warning(f"LLM selected invalid icon '{icon}', using default 'bot'")
                    
                    # Extract and validate colors
                    bg_color = parsed_response.get('background_color', '').strip()
                    text_color = parsed_response.get('text_color', '').strip()
                    
                    if bg_color in frontend_colors:
                        result["icon_background"] = bg_color
                        logger.debug(f"LLM selected background color: '{bg_color}'")
                    else:
                        logger.warning(f"LLM selected invalid background color '{bg_color}', using default")
                    
                    if text_color in frontend_colors:
                        result["icon_color"] = text_color
                        logger.debug(f"LLM selected text color: '{text_color}'")
                    else:
                        logger.warning(f"LLM selected invalid text color '{text_color}', using default")
                        
                else:
                    logger.warning(f"LLM returned non-dict JSON: {parsed_response}")
                    
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse LLM JSON response: {e}. Raw content: {raw_content}")
        else:
            logger.warning(f"Failed to get valid response from LLM for agent icon generation. Response: {response}")

        logger.debug(f"Generated agent styling: icon={result['icon_name']}, bg={result['icon_background']}, color={result['icon_color']}")
        return result

    except Exception as e:
        logger.error(f"Error in agent icon generation: {str(e)}\n{traceback.format_exc()}")
        # Return safe defaults on error (using Indigo theme)
        return {
            "icon_name": "bot",
            "icon_color": "#FFFFFF", 
            "icon_background": "#6366F1"
        }

def merge_custom_mcps(existing_mcps: List[Dict[str, Any]], new_mcps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not new_mcps:
        return existing_mcps
    
    merged_mcps = existing_mcps.copy()
    
    for new_mcp in new_mcps:
        new_mcp_name = new_mcp.get('name')
        existing_index = None
        
        for i, existing_mcp in enumerate(merged_mcps):
            if existing_mcp.get('name') == new_mcp_name:
                existing_index = i
                break
        
        if existing_index is not None:
            merged_mcps[existing_index] = new_mcp
        else:
            merged_mcps.append(new_mcp)
    
    return merged_mcps

def initialize(
    _db: DBConnection,
    _instance_id: Optional[str] = None
):
    """Initialize the agent API with resources from the main API."""
    global db, instance_id
    db = _db
    
    # Initialize the versioning module with the same database connection
    from .versioning.api import initialize as initialize_versioning
    initialize_versioning(_db)

    # Use provided instance_id or generate a new one
    if _instance_id:
        instance_id = _instance_id
    else:
        # Generate instance ID
        instance_id = str(uuid.uuid4())[:8]

    logger.debug(f"Initialized agent API with instance ID: {instance_id}")

async def _cleanup_redis_response_list(agent_run_id: str):
    try:
        response_list_key = f"agent_run:{agent_run_id}:responses"
        await redis.delete(response_list_key)
        logger.debug(f"Cleaned up Redis response list for agent run {agent_run_id}")
    except Exception as e:
        logger.warning(f"Failed to clean up Redis response list for {agent_run_id}: {str(e)}")


async def check_for_active_project_agent_run(client, project_id: str):
    project_threads = await client.table('threads').select('thread_id').eq('project_id', project_id).execute()
    project_thread_ids = [t['thread_id'] for t in project_threads.data]

    if project_thread_ids:
        from .utils.query_utils import batch_query_in
        
        active_runs = await batch_query_in(
            client=client,
            table_name='agent_runs',
            select_fields='id',
            in_field='thread_id',
            in_values=project_thread_ids,
            additional_filters={'status': 'running'}
        )
        
        if active_runs:
            return active_runs[0]['id']
    return None


async def stop_agent_run(db, agent_run_id: str, error_message: Optional[str] = None):
    logger.debug(f"Stopping agent run: {agent_run_id}")
    client = await db.client
    final_status = "failed" if error_message else "stopped"

    response_list_key = f"agent_run:{agent_run_id}:responses"
    all_responses = []
    try:
        all_responses_json = await redis.lrange(response_list_key, 0, -1)
        all_responses = [json.loads(r) for r in all_responses_json]
        logger.debug(f"Fetched {len(all_responses)} responses from Redis for DB update on stop/fail: {agent_run_id}")
    except Exception as e:
        logger.error(f"Failed to fetch responses from Redis for {agent_run_id} during stop/fail: {e}")

    update_success = await update_agent_run_status(
        client, agent_run_id, final_status, error=error_message
    )

    if not update_success:
        logger.error(f"Failed to update database status for stopped/failed run {agent_run_id}")

    global_control_channel = f"agent_run:{agent_run_id}:control"
    try:
        await redis.publish(global_control_channel, "STOP")
        logger.debug(f"Published STOP signal to global channel {global_control_channel}")
    except Exception as e:
        logger.error(f"Failed to publish STOP signal to global channel {global_control_channel}: {str(e)}")

    try:
        instance_keys = await redis.keys(f"active_run:*:{agent_run_id}")
        logger.debug(f"Found {len(instance_keys)} active instance keys for agent run {agent_run_id}")

        for key in instance_keys:
            parts = key.split(":")
            if len(parts) == 3:
                instance_id_from_key = parts[1]
                instance_control_channel = f"agent_run:{agent_run_id}:control:{instance_id_from_key}"
                try:
                    await redis.publish(instance_control_channel, "STOP")
                    logger.debug(f"Published STOP signal to instance channel {instance_control_channel}")
                except Exception as e:
                    logger.warning(f"Failed to publish STOP signal to instance channel {instance_control_channel}: {str(e)}")
            else:
                logger.warning(f"Unexpected key format found: {key}")

        await _cleanup_redis_response_list(agent_run_id)

    except Exception as e:
        logger.error(f"Failed to find or signal active instances for {agent_run_id}: {str(e)}")

    logger.debug(f"Successfully initiated stop process for agent run: {agent_run_id}")


async def check_agent_run_limit(client, account_id: str) -> Dict[str, Any]:
    """
    Check if the account has reached the limit of 3 parallel agent runs within the past 24 hours.
    
    Returns:
        Dict with 'can_start' (bool), 'running_count' (int), 'running_thread_ids' (list)
        
    Note: This function does not use caching to ensure real-time limit checks.
    """
    try:

        # Calculate 24 hours ago
        twenty_four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=24)
        twenty_four_hours_ago_iso = twenty_four_hours_ago.isoformat()
        
        logger.debug(f"Checking agent run limit for account {account_id} since {twenty_four_hours_ago_iso}")
        
        # Get all threads for this account
        threads_result = await client.table('threads').select('thread_id').eq('account_id', account_id).execute()
        
        if not threads_result.data:
            logger.debug(f"No threads found for account {account_id}")
            return {
                'can_start': True,
                'running_count': 0,
                'running_thread_ids': []
            }
        
        thread_ids = [thread['thread_id'] for thread in threads_result.data]
        logger.debug(f"Found {len(thread_ids)} threads for account {account_id}")
        
        # Query for running agent runs within the past 24 hours for these threads
        from .utils.query_utils import batch_query_in
        
        additional_filters = {
            "status": "running",
            "started_at_gte": twenty_four_hours_ago_iso,
            # WS-D: shadow runs must not count toward run limits.
            "is_shadow": False,
        }

        try:
            running_runs = await batch_query_in(
                client=client,
                table_name="agent_runs",
                select_fields="id, thread_id, started_at",
                in_field="thread_id",
                in_values=thread_ids,
                additional_filters=additional_filters,
            )
        except Exception as e:
            # Backward compatibility for environments where `is_shadow` is not yet migrated.
            logger.debug(f"check_agent_run_limit: fallback without is_shadow filter: {e}")
            additional_filters.pop("is_shadow", None)
            running_runs = await batch_query_in(
                client=client,
                table_name="agent_runs",
                select_fields="id, thread_id, started_at",
                in_field="thread_id",
                in_values=thread_ids,
                additional_filters=additional_filters,
            )
        
        running_count = len(running_runs)
        running_thread_ids = [run['thread_id'] for run in running_runs]
        
        logger.debug(f"Account {account_id} has {running_count} running agent runs in the past 24 hours")
        
        result = {
            'can_start': running_count < config.MAX_PARALLEL_AGENT_RUNS,
            'running_count': running_count,
            'running_thread_ids': running_thread_ids
        }
        return result

    except Exception as e:
        logger.error(f"Error checking agent run limit for account {account_id}: {str(e)}")
        # In case of error, allow the run to proceed but log the error
        return {
            'can_start': True,
            'running_count': 0,
            'running_thread_ids': []
        }


async def check_agent_count_limit(client, account_id: str) -> Dict[str, Any]:
    """
    Check if a user can create more agents based on their subscription tier.
    
    Returns:
        Dict containing:
        - can_create: bool - whether user can create another agent
        - current_count: int - current number of custom agents (excluding default agents)
        - limit: int - maximum agents allowed for this tier
        - tier_name: str - subscription tier name
    
    Note: This function does not use caching to ensure real-time agent counts.
    """
    try:
        # In local mode, allow practically unlimited custom agents
        if config.ENV_MODE.value == "local":
            return {
                'can_create': True,
                'current_count': 0,  # Return 0 to avoid showing any limit warnings
                'limit': 999999,     # Practically unlimited
                'tier_name': 'local'
            }
        
        # Always query fresh data from database to avoid stale cache issues
        agents_result = await client.table('agents').select('agent_id, metadata').eq('account_id', account_id).execute()
        
        non_default_agents = []
        for agent in agents_result.data or []:
            metadata = agent.get('metadata', {}) or {}
            is_default = metadata.get('is_zmind_default', False)
            if not is_default:
                non_default_agents.append(agent)
                
        current_count = len(non_default_agents)
        logger.debug(f"Account {account_id} has {current_count} custom agents (excluding default agents)")
        
        try:
            from core.billing import entitlements
            tier_info = await entitlements.get_user_subscription_tier(account_id)
            tier_name = tier_info['name']
            logger.debug(f"Account {account_id} subscription tier: {tier_name}")
        except Exception as billing_error:
            logger.warning(f"Could not get subscription tier for {account_id}: {str(billing_error)}, defaulting to free")
            tier_name = 'free'
        
        agent_limit = config.AGENT_LIMITS.get(tier_name, config.AGENT_LIMITS['free'])
        
        can_create = current_count < agent_limit
        
        result = {
            'can_create': can_create,
            'current_count': current_count,
            'limit': agent_limit,
            'tier_name': tier_name
        }
        
        logger.debug(f"Account {account_id} has {current_count}/{agent_limit} agents (tier: {tier_name}) - can_create: {can_create} (real-time count)")
        
        return result
        
    except Exception as e:
        logger.error(f"Error checking agent count limit for account {account_id}: {str(e)}", exc_info=True)
        return {
            'can_create': True,
            'current_count': 0,
            'limit': config.AGENT_LIMITS['free'],
            'tier_name': 'free'
        }


async def check_project_count_limit(client, account_id: str) -> Dict[str, Any]:
    """
    Check if a user can create more projects based on their subscription tier.
    
    Returns:
        Dict containing:
        - can_create: bool - whether user can create another project
        - current_count: int - current number of projects
        - limit: int - maximum projects allowed for this tier
        - tier_name: str - subscription tier name
    
    Note: This function does not use caching to ensure real-time project counts,
    preventing issues where deleted projects aren't immediately reflected in limits.
    """
    try:
        # In local mode, allow practically unlimited projects
        if config.ENV_MODE.value == "local":
            return {
                'can_create': True,
                'current_count': 0,  # Return 0 to avoid showing any limit warnings
                'limit': 999999,     # Practically unlimited
                'tier_name': 'local'
            }
        
        try:
            result = await Cache.get(f"project_count_limit:{account_id}")
            if result:
                logger.debug(f"Cache hit for project count limit: {account_id}")
                return result
        except Exception as cache_error:
            logger.warning(f"Cache read failed for project count limit {account_id}: {str(cache_error)}")

        projects_result = await client.table('projects').select('project_id').eq('account_id', account_id).execute()
        current_count = len(projects_result.data or [])
        logger.debug(f"Account {account_id} has {current_count} projects (real-time count)")
        
        try:
            credit_result = await client.table('credit_accounts').select('tier').eq('account_id', account_id).single().execute()
            tier_name = credit_result.data.get('tier', 'free') if credit_result.data else 'free'
            logger.debug(f"Account {account_id} credit tier: {tier_name}")
        except Exception as credit_error:
            try:
                logger.debug(f"Trying user_id fallback for account {account_id}")
                credit_result = await client.table('credit_accounts').select('tier').eq('user_id', account_id).single().execute()
                tier_name = credit_result.data.get('tier', 'free') if credit_result.data else 'free'
                logger.debug(f"Account {account_id} credit tier (via fallback): {tier_name}")
            except:
                logger.debug(f"No credit account for {account_id}, defaulting to free tier")
                tier_name = 'free'
        
        from core.billing.config import get_project_limit
        project_limit = get_project_limit(tier_name)
        can_create = current_count < project_limit
        
        result = {
            'can_create': can_create,
            'current_count': current_count,
            'limit': project_limit,
            'tier_name': tier_name
        }
        
        logger.debug(f"Account {account_id} has {current_count}/{project_limit} projects (tier: {tier_name}) - can_create: {can_create}")
        
        return result
        
    except Exception as e:
        logger.error(f"Error checking project count limit for account {account_id}: {str(e)}", exc_info=True)
        return {
            'can_create': False,
            'current_count': 0,
            'limit': config.PROJECT_LIMITS['free'],
            'tier_name': 'free'
        }


# Removed import-time test harness to avoid side effects.
