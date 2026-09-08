# LangGraph Supervisor Architecture (Handoff-First)

Status: Active (handoff-only supervisor default)
Last Updated: 2025-12-21

This document describes the current multi-agent architecture that uses a top-level
supervisor with tool-based handoffs, plus a lightweight routing hint to reduce
latency and stabilize tool usage.

---

## Goals
- Fast first response: shrink tool schema for the top-level model.
- Stable execution: delegate tool-heavy tasks to specialist agents.
- Maintainable: keep all tool execution inside LangGraph (no AgentPress).

---

## Components

### 1) Supervisor (top-level)
- Model: uses `LANGGRAPH_SUPERVISOR_MODEL` if set, otherwise uses the normal model.
- Tools: handoff-only by default (transfer tools only).
- Behavior: answers simple tasks directly; delegates complex/tool-heavy tasks.

### 2) Routing hint (heuristic)
- Simple keyword classifier on the latest user message.
- Produces a hint used to limit available transfer tools (when confident).
- Adds a short "Supervisor Routing Hint" line to the system prompt.

### 3) Subagents (specialists)
- **canvas_agent**: canvas tools only.
- **socratic_agent**: reasoning and clarification.
- **presentation_agent**: PPT planning and slide strategy.
- **deep_research_agent**: multi-query web research.
- **integration_agent**: data providers + MCP tools.
- **synthesis_agent**: merge outputs, no tools.

Subagents run in-memory only (no DB persistence) but still deduct usage for billing.

---

## Execution Flow
1) Supervisor loads context and prompt (with routing hint if present).
2) Supervisor either:
   - answers directly (no tools), or
   - calls `transfer_to_*` tool(s) to delegate.
3) Subagent runs with restricted tool registry and returns results.
4) Supervisor synthesizes results and replies to the user.

---

## Configuration (env)
- `LANGGRAPH_SUPERVISOR_ENABLED` (default: true)
- `LANGGRAPH_SUPERVISOR_MODE` (handoff_only | hybrid)
  - `handoff_only`: only transfer tools exposed to supervisor; native tools run in delegated subagents.
  - `hybrid`: supervisor also sees native tools + MCP; faster for small tasks but with larger tool schema.
- `LANGGRAPH_SUPERVISOR_MODEL` (optional override)
- `LANGGRAPH_ROUTER_ENABLED` (default: true)
- `LANGGRAPH_ROUTER_HARD_GATE` (default: false)
  - `false`: routing only influences prompt hints; all transfer tools remain available.
  - `true`: only routed transfer tools are exposed (strict delegation gate).
- `ZMIND_SKILLS_AUTO_RUN` (default: false)
- `ZMIND_SKILLS_AUTO_RUN_SCORE` (default: 7)
  - When enabled, a high-confidence matched skill can be deterministically injected as the first `run_skill` tool call.

---

## Notes / Tradeoffs
- If routing hint is empty, all transfer tools are exposed as a safe fallback.
- MCP connections are still initialized when configured by the agent.
- A future improvement is an explicit planner node for multi-step tasks.
