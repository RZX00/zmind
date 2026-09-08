from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator, AliasChoices

from core.langgraph_engine.contracts import SideEffectLevel, ToolExecutionResult, ToolSpec
from core.langgraph_engine.tools.runtime_context import ToolRuntimeContext
from core.utils.logger import logger


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_runtime_context(context: Dict[str, Any]) -> ToolRuntimeContext:
    return ToolRuntimeContext.from_mapping(context)


class ToolArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ---- Messaging / Control ----


class AskArgs(ToolArgs):
    text: str = Field(description="Question text to present to the user.")
    attachments: Optional[List[str]] = Field(
        default=None, description="Optional file paths or URLs as a list of strings."
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_attachments(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        att = values.get("attachments")
        if isinstance(att, str):
            values = {**values, "attachments": [att]}
        return values

class CtaButtonArgs(BaseModel):
    label: str
    action: str
    payload: Optional[Dict[str, Any]] = None
    style: Optional[Literal["primary", "secondary", "danger"]] = None
    icon: Optional[str] = None
    description: Optional[str] = None


class CtaArgs(ToolArgs):
    buttons: List[CtaButtonArgs] = Field(
        validation_alias=AliasChoices("buttons", "cta", "actions"),
        description="CTA button definitions.",
    )


class WebBrowserTakeoverArgs(ToolArgs):
    text: str
    attachments: Optional[List[str]] = Field(
        default=None, description="Optional file paths or URLs as a list of strings."
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_attachments(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        att = values.get("attachments")
        if isinstance(att, str):
            values = {**values, "attachments": [att]}
        return values


class ListSkillsArgs(ToolArgs):
    include_disabled: bool = False


class InstallSkillArgs(ToolArgs):
    source_type: Literal["github", "manual", "marketplace"] = Field(
        validation_alias=AliasChoices("source_type", "sourceType")
    )
    github_url: Optional[str] = Field(
        default=None, validation_alias=AliasChoices("github_url", "githubUrl")
    )
    markdown_content: Optional[str] = Field(
        default=None, validation_alias=AliasChoices("markdown_content", "markdownContent")
    )
    marketplace_skill_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "marketplace_skill_id", "marketplaceSkillId", "marketplace_id", "marketplaceId"
        ),
    )
    force: bool = False


class RunSkillArgs(ToolArgs):
    skill_id: str = Field(validation_alias=AliasChoices("skill_id", "skillId"))
    input: Optional[str] = None
    context: Optional[str] = None
    task_run_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("task_run_id", "taskRunId", "session_id", "sessionId"),
    )
    output_mode: Optional[Literal["last_message", "full_history"]] = "last_message"


class CompleteArgs(ToolArgs):
    text: Optional[str] = None
    attachments: Optional[List[str]] = Field(
        default=None, description="Optional file paths or URLs as a list of strings."
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_attachments(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        att = values.get("attachments")
        if isinstance(att, str):
            values = {**values, "attachments": [att]}
        return values


class WaitArgs(ToolArgs):
    seconds: int = Field(ge=1, le=300)


# ---- Tasks ----


class TaskArgs(ToolArgs):
    description: Optional[str] = None
    prompt: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("prompt", "task", "instruction", "query", "text"),
    )
    context: Optional[str] = Field(default=None, validation_alias=AliasChoices("context", "details"))
    subagent_type: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("subagent_type", "subagent", "agent", "agent_type"),
    )
    task_run_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("task_run_id", "taskRunId", "session_id", "sessionId"),
    )
    output_mode: Optional[Literal["last_message", "full_history"]] = "last_message"


# ---- Document-native tools ----


class DocReadContextArgs(ToolArgs):
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    include_content: bool = Field(
        default=True,
        validation_alias=AliasChoices("include_content", "includeContent"),
    )
    max_chars: int = Field(
        default=12_000,
        ge=500,
        le=50_000,
        validation_alias=AliasChoices("max_chars", "maxChars"),
    )


class DocListBlocksArgs(ToolArgs):
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    limit: int = Field(default=200, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class DocOpRangeArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")
    from_: int = Field(validation_alias=AliasChoices("from", "from_"), serialization_alias="from")
    to: int


class DocApplyOperationArgs(BaseModel):
    model_config = ConfigDict(extra="ignore")
    op: Literal[
        "replace_document",
        "replace_range",
        "delete_range",
        "insert_at",
        "insert_after_block",
        "insert_before_block",
    ]
    range: Optional[DocOpRangeArgs] = None
    content_md: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("content_md", "contentMd"),
        serialization_alias="contentMd",
    )
    block_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("block_id", "blockId"),
        serialization_alias="blockId",
    )
    position: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class DocApplyOpsArgs(ToolArgs):
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    base_version: int = Field(
        ge=1,
        validation_alias=AliasChoices("base_version", "baseVersion"),
        serialization_alias="baseVersion",
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("idempotency_key", "idempotencyKey"),
        serialization_alias="idempotencyKey",
    )
    summary: Optional[str] = None
    ops: List[DocApplyOperationArgs] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


class DocGenerateImageAndInsertArgs(ToolArgs):
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    prompt: str = Field(min_length=1)
    base_version: Optional[int] = Field(
        default=None,
        ge=1,
        validation_alias=AliasChoices("base_version", "baseVersion"),
        serialization_alias="baseVersion",
    )
    placement: Literal["append", "prepend", "insert_after_block", "insert_before_block", "insert_at"] = "append"
    block_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("block_id", "blockId"),
        serialization_alias="blockId",
    )
    position: Optional[int] = Field(default=None, ge=0)
    alt_text: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("alt_text", "altText"),
        serialization_alias="altText",
    )
    caption: Optional[str] = None
    aspect_ratio: str = Field(
        default="1:1",
        validation_alias=AliasChoices("aspect_ratio", "aspectRatio"),
        serialization_alias="aspectRatio",
    )
    quantity: int = Field(default=1, ge=1, le=10)
    model: str = "habitat/gpt-image-2"
    reference_image_ids: Optional[List[str]] = Field(
        default=None,
        validation_alias=AliasChoices("reference_image_ids", "referenceImageIds"),
        serialization_alias="referenceImageIds",
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("idempotency_key", "idempotencyKey"),
        serialization_alias="idempotencyKey",
    )
    summary: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    url_ttl_seconds: int = Field(
        default=604800,
        ge=300,
        le=604800,
        validation_alias=AliasChoices("url_ttl_seconds", "urlTtlSeconds"),
        serialization_alias="urlTtlSeconds",
    )


