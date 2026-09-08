# Canvas schema v1 — migration & additive-safety analysis (WS1-5)

> Decision gate before any live-doc write. This is the go/no-go analysis the implementation
> plan requires before WS5 slots / WS1 codegen touch the three schema runtimes + Yjs.
> Companion to `schemas/canvas-schema.json` (WS1-1) and `docs/task-plans/2026-06-21-canvas-ai-operation-implementation-plan.md`.

## TL;DR

All v1 schema additions are **additive and optional**. There is **no destructive migration and
no Yjs document-version bump**. Old documents that predate the new fields keep parsing and
rendering unchanged; new fields are written going forward and absent-means-default on read.
**Verdict: GO** for the additive slots (connection `relation`/`directed`/`relationData`,
node/connection `provenance`, typed `tableStyles`), behind a CI drift test. The one item that
needs a real (small) backfill — retiring the orphaned `GroupEntity` / `Canvas.groups` and the
competing `mindmap.siblingOrder`/`collapsed` stores — ships **atomically with its deprecation**
behind a single revert commit, and is the only part that reads/writes existing docs in bulk.

## What changes, and why each is safe

| Change | Runtimes touched | Safety |
|---|---|---|
| Connection `relation?`, `directed?`, `relationData?` (WS5-1) | `canvas.ts`, `api_models.py`, realtime `contract.js` + `canvasDoc.js add_connection` | Additive optional fields. **Load-bearing fix:** `canvasDoc.js add_connection` builds an explicit whitelist payload that silently drops unknown keys — it must switch to a spread (mirroring `add_node`) or the new slots never persist. Reads default `relation=null`/`directed=true`. |
| Node/connection `provenance` (WS5-3) | all three | Additive optional. Absent on old docs ⇒ read-projected as `human`/`imported`, **never back-filled**. `ai?:boolean` retained as a derived shim, never deleted. |
| Typed `tableStyles` (replace `any`) | `canvas.ts`, `api_models.py` | Tightening a previously-`any` field. Pydantic keeps `extra="ignore"` so unknown legacy keys still parse; unknown keys surface as `VALIDATION` only on the **write** path, not on read of old docs. |
| Drop empty `linkStyles` stub | `canvas.ts` | The interface is empty today; removing an unfillable advertised field. No data carries it. |
| Codegen `ALLOWED_OPS` / `CANVAS_PATCH_KEYS` from the artifact (WS1-2) | `ops_contract.py`, `contract.js` | Generated output must reproduce the exact current hand-curated `OP_ALIASES`; the 6 new ops add aliases. Pure refactor + 6 additions; no doc change. |

## Yjs / JSONB specifics

- The realtime doc stores nodes and connections as per-id `Y.Map`s (`canvasDoc.js buildEntryMap`).
  **Adding keys to a `Y.Map` is non-breaking** and needs no document-version bump — clients that
  don't know a key ignore it; the persisted JSONB (`canvases.doc`, the exported canvas) simply
  gains optional fields.
- Persisted JSONB is read back through pydantic with `extra="ignore"` (must stay), so a doc
  written before v1 (no `relation`/`provenance`) parses fine; a doc written after v1 round-trips
  the new fields.
- **No provenance backfill.** We do not rewrite historical docs to invent `createdBy`. Absent
  provenance is read-projected to a sensible default. This keeps the migration zero-risk.

## The one real backfill (gated, atomic, reversible)

Unifying containment (WS5-3/WS5-4) retires three overlapping mechanisms:
- `GroupEntity` / `Canvas.groups[].nodeIds` — **orphaned today** (no op writes it; the apply loop
  never reads `groups`). Migrate any historical `nodeIds` → per-node `parentGroupId`, then drop
  `Canvas.groups`.
- `mindmap.siblingOrder` → the unified ordered `children[]`; `mindmap.collapsed[nodeId]` → node
  `isCollapsed`.

This is the only change that scans/writes existing docs. It ships **with** the deprecation in one
commit, behind a feature gate, with a single revert path. Until it ships, the TS interfaces stay
(`@deprecated`-marked) so nothing breaks.

## Rollout order (Phase 0 → 1)

1. **WS1-1 (done):** author `schemas/canvas-schema.json` + this analysis.
2. **WS1-2:** codegen `ops_contract.py` / `contract.js` (op-set + patch-keys) from the artifact + a
   3-runtime drift test in CI. No doc change.
3. **WS1-3:** codegen pydantic + frontend types; kill the `any`/`Any` holes; keep `extra="ignore"`.
4. **WS5-1 / WS5-3 / WS5-5:** add the slots; fix `canvasDoc.js add_connection` to carry them; stamp
   provenance from the request actor. All additive.
5. **WS5-4:** the gated containment backfill (the only bulk doc write), atomic + revertible.

## Open decision (ratified)

- **Groups are connectable** (founder decision): `add_connection` accepts a group id as an
  endpoint; the WS5-3 containment invariant and the read edge-projection must tolerate group
  endpoints. (The alternative — leaf-only — was declined.)

## Residual risks

- The drift test (WS1-2) is the safety net: it fails CI the moment `canvas.ts` / `api_models.py` /
  `contract.js` diverge from the artifact. Build it with the codegen, not after.
- `canvasDoc.js add_connection` whitelist is the single highest-leverage realtime touch — without
  it the new slots are written by callers but silently dropped at the realtime boundary. Verify
  end-to-end (write `relation` → re-read `relation`) before declaring WS5-1 done.
- These last two need the Node realtime service + the backend Linux env to test end-to-end, which
  is why they are sequenced after this gate rather than bundled with the read workstream.
