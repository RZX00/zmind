"""
LLM API interface for making calls to various language models.

This module provides a unified interface for making API calls to different LLM providers
(OpenAI, Anthropic, Groq, xAI, etc.) using LiteLLM. It includes support for:
- Streaming responses
- Tool calls and function calling
- Retry logic with exponential backoff
- Model-specific configurations
- Comprehensive error handling and logging
"""

import asyncio
from typing import Union, Dict, Any, Optional, AsyncGenerator, List, Callable, Awaitable
import os
import json
import httpx
from types import SimpleNamespace
import litellm
from litellm.router import Router
from litellm.files.main import ModelResponse
from litellm.exceptions import APIError as LiteLLMAPIError
from core.utils.logger import logger
from core.utils.config import config

# litellm.set_verbose=True
# Let LiteLLM auto-adjust params and drop unsupported ones (e.g., GPT-5 temperature!=1)
litellm.modify_params = True
litellm.drop_params = True

# Constants
MAX_RETRIES = 3
provider_router = None
HABITAT_FALLBACK_BASE = "https://eapi.site/v1"
AIPING_FALLBACK_BASE = "https://aiping.cn/api/v1"
DEFAULT_HEDGED_MODEL = "habitat/gemini-3.8-flash"
DEFAULT_HEDGED_DELAY_MS = 2500


class LLMError(Exception):
    """Base exception for LLM-related errors."""
    pass


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _resolve_hedged_delay_ms() -> int:
    raw = (os.getenv("LLM_HEDGED_DELAY_MS") or "").strip()
    if not raw:
        return DEFAULT_HEDGED_DELAY_MS
    try:
        return max(0, int(float(raw)))
    except Exception:
        return DEFAULT_HEDGED_DELAY_MS


def _resolve_hedged_model(primary_model: str) -> Optional[str]:
    candidate = (os.getenv("LLM_HEDGED_MODEL") or "").strip() or DEFAULT_HEDGED_MODEL
    if not candidate:
        return None
    if candidate.lower() == (primary_model or "").strip().lower():
        return None
    return candidate


async def _cancel_tasks(tasks: list[asyncio.Task]) -> None:
    pending = [task for task in tasks if task is not None and not task.done()]
    if not pending:
        return
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


async def _run_hedged_requests(
    *,
    primary_factory: Callable[[], Awaitable[Any]],
    hedge_factory: Callable[[], Awaitable[Any]],
    delay_ms: int,
    primary_model: str,
    hedge_model: str,
) -> Any:
    primary_task = asyncio.create_task(primary_factory())
    hedge_task: Optional[asyncio.Task] = None

    try:
        if delay_ms > 0:
            try:
                return await asyncio.wait_for(asyncio.shield(primary_task), timeout=delay_ms / 1000.0)
            except asyncio.TimeoutError:
                hedge_task = asyncio.create_task(hedge_factory())
        else:
            hedge_task = asyncio.create_task(hedge_factory())

        errors: list[Exception] = []
        active: set[asyncio.Task] = {primary_task}
        if hedge_task is not None:
            active.add(hedge_task)

        while active:
            done, pending = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                try:
                    result = task.result()
                    winner = "primary" if task is primary_task else "hedge"
                    logger.info(
                        "Hedged LLM request completed",
                        winner=winner,
                        primary_model=primary_model,
                        hedge_model=hedge_model,
                        delay_ms=delay_ms,
                    )
                    await _cancel_tasks(list(pending))
                    return result
                except Exception as exc:
                    if isinstance(exc, Exception):
                        errors.append(exc)
            active = set(pending)

        if errors:
            raise errors[-1]
        raise LLMError("Hedged request failed without any result")
    finally:
        tasks = [primary_task]
        if hedge_task is not None:
            tasks.append(hedge_task)
        await _cancel_tasks(tasks)