class DocUndoRevisionArgs(ToolArgs):
    revision_id: str = Field(
        validation_alias=AliasChoices("revision_id", "revisionId"),
        serialization_alias="revisionId",
    )
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    expected_current_version: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("expected_current_version", "expectedCurrentVersion"),
        serialization_alias="expectedCurrentVersion",
    )
    summary: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class DocGetRevisionArgs(ToolArgs):
    revision_id: str = Field(
        validation_alias=AliasChoices("revision_id", "revisionId"),
        serialization_alias="revisionId",
    )
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )


class DocUpdateTitleArgs(ToolArgs):
    doc_item_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("doc_item_id", "docItemId", "item_id", "itemId"),
    )
    title: str = Field(
        min_length=1,
        validation_alias=AliasChoices("title", "doc_title", "docTitle"),
    )


# ---- Triggers ----


class CreateScheduledTriggerArgs(ToolArgs):
    name: str
    cron_expression: str = Field(validation_alias=AliasChoices("cron_expression", "cronExpression"))
    agent_prompt: str = Field(validation_alias=AliasChoices("agent_prompt", "agentPrompt"))
    description: Optional[str] = None
    model: Optional[str] = None
    agent_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("agent_id", "agentId"))
    worker_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("worker_name", "workerName"))


class GetScheduledTriggersArgs(ToolArgs):
    agent_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("agent_id", "agentId"))
    worker_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("worker_name", "workerName"))


class DeleteScheduledTriggerArgs(ToolArgs):
    trigger_id: str = Field(validation_alias=AliasChoices("trigger_id", "triggerId"))


class ToggleScheduledTriggerArgs(ToolArgs):
    trigger_id: str = Field(validation_alias=AliasChoices("trigger_id", "triggerId"))
    is_active: bool = Field(validation_alias=AliasChoices("is_active", "isActive"))


class ListAppEventTriggersArgs(ToolArgs):
    toolkit_slug: str = Field(validation_alias=AliasChoices("toolkit_slug", "toolkitSlug"))


class CreateEventTriggerArgs(ToolArgs):
    slug: str
    profile_id: str = Field(validation_alias=AliasChoices("profile_id", "profileId"))
    agent_prompt: str = Field(validation_alias=AliasChoices("agent_prompt", "agentPrompt"))
    trigger_config: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("trigger_config", "triggerConfig"),
    )
    name: Optional[str] = None
    connected_account_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("connected_account_id", "connectedAccountId"),
    )
    model: Optional[str] = None
    agent_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("agent_id", "agentId"))
    worker_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("worker_name", "workerName"))


# ---- Canvas (CaC) ----


class CanvasGenerateImageArgs(ToolArgs):
    prompt: str
    aspect_ratio: str = "1:1"
    quantity: int = Field(default=1, ge=1, le=10)
    reference_images: Optional[List[dict]] = None
    model: str = "habitat/gpt-image-2"


class WorkspaceListCanvasesArgs(ToolArgs):
    query: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
    include_deleted: bool = Field(
        default=False,
        validation_alias=AliasChoices("include_deleted", "includeDeleted"),
    )


# ---- Presentation rendering ----


class RenderPresentationArgs(ToolArgs):
    slides_json: str = Field(
        description=(
            "A JSON string matching the PresentationData schema. "
            "Must include 'title', 'style', 'lang', and 'slides' array. "
            "Each slide has: order, layout, title, and layout-specific fields."
        ),
        validation_alias=AliasChoices("slides_json", "slidesJson", "json", "data"),
    )


# ---- Knowledge base ----


class KbListFoldersArgs(ToolArgs):
    limit: int = Field(default=50, ge=1, le=200)


class KbListEntriesArgs(ToolArgs):
    folder_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("folder_id", "folderId"))
    agent_assigned: bool = False
    limit: int = Field(default=50, ge=1, le=200)


class KbOverviewArgs(ToolArgs):
    limit_per_folder: int = Field(
        default=20,
        ge=1,
        le=100,
        validation_alias=AliasChoices("limit_per_folder", "limit"),
    )
    include_unassigned: bool = True
    agent_assigned: Optional[bool] = None


class KbGetEntryTextArgs(ToolArgs):
    entry_id: str = Field(validation_alias=AliasChoices("entry_id", "id"))
    max_chars: int = Field(default=1200, ge=200, le=5000)


class KbSummarizeEntryArgs(ToolArgs):
    entry_id: str = Field(validation_alias=AliasChoices("entry_id", "id"))
    goal: Optional[str] = None


class KbSearchArgs(ToolArgs):
    query: str = Field(validation_alias=AliasChoices("query", "q"))
    limit: int = Field(default=20, ge=1, le=50)


# ---- Web/search ----


class WebSearchArgs(ToolArgs):
    query: str = Field(validation_alias=AliasChoices("query", "q", "search", "search_query", "searchQuery"))
    num_results: int = Field(
        default=20,
        ge=1,
        le=50,
        validation_alias=AliasChoices("num_results", "numResults", "limit", "count"),
    )


class ScrapeWebpageArgs(ToolArgs):
    urls: Union[str, List[str]] = Field(validation_alias=AliasChoices("urls", "url", "url_list", "urlList"))
    include_html: bool = False


class ImageSearchArgs(ToolArgs):
    query: Union[str, List[str]] = Field(
        validation_alias=AliasChoices("query", "queries", "q", "search", "search_terms", "searchTerms")
    )
    num_results: int = Field(
        default=12,
        ge=1,
        le=100,
        validation_alias=AliasChoices("num_results", "numResults", "limit", "count"),
    )


class IntelligentWebSearchArgs(ToolArgs):
    query: str
    num_results: int = Field(default=10, ge=1, le=50)
    search_depth: Literal["basic", "advanced"] = "advanced"
    include_images: bool = True


class ExtractWebContentArgs(ToolArgs):
    urls: Union[str, List[str]] = Field(validation_alias=AliasChoices("urls", "url", "url_list", "urlList"))
    extract_mode: Literal["text", "structured", "full"] = "structured"
    summarize: bool = True


# ---- Providers/search (billing) ----


class PeopleSearchArgs(ToolArgs):
    query: str
    enrichment_description: str = "LinkedIn profile URL"


class CompanySearchArgs(ToolArgs):
    query: str
    enrichment_description: str = "Company website, funding information, and key details"


class GetDataProviderEndpointsArgs(ToolArgs):
    service_name: str


class ExecuteDataProviderCallArgs(ToolArgs):
    service_name: str
    route: str
    payload: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Request payload as a JSON object.",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_payload(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        p = values.get("payload")
        if isinstance(p, str):
            import json as _json
            try:
                parsed = _json.loads(p)
                if isinstance(parsed, dict):
                    return {**values, "payload": parsed}
            except (ValueError, TypeError):
                pass
            # Wrap plain string as {"query": ...}
            return {**values, "payload": {"query": p}}
        return values


