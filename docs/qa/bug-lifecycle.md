# Zmind Bug Lifecycle

> Phase 0 frozen on: 2026-03-13

---

## 1. Purpose

This lifecycle defines what bug states mean and who is allowed to move them.

Without a strict lifecycle:

- open bugs get lost
- “verified” means different things to different people
- phase closure becomes fiction

---

## 2. Lifecycle States

| State | Meaning | Exit condition |
|---|---|---|
| `Open` | Newly recorded, not yet reviewed | triage owner assigned |
| `Triaged` | Severity, scope, and owner decided | fix plan accepted |
| `In Fix` | A concrete fix is being implemented | candidate build exists |
| `In Regression` | Fix exists and is under verification | evidence confirms behavior |
| `Verified` | Reproduced issue is gone and regression is acceptable | close decision recorded |
| `Waived` | Not fixed in current wave, but risk accepted explicitly | waiver owner + reason recorded |
| `Closed` | Administrative close after verification or waiver | archival only |

---

## 3. State Transition Rules

```text
Lifecycle
=========

Open
  -> Triaged
  -> Waived   (rare; only after explicit decision)

Triaged
  -> In Fix
  -> Waived

In Fix
  -> In Regression
  -> Triaged   (if fix invalid or scope changed)

In Regression
  -> Verified
  -> In Fix    (if regression fails)

Verified
  -> Closed

Waived
  -> Closed
```

---

## 4. Required Evidence Per State

### `Open`

Must have:

- surface
- title
- repro steps
- expected result
- actual result
- environment

### `Triaged`

Must add:

- severity
- owner
- phase target
- user harm statement

### `In Fix`

Must add:

- fix branch/commit reference
- change summary

### `In Regression`

Must add:

- regression steps
- evidence source
- tester

### `Verified`

Must add:

- exact build/commit verified
- result summary
- regression status

### `Waived`

Must add:

- waiver owner
- waiver reason
- expiry or revisit phase

---

## 5. Gate Rules

- No `P0` may remain in `Open` at phase end.
- No phase may close with `P1` bugs still lacking triage.
- `Verified` is invalid without evidence.
- `Waived` is invalid without a named decision owner.

---

## 6. Ownership Rules

| State | Primary owner |
|---|---|
| `Open` | auditor |
| `Triaged` | quality lead + domain owner |
| `In Fix` | implementing engineer |
| `In Regression` | auditor or regression owner |
| `Verified` | quality lead or delegated verifier |
| `Waived` | product/quality decision owner |