def setup_api_keys() -> None:
    """Set up API keys from environment variables."""
    providers = [
        "GEMINI",
        "HABITAT",
        "AIPING",
    ]
    for provider in providers:
        key = getattr(config, f"{provider}_API_KEY")
        if key:
            logger.debug(f"API key set for provider: {provider}")
        else:
            logger.warning(f"No API key found for provider: {provider}")

    if config.HABITAT_API_KEY:
        os.environ.setdefault("HABITAT_API_KEY", config.HABITAT_API_KEY)
    if config.AIPING_API_KEY:
        os.environ.setdefault("AIPING_API_KEY", config.AIPING_API_KEY)

    if config.GEMINI_API_KEY:
        os.environ.setdefault("GEMINI_API_KEY", config.GEMINI_API_KEY)
        os.environ.setdefault("GOOGLE_API_KEY", config.GEMINI_API_KEY)
        os.environ.setdefault("VERTEXAI_API_KEY", config.GEMINI_API_KEY)

    if config.VERTEXAI_PROJECT:
        os.environ.setdefault("VERTEXAI_PROJECT", config.VERTEXAI_PROJECT)
    if config.VERTEXAI_LOCATION:
        os.environ.setdefault("VERTEXAI_LOCATION", config.VERTEXAI_LOCATION)
    if config.VERTEXAI_API_BASE:
        os.environ.setdefault("VERTEXAI_API_BASE", config.VERTEXAI_API_BASE)
    if config.VERTEXAI_CREDENTIALS:
        os.environ.setdefault("VERTEXAI_CREDENTIALS", config.VERTEXAI_CREDENTIALS)

    # Set up AWS Bedrock credentials
    aws_access_key = config.AWS_ACCESS_KEY_ID
    aws_secret_key = config.AWS_SECRET_ACCESS_KEY
    aws_region = config.AWS_REGION_NAME

    if aws_access_key and aws_secret_key and aws_region:
        logger.debug(f"AWS credentials set for Bedrock in region: {aws_region}")
        # Configure LiteLLM to use AWS credentials
        os.environ["AWS_ACCESS_KEY_ID"] = aws_access_key
        os.environ["AWS_SECRET_ACCESS_KEY"] = aws_secret_key
        os.environ["AWS_REGION_NAME"] = aws_region
    else:
        logger.warning(
            f"Missing AWS credentials for Bedrock integration - access_key: {bool(aws_access_key)}, secret_key: {bool(aws_secret_key)}, region: {aws_region}"
        )

    if config.AZURE_OPENAI_API_KEY and config.AZURE_OPENAI_ENDPOINT:
        os.environ.setdefault("AZURE_API_KEY", config.AZURE_OPENAI_API_KEY)
        os.environ.setdefault("AZURE_API_BASE", config.AZURE_OPENAI_ENDPOINT)
        os.environ.setdefault("AZURE_API_VERSION", config.AZURE_OPENAI_API_VERSION)
        if config.AZURE_OPENAI_DEPLOYMENTS:
            os.environ.setdefault(
                "AZURE_OPENAI_DEPLOYMENTS",
                json.dumps(config.AZURE_OPENAI_DEPLOYMENTS),
            )
        logger.debug("Azure OpenAI configuration detected and environment variables initialized.")
    else:
        logger.debug("Azure OpenAI configuration not provided; Azure routes will be disabled.")


def _normalize_openai_base(api_base: Optional[str]) -> Optional[str]:
    """Normalize OpenAI-compatible api_base to exclude '/chat/completions' suffix and trailing slash."""
    if not api_base:
        return None
    base = api_base.rstrip("/")
    suffix = "/chat/completions"
    if base.endswith(suffix):
        base = base[: -len(suffix)]
    return base


def setup_provider_router(openai_compatible_api_key: str = None, openai_compatible_api_base: str = None):
    """Configure LiteLLM Router to strictly use Vertex AI for Gemini models.

    This removes any fallback to Google AI Studio. If Vertex configuration or
    credentials are missing, requests will error rather than silently fallback.
    """
    global provider_router

    # Build model list for Router (Vertex only)
    vertex_params: Dict[str, Any] = {"custom_llm_provider": "vertex_ai"}
    if config.VERTEXAI_PROJECT:
        vertex_params["vertex_project"] = config.VERTEXAI_PROJECT
    if config.VERTEXAI_LOCATION:
        vertex_params["vertex_location"] = config.VERTEXAI_LOCATION
    if config.VERTEXAI_API_BASE:
        vertex_params["api_base"] = config.VERTEXAI_API_BASE
    if config.VERTEXAI_CREDENTIALS:
        vertex_params["vertex_credentials"] = config.VERTEXAI_CREDENTIALS

    def _params_with_model(pattern: str) -> Dict[str, Any]:
        p = dict(vertex_params)
        p["model"] = pattern
        return p

    habitat_api_base = _normalize_openai_base(config.HABITAT_API_BASE) or HABITAT_FALLBACK_BASE
    habitat_params: Dict[str, Any] = {
        "custom_llm_provider": "openai",
        "api_base": habitat_api_base,
        "api_key": config.HABITAT_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY,
        "model": "*",
    }
    aiping_api_base = _normalize_openai_base(config.AIPING_API_BASE) or AIPING_FALLBACK_BASE
    aiping_params: Dict[str, Any] = {
        "custom_llm_provider": "openai",
        "api_base": aiping_api_base,
        "api_key": config.AIPING_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY,
        "model": "*",
    }

    model_list = [
        {"model_name": "habitat/*", "litellm_params": habitat_params},
        {"model_name": "aiping/*", "litellm_params": aiping_params},
        {
            "model_name": "*",
            "litellm_params": {
                "model": "*",
            },
        },
    ]

    if config.AZURE_OPENAI_API_KEY and config.AZURE_OPENAI_ENDPOINT:
        azure_params = {
            "custom_llm_provider": "azure",
            "api_key": config.AZURE_OPENAI_API_KEY,
            "api_base": config.AZURE_OPENAI_ENDPOINT,
            "api_version": config.AZURE_OPENAI_API_VERSION,
        }
        deployments = config.AZURE_OPENAI_DEPLOYMENTS or {}
        if deployments:
            for canonical_id, deployment_name in deployments.items():
                entry_params = dict(azure_params)
                entry_params["model"] = deployment_name
                model_list.append({"model_name": canonical_id, "litellm_params": entry_params})
                alias_key = f"azure/{canonical_id}"
                model_list.append({"model_name": alias_key, "litellm_params": dict(entry_params)})
        else:
            model_list.append({"model_name": "azure/*", "litellm_params": {**azure_params, "model": "azure/*"}})

    model_list.append(
        {
            "model_name": "openai-compatible/*",  # support OpenAI-Compatible LLM provider
            "litellm_params": {
                "model": "openai/*",
                "api_key": openai_compatible_api_key or config.OPENAI_COMPATIBLE_API_KEY,
                "api_base": openai_compatible_api_base or config.OPENAI_COMPATIBLE_API_BASE,
            },
        }
    )
    model_list.append(
        {
            "model_name": "*",  # supported LLM provider by LiteLLM
            "litellm_params": {
                "model": "*",
            },
        },
    )
    provider_router = Router(model_list=model_list)