# ---- Images/documents/analytics ----


class SearchImagesArgs(ToolArgs):
    query: Union[str, List[str]] = Field(
        validation_alias=AliasChoices("query", "queries", "q", "search", "search_terms", "searchTerms")
    )
    num_results: int = Field(
        default=10,
        ge=1,
        le=50,
        validation_alias=AliasChoices("num_results", "numResults", "limit", "count"),
    )
    image_type: Literal["any", "photo", "clipart", "lineart", "face", "news"] = "any"
    size_filter: Literal["any", "large", "medium", "small", "wallpaper", "icon"] = "any"


class AnalyzeImageContentArgs(ToolArgs):
    image_url: str
    analysis_type: Literal["objects", "text", "colors", "comprehensive"] = "comprehensive"
    detail_level: Literal["basic", "detailed", "extensive"] = "detailed"


class GenerateDocumentArgs(ToolArgs):
    content: str = Field(validation_alias=AliasChoices("content", "text", "body"))
    output_format: Literal["pdf", "docx", "html", "markdown"] = Field(
        default="pdf", validation_alias=AliasChoices("output_format", "outputFormat", "format")
    )
    template: Literal["professional", "academic", "report", "letter", "presentation"] = "professional"
    title: str = Field(default="Generated Document", validation_alias=AliasChoices("title", "document_title", "documentTitle"))
    metadata: Optional[Dict[str, Any]] = None


class AnalyzeDocumentArgs(ToolArgs):
    content: str
    analysis_type: Literal["readability", "structure", "topics", "comprehensive"] = "comprehensive"
    content_type: Literal["academic", "business", "technical", "general"] = "general"


class AnalyzeDataArgs(ToolArgs):
    data: str
    analysis_type: Literal["descriptive", "trends", "correlations", "comprehensive"] = "comprehensive"
    data_format: Literal["auto", "json", "csv", "text"] = "auto"


class GenerateInsightsArgs(ToolArgs):
    analysis_results: str
    insight_type: Literal["patterns", "anomalies", "recommendations", "comprehensive"] = "comprehensive"
    business_context: str = "general"


# ---- Canvas as Code (CaC) ----


class CaCReadArgs(ToolArgs):
    """Canvas as Code - Read canvas content"""
    scope: Optional[Literal["all", "selection", "viewport"]] = None
    canvas_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("canvas_id", "canvasId"),
    )
    where: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Predicate filter. Any node field by exact value, or aliases: parentId "
            "(=parentGroupId), rel (=relation, matches edges), actor "
            "(=provenance.createdBy.actor). Dict ops: {$contains}/{$startsWith}/{$regex}; "
            'a list means multi-value membership. Example: {"type":"text","content":{"$contains":"TODO"}}.'
        ),
    )
    limit: Optional[int] = None
    detail: Optional[Literal["outline", "structure", "full"]] = Field(
        default=None,
        description=(
            "Read depth. outline = ids+labels+topology only (orient on a large canvas); "
            "structure = +geometry +budgeted content (the default); full = raw nodes (capped)."
        ),
    )
    children_of: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("children_of", "childrenOf"),
        description="Return only the subtree under this container id (group/column/mindmap).",
    )
    camera: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Viewport for scope='viewport': {x,y,zoom,vw,vh}; filters to visible nodes.",
    )
    full: Optional[bool] = None  # deprecated alias for detail='full'


