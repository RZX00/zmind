# ADR: Agent Runtime V2 / Clean Break / Canvas Native First

## Status

Accepted

## Context

The current backend agent architecture has grown into a mix of:

- worker-owned orchestration logic
- LangGraph-owned global runtime semantics
- direct model-facing canvas CRUD tools
- partially independent canvas-native services
- event and persistence paths that do not share one canonical source

This creates five concrete problems:

```text
1. global runtime semantics are fragmented
2. canvas is treated as a tool instead of the main execution surface
3. completion can be reported before strict verification
4. resume restores text/history better than runtime semantics
5. stream/persistence/billing interpret events through different contracts
```

## Decision 1: Clean Break

We will not preserve the old runtime as an in-process fallback.

Reason:

- it keeps the old semantic boundary alive
- it doubles maintenance and testing burden
- it weakens the incentive to fully migrate callers

Rollback remains available through git branch or deployed version rollback.

## Decision 2: Canvas Native First

Canvas requests must enter a dedicated internal lane before any model-direct canvas tool path.

Reason:

- canvas work is stateful and version-sensitive
- canvas changes need plan, compile, verify, and repair semantics
- canvas UX depends on user-goal completion, not tool-call success

The old canvas CRUD engine remains, but only as:

- snapshot backend
- mutation backend
- version guard
- persistence backend

## Decision 3: Strict Verify Gate

No write may be declared complete without verification.

Reason:

- write success is not equivalent to goal success
- version conflicts and partial mutations are common failure classes
- canvas UX degrades sharply when users are told something is done when it is not

This applies to:

- lightweight verify for trivial writes
- full verify for non-trivial writes

## Decision 4: Full Continuity

Resume must restore runtime semantics, not only transcript text.

Reason:

- preview/confirm flows require reloading the exact plan
- repair flows require prior verifier evidence
- deterministic context lifecycle requires replacement/collapse state

Therefore continuity must store:

- event history
- replacement ledger
- artifact references
- verifier/repair history
- active lane metadata

## Decision 5: Canonical Event Bus V2

All downstream projections must derive from the same event envelope.

Reason:

- stream, persistence, analytics, billing, and resume should not each infer state separately
- event drift makes replay and auditing unreliable

Legacy stream compatibility can remain as a projection during migration, but not as the primary semantic source.
