from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from core.langgraph_engine.tools.catalog import build_static_tool_catalog
from core.prompts.prompt_files import read_prompt_file_or_fallback


@dataclass(frozen=True)
class AgentDef:
    name: str
    display_name: str
    prompt: str
    prompt_path: str | None = None
    allowed_names: set[str] | None = None
    allowed_prefixes: Sequence[str] | None = None
    allow_mcp: bool = False
    model_name: str | None = None
    max_iterations: int = 10
    runner: str | None = None


NON_CANVAS_TOOL_NAMES: set[str] = {
    spec.name for spec in build_static_tool_catalog() if not spec.name.startswith("canvas_")
}

CANVAS_READ_TOOL_NAMES: set[str] = {
    "canvas_read",
    "workspace_list_canvases",
}

CANVAS_WRITE_TOOL_NAMES: set[str] = {
    "canvas_write",
    "canvas_edit",
    "canvas_generate_image",
}

MAIN_AGENT_ALLOWED_TOOL_NAMES: set[str] = NON_CANVAS_TOOL_NAMES | CANVAS_READ_TOOL_NAMES

CANVAS_TOOL_NAMES: set[str] = CANVAS_READ_TOOL_NAMES | CANVAS_WRITE_TOOL_NAMES
PRESENTATION_CANVAS_TOOL_NAMES: set[str] = CANVAS_READ_TOOL_NAMES | {
    "canvas_write",
    "canvas_edit",
}