class CaCWriteNodeArgs(BaseModel):
    """Single node descriptor for canvas_write.

    Keep validation permissive (extra allowed + best-effort coercion) to reduce
    args_validation_error while still giving the model a helpful schema.
    """

    model_config = ConfigDict(extra="allow")

    # Keep in sync with core.canvas.cac.types.NodeType (runtime) and frontend CanvasNode['type'].
    type: Literal["text", "todo", "table", "code", "media", "group", "column", "canvas-link"] = "text"
    content: Optional[str] = None
    title: Optional[str] = None

    # Temporary IDs for cross-call references. Use "$id": "$1", "$2", ...
    id: Optional[str] = Field(default=None, alias="$id", validation_alias=AliasChoices("$id", "id"))

    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None

    code_type: Optional[Literal["mermaid", "svg", "html"]] = Field(
        default=None,
        alias="codeType",
        validation_alias=AliasChoices("codeType", "code_type"),
    )
    data: Optional[Dict[str, Any]] = None
    children: Optional[List[str]] = None
    group_mode: Optional[Literal["normal", "mindmap"]] = Field(
        default=None,
        alias="groupMode",
        validation_alias=AliasChoices("groupMode", "group_mode"),
    )
    target_canvas_id: Optional[str] = Field(
        default=None,
        alias="targetCanvasId",
        validation_alias=AliasChoices("targetCanvasId", "target_canvas_id"),
    )
    style: Optional[Dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_numeric_fields(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        coerced = dict(values)
        for key in ("x", "y", "width", "height"):
            if key not in coerced:
                continue
            raw = coerced.get(key)
            if raw is None:
                continue
            if isinstance(raw, str):
                token = raw.strip().lower()
                if token in ("auto", "none", ""):
                    coerced[key] = None
                    continue
            try:
                coerced[key] = float(raw)
            except Exception:
                # Drop invalid numeric inputs to avoid failing the whole tool call.
                coerced.pop(key, None)
        return coerced


class CaCWriteConnectionItemArgs(BaseModel):
    """Connection descriptor for canvas_write."""

    model_config = ConfigDict(extra="allow")

    from_id: str = Field(alias="from", validation_alias=AliasChoices("from", "from_id", "fromId"))
    to_id: str = Field(alias="to", validation_alias=AliasChoices("to", "to_id", "toId"))
    label: Optional[str] = None
    style: Optional[Literal["line", "arrow"]] = None
    dashed: Optional[bool] = None
    # Typed-edge slots (§4.1) — the agent authors logical meaning here, not in `label`.
    relation: Optional[str] = Field(
        default=None,
        description="Open machine-readable edge kind (e.g. supports/contradicts/cites/question/reference). Distinct from the human `label`.",
    )
    directed: Optional[bool] = Field(
        default=None,
        description="Logical direction: true = from->to is directed (default for typed edges); false = undirected.",
    )
    relationData: Optional[Dict[str, Any]] = Field(
        default=None, description="Optional open bag for edge metadata (weight, citation id, …)."
    )


class CaCWriteConnectionsArgs(BaseModel):
    """Connections input for canvas_write.

    Canonical shape (preferred):
      { "preset": "chain" } or { "items": [ { "from": "...", "to": "..." } ] }

    Backwards-compatible:
      "chain" | "star" | "none" | "tree"
      [ { "from": "...", "to": "..." }, ... ]
    """

    model_config = ConfigDict(extra="allow")

    preset: Optional[Literal["none", "chain", "star", "tree"]] = Field(
        default=None,
        description=(
            "Quick connection layout over the flat node list: none | chain (1->2->3) | "
            "star (first->rest) | tree. NOTE: 'tree' here is a sequential chain (a flat list "
            "can't express hierarchy) — for a real hierarchy/mindmap use the top-level `tree:` "
            "field instead, which builds parent->child structure."
        ),
    )
    items: Optional[List[CaCWriteConnectionItemArgs]] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_shapes(cls, values: Any) -> Any:
        if values is None:
            return None
        if isinstance(values, str):
            return {"preset": values}
        if isinstance(values, list):
            return {"items": values}
        if isinstance(values, dict):
            if "preset" in values or "items" in values:
                return values
            # Single connection object -> wrap into items list.
            if "from" in values and "to" in values:
                return {"items": [values]}
        return values


class CaCTreeArgs(BaseModel):
    """Tree input for canvas_write (mindmap/tree)."""

    model_config = ConfigDict(extra="allow")

    content: str
    type: Optional[Literal["text", "todo", "table", "code", "media", "group", "column", "canvas-link"]] = "text"
    id: Optional[str] = Field(default=None, alias="$id", validation_alias=AliasChoices("$id", "id"))
    style: Optional[Dict[str, Any]] = None
    # Keep children permissive to avoid recursive $ref cycles in schema sanitizer.
    children: Optional[List[Dict[str, Any]]] = None


class CaCWriteArgs(ToolArgs):
    """Canvas as Code - Create new content"""
    layout: Optional[Literal["stack", "row", "grid", "mindmap", "tree", "freeform"]] = None
    anchor: Optional[str] = Field(
        default=None,
        description=(
            "Starting position. Use a keyword string: 'selection.right', 'viewport.center', "
            "'selection.below', 'canvas.origin', 'node:<id>.right', etc."
        ),
    )
    spacing: Optional[float] = Field(
        default=None,
        description="Space between nodes in pixels (default: 20).",
    )
    canvas_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("canvas_id", "canvasId"),
    )
    columns: Optional[int] = None
    nodes: Optional[List[CaCWriteNodeArgs]] = None
    connections: Optional[CaCWriteConnectionsArgs] = None
    tree: Optional[CaCTreeArgs] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_common_mistakes(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        normalized = dict(values)

        # Unwrap accidental nesting (e.g. {"args": {...}} or {"input": {...}})
        for key in ("args", "input", "payload"):
            inner = normalized.get(key)
            if isinstance(inner, dict):
                normalized.pop(key, None)
                for k, v in inner.items():
                    normalized.setdefault(k, v)
                break

        nodes = normalized.get("nodes")
        if isinstance(nodes, dict):
            normalized["nodes"] = [nodes]

        # ------------------------------------------------------------------
        # Coerce `anchor` to string.
        #
        # anchor is typed as Optional[str] so the tool schema unambiguously
        # tells the LLM it's a string.  But we still defensively convert
        # dict inputs that older models or edge cases might produce.
        # ------------------------------------------------------------------
        anchor = normalized.get("anchor")
        if isinstance(anchor, dict):
            x = anchor.get("x")
            y = anchor.get("y")
            if x is not None and y is not None:
                # Coordinate dict like {"x": 100, "y": 200} → "100,200"
                # CaCEngine.resolve_anchor will be updated to parse this.
                try:
                    normalized["anchor"] = f"{float(x)},{float(y)}"
                except (ValueError, TypeError):
                    normalized.pop("anchor", None)
            else:
                # Semantic dict like {"type": "viewport", "position": "center"}
                anchor_type = anchor.get("type", "")
                position = (
                    anchor.get("position")
                    or anchor.get("alignment")
                    or anchor.get("location")
                    or anchor.get("place")
                    or ""
                )
                if anchor_type and position:
                    normalized["anchor"] = f"{anchor_type}.{position}"
                elif anchor_type:
                    normalized["anchor"] = anchor_type
                elif position:
                    normalized["anchor"] = f"viewport.{position}"
                else:
                    normalized.pop("anchor", None)

        # ------------------------------------------------------------------
        # Coerce `spacing` to float.
        # ------------------------------------------------------------------
        spacing = normalized.get("spacing")
        if isinstance(spacing, str):
            cleaned = spacing.strip().lower().replace("px", "").replace("pt", "")
            try:
                normalized["spacing"] = float(cleaned)
            except (ValueError, TypeError):
                normalized.pop("spacing", None)
        elif isinstance(spacing, dict):
            # {"x": 40, "y": 20} → use average or x as primary spacing
            try:
                sx = float(spacing.get("x", spacing.get("horizontal", 20)))
                normalized["spacing"] = sx
            except (ValueError, TypeError):
                normalized.pop("spacing", None)

        return normalized

    @model_validator(mode="after")
    def _require_nodes_or_tree(self) -> "CaCWriteArgs":
        if not self.nodes and not self.tree:
            raise ValueError("canvas_write requires 'nodes' or 'tree'")
        return self


class CaCEditArgs(ToolArgs):
    """Canvas as Code - Edit or delete existing content"""
    model_config = ConfigDict(extra="allow")

    canvas_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("canvas_id", "canvasId"),
    )
    expected_version: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("expected_version", "expectedVersion"),
        description=(
            "Optional serverVersion pin for optimistic concurrency. If the canvas moved on "
            "(a concurrent edit), the write fails with STALE_RELOAD so you re-read and retry "
            "instead of clobbering. Omit to apply without a version check."
        ),
    )
    # WC1: the ADVERTISED grammar is exactly one shape — {operations, expected_version}.
    # The legacy $delete/$select/$set/$transform/$connections/$canvas/updates shapes are no
    # longer declared (so the model isn't offered ~8 ambiguous variants), but stay tolerated
    # for back-compat via extra="allow": CanvasEditPayload.from_dict reads the raw $-keys and
    # _normalize_common_mistakes normalizes them on the raw dict, so old callers don't break.
    operations: List[Dict[str, Any]] = Field(
        ...,
        alias="$operations",
        validation_alias=AliasChoices("$operations", "operations"),
        description=(
            "REQUIRED, non-empty. Canonical edit grammar: a list of ops, each {op, ...}. op is one of the closed "
            "set: add_node, update_node, delete_node, move_node, apply_style, add_connection "
            "(accepts relation/directed/relationData typed-edge slots), update_connection, "
            "delete_connection, update_canvas, relayout_mindmap, update_table_cell{id,row,col,value}, "
            "table_row_op{id,action:insert|delete,index,rowData?}, table_col_op{id,action,index,header?}, "
            "group_nodes{ids[],mode?}, ungroup{id}, set_collapsed{id,collapsed}."
        ),
    )

    @property
    def delete(self) -> Optional[List[str]]:
        """Expose tolerated legacy delete arguments without advertising them in the tool schema."""
        extras = self.model_extra or {}
        value = extras.get("$delete", extras.get("delete"))
        return value if isinstance(value, list) else None

    @property
    def updates(self) -> Optional[Dict[str, Dict[str, Any]]]:
        """Expose tolerated legacy update arguments without advertising them in the tool schema."""
        extras = self.model_extra or {}
        value = extras.get("updates", extras.get("nodes"))
        return value if isinstance(value, dict) else None

    @model_validator(mode="before")
    @classmethod
    def _normalize_common_mistakes(cls, values: Any) -> Any:
        if not isinstance(values, dict):
            return values
        normalized = dict(values)

        def _coerce_delete_list(raw: Any) -> Optional[List[str]]:
            if isinstance(raw, str):
                text = raw.strip()
                return [text] if text else None
            if isinstance(raw, (list, tuple, set)):
                out: List[str] = []
                for item in raw:
                    if item is None:
                        continue
                    text = str(item).strip()
                    if text:
                        out.append(text)
                return out or None
            return None

        delete_val = normalized.get("$delete", normalized.get("delete"))
        delete_list = _coerce_delete_list(delete_val)
        if delete_list:
            normalized["$delete"] = delete_list

        # Common LLM mistake: {"updates":{"$delete":[...]}}
        updates_key = "updates" if "updates" in normalized else ("nodes" if "nodes" in normalized else None)
        if updates_key and isinstance(normalized.get(updates_key), dict):
            updates_obj = dict(normalized.get(updates_key) or {})
            nested_delete = updates_obj.pop("$delete", None)
            if nested_delete is None:
                nested_delete = updates_obj.pop("delete", None)

            nested_delete_list = _coerce_delete_list(nested_delete)
            if nested_delete_list:
                if not delete_list:
                    normalized["$delete"] = nested_delete_list

            # Keep only node-id -> patch entries in updates
            cleaned_updates: Dict[str, Dict[str, Any]] = {}
            for key, value in updates_obj.items():
                if isinstance(key, str) and not key.startswith("$") and isinstance(value, dict):
                    cleaned_updates[key] = value

            if cleaned_updates:
                normalized[updates_key] = cleaned_updates
            else:
                normalized.pop("updates", None)
                normalized.pop("nodes", None)

        ops_val = normalized.get("$operations", normalized.get("operations"))
        if isinstance(ops_val, dict) and ops_val:
            normalized["$operations"] = [ops_val]

        # Keep the canonical `$operations` field required in the generated tool
        # schema while allowing the legacy extra-key shapes documented above. The
        # empty list satisfies Pydantic's required-field check; `_require_action`
        # still rejects payloads that contain only canvas/version metadata.
        has_operations = "$operations" in normalized or "operations" in normalized
        metadata_keys = {"canvas_id", "canvasId", "expected_version", "expectedVersion"}
        if not has_operations and any(key not in metadata_keys for key in normalized):
            normalized["$operations"] = []

        # Coerce single connection dict → list
        for conn_key in ("$connections", "connections"):
            conn_val = normalized.get(conn_key)
            if isinstance(conn_val, dict) and conn_val:
                normalized[conn_key] = [conn_val]
                break
        return normalized

    @model_validator(mode="after")
    def _require_action(self) -> "CaCEditArgs":
        # operations is the canonical action (WC1). The legacy $delete/$select/$set/
        # $transform/$connections/$canvas/updates shapes + a bare node-id->patch map are no
        # longer declared fields — they arrive via extra="allow", so any extra key counts as
        # an action (canvas_id/expected_version are declared, never in model_extra).
        if self.operations:
            return self
        extras = getattr(self, "model_extra", None) or {}
        if extras:
            return self
        raise ValueError("canvas_edit requires at least one edit action")


