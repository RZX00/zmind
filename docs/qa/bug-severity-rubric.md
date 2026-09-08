# Zmind Bug Severity Rubric

> Phase 0 frozen on: 2026-03-13

---

## 1. Purpose

This rubric prevents severity drift.

A bug is not `P0` because it is annoying, and a bug is not `P3` because it is visually small.
Severity is determined by user harm, business harm, and recovery cost.

---

## 2. Severity Definitions

### `P0` - Release Blocking / Production Critical

Use `P0` when any of the following is true:

- user data can be lost or corrupted
- billing, credits, or entitlement can be wrong
- unauthorized access or data exposure is possible
- login, invite, share, or core editor entry is blocked
- core save/recover flow is unreliable
- there is no safe workaround

Examples in this codebase:

- canvas draft recovery restores the wrong draft
- share thread exposes private file content to anonymous users
- invite redeem adds the wrong credits or no credits while claiming success
- team role change lets a member gain owner powers incorrectly
- canvas/doc/thread cannot be entered or saved for normal users

Target response:

- triage immediately
- isolate blast radius same day
- fix before release
- mandatory regression evidence

### `P1` - Serious Core Experience Failure

Use `P1` when:

- the main workflow is badly degraded
- outcomes are often wrong but not catastrophic
- a workaround exists but is costly or confusing
- repeated occurrence will materially hurt trust

Examples:

- workspace move/rename intermittently fails
- doc AI panel mutates content incorrectly but content is recoverable
- trigger detail panel breaks on mobile and blocks configuration
- skills install path fails for a subset of valid cases

Target response:

- triage in current phase
- fix within current program wave
- regression coverage strongly recommended

### `P2` - Important but Non-Blocking Defect

Use `P2` when:

- the issue affects a secondary or support workflow
- workaround exists and is acceptable
- damage is localized and recoverable

Examples:

- changelog button opens wrong target
- explore pagination requires refresh to show the next page
- outline panel drag position is not persisted

Target response:

- triage in current phase
- fix if capacity allows or bundle into next scheduled fix wave

### `P3` - Low-Risk Defect / Polish

Use `P3` when:

- the issue is low-frequency, low-harm, and cosmetic or wording-driven
- no meaningful data, permission, or core-flow risk exists

Examples:

- copy text mismatch
- spacing/alignment issue
- non-critical status badge wording inconsistency

Target response:

- log and backlog
- batch with polish work

---

## 3. Tie-Break Rules

If a bug could belong to two levels, use the higher level when:

- the bug involves permissions
- the bug involves money/credits
- the bug involves persistence/recovery
- the bug appears in Canvas / Doc / Thread / Auth / Share / Team role logic

Do not downgrade because:

- the bug is hard to reproduce
- the user can refresh sometimes
- only one role is affected
- only mobile is affected

---

## 4. Severity Decision Tree

```text
Decision Tree
=============

Does it expose or corrupt data?
  -> Yes => P0

Does it break auth, billing, share, team permission, save, recover, or core editor access?
  -> Yes => P0

Does it seriously degrade a main workflow with poor workaround?
  -> Yes => P1

Does it break a secondary workflow with acceptable workaround?
  -> Yes => P2

Otherwise
  -> P3
```

---

## 5. Required Fields When Logging Severity

Every bug entry must include:

- severity
- justification sentence
- affected surface
- affected role(s)
- user harm statement
- workaround statement

Bad example:

- `P1 because it seems important`

Good example:

- `P0 because anonymous users can open a public thread and access private file preview URLs; no safe workaround exists and this is a permission leak.`

