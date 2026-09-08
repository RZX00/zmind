"""Thread-related API models."""

from pydantic import BaseModel
from typing import Optional, Literal, Any


class ClientMessageHint(BaseModel):
    """Optional client hint to ensure the latest user message is in context."""
    message_id: Optional[str] = None
    content: Optional[Any] = None
    metadata: Optional[dict[str, Any]] = None
    role: Optional[str] = None
    type: Optional[str] = None


class AgentStartRequest(BaseModel):
    """Request model for starting an agent."""
    model_name: Optional[str] = None  # Will be set to default model in the endpoint
    # None means "not specified by client"; server may apply model default
    enable_thinking: Optional[bool] = None
    reasoning_effort: Optional[str] = 'low'
    stream: Optional[bool] = True
    enable_context_manager: Optional[bool] = True
    enable_prompt_caching: Optional[bool] = True
    agent_id: Optional[str] = None  # Custom agent to use
    run_mode: Optional[Literal['agent', 'chat']] = None
    interaction_surface: Optional[Literal['canvas', 'doc']] = None
    selection_context: Optional[dict[str, Any]] = None
    workspace_target: Optional[dict[str, Any]] = None
    response_mode: Optional[Literal['auto', 'preview', 'confirm', 'force_apply']] = None
    resume_token: Optional[str] = None
    client_message: Optional[ClientMessageHint] = None


class InitiateAgentResponse(BaseModel):
    """Response model for agent initiation."""
    thread_id: str
    agent_run_id: Optional[str] = None


class CreateThreadResponse(BaseModel):
    """Response model for thread creation."""
    thread_id: str
    project_id: str


class MessageCreateRequest(BaseModel):
    """Request model for creating a message."""
    type: str
    content: str
    is_llm_message: bool = True