def get_openrouter_fallback(model_name: str) -> Optional[str]:
    """Gemini-only deployment does not require OpenRouter fallbacks."""
    return None

def _normalize_openrouter_provider_name(model_name: str) -> str:
    """Deprecated: OpenRouter paths are not used."""
    return model_name

def _configure_token_limits(params: Dict[str, Any], model_name: str, max_tokens: Optional[int]) -> None:
    """Configure token limits based on model type."""
    if max_tokens is None:
        return
    
    if model_name.startswith("bedrock/") and "claude-3-7" in model_name:
        # For Claude 3.7 in Bedrock, do not set max_tokens or max_tokens_to_sample
        # as it causes errors with inference profiles
        logger.debug(f"Skipping max_tokens for Claude 3.7 model: {model_name}")
        return
    
    is_openai_o_series = 'o1' in model_name
    is_openai_gpt5 = 'gpt-5' in model_name
    param_name = "max_completion_tokens" if (is_openai_o_series or is_openai_gpt5) else "max_tokens"
    params[param_name] = max_tokens

def _configure_habitat(params: Dict[str, Any], model_name: str) -> None:
    """Configure Habitat-specific parameters (OpenAI-compatible gateway)."""
    if not model_name.startswith("habitat/"):
        return

    params.setdefault("custom_llm_provider", "openai")
    api_base = _normalize_openai_base(config.HABITAT_API_BASE) or HABITAT_FALLBACK_BASE
    params.setdefault("api_base", api_base)
    params.setdefault("api_key", config.HABITAT_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY)


def _configure_habitat_anthropic(params: Dict[str, Any], model_name: str) -> None:
    """Route Habitat Claude models through the native Anthropic Messages API.

    LiteLLM (custom_llm_provider="anthropic") translates OpenAI-shaped messages/tools
    to POST {api_base}/v1/messages and normalizes the response back to OpenAI form,
    which re-enables native prompt caching, extended thinking and tool_use.
    """
    if not model_name.startswith("habitat/"):
        return

    params["custom_llm_provider"] = "anthropic"
    # LiteLLM's Anthropic handler appends "/v1/messages", so strip a trailing /v1.
    base = _normalize_openai_base(config.HABITAT_API_BASE) or HABITAT_FALLBACK_BASE
    if base.endswith("/v1"):
        base = base[: -len("/v1")]
    params.setdefault("api_base", base.rstrip("/"))
    params.setdefault("api_key", config.HABITAT_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY)
    # Anthropic requires an explicit max_tokens; avoid LiteLLM's low default truncating output.
    params.setdefault("max_tokens", 16384)


def _configure_aiping(params: Dict[str, Any], model_name: str) -> None:
    """Configure AIPING-specific parameters (OpenAI-compatible gateway)."""
    if not model_name.startswith("aiping/"):
        return

    params.setdefault("custom_llm_provider", "openai")
    api_base = _normalize_openai_base(config.AIPING_API_BASE) or AIPING_FALLBACK_BASE
    params.setdefault("api_base", api_base)
    params.setdefault("api_key", config.AIPING_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY)

def _configure_anthropic(params: Dict[str, Any], model_name: str, messages: List[Dict[str, Any]]) -> None:
    """Configure Anthropic-specific parameters."""
    if not ("claude" in model_name.lower() or "anthropic" in model_name.lower()):
        return

    if params.get("custom_llm_provider") == "openai" or model_name.startswith(("aiping/", "openrouter/", "openai-compatible/")):
        return

    # Include both prompt caching and extended output beta features
    params["extra_headers"] = {
        "anthropic-beta": "prompt-caching-2024-07-31,max-tokens-3-5-sonnet-2024-07-15"
    }
    logger.debug(f"Added Anthropic-specific headers for prompt caching and extended output")

def _configure_openrouter(params: Dict[str, Any], model_name: str) -> None:
    """Configure OpenRouter-specific parameters."""
    if not model_name.startswith("openrouter/"):
        return
    
    logger.debug(f"Preparing OpenRouter parameters for model: {model_name}")

    # Add optional site URL and app name from config
    site_url = config.OR_SITE_URL
    app_name = config.OR_APP_NAME
    if site_url or app_name:
        extra_headers = params.get("extra_headers", {})
        if site_url:
            extra_headers["HTTP-Referer"] = site_url
        if app_name:
            extra_headers["X-Title"] = app_name
        params["extra_headers"] = extra_headers
        logger.debug(f"Added OpenRouter site URL and app name to headers")

def _configure_bedrock(params: Dict[str, Any], model_name: str, model_id: Optional[str]) -> None:
    """Configure Bedrock-specific parameters."""
    if not model_name.startswith("bedrock/"):
        return
    
    logger.debug(f"Preparing AWS Bedrock parameters for model: {model_name}")

    # Auto-set model_id for Claude 3.7 Sonnet if not provided
    if not model_id and "anthropic.claude-3-7-sonnet" in model_name:
        params["model_id"] = "arn:aws:bedrock:us-west-2:935064898258:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0"
        logger.debug(f"Auto-set model_id for Claude 3.7 Sonnet: {params['model_id']}")

