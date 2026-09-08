# 2026-04-30 Phase 3 Core Workspace Report

> Program calendar window: 2026-04-10 to 2026-04-30
> Documentation executed on: 2026-03-13

## Scope

Phase 3 audited the product's daily-work surfaces:

- dashboard
- workspace
- canvas
- doc
- thread

## Work Completed

Created:

- `docs/qa/audits/dashboard-audit.md`
- `docs/qa/audits/workspace-audit.md`
- `docs/qa/audits/canvas-deep-audit.md`
- `docs/qa/audits/doc-deep-audit.md`
- `docs/qa/audits/thread-deep-audit.md`
- `docs/qa/regression/core-workspace-regression-pack.md`
- `docs/reports/2026-04-30-phase3-core-workspace-report.md`

Updated:

- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`

## Findings Summary

| Severity | Count | IDs |
|---|---:|---|
| `P0` | 1 | `BUG-0004` |
| `P1` | 2 | `BUG-0005`, `BUG-0006` |
| Watchlist / risk only | 1 | `RISK-0008` |

## What Was Confirmed

### 1. Canvas undo/redo is not durably aligned with the normal persistence contract

The normal canvas save path persists metadata and global styles. The undo/redo persistence path does not. That means refresh can revive stale anchors, styling, or grouped-connection state after a user believed an undo or redo had been saved.

### 2. Doc autosave loses durability when the editor is torn down before debounce fires

The doc surface has local draft and explicit flush points, but navigation or unmount can still cancel the pending server save. That leaves the server copy stale until the user happens to recover from the same browser.

### 3. Thread optimistic user messages are not reconciled consistently when run start is denied

Billing denial invalidates the thread message query. Run-limit and project-limit denials do not. Because the real user message is already persisted before the run-start call, those branches can leave behind stale `temp-*` message state.

## What Was Not Confirmed

Dashboard and workspace both remain important surfaces, but this static audit did not find a code-level defect strong enough to register as a confirmed bug there.

That is not the same as "fully proven safe":

- they still lack runnable end-to-end coverage
- their correctness depends on surrounding canvas/doc/thread surfaces that did fail

## Product State After Phase 3

```text
Before Phase 3
==============
Core daily-work surfaces were still mostly a risk cluster:
- many stateful editors
- complex save flows
- optimistic UI
- weak runnable regression coverage

After Phase 3
=============
We now know:
- workspace data plumbing is structurally better than the editor surfaces
- the most serious core-work bug is canvas persistence drift after undo/redo
- doc teardown durability is not release-grade
- thread run-limit error handling leaves message truth ambiguous
```

## Regression Status

`REG-02` now exists as a frozen manual specification covering twelve core workspace cases.

It is not yet runnable because:

- Playwright adoption is still not implemented
- deterministic seed/reset for workspace fixtures is still missing
- open `P0` and `P1` defects remain on canvas, doc, and thread

## Open Risks

Most important remaining risks after this phase:

- no runnable core-workspace E2E pack yet exists
- save/recovery paths remain only partially protected by manual evidence
- dashboard/workspace still rely on static audit until `REG-02` becomes executable

These remain tracked in `docs/qa/open-risk-register.md`.

## Gate Check

Phase 3 exit criteria required:

- no open P0 remains on dashboard / workspace / canvas / doc / thread
- core workspace regression pack exists
- all major save / recovery flows are explicitly verified

Result:

- `CONDITIONAL FAIL`

Reason:

- the audit requirement is satisfied
- the quality gate is not satisfied because `BUG-0004` remains open, `BUG-0005` and `BUG-0006` remain triaged, and `REG-02` is still manual-only

## Next Phase

Phase 4 moves into support surfaces:

- knowledge
- triggers
- trash
- skills
- credentials
- integrations

That phase decides whether peripheral workflows are merely secondary or whether they contain hidden trust-breakers that poison deeper product usage.