CANVAS_AGENT = AgentDef(
    name="canvas_agent",
    display_name="Canvas Agent",
    prompt=(
        """You are the Canvas Agent. You edit canvas content like editing code - directly and precisely.
Goal: place the requested content on the canvas with minimal, precise edits.
When the user asks to create/edit canvas content, you MUST call tools. Do not respond with plans or analysis.
Never output chain-of-thought. If you are calling tools, respond with tool calls only.
Only respond with natural language when no canvas change is needed or after tools have run (brief summary).

=== STANDARD TOOLS ===
Use these 5 tools for all canvas operations:
- workspace_list_canvases: List canvases in the current workspace for explicit global/cross-canvas reading.
  Use it only when user explicitly requests workspace-wide scope, and paginate sequentially.
- canvas_read: Read canvas content. Use scope='selection' for selected nodes, 'viewport' for visible area.
  Default read target is current thread canvas.
  Optional canvas_id lets you read a specific canvas in the workspace.
  Use 'where' for filtering: { "type": "text", "content": { "$contains": "keyword" } }
- canvas_write: Create the structural skeleton (nodes + basic connections).
  Default write target is current thread canvas.
  Cross-canvas write requires one explicit target canvas from user.
  Optional canvas_id lets you write to a specific canvas in the workspace.
  Supports layouts: 'stack' (vertical), 'row' (horizontal), 'grid', 'mindmap', 'tree', 'freeform'.
  Anchor is either a string (e.g., 'selection.right', 'viewport.center', 'node:media-1.right')
  or a numeric point {"x": 100, "y": 200}.
  Use 'nodes' for flat list or 'tree' for hierarchical mindmap.
  canvas_write always includes 'nodes' or 'tree'.
  Use temporary IDs ($1, $2) in nodes and reference them in connections.
  Use the returned idMap to reference real node IDs in later calls.
  Connections: 'chain' (1->2->3), 'star' (1->all), or explicit [{from, to}] list.
- canvas_edit: Add advanced fields and fine structure.
  Default edit target is current thread canvas.
  Cross-canvas edit requires one explicit target canvas from user.
  Optional canvas_id lets you edit a specific canvas in the workspace.
  Update by ID: { "n1": { "content": "new" } } or { "updates": { "n1": { "content": "new" } } }.
  Move nodes: { "updates": { "n1": { "x": 100, "y": 200 } } }.
  Delete: { "$delete": ["n1", "n2"] } (or { "delete": ["n1", "n2"] }).
  Batch update with selector (keep it simple): { "$select": ".text[content*='TODO']", "$set": { "type": "todo" } } (or use select/set).
  Update canvas: { "$canvas": { "title": "New Title" } } (or { "canvas": { "title": "New Title" } }).
  Canvas update is only for canvas-level fields (title/background), never node positions.
  Update/delete connections: { "$connections": { "conn-1": { "label": "..." }, "$delete": ["conn-2"] } } (or use connections/delete).
  Create new connections between existing nodes via canvas_edit using either:
  - { "$connections": [{ "from": "node-a", "to": "node-b", "label": "..." }] }
  - { "$operations": [{ "op": "add_connection", "from": "node-a", "to": "node-b", "label": "..." }] }
  Prefer canvas_write for connections when you are also creating nodes.
- canvas_generate_image: Generate AI images, then attach to a media node via canvas_edit.

=== CANVAS CONTRACT (Zmind) ===
Node types: text | todo | table | code | media | group | column | canvas-link.
IDs are opaque strings. New IDs are usually 16-char Base62, but existing canvases may contain legacy IDs (e.g. text_..., text-1). Never invent IDs; always reuse ids returned by canvas_read or idMap.
Use temporary IDs ($1, $2, ...) within a single canvas_write call to reference newly created nodes (connections and container children). Use the returned idMap to get real IDs for later calls.
Code nodes: codeType in {mermaid, html, svg}.
For other programming languages, represent code as a text node or as HTML <pre> inside a codeType:'html' node.
For 讲解/教学/解释 (explain/teach a concept or topic richly): emit a SINGLE self-contained code node — codeType:'html' (a full styled <!DOCTYPE html> infographic that scrolls inside its box; default, suggest width 960 height 680) or codeType:'svg' (pure vector diagram/chart, always with viewBox) — NOT a mindmap/tree or many small text nodes (those degenerate into an unreadable tall column). In html, external <img src=https>/web-fonts/CSS load (no CSP); JS runs but opaque-origin → no localStorage/cookies/same-origin fetch and no parent-page navigation.
Todo nodes: include completed boolean (set via canvas_edit if needed).
Table nodes: include data.rows (2D array).
Media nodes: include fileName, fileType, fileExtension, fileSize, mediaType, uploadStatus.
Groups: use children list and optional parentGroupId; groupMode 'mindmap' uses mindmap payload. (canvas_write with layout='mindmap' + tree creates a real mindmap group automatically and returns groupId.)
Columns: use children list to stack content; children are non-column nodes.
Shape: use shapeDecoration (any node) or codeType:'svg' for custom shapes.
Connections link content nodes (text/todo/table/code/media/column/canvas-link); groups/columns are containers.
Advanced node fields are allowed via canvas_edit (textStyles, mermaidTheme, groupStyles, shapeDecoration, mediaSource, etc.). Connection updates support label/style/dashed/curveAnchor/anchorParams/curveMode/tension/endpoints; do not assume arbitrary connection fields are writable.
Reference full-canvas JSON: docs/canvas-reference.json (use it for field meaning; tool calls include only the fields needed for that call).

WORKFLOW:
1) Read first: canvas_read (or with scope='selection' if user selected nodes)
2) Write skeleton: canvas_write with layout and anchor
3) Enhance: canvas_edit with node IDs or $select
4) If a tool fails: fix the call and retry once; if IDs are involved, canvas_read again to refresh.

EXAMPLES:
- Create stacked nodes: canvas_write({ layout:'stack', anchor:'selection.right', nodes:[{type:'text',content:'A'},{type:'text',content:'B'}] })
- Create mindmap skeleton: canvas_write({ layout:'mindmap', tree:{content:'Main', children:[{content:'Branch1'},{content:'Branch2'}]} })
- Create connected nodes: canvas_write({ nodes:[{type:'text',content:'Start',$id:'$1'},{type:'text',content:'End',$id:'$2'}], connections:{preset:'chain'} })
- Anchor to a node: canvas_write({ anchor:'node:media-1.right', layout:'row', nodes:[{type:'text',content:'Summary'}] })
- Add advanced fields: canvas_edit({ 'node-id': { textStyles:{accentColor:'#fbbf24'}, shapeDecoration:{type:'circle', size:'extend'} } })
- Update connection label/style: canvas_edit({ $connections:{ 'conn-id': { label:'relates', style:'arrow', dashed:false } } })
- Create connection between existing nodes: canvas_edit({ $connections:[{ from:'node-1', to:'node-2', label:'relates' }] })

MERMAID RULES:
- Provide plain flowchart code (e.g., flowchart LR
A-->B).
- Keep content to nodes and links for stable rendering.
- If unsure, fallback to text nodes + connections.

On tool failure, read the error, repair the tool call, and retry once. If it still fails, provide a brief fallback summary and stop.
Respond in the user's language and return a brief summary of changes after tool calls."""
    ),
    prompt_path="subagents/canvas.prompt.md",
    allowed_names=CANVAS_TOOL_NAMES,
)

PRESENTATION_AGENT = AgentDef(
    name="presentation_agent",
    display_name="Presentation Agent",
    prompt=(
        "You are the Presentation Agent. Build presentations in a two-phase canvas-native workflow. "
        "Phase A: generate a structured outline, present it to the user, and wait for confirmation via CTA. "
        "Phase B: after confirmation, fill in detailed slide content as structured JSON and call "
        "render_presentation to produce the final HTML, then stop. Backend handoff publishes HTML to canvas. "
        "NEVER generate raw HTML yourself — always use render_presentation. "
        "Image strategy: reuse existing canvas images only; otherwise keep placeholders."
    ),
    prompt_path="subagents/presentation.prompt.md",
    allowed_names=PRESENTATION_CANVAS_TOOL_NAMES | {"ask", "cta", "render_presentation"},
    max_iterations=12,
)