def _configure_openai_gpt5(params: Dict[str, Any], model_name: str) -> None:
    """Configure OpenAI GPT-5 specific parameters."""
    if "gpt-5" not in model_name:
        return
    

    # Drop unsupported temperature param (only default 1 allowed)
    if "temperature" in params and params["temperature"] != 1:
        params.pop("temperature", None)

    # Request priority service tier when calling OpenAI directly

    # Pass via both top-level and extra_body for LiteLLM compatibility
    if not model_name.startswith("openrouter/"):
        params["service_tier"] = "priority"
        extra_body = params.get("extra_body", {})
        if "service_tier" not in extra_body:
            extra_body["service_tier"] = "priority"
        params["extra_body"] = extra_body


def _configure_thinking(params: Dict[str, Any], model_name: str, enable_thinking: Optional[bool], reasoning_effort: Optional[str]) -> None:
    """Configure reasoning/thinking parameters for supported models."""
    if not enable_thinking:
        return
    

    effort_level = reasoning_effort or 'low'
    is_anthropic = "anthropic" in model_name.lower() or "claude" in model_name.lower()
    is_xai = "xai" in model_name.lower() or model_name.startswith("xai/")
    
    if is_anthropic and not (params.get("custom_llm_provider") == "openai" or model_name.startswith(("aiping/", "openrouter/", "openai-compatible/"))):
        params["reasoning_effort"] = effort_level
        params["temperature"] = 1.0  # Required by Anthropic when reasoning_effort is used
        logger.info(f"Anthropic thinking enabled with reasoning_effort='{effort_level}'")
    elif is_xai:
        params["reasoning_effort"] = effort_level
        logger.info(f"xAI thinking enabled with reasoning_effort='{effort_level}'")


