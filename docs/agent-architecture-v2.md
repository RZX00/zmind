# Agent Architecture V2 (Current Runtime)

## Status
- This file is the current runtime architecture reference.
- Re-established on **2026-02-07** as an HTML-presentation-first baseline.
- Legacy design snapshots remain in `docs/archive/2026-02-doc-audit/`.

## System Overview
Zmind uses a supervisor + specialized subagent model:
- `canvas_agent`
- `presentation_agent`
- `deep_research_agent`
- `integration_agent`

The supervisor prefers direct handling when possible and delegates only when specialization is needed.

## Routing Layer
**File**: `backend/core/langgraph_engine/supervisor/router.py`

Key routing rules:
- Canvas creation/editing and image generation requests -> `canvas_agent`
- PPT/slide generation requests -> `presentation_agent`
- Multi-source web research -> `deep_research_agent`
- External API/MCP/data-provider actions -> `integration_agent`

## Agent Definitions
**File**: `backend/core/langgraph_engine/supervisor/agent_defs.py`

### `canvas_agent`
- Owns canvas-native creation and editing workflows.
- Uses `canvas_read`, `canvas_write`, `canvas_edit`, and image generation tools where appropriate.

### `presentation_agent` (HTML-only)
- Generates and edits HTML slide decks on canvas.
- Writes decks as `code` nodes (`codeType='html'`).
- Edits existing decks through read-then-edit flow.
- Uses `ask`/`cta` for user-facing decisions.

### `deep_research_agent`
- Performs constrained web research and synthesis.

### `integration_agent`
- Executes provider/MCP-backed integration calls.

## Tool Catalog Governance
**Files**:
- `backend/core/langgraph_engine/tools/adapters/native_tool_adapter.py`
- `backend/core/langgraph_engine/contracts/tool_interface.py`
- `backend/core/utils/tool_groups.py`

Principles:
- Runtime tool registration is the source of truth.
- Tool exposure must match frontend tool rendering mappings.
- Removed tools must not remain in terminating-tool lists or UI fallbacks.

## Presentation Domain Path
### Prompt + behavior
- `prompts/subagents/presentation.prompt.md`
- `backend/core/prompts/presentation_agent_prompt.md`

### Execution path
1. Supervisor delegates to `presentation_agent`.
2. Agent produces HTML deck and invokes canvas tools.
3. Canvas stores deck as editable content.
4. Frontend displays output and supports export/share actions.

### Export + Google Slides
- Frontend handles auth callback and upload intent:
  - `frontend/src/components/thread/ThreadComponent.tsx`
- Frontend API utility:
  - `frontend/src/components/thread/tool-views/utils/presentation-utils.ts`
- Backend Google endpoints:
  - `backend/core/google/google_slides_api.py`
  - `backend/core/google/google_slides_service.py`

## UX Integrity Layer
Frontend tool rendering must mirror backend catalog:
- Tool title/icon mappings:
  - `frontend/src/components/thread/utils.ts`
  - `frontend/src/components/thread/tool-views/utils.ts`
- Removed sandbox tool handling:
  - `frontend/src/components/thread/tool-views/wrapper/CloudToolViewRegistry.tsx`
- Streaming/message cleanup logic:
  - `frontend/src/components/thread/content/ThreadContent.tsx`
  - `frontend/src/components/thread/content/ShowToolStream.tsx`
  - `frontend/src/components/thread/tool-inline/summarizers.tsx`

## Deprecated Concepts (Do Not Reintroduce)
- Legacy image-based PPT orchestration chain and its related tool family.
- Any presentation workflow that depends on per-slide image generation state.

## Engineering Guardrails
- Keep business intent in agent prompts; keep execution in tool contracts.
- Avoid frontend-only “phantom tools” not present in backend registry.
- Preserve Google Slides integration while refactoring PPT internals.
- Preserve general image-generation capability outside presentation-specific legacy flows.