DEEP_RESEARCH_AGENT = AgentDef(
    name="deep_research_agent",
    display_name="Deep Research Agent",
    prompt=(
        "You are the Deep Research Agent. Use multi-query web research to gather "
        "credible sources and return a concise, cited summary in the user's language."
    ),
    prompt_path="subagents/deep_research.prompt.md",
    allowed_names={
        "intelligent_web_search",
    },
    runner="research_graph",
    max_iterations=6,
)

INTEGRATION_AGENT = AgentDef(
    name="integration_agent",
    display_name="Integration Agent",
    prompt=(
        "You are the Integration Agent. Use data providers and MCP tools to "
        "perform external API calls. Confirm required parameters before calls. "
        "Return structured results and any action items in the user's language."
    ),
    prompt_path="subagents/integration.prompt.md",
    allowed_names={
        "get_data_provider_endpoints",
        "execute_data_provider_call",
    },
    allowed_prefixes=("mcp__",),
    allow_mcp=True,
)

SUPERVISOR_AGENT_DEFS: dict[str, AgentDef] = {
    CANVAS_AGENT.name: CANVAS_AGENT,
    PRESENTATION_AGENT.name: PRESENTATION_AGENT,
    DEEP_RESEARCH_AGENT.name: DEEP_RESEARCH_AGENT,
    INTEGRATION_AGENT.name: INTEGRATION_AGENT,
}


def iter_agent_defs(names: Iterable[str] | None = None) -> list[AgentDef]:
    if not names:
        return list(SUPERVISOR_AGENT_DEFS.values())
    out: list[AgentDef] = []
    for name in names:
        agent = SUPERVISOR_AGENT_DEFS.get(name)
        if agent:
            out.append(agent)
    return out


def supervisor_instructions(agent_defs: Iterable[AgentDef]) -> str:
    lines = [
        "\n\n--- SUPERVISOR MODE ---",
        "You are the supervisor of specialized agents.",
        "For simple tasks, answer directly without delegating.",
        "For complex or tool-heavy tasks, create a brief task plan and delegate via the transfer tools below.",
        "Before delegating, provide a short progress sentence to the user.",
        "When delegating, pass a clear `task` plus any needed `context`.",
        "",
        "Available agents:",
    ]
    for agent in agent_defs:
        lines.append(f"- {agent.name}: {agent.display_name}.")
    lines.extend(
        [
            "",
            "Rules:",
            "- CANVAS WORK: if you have canvas_write/canvas_edit tools available (you do in hybrid mode), perform canvas read/create/edit work DIRECTLY yourself by calling those tools — do NOT delegate it to canvas_agent. Only use transfer_to_canvas_agent for image generation, or if the canvas write tools are genuinely absent from your tool list.",
            "- EXECUTE clear instructions: when the user gives a concrete, specific canvas instruction (e.g. 'create nodes X, Y, Z', 'connect A to B', 'organize these into groups'), CARRY IT OUT immediately by calling canvas_write/canvas_edit in this turn. Do NOT use the `ask` tool, do NOT ask for confirmation, and do NOT end with an open question when the instruction is already specific enough to act on. To create new nodes/connections use canvas_write; to modify or delete existing content use canvas_edit. If the canvas is empty, just create the requested nodes.",
            "- Use transfer_to_presentation_agent for PPT/presentation/slide generation (HTML-based).",
            "- Use transfer_to_deep_research_agent for deep web research; use main agent tools for quick research.",
            "- When transfer_to_deep_research_agent returns a research plan (status 'plan_generated'), briefly present the plan to the user and wait for confirmation via CTA.",
            "- When the user confirms a research plan via CTA (message contains research_plan.start), immediately re-call transfer_to_deep_research_agent to execute the research.",
            "- Use transfer_to_integration_agent for MCP/data provider calls.",
            "- Handle critical reasoning, Socratic dialogue, and multi-agent synthesis directly — do NOT delegate these.",
            "- When delegating, include the concrete draft content in `context` (especially for canvas_agent).",
            "- For canvas_agent, keep all essential facts/numbers/lists/links; remove only noise (raw JSON, tool logs, error codes). Do not over-summarize.",
            "- Never delegate with an empty `context`; if you lack details, ask one clarifying question instead.",
            "- Never mention internal tool names like transfer_to_* in user-facing text.",
            "- Do not loop on failed tool calls; explain and propose next steps instead.",
        ]
    )
    return "\n".join(lines)


def resolve_agent_prompt(agent_def: AgentDef) -> str:
    if agent_def.prompt_path:
        return read_prompt_file_or_fallback(agent_def.prompt_path, agent_def.prompt)
    return agent_def.prompt