# ---- Files ----


class UploadFileArgs(ToolArgs):
    file_path: str
    bucket_name: Literal["browser-screenshots", "agent-files", "presentations"] = "agent-files"
    custom_filename: Optional[str] = None
    make_public: bool = False


class ExpandMessageArgs(ToolArgs):
    message_id: str


def build_native_tool_specs() -> list[ToolSpec]:
    """Static tool catalog for v1 (native LangGraph tool implementations)."""
    return [
        # Messaging / control
        ToolSpec(
            name="ask",
            description="Ask the user a question and wait for response.",
            args_model=AskArgs,
            handler=_call_message_tool("ask"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="cta",
            description="Provide action buttons (CTA) alongside the assistant reply.",
            args_model=CtaArgs,
            handler=_call_message_tool("cta"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="web_browser_takeover",
            description="Request user takeover for browser interaction.",
            args_model=WebBrowserTakeoverArgs,
            handler=_call_message_tool("web_browser_takeover"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="complete",
            description="Mark the run as complete.",
            args_model=CompleteArgs,
            handler=_call_message_tool("complete"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="wait",
            description="Pause execution for a number of seconds.",
            args_model=WaitArgs,
            handler=_call_message_tool("wait"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="task",
            description="Run a checkpoint-backed subtask using a specialized subagent.",
            args_model=TaskArgs,
            handler=_call_task_tool(),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Document-native tools
        ToolSpec(
            name="doc_read_context",
            description=(
                "Read document context for the current doc thread, including title/version and optional markdown content."
            ),
            args_model=DocReadContextArgs,
            handler=_call_doc_agent_tool("doc_read_context"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="doc_list_blocks",
            description="List parsed document blocks with stable block ids/anchors.",
            args_model=DocListBlocksArgs,
            handler=_call_doc_agent_tool("doc_list_blocks"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="doc_apply_ops",
            description=(
                "Apply structured markdown edit operations (replace/insert/delete) with optimistic concurrency control."
            ),
            args_model=DocApplyOpsArgs,
            handler=_call_doc_agent_tool("doc_apply_ops"),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        ToolSpec(
            name="doc_generate_image_and_insert",
            description=(
                "Generate one or more images, link them to the active doc, then insert markdown image blocks directly "
                "into the document."
            ),
            args_model=DocGenerateImageAndInsertArgs,
            handler=_call_doc_agent_tool("doc_generate_image_and_insert"),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        ToolSpec(
            name="doc_undo_revision",
            description="Undo a document revision and create a new compensating revision.",
            args_model=DocUndoRevisionArgs,
            handler=_call_doc_agent_tool("doc_undo_revision"),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        ToolSpec(
            name="doc_get_revision",
            description="Read a specific document revision payload and metadata.",
            args_model=DocGetRevisionArgs,
            handler=_call_doc_agent_tool("doc_get_revision"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="doc_update_title",
            description="Update the current document title.",
            args_model=DocUpdateTitleArgs,
            handler=_call_doc_agent_tool("doc_update_title"),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        # Trigger tools
        ToolSpec(
            name="create_scheduled_trigger",
            description="Create a scheduled trigger for an agent using a cron expression.",
            args_model=CreateScheduledTriggerArgs,
            handler=_call_trigger_tool("create_scheduled_trigger"),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="get_scheduled_triggers",
            description="List scheduled triggers for the current or selected agent.",
            args_model=GetScheduledTriggersArgs,
            handler=_call_trigger_tool("get_scheduled_triggers"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="delete_scheduled_trigger",
            description="Delete a scheduled trigger by ID.",
            args_model=DeleteScheduledTriggerArgs,
            handler=_call_trigger_tool("delete_scheduled_trigger"),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="toggle_scheduled_trigger",
            description="Enable or disable a scheduled trigger.",
            args_model=ToggleScheduledTriggerArgs,
            handler=_call_trigger_tool("toggle_scheduled_trigger"),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="list_event_trigger_apps",
            description="List apps that support Composio event triggers.",
            args_model=ToolArgs,
            handler=_call_trigger_tool("list_event_trigger_apps"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="list_app_event_triggers",
            description="List event triggers for a Composio toolkit slug.",
            args_model=ListAppEventTriggersArgs,
            handler=_call_trigger_tool("list_app_event_triggers"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="create_event_trigger",
            description="Create a Composio event trigger and bind it to an agent.",
            args_model=CreateEventTriggerArgs,
            handler=_call_trigger_tool("create_event_trigger"),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        # Canvas tools (CaC)
        ToolSpec(
            name="canvas_generate_image",
            description="Generate AI images and insert into the canvas.",
            args_model=CanvasGenerateImageArgs,
            handler=_call_canvas_generate_image_tool(),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="workspace_list_canvases",
            description=(
                "List canvases in the current workspace for cross-canvas navigation and management. "
                "Use query/limit/offset for paging and filtering."
            ),
            args_model=WorkspaceListCanvasesArgs,
            handler=_call_workspace_list_canvases_tool(),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Canvas as Code (CaC) - Standard tools
        ToolSpec(
            name="canvas_read",
            description=(
                "Read canvas content. Returns nodes and connections with optional filtering. "
                "Use optional canvas_id for cross-canvas reads. "
                "Use scope='selection' to read only selected nodes, or 'viewport' for visible area. "
                "Use 'where' for filtering: { \"type\": \"text\", \"content\": { \"$contains\": \"keyword\" } }"
            ),
            args_model=CaCReadArgs,
            handler=_call_canvas_read_tool_cac(),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="canvas_write",
            description=(
                "Create new content on canvas. Supports multiple layouts: "
                "'stack' (vertical), 'row' (horizontal), 'grid', 'mindmap', 'tree'. "
                "Use optional canvas_id for cross-canvas writes. "
                "Use 'anchor' for position: 'selection.right', 'viewport.center', 'node:id.below'. "
                "Use 'nodes' for flat list or 'tree' for hierarchical mindmap structure. "
                "Connections: { preset: 'chain'|'star'|'tree' } or { items: [{from, to}] }."
            ),
            args_model=CaCWriteArgs,
            handler=_call_canvas_write_tool(),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        ToolSpec(
            name="canvas_edit",
            description=(
                "Edit or delete existing canvas content. "
                "Use optional canvas_id for cross-canvas edits. "
                "Update nodes by ID: { \"n1\": { \"content\": \"new\" }, \"n2\": { \"x\": 100 } }. "
                "Delete nodes: { \"$delete\": [\"n1\", \"n2\"] }. "
                "Batch update with selector: { \"$select\": \".text[content*='TODO']\", \"$set\": { \"type\": \"todo\" } }. "
                "Update canvas props: { \"$canvas\": { \"title\": \"New Title\" } }. "
                "Update/delete connections: { \"$connections\": { \"conn-1\": { \"label\": \"...\" }, \"$delete\": [\"conn-2\"] } }. "
                "Add connections between existing nodes: { \"$connections\": [ { \"from\": \"n1\", \"to\": \"n2\", \"label\": \"...\" } ] } "
                "or { \"$connections\": { \"$add\": [ { \"from\": \"n1\", \"to\": \"n2\" } ] } }."
            ),
            args_model=CaCEditArgs,
            handler=_call_canvas_edit_tool_cac(),
            side_effect_level=SideEffectLevel.REVERSIBLE_WRITE,
        ),
        # Presentation rendering
        ToolSpec(
            name="render_presentation",
            description=(
                "Render structured slide JSON into a self-contained HTML presentation. "
                "Input: a JSON string with 'title', 'style', 'lang', and 'slides' array. "
                "Each slide needs 'order', 'layout' (title/content/image_left/image_right/"
                "comparison/data/quote/timeline/team/closing), 'title', and layout-specific fields. "
                "Returns the complete HTML ready for canvas_write as a code node with codeType='html'."
            ),
            args_model=RenderPresentationArgs,
            handler=_call_render_presentation_tool(),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Knowledge base
        ToolSpec(
            name="kb_list_folders",
            description="List knowledge base folders for the current user.",
            args_model=KbListFoldersArgs,
            handler=_call_kb_tool("kb_list_folders"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="kb_list_entries",
            description="List knowledge base entries.",
            args_model=KbListEntriesArgs,
            handler=_call_kb_tool("kb_list_entries"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="kb_overview",
            description="Summarize knowledge base folders and entries.",
            args_model=KbOverviewArgs,
            handler=_call_kb_tool("kb_overview"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="kb_get_entry_text",
            description="Get entry text (snippet) from knowledge base storage.",
            args_model=KbGetEntryTextArgs,
            handler=_call_kb_tool("kb_get_entry_text"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="kb_summarize_entry",
            description="Summarize a knowledge base entry for context injection.",
            args_model=KbSummarizeEntryArgs,
            handler=_call_kb_tool("kb_summarize_entry"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="kb_search",
            description="Search knowledge base entries by query.",
            args_model=KbSearchArgs,
            handler=_call_kb_tool("kb_search"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Web/search
        ToolSpec(
            name="web_search",
            description="Search the web for up-to-date information.",
            args_model=WebSearchArgs,
            handler=_call_web_search_tool("web_search"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="scrape_webpage",
            description="Extract content from multiple web pages (batch).",
            args_model=ScrapeWebpageArgs,
            handler=_call_web_search_tool("scrape_webpage"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="image_search",
            description="Search images using SERPER API (single or batch).",
            args_model=ImageSearchArgs,
            handler=_call_web_search_tool("image_search"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="intelligent_web_search",
            description="Intelligent web search with ranking and analysis.",
            args_model=IntelligentWebSearchArgs,
            handler=_call_intelligent_search_tool("intelligent_web_search"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="extract_web_content",
            description="Extract and analyze content from web pages.",
            args_model=ExtractWebContentArgs,
            handler=_call_intelligent_search_tool("extract_web_content"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Providers/search (billing)
        ToolSpec(
            name="people_search",
            description="Search for people (billing + external).",
            args_model=PeopleSearchArgs,
            handler=_call_people_search_tool(),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="company_search",
            description="Search for companies (billing + external).",
            args_model=CompanySearchArgs,
            handler=_call_company_search_tool(),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="get_data_provider_endpoints",
            description="List available endpoints for a data provider.",
            args_model=GetDataProviderEndpointsArgs,
            handler=_call_data_providers_tool("get_data_provider_endpoints"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="execute_data_provider_call",
            description="Execute a call to a data provider endpoint.",
            args_model=ExecuteDataProviderCallArgs,
            handler=_call_data_providers_tool("execute_data_provider_call"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Images/documents/analytics
        ToolSpec(
            name="search_images",
            description="Search for images (cloud).",
            args_model=SearchImagesArgs,
            handler=_call_image_service_tool("search_images"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="analyze_image_content",
            description="Analyze image content (cloud).",
            args_model=AnalyzeImageContentArgs,
            handler=_call_image_service_tool("analyze_image_content"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="generate_document",
            description="Generate documents (cloud).",
            args_model=GenerateDocumentArgs,
            handler=_call_document_service_tool("generate_document"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="analyze_document",
            description="Analyze document content.",
            args_model=AnalyzeDocumentArgs,
            handler=_call_document_service_tool("analyze_document"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="analyze_data",
            description="Analyze data (statistics/trends).",
            args_model=AnalyzeDataArgs,
            handler=_call_data_analytics_tool("analyze_data"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="generate_insights",
            description="Generate insights from analysis results.",
            args_model=GenerateInsightsArgs,
            handler=_call_data_analytics_tool("generate_insights"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Files
        ToolSpec(
            name="upload_file",
            description="Upload a file to Supabase storage.",
            args_model=UploadFileArgs,
            handler=_call_upload_file_tool(),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        # Skills
        ToolSpec(
            name="list_skills",
            description="List built-in and user-defined skills.",
            args_model=ListSkillsArgs,
            handler=_call_skills_tool("list_skills"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        ToolSpec(
            name="install_skill",
            description="Install a skill from GitHub, manual markdown, or marketplace.",
            args_model=InstallSkillArgs,
            handler=_call_skills_tool("install_skill"),
            side_effect_level=SideEffectLevel.EXTERNAL_WRITE,
        ),
        ToolSpec(
            name="run_skill",
            description="Run a skill by id and return structured output.",
            args_model=RunSkillArgs,
            handler=_call_skills_tool("run_skill"),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
        # Misc
        ToolSpec(
            name="expand_message",
            description="Expand a previous message content by message_id.",
            args_model=ExpandMessageArgs,
            handler=_call_expand_message_tool(),
            side_effect_level=SideEffectLevel.READ_ONLY,
        ),
    ]


def _tool_result_to_execution_result(
    *,
    tool_call_id: str,
    name: str,
    result: Any,
    started_at: str,
) -> ToolExecutionResult:
    ended_at = _now_iso()

    success = bool(getattr(result, "success", False))
    output = getattr(result, "output", None)
    metadata = getattr(result, "metadata", None)

    payload: ToolExecutionResult = {
        "tool_call_id": tool_call_id,
        "name": name,
        "success": success,
        "started_at": started_at,
        "ended_at": ended_at,
    }

    if output is not None:
        payload["output"] = output
    if isinstance(metadata, dict):
        payload["metadata"] = metadata

    if not success:
        payload["error"] = str(output)[:500] if output else "tool_failed"

    return payload


def _call_message_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.message_tool import MessageTool

            tool = MessageTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("Message tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_doc_agent_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.doc_agent_tool import DocAgentTool

            if not runtime.account_id:
                raise ValueError("account_id is required for doc tool execution")

            run_config = context.get("run_config")
            agent_run_id = getattr(run_config, "agent_run_id", None) if run_config is not None else None

            tool = DocAgentTool(
                thread_id=runtime.thread_id,
                account_id=str(runtime.account_id),
                db_connection=runtime.db,
                doc_item_id=context.get("doc_item_id"),
                doc_context=context.get("doc_context"),
                agent_run_id=agent_run_id,
            )
            normalized_args = _normalize_doc_tool_args(args)
            method = getattr(tool, method_name)
            result = await method(**normalized_args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=method_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("Doc tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _normalize_doc_tool_args(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Native registry validates args with `model_dump(by_alias=True)`, so doc tools can
    receive camelCase keys. DocAgentTool expects snake_case kwargs. Normalize top-level
    aliases before invoking tool methods.
    """
    if not isinstance(args, dict):
        return {}

    normalized = dict(args)
    alias_map = {
        "docItemId": "doc_item_id",
        "baseVersion": "base_version",
        "idempotencyKey": "idempotency_key",
        "revisionId": "revision_id",
        "expectedCurrentVersion": "expected_current_version",
        "docTitle": "title",
        "doc_title": "title",
        "blockId": "block_id",
        "altText": "alt_text",
        "aspectRatio": "aspect_ratio",
        "referenceImageIds": "reference_image_ids",
        "urlTtlSeconds": "url_ttl_seconds",
    }
    for alias_key, canonical_key in alias_map.items():
        if alias_key not in normalized:
            continue
        if canonical_key not in normalized:
            normalized[canonical_key] = normalized[alias_key]
        # Remove alias key to avoid unexpected kwargs in DocAgentTool method signatures.
        normalized.pop(alias_key, None)
    return normalized


def _call_canvas_generate_image_tool(tool_name: str = "canvas_generate_image"):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.canvas_generate_image_tool import CanvasGenerateImageTool

            tool = CanvasGenerateImageTool(
                thread_manager=runtime.thread_manager,
                thread_id=runtime.thread_id,
                canvas_id=args.get("canvas_id"),
                db_connection=runtime.db,
            )
            result = await tool.canvas_generate_image(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=tool_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("%s failed", tool_name)
            return {
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_workspace_list_canvases_tool(tool_name: str = "workspace_list_canvases"):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.canvas.cac.tools import WorkspaceListCanvasesTool

            tool = WorkspaceListCanvasesTool(
                thread_id=runtime.thread_id,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            result = await tool.workspace_list_canvases(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=tool_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("%s failed", tool_name)
            return {
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_render_presentation_tool(tool_name: str = "render_presentation"):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.presentation.render_tool import RenderPresentationTool

            tool = RenderPresentationTool()
            result = await tool.render(
                slides_json=args.get("slides_json", ""),
                canvas_id=runtime.canvas_id,
            )
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=tool_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("%s failed", tool_name)
            return {
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_kb_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.knowledge_base_tools import KnowledgeBaseTools

            tool = KnowledgeBaseTools(
                thread_id=runtime.thread_id,
                agent_config=runtime.agent_config,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("KB tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_web_search_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.web_search_tool import WebSearchTool

            if method_name == "scrape_webpage":
                urls = args.get("urls")
                if isinstance(urls, list):
                    args = dict(args)
                    args["urls"] = ", ".join(str(url).strip() for url in urls if str(url).strip())

            tool = WebSearchTool(project_id=runtime.project_id, thread_manager=runtime.thread_manager)
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("WebSearch tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_intelligent_search_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.intelligent_search_tool import IntelligentSearchTool

            if method_name == "extract_web_content":
                urls = args.get("urls")
                if isinstance(urls, list):
                    args = dict(args)
                    args["urls"] = ", ".join(str(url).strip() for url in urls if str(url).strip())

            tool = IntelligentSearchTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("IntelligentSearch tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_people_search_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.people_search_tool import PeopleSearchTool

            tool = PeopleSearchTool(thread_manager=context.get("thread_manager"))
            result = await tool.people_search(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name="people_search", result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("people_search failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "people_search",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_company_search_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.company_search_tool import CompanySearchTool

            tool = CompanySearchTool(thread_manager=context.get("thread_manager"))
            result = await tool.company_search(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name="company_search", result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("company_search failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "company_search",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_data_providers_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.data_providers_tool import DataProvidersTool

            tool = DataProvidersTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("DataProviders tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_image_service_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.image_service_tool import ImageServiceTool

            tool = ImageServiceTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("ImageService tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_document_service_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.document_service_tool import DocumentServiceTool

            tool = DocumentServiceTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("DocumentService tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_data_analytics_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.data_analytics_tool import DataAnalyticsTool

            tool = DataAnalyticsTool()
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name=method_name, result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("DataAnalytics tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_upload_file_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            from core.tools.upload_file_tool import UploadFileTool

            tool = UploadFileTool()
            result = await tool.upload_file(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name="upload_file", result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("upload_file failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "upload_file",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_skills_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.skills_tool import SkillsTool

            tool = SkillsTool(
                thread_id=runtime.thread_id,
                account_id=runtime.account_id,
                agent_config=runtime.agent_config,
                db_connection=runtime.db,
                run_config=context.get("run_config"),
                parent_state=context.get("state") or {},
                tool_context=context,
            )
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=method_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("Skills tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_task_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            parent_run_config = context.get("run_config")
            if parent_run_config is None:
                return {
                    "tool_call_id": tool_call_id,
                    "name": "task",
                    "success": False,
                    "started_at": started_at,
                    "ended_at": _now_iso(),
                    "error": "tool_error:missing_run_config",
                }

            from core.tools.task_tool import TaskTool

            tool = TaskTool(
                thread_id=runtime.thread_id,
                project_id=runtime.project_id,
                account_id=str(runtime.account_id or ""),
                db_connection=runtime.db,
                parent_run_config=parent_run_config,
                parent_state=context.get("state") or {},
                tool_context=context,
            )
            result = await tool.task(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name="task",
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("task tool call failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "task",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_trigger_tool(method_name: str):
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.trigger_tool import TriggerTool

            agent_id: Optional[str] = None
            if isinstance(runtime.agent_config, dict):
                agent_id = runtime.agent_config.get("agent_id")

            tool = TriggerTool(
                thread_id=runtime.thread_id,
                db_connection=runtime.db,
                agent_id=agent_id,
                account_id=runtime.account_id,
            )
            method = getattr(tool, method_name)
            result = await method(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name=method_name,
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("Trigger tool call failed", tool=method_name)
            return {
                "tool_call_id": tool_call_id,
                "name": method_name,
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_canvas_read_tool_cac():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.canvas.cac.tools import CanvasReadTool

            tool = CanvasReadTool(
                thread_id=runtime.thread_id,
                canvas_id=runtime.canvas_id,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            result = await tool.read(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name="canvas_read",
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("canvas_read failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "canvas_read",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_canvas_write_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.canvas.cac.tools import CanvasWriteTool

            tool = CanvasWriteTool(
                thread_id=runtime.thread_id,
                canvas_id=runtime.canvas_id,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            result = await tool.write(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name="canvas_write",
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("canvas_write failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "canvas_write",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_canvas_edit_tool_cac():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.canvas.cac.tools import CanvasEditTool as CaCEditTool

            tool = CaCEditTool(
                thread_id=runtime.thread_id,
                canvas_id=runtime.canvas_id,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            result = await tool.edit(**args)
            return _tool_result_to_execution_result(
                tool_call_id=tool_call_id,
                name="canvas_edit",
                result=result,
                started_at=started_at,
            )
        except Exception as exc:
            logger.exception("canvas_edit failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "canvas_edit",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler


def _call_expand_message_tool():
    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> ToolExecutionResult:
        started_at = _now_iso()
        tool_call_id = str(context.get("tool_call_id") or "")
        try:
            runtime = _get_runtime_context(context)
            from core.tools.expand_msg_tool import ExpandMessageTool

            tool = ExpandMessageTool(
                thread_id=runtime.thread_id,
                thread_manager=runtime.thread_manager,
                db_connection=runtime.db,
            )
            result = await tool.expand_message(**args)
            return _tool_result_to_execution_result(tool_call_id=tool_call_id, name="expand_message", result=result, started_at=started_at)
        except Exception as exc:
            logger.exception("expand_message failed")
            return {
                "tool_call_id": tool_call_id,
                "name": "expand_message",
                "success": False,
                "started_at": started_at,
                "ended_at": _now_iso(),
                "error": f"tool_error:{type(exc).__name__}",
                "metadata": {"message": str(exc)[:500]},
            }

    return handler