def _sanitize_openai_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Strip non-OpenAI fields and coerce tool content to string for strict gateways."""
    sanitized: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue

        role = msg.get("role") or "user"
        base: Dict[str, Any] = {"role": role}

        content = msg.get("content", "")
        if role == "tool":
            if isinstance(content, (dict, list)):
                try:
                    content = json.dumps(content, ensure_ascii=False)
                except Exception:
                    content = str(content)
            elif content is None:
                content = ""
            elif not isinstance(content, str):
                content = str(content)
        else:
            if isinstance(content, dict):
                try:
                    content = json.dumps(content, ensure_ascii=False)
                except Exception:
                    content = str(content)
        base["content"] = content

        name = msg.get("name")
        if isinstance(name, str) and name.strip():
            base["name"] = name.strip()

        if role == "tool":
            tool_call_id = msg.get("tool_call_id")
            if tool_call_id is not None:
                base["tool_call_id"] = str(tool_call_id)

        if role == "assistant":
            tool_calls = msg.get("tool_calls")
            if tool_calls is not None:
                base["tool_calls"] = tool_calls
            function_call = msg.get("function_call")
            if function_call is not None:
                base["function_call"] = function_call

        sanitized.append(base)

    return sanitized

def _add_fallback_model(params: Dict[str, Any], model_name: str, messages: List[Dict[str, Any]]) -> None:
    """Deprecated in Gemini-only setup; no fallback model configured."""
    return

def _add_tools_config(params: Dict[str, Any], tools: Optional[List[Dict[str, Any]]], tool_choice: str) -> None:
    """Add tools configuration to parameters."""
    if tools is None:
        return
    
    params.update({
        "tools": tools,
        "tool_choice": tool_choice
    })
    logger.debug(f"Added {len(tools)} tools to API parameters")

def prepare_params(
    messages: List[Dict[str, Any]],
    model_name: str,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    response_format: Optional[Any] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    stream: bool = False,
    top_p: Optional[float] = None,
    model_id: Optional[str] = None,
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = "low",
) -> Dict[str, Any]:
    from core.ai_models import model_manager, ModelProvider
    resolved_model_name = model_manager.resolve_model_id(model_name)
    # Optional compatibility shim: can force legacy Gemini identifiers to Habitat.
    legacy_vertex_like = (
        resolved_model_name.startswith("vertex_ai/")
        or resolved_model_name.startswith("google/")
        or resolved_model_name.startswith("gemini-")
        or resolved_model_name.startswith("gemini/")
    )
    force_habitat_redirect = _env_flag("LLM_FORCE_HABITAT_GEMINI_REDIRECT", False)
    if legacy_vertex_like and force_habitat_redirect:
        logger.info(
            "Redirecting legacy Gemini identifier to Habitat gateway",
            original_model=resolved_model_name,
        )
        resolved_model_name = "habitat/gemini-3.1-pro"

    logger.debug(f"Model resolution: '{model_name}' -> '{resolved_model_name}'")

    model_obj = model_manager.get_model(resolved_model_name)
    model_metadata = model_obj.metadata if model_obj else {}

    params = {
        "model": resolved_model_name,
        "messages": messages,
        "temperature": temperature,
        "response_format": response_format,
        "top_p": top_p,
        "stream": stream,
        "num_retries": MAX_RETRIES,
    }

    if api_key:
        params["api_key"] = api_key
    if api_base:
        params["api_base"] = api_base
    if model_obj and model_obj.provider == ModelProvider.AZURE:
        if not (config.AZURE_OPENAI_API_KEY and config.AZURE_OPENAI_ENDPOINT):
            raise LLMError("Azure OpenAI credentials are not configured.")
        params.setdefault("api_key", config.AZURE_OPENAI_API_KEY)
        params.setdefault("api_base", config.AZURE_OPENAI_ENDPOINT)
        params.setdefault("api_version", config.AZURE_OPENAI_API_VERSION)
        params.setdefault("custom_llm_provider", "azure")

        deployment_key = None
        deployment_key_aliases = []
        if model_obj.metadata:
            deployment_key = model_obj.metadata.get("deployment_key")
            raw_aliases = model_obj.metadata.get("deployment_key_aliases")
            if isinstance(raw_aliases, list):
                deployment_key_aliases = [str(item) for item in raw_aliases if item]
        if not deployment_key:
            deployment_key = resolved_model_name
        deployments = config.AZURE_OPENAI_DEPLOYMENTS or {}
        deployment_name = None
        for candidate in [deployment_key, resolved_model_name, *deployment_key_aliases]:
            if candidate in deployments:
                deployment_name = deployments.get(candidate)
                break
        if not deployment_name:
            raise LLMError(f"No Azure deployment configured for model '{resolved_model_name}'.")
        params["azure_deployment"] = deployment_name
        logger.debug(f"Resolved Azure deployment '{deployment_name}' for model {resolved_model_name}")

    if resolved_model_name.startswith("habitat/"):
        raw_model = model_metadata.get("raw_model_name") or resolved_model_name.split("/", 1)[-1]
        params["model"] = raw_model
        params["_gateway_marker"] = True
        params["_provider_marker"] = "habitat"
        # Per-family native protocol: Claude -> Anthropic Messages; others stay OpenAI-compatible.
        if "claude" in raw_model.lower() or "anthropic" in raw_model.lower():
            _configure_habitat_anthropic(params, resolved_model_name)
        else:
            _configure_habitat(params, resolved_model_name)
    elif resolved_model_name.startswith("aiping/"):
        raw_model = model_metadata.get("raw_model_name") or resolved_model_name.split("/", 1)[-1]
        params["model"] = raw_model
        _configure_aiping(params, resolved_model_name)
        params["_gateway_marker"] = True
        params["_provider_marker"] = "aiping"

    if model_id:
        params["model_id"] = model_id

    if model_name.startswith("openai-compatible/"):
        # Check if have required config either from parameters or environment
        if (not api_key and not config.OPENAI_COMPATIBLE_API_KEY) or (
            not api_base and not config.OPENAI_COMPATIBLE_API_BASE
        ):
            raise LLMError(
                "OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_API_BASE is required for openai-compatible models. If just updated the environment variables,  wait a few minutes or restart the service to ensure they are loaded."
            )
        
        setup_provider_router(api_key, api_base)

    # Anthropic-routed Habitat Claude keeps structured content (cache_control blocks);
    # only OpenAI-style providers get messages flattened.
    is_openai_like = (
        params.get("custom_llm_provider") in {"openai", "azure"}
        or resolved_model_name.startswith(("aiping/", "openrouter/", "openai-compatible/"))
        or (model_obj and model_obj.provider in (ModelProvider.OPENAI, ModelProvider.AZURE, ModelProvider.OPENROUTER, ModelProvider.AIPING))
    )
    if is_openai_like:
        params["messages"] = _sanitize_openai_messages(params["messages"])

    # Handle token limits
    _configure_token_limits(params, resolved_model_name, max_tokens)
    # Add tools if provided
    _add_tools_config(params, tools, tool_choice)
    # Add Anthropic-specific parameters
    _configure_anthropic(params, resolved_model_name, params["messages"])
    # Add Bedrock-specific parameters
    _configure_bedrock(params, resolved_model_name, model_id)
    
    _add_fallback_model(params, resolved_model_name, messages)
    # Add OpenAI GPT-5 specific parameters
    _configure_openai_gpt5(params, resolved_model_name)
    # Add Kimi K2-specific parameters
    # Kimi K2-specific configuration removed (model deprecated)
    _configure_thinking(params, resolved_model_name, enable_thinking, reasoning_effort)

    # Drop None-valued fields to satisfy strict OpenAI-compatible gateways.
    params = {k: v for k, v in params.items() if v is not None}

    return params


# ---------------------------------------------------------------------------
# Habitat GPT models -> native OpenAI Responses API (POST /v1/responses)
# Translated back to the chat-completions shape the agent loop consumes.
# ---------------------------------------------------------------------------
def _habitat_base_v1() -> str:
    base = _normalize_openai_base(config.HABITAT_API_BASE) or HABITAT_FALLBACK_BASE
    return (base or "").rstrip("/")


def _responses_usage_to_chat(usage: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(usage, dict):
        return None
    return {
        "prompt_tokens": usage.get("input_tokens", 0) or 0,
        "completion_tokens": usage.get("output_tokens", 0) or 0,
        "total_tokens": usage.get("total_tokens", 0) or 0,
    }


def _chat_tools_to_responses_tools(tools: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
    if not tools:
        return None
    out: List[Dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function")
        if isinstance(fn, dict):
            out.append({
                "type": "function",
                "name": fn.get("name"),
                "description": fn.get("description", "") or "",
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
            })
        elif tool.get("type") == "function" and tool.get("name"):
            out.append(tool)
    return out or None


def _chat_messages_to_responses_input(
    messages: List[Dict[str, Any]]
) -> tuple[Optional[str], List[Dict[str, Any]]]:
    """Convert OpenAI chat messages into Responses (instructions, input[]).

    system -> instructions; assistant.tool_calls -> function_call items;
    role=tool -> function_call_output items; the rest -> message items.
    """
    instructions: List[str] = []
    items: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role") or "user"
        content = msg.get("content")
        if role == "system":
            if isinstance(content, str):
                instructions.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("text"):
                        instructions.append(str(part["text"]))
                    elif isinstance(part, str):
                        instructions.append(part)
            continue
        if role == "tool":
            if isinstance(content, (dict, list)):
                output = json.dumps(content, ensure_ascii=False)
            else:
                output = "" if content is None else str(content)
            items.append({
                "type": "function_call_output",
                "call_id": str(msg.get("tool_call_id") or ""),
                "output": output,
            })
            continue
        if role == "assistant":
            text = content if isinstance(content, str) else None
            if not text and isinstance(content, list):
                text = "".join(str(p.get("text", "")) for p in content if isinstance(p, dict)) or None
            if text:
                items.append({"role": "assistant", "content": text})
            for tc in (msg.get("tool_calls") or []):
                fn = tc.get("function") if isinstance(tc, dict) else None
                fn = fn or {}
                args = fn.get("arguments")
                if not isinstance(args, str):
                    args = json.dumps(args or {}, ensure_ascii=False)
                items.append({
                    "type": "function_call",
                    "call_id": str(tc.get("id") or ""),
                    "name": fn.get("name") or "",
                    "arguments": args,
                })
            continue
        # user / other roles
        if isinstance(content, str):
            items.append({"role": role, "content": content})
        elif isinstance(content, list):
            parts: List[Dict[str, Any]] = []
            for part in content:
                if not isinstance(part, dict):
                    parts.append({"type": "input_text", "text": str(part)})
                    continue
                ptype = part.get("type")
                if ptype in ("image_url", "input_image"):
                    url = part.get("image_url")
                    if isinstance(url, dict):
                        url = url.get("url")
                    if url:
                        parts.append({"type": "input_image", "image_url": url})
                elif part.get("text") is not None:
                    parts.append({"type": "input_text", "text": str(part.get("text"))})
            items.append({"role": role, "content": parts or ""})
        elif content is not None:
            items.append({"role": role, "content": str(content)})
    joined = "\n\n".join(s for s in instructions if s).strip()
    return (joined or None), items


def _build_responses_payload(
    *, raw_model, messages, tools, tool_choice, stream, max_tokens, enable_thinking, reasoning_effort
) -> Dict[str, Any]:
    instructions, input_items = _chat_messages_to_responses_input(messages)
    payload: Dict[str, Any] = {
        "model": raw_model,
        "input": input_items,
        "stream": bool(stream),
        "max_output_tokens": int(max_tokens) if max_tokens else 16384,
    }
    if instructions:
        payload["instructions"] = instructions
    rtools = _chat_tools_to_responses_tools(tools)
    if rtools:
        payload["tools"] = rtools
        if isinstance(tool_choice, str) and tool_choice in ("auto", "none", "required"):
            payload["tool_choice"] = tool_choice
        elif isinstance(tool_choice, dict):
            fn = tool_choice.get("function") if isinstance(tool_choice.get("function"), dict) else None
            name = (fn or {}).get("name") or tool_choice.get("name")
            payload["tool_choice"] = {"type": "function", "name": name} if name else "auto"
        else:
            payload["tool_choice"] = "auto"
    if enable_thinking:
        payload["reasoning"] = {"effort": reasoning_effort or "low"}
    return payload


def _responses_chunk(*, content=None, reasoning=None, tool_call=None, finish_reason=None, usage=None):
    """Build a chat-completions-shaped streaming chunk (delta MUST be an object)."""
    delta = SimpleNamespace(
        content=content,
        tool_calls=([tool_call] if tool_call is not None else None),
        reasoning_content=reasoning,
    )
    choice = SimpleNamespace(delta=delta, finish_reason=finish_reason, message=None)
    return SimpleNamespace(choices=[choice], usage=usage)


def _responses_to_chat_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    content_text = ""
    reasoning_text = ""
    tool_calls: List[Dict[str, Any]] = []
    for item in (data.get("output") or []):
        if not isinstance(item, dict):
            continue
        itype = item.get("type")
        if itype == "message":
            for c in (item.get("content") or []):
                if isinstance(c, dict) and c.get("type") in ("output_text", "text") and c.get("text"):
                    content_text += str(c["text"])
        elif itype == "function_call":
            tool_calls.append({
                "id": item.get("call_id"),
                "type": "function",
                "function": {"name": item.get("name"), "arguments": item.get("arguments") or ""},
            })
        elif itype == "reasoning":
            for c in (item.get("summary") or item.get("content") or []):
                if isinstance(c, dict) and c.get("text"):
                    reasoning_text += str(c["text"])
    if not content_text and data.get("output_text"):
        content_text = str(data.get("output_text"))
    message: Dict[str, Any] = {"role": "assistant", "content": content_text or None}
    if tool_calls:
        message["tool_calls"] = tool_calls
    if reasoning_text:
        message["reasoning_content"] = reasoning_text
    return {
        "choices": [{"message": message, "finish_reason": "tool_calls" if tool_calls else "stop"}],
        "usage": _responses_usage_to_chat(data.get("usage")),
    }


async def _responses_stream(url: str, headers: Dict[str, str], payload: Dict[str, Any]):
    item_index: Dict[Any, int] = {}
    saw_tool_call = False
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "ignore")
                    raise LLMError(f"Habitat responses API error {resp.status_code}: {body[:300]}")
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    try:
                        evt = json.loads(data_str)
                    except Exception:
                        continue
                    etype = evt.get("type") or ""
                    if etype == "response.output_text.delta":
                        if evt.get("delta"):
                            yield _responses_chunk(content=evt.get("delta"))
                    elif etype.startswith("response.reasoning") and etype.endswith(".delta"):
                        if evt.get("delta"):
                            yield _responses_chunk(reasoning=evt.get("delta"))
                    elif etype == "response.output_item.added":
                        item = evt.get("item") or {}
                        if item.get("type") == "function_call":
                            saw_tool_call = True
                            idx = item_index.setdefault(item.get("id"), len(item_index))
                            yield _responses_chunk(tool_call={
                                "index": idx,
                                "id": item.get("call_id"),
                                "type": "function",
                                "function": {"name": item.get("name"), "arguments": item.get("arguments") or ""},
                            })
                    elif etype == "response.function_call_arguments.delta":
                        idx = item_index.setdefault(evt.get("item_id"), len(item_index))
                        if evt.get("delta"):
                            yield _responses_chunk(tool_call={
                                "index": idx,
                                "function": {"arguments": evt.get("delta")},
                            })
                    elif etype == "response.completed":
                        resp_obj = evt.get("response") or {}
                        yield _responses_chunk(
                            finish_reason="tool_calls" if saw_tool_call else "stop",
                            usage=_responses_usage_to_chat(resp_obj.get("usage")),
                        )
                    elif etype in ("response.failed", "error", "response.error"):
                        raise LLMError(f"Habitat responses stream error: {json.dumps(evt)[:300]}")
    except LLMError:
        raise
    except Exception as exc:
        raise LLMError(f"Habitat responses stream failed: {exc}")


async def _habitat_responses_call(
    *, messages, raw_model, tools, tool_choice, stream, max_tokens, enable_thinking, reasoning_effort
):
    """Call Habitat's native OpenAI Responses API, adapting it to the chat-completions
    shape the agent's stream / non-stream consumer expects."""
    url = f"{_habitat_base_v1()}/responses"
    key = config.HABITAT_API_KEY or config.OPENAI_COMPATIBLE_API_KEY or config.OPENAI_API_KEY
    headers = {"Authorization": f"Bearer {key or ''}", "Content-Type": "application/json"}
    payload = _build_responses_payload(
        raw_model=raw_model, messages=messages, tools=tools, tool_choice=tool_choice,
        stream=stream, max_tokens=max_tokens, enable_thinking=enable_thinking, reasoning_effort=reasoning_effort,
    )
    if stream:
        return _responses_stream(url, headers, payload)
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text if exc.response is not None else ""
        raise LLMError(f"Habitat responses API error: {exc} {body[:300]}")
    except Exception as exc:
        raise LLMError(f"Habitat responses API call failed: {exc}")
    return _responses_to_chat_dict(data)


