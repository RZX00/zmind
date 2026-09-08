# PPT Generation Architecture (HTML-Only)

## Status
- This document is the **current canonical architecture** for PPT generation in Zmind.
- As of **2026-02-07**, the image-based PPT pipeline is removed from runtime.
- Historical image-based designs are archived under `docs/archive/2026-02-doc-audit/`.

## Product Goal
- Convert user intent into a presentation that feels immediate, editable, and shareable.
- Keep authoring in one place (canvas), with minimal cognitive load for users.
- Preserve export and Google Slides interoperability.

## Scope
### In scope
- HTML slide deck generation on canvas (`code` node, `codeType='html'`).
- Iterative edits to existing deck content.
- Export to PPTX/PDF and optional upload to Google Slides.

### Out of scope
- Image-based per-slide rendering pipeline.
- Template snapshot / batch image generation tools from legacy flow.

## Runtime Architecture
1. User requests PPT/slides.
2. Supervisor routes request to `presentation_agent`.
3. `presentation_agent` builds or edits a self-contained HTML deck.
4. Agent writes to canvas via `canvas_write` or updates via `canvas_edit`.
5. Frontend renders result in thread/canvas.
6. User can export and optionally upload to Google Slides.

## Core Components
- **Routing**
  - `backend/core/langgraph_engine/supervisor/router.py`
  - Delegates presentation intent to `presentation_agent`.
- **Presentation Agent definition**
  - `backend/core/langgraph_engine/supervisor/agent_defs.py`
  - `backend/core/prompts/presentation_agent_prompt.md`
  - `prompts/subagents/presentation.prompt.md`
- **Tool registration**
  - `backend/core/langgraph_engine/tools/adapters/native_tool_adapter.py`
  - Presentation path uses `canvas_read`, `canvas_write`, `canvas_edit`, `ask`, `cta`.
- **Canvas execution**
  - `backend/core/canvas/cac/tools.py`
- **Frontend handling**
  - `frontend/src/components/thread/ThreadComponent.tsx`
  - `frontend/src/components/thread/tool-views/utils/presentation-utils.ts`
- **Google integration**
  - `backend/core/google/google_slides_api.py`
  - `backend/core/google/google_slides_service.py`

## Data Contract
### Canvas write contract
- Node type: `code`
- `codeType`: `html`
- `content`: complete single-file HTML (`<!DOCTYPE html>...`)
- Recommended size: `960 x 600`

### Canvas edit contract
- Always read first (`canvas_read`) when modifying existing deck.
- Update existing node content via `canvas_edit` and `$set`.
- Avoid creating duplicate deck nodes for minor edits.

## Deck UX Contract
- Keyboard left/right navigation.
- One active slide visible at a time.
- Fade transitions.
- Page indicator and top progress bar.
- Fullscreen support.
- Touch swipe support.
- Print mode with sequential slides.

## Export and Google Slides Flow
1. Presentation exists as HTML in canvas.
2. Frontend/backend conversion endpoint produces PPTX/PDF.
3. If user chooses Google Slides:
   - OAuth handled via `/google/auth-url` and callback.
   - Converted PPTX uploaded through `/presentation-tools/convert-and-upload-to-slides`.
4. Frontend shows success toast and open-in-slides action.

## Tooling Constraints
- Runtime does **not** rely on removed image-based presentation tools.
- Keep general image generation tools available for non-PPT tasks.
- `presentation_agent` remains presentation-specific; image generation routes to `canvas_agent` when requested.

## Migration Note
- If any legacy image-based PPT references are found, treat them as deprecated and do not reintroduce them into runtime.
