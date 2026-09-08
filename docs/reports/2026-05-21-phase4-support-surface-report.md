# 2026-05-21 Phase 4 Support Surface Report

> Program calendar window: 2026-05-01 to 2026-05-21
> Documentation executed on: 2026-03-13

## Scope

Phase 4 audited the product's support surfaces:

- knowledge
- triggers
- trash
- skills
- credentials
- integrations

## Work Completed

Created:

- `docs/qa/audits/knowledge-audit.md`
- `docs/qa/audits/triggers-audit.md`
- `docs/qa/audits/trash-audit.md`
- `docs/qa/audits/skills-audit.md`
- `docs/qa/audits/credentials-audit.md`
- `docs/qa/audits/integrations-audit.md`
- `docs/qa/regression/support-surface-regression-pack.md`
- `docs/reports/2026-05-21-phase4-support-surface-report.md`

Updated:

- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`

## Findings Summary

| Severity | Count | IDs |
|---|---:|---|
| `P0` | 0 | none |
| `P1` | 2 | `BUG-0007`, `BUG-0008` |
| `P2` | 1 | `BUG-0009` |
| Watchlist / risk only | 1 | `RISK-0009` |

## What Was Confirmed

### 1. Trigger detail routing breaks route-scope truth

The trigger page is entered through scope-aware routes, but selecting or deselecting a trigger rewrites the browser location to hard-coded personal `/triggers` paths. Team slug and locale prefix are therefore lost during normal detail-panel interaction.

### 2. Dashboard knowledge shortcuts are less safe than the canonical knowledge manager

The full knowledge manager respects `currentWorkspaceId`. The dashboard knowledge slice does not. It issues direct Supabase queries without `account_id` filtering and then uses a hard-coded `/knowledge` destination path, so users with multiple accessible workspaces can see mixed-account data and be kicked out of team scope.

### 3. Trash node-count sorting is only page-local

The trash page offers a `Nodes` sort mode, but the backend can only paginate by deleted time or title. The frontend works around that by resorting just the current page, which means the table is not globally sorted once there is more than one page of trash.

## What Was Not Confirmed

Static review did not find a bug-register-level defect in:

- skills marketplace
- credentials settings
- Obsidian integration
- OpenClaw integration

That does not mean these surfaces are fully proven. It means only that this audit did not find a code-level defect strong enough to register as a confirmed bug without runtime evidence.

## Product State After Phase 4

```text
Before Phase 4
==============
Support surfaces were still treated as "secondary":
- fewer users touch them every day
- but they still influence trust, workspace boundaries, and recovery flows

After Phase 4
=============
We now know:
- the biggest support-surface failures are route and workspace-scope truth defects
- trash still contains at least one misleading table behavior on a destructive surface
- the settings and integration shells are structurally better than the route-mirror slices
```

## Regression Status

`REG-03` now exists as a frozen manual specification covering eleven support-surface cases.

It is not yet runnable because:

- Playwright product coverage still does not exist
- deterministic support-surface fixtures are still not scriptable end-to-end
- open `BUG-0007`, `BUG-0008`, and `BUG-0009` remain unresolved

## Open Risks

Most important remaining risks after this phase:

- support-surface smoke coverage is still manual only
- route-mirror and scope-discipline issues are now confirmed, not hypothetical, which raises the priority of boundary and locale phases
- integration health is still static-audit-only until executable smoke coverage exists

These remain tracked in `docs/qa/open-risk-register.md`.

## Gate Check

Phase 4 exit criteria required:

- support surfaces have no open P0
- high-frequency support flows have smoke coverage
- integration role gates are reviewed

Result:

- `CONDITIONAL PASS`

Reason:

- no `P0` support-surface defect was confirmed in this phase
- `REG-03` now defines smoke coverage and integration role-gate checks
- the phase is still not release-grade because `BUG-0007`, `BUG-0008`, and `BUG-0009` remain open and `REG-03` is manual-only

## Next Phase

Phase 5 moves into higher-damage boundary surfaces:

- team settings
- team members and invites
- share canvas
- share thread
- admin surfaces