async def make_llm_api_call(
    messages: List[Dict[str, Any]],
    model_name: str,
    response_format: Optional[Any] = None,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    stream: bool = False,
    top_p: Optional[float] = None,
    model_id: Optional[str] = None,
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = "low",
) -> Union[Dict[str, Any], AsyncGenerator, ModelResponse]:
    """
    Make an API call to a language model using LiteLLM.

    Args:
        messages: List of message dictionaries for the conversation
        model_name: Name of the model to use (e.g., "gemini-3.1-pro-preview-customtools", "gpt-4", "bedrock/anthropic.claude-3-sonnet-20240229-v1:0")
        response_format: Desired format for the response
        temperature: Sampling temperature (0-1)
        max_tokens: Maximum tokens in the response
        tools: List of tool definitions for function calling
        tool_choice: How to select tools ("auto" or "none")
        api_key: Override default API key
        api_base: Override default API base URL
        stream: Whether to stream the response
        top_p: Top-p sampling parameter
        model_id: Optional ARN for Bedrock inference profiles
        enable_thinking: Whether to enable thinking
        reasoning_effort: Level of reasoning effort

    Returns:
        Union[Dict[str, Any], AsyncGenerator]: API response or stream

    Raises:
        LLMRetryError: If API call fails after retries
        LLMError: For other API-related errors
    """
    # debug <timestamp>.json messages
    # Habitat GPT models speak the native OpenAI Responses API; route them there
    # and translate back to chat-completions for the agent loop.
    from core.ai_models import model_manager as _mm
    _resolved_for_responses = _mm.resolve_model_id(model_name) or model_name
    if _resolved_for_responses.startswith("habitat/"):
        _mobj = _mm.get_model(_resolved_for_responses)
        _raw = (_mobj.metadata.get("raw_model_name") if (_mobj and _mobj.metadata) else None) or _resolved_for_responses.split("/", 1)[-1]
        _protocols = (_mobj.metadata.get("protocol_support") or {}) if _mobj else {}
        _use_responses = _protocols.get("openAiResponses", False) and not _protocols.get("anthropicMessages", False)
        _use_responses = _use_responses or (_raw.lower().startswith("gpt") and not _raw.lower().startswith("gpt-image"))
        if _use_responses:
            logger.debug(f"Routing {model_name} via Habitat Responses API (raw={_raw}, stream={stream})")
            return await _habitat_responses_call(
                messages=messages,
                raw_model=_raw,
                tools=tools,
                tool_choice=tool_choice,
                stream=stream,
                max_tokens=max_tokens,
                enable_thinking=enable_thinking,
                reasoning_effort=reasoning_effort,
            )

    logger.debug(f"Making LLM API call to model: {model_name} (Thinking: {enable_thinking}, Effort: {reasoning_effort})")
    logger.debug(f"📡 API Call: Using model {model_name}")

    logger.info(f"📥 Received {len(messages)} messages for LLM call")
    for i, msg in enumerate(messages):
        role = msg.get('role', 'unknown')
        content = msg.get('content', '')
        if isinstance(content, list) and content:
            has_cache = 'cache_control' in content[0] if isinstance(content[0], dict) else False
            content_len = len(str(content[0].get('text', ''))) if isinstance(content[0], dict) else 0
            logger.info(f"  Input msg {i}: role={role}, has_cache={has_cache}, length={content_len}")
    
    params = prepare_params(
        messages=messages,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format=response_format,
        tools=tools,
        tool_choice=tool_choice,
        api_key=api_key,
        api_base=api_base,
        stream=stream,
        top_p=top_p,
        model_id=model_id,
        enable_thinking=enable_thinking,
        reasoning_effort=reasoning_effort,
    )
    # Debug: Log what we're sending to LiteLLM
    if 'messages' in params:
        logger.info(f"📨 Sending to LiteLLM: {len(params['messages'])} messages")
        for i, msg in enumerate(params['messages'][:3]):  # Only log first 3 to avoid spam
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            if isinstance(content, list) and content:
                has_cache = 'cache_control' in content[0] if isinstance(content[0], dict) else False
                logger.info(f"  Final msg {i}: role={role}, has_cache={has_cache}")
                # Log the actual cache_control value if present
                if has_cache:
                    logger.info(f"    cache_control value: {content[0].get('cache_control')}")
    
    # Log the headers being sent
    if 'extra_headers' in params:
        logger.info(f"📮 Headers to LiteLLM: {params['extra_headers']}")
    
    provider_marker = params.pop("_provider_marker", None)

    async def _invoke_with_retry(
        *,
        call_params: Dict[str, Any],
        call_provider_marker: Optional[str],
        call_model_name: str,
    ) -> Any:
        try_params = dict(call_params)

        while True:
            try:
                is_gateway = bool(try_params.get("_gateway_marker", False))
                request_payload = dict(try_params)
                request_payload.pop("_gateway_marker", None)

                if is_gateway:
                    response = await litellm.acompletion(**request_payload)
                else:
                    response = await provider_router.acompletion(**request_payload)
                logger.debug(f"Successfully received API response from {call_model_name}")

                # Check if streaming
                is_streaming = bool(request_payload.get("stream", False))

                if not is_streaming and hasattr(response, "usage"):
                    usage = response.usage
                    cache_creation = getattr(usage, "cache_creation_input_tokens", 0)
                    cache_read = getattr(usage, "cache_read_input_tokens", 0)
                    total_tokens = getattr(usage, "prompt_tokens", 0)

                    if cache_creation > 0 or cache_read > 0:
                        logger.info(
                            f"🎯 CACHE METRICS: creation={cache_creation}, read={cache_read}, total={total_tokens}"
                        )
                    else:
                        logger.warning(f"⚠️ NO CACHE USED: total_tokens={total_tokens}")
                elif is_streaming:
                    logger.info("📡 Streaming response - cache metrics will be in final chunk")

                return response

            except LiteLLMAPIError as e:
                text = str(e) or ""
                logger.error(f"LiteLLM API error: {text}", exc_info=True)
                raise LLMError(f"API call failed: {text}")
            except Exception as e:
                logger.error(f"Unexpected error during API call: {str(e)}", exc_info=True)
                raise LLMError(f"API call failed: {str(e)}")

    is_stream = bool(params.get("stream"))
    hedged_enabled = _env_flag("LLM_HEDGED_REQUESTS", True)
    if not is_stream and hedged_enabled:
        hedge_model_name = _resolve_hedged_model(model_name)
        if hedge_model_name:
            hedge_params = prepare_params(
                messages=messages,
                model_name=hedge_model_name,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
                api_key=api_key,
                api_base=api_base,
                stream=stream,
                top_p=top_p,
                model_id=model_id,
                enable_thinking=enable_thinking,
                reasoning_effort=reasoning_effort,
            )
            hedge_provider_marker = hedge_params.pop("_provider_marker", None)
            delay_ms = _resolve_hedged_delay_ms()
            logger.debug(
                "Hedged LLM request armed",
                primary_model=model_name,
                hedge_model=hedge_model_name,
                delay_ms=delay_ms,
            )
            return await _run_hedged_requests(
                primary_factory=lambda: _invoke_with_retry(
                    call_params=dict(params),
                    call_provider_marker=provider_marker,
                    call_model_name=model_name,
                ),
                hedge_factory=lambda: _invoke_with_retry(
                    call_params=dict(hedge_params),
                    call_provider_marker=hedge_provider_marker,
                    call_model_name=hedge_model_name,
                ),
                delay_ms=delay_ms,
                primary_model=model_name,
                hedge_model=hedge_model_name,
            )

    return await _invoke_with_retry(
        call_params=dict(params),
        call_provider_marker=provider_marker,
        call_model_name=model_name,
    )

setup_api_keys()
setup_provider_router()
