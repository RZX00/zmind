# Canvas AI Operation & Comprehension — Implementation Plan

## 0. How to read this

**Ticket schema:** `WS<n>-<k> · Goal · Changes(file:line) · Satisfies(§8 acceptance IDs) · Depends/Blocks · Effort · Risk`. All paths are repo-relative to `E:\app\zmind`.

**Effort legend:** S = <1pd · M = 2-4pd · L = 1-1.5wk. "pd" = person-day, one engineer.

**Acceptance-ID map (§8 of the contract):** `SCH*`=schema/drift; `RD*`=read; `RT*`=round-trip; `WC1`=one write grammar; `E*`=edges; `PR*`=provenance; `U*`=containment unify; `G*`=groups; `TB*`=tables; `DC*`=delete-cascade; `MV1`=container-move; `CL2`=canvas-link title; `SM*`/`S1/S2`=smoothness; `§3.3`=id authority; `§3.4`=error envelope; `§7`=thin thinking probe (HARD GATE). Every ID is owned by exactly one ticket below (see WS6-1 `test_matrix_index.py` registry that fails on any unmapped ID).

## 1. Dependency graph & critical path

```
WS1-1 canonical schema.json ── the bottleneck, blocks the whole codegen spine
  ├─► WS1-2 codegen ops_contract.py + contract.js
  ├─► WS1-3 codegen canvas.generated.ts + pydantic (TableStyles/Provenance)
  ├─► WS1-5 migration plan (Yjs/JSONB additive proof)  ── DECISION GATE, do first
  └─► (WS1-2,WS1-3) ─► WS1-4 realtime add_connection slot-carry + CI drift test
WS5-1 edge slots ─► WS5-2 directed-only ; WS5-5 provenance (needs WS5-1)
WS5-3 containment unify ─► WS5-4 GroupEntity retire (BACKFILL migration)
        │
        ▼ (slots present on the 3 schemas)
WS2-1 self-budget serializer ─► WS2-2 truncation exempt
        └─► WS2-3 topology restore ─► WS2-4 detail levels ─► WS2-5 edge projection
                                                          └─► WS2-6 find/children_of
                                                          └─► WS2-7 viewport(remove)
WS3-1 6 new ops ─► WS3-2 table exec ; WS3-3 group/collapse exec ─► WS3-7 cascade
WS3-1 ─► WS3-4 one grammar ─► WS3-5 collapse to apply_canvas_ops ─► WS3-6 retire monolith
WS4-1 tmp: unify ─► WS4-2 idMap total ─► WS4-5 ENVELOPE ─► WS4-6 ID_REMAPPED
WS4-3 idempotency key ─► (WS6-4 retry)
WS4-4 typed op errors ─► WS4-5 ; WS4-5 ─► WS4-7 lock/cascade ; WS4-8 empty/too-large
WS6-1 harness ─► WS6-2/3/6 ─► WS6-7 thin probe (LAST to go green)
```

**CRITICAL PATH (longest serial chain):**
`WS1-1 → WS1-3 → WS5-1 → WS5-5 → WS4-5 (envelope) → WS4-6 → WS6-7 (§7 gate)`
and in parallel the read spine `WS1-1 → WS2-1 → WS2-3 → WS2-4 → WS2-5 → WS6-2`. WS1-1 + the migration decision (WS1-5) are prerequisites for *everything* downstream and carry the top risk (3-schema + Yjs/JSONB live-doc evolution). **Estimate and decide WS1-5 before any live-doc write lands.**

## 2. Phased roadmap (sequences the TL;DR 8 steps)

**Phase 0 — Clear the top risk (serial, ~5-6pd).** WS1-1 (author `schemas/canvas-schema.json`) + WS1-5 (migration plan & additive-safety proof). *Why first:* schema is the single source for codegen and the migration doc is the go/no-go on touching live docs. Ships nothing user-visible; unlocks every other phase. **Not parallelizable** — this is the bottleneck.

**Phase 1 — Codegen spine + types (mostly parallel, ~7-9pd).** WS1-2 (gen `ops_contract.py`/`contract.js`), WS1-3 (gen TS/pydantic, kill `any`/`Any`), WS5-1 (edge slots on 3 schemas), WS5-3 (containment unify). *Why now:* types/slots must exist before read can project them and before write can carry them. WS1-2/1-3/5-1 parallelizable; WS5-3 parallel. **Unlocks:** typed `tableStyles`, `relation/directed/relationData`, `parentGroupId` authority.

**Phase 2 — First valuable PR: additive read slice (serial within, ~5-7pd).** WS2-1 (self-budget `json.dumps` serializer) → WS2-2 (truncation exemption) → WS2-3 (restore dropped topology). *Why:* this is the smallest slice that materially improves AI-operability with **zero Yjs migration** (read-only). See §4. **Ships:** valid, budgeted, topology-complete reads.

**Phase 3 — Read depth + write slots persist (parallel tracks, ~9-12pd).** Track A read: WS2-4 (detail levels) → WS2-5 (edge projection) → WS2-6 (find/children_of), WS2-7 (remove viewport lie). Track B write-slot persistence: WS1-4 (realtime `add_connection` slot-carry + drift CI), WS5-5 (provenance auto-stamp), WS5-2 (directed-only), WS5-4 (GroupEntity retire + backfill — gated on Phase-1 WS5-3). **Unlocks:** RD1-RD6, E1-E3, PR1-PR4, U1-U3.

**Phase 4 — Write grammar & ops (serial spine, ~10-14pd).** WS3-1 (6 new ops) → {WS3-2 table exec, WS3-3 group/collapse exec → WS3-7 cascade} and WS3-4 (ONE grammar) → WS3-5 (collapse to `apply_canvas_ops`) → WS3-6 (retire `canvas_edit_tool.py` monolith — highest single-ticket risk, v2-only gate). **Unlocks:** WC1, TB1-TB4, G1-G4, C1-C3.

**Phase 5 — Id authority & error envelope (serial, ~8-11pd).** WS4-1 (`tmp:` unify) → WS4-2 (idMap total) → WS4-3 (deterministic idempotency key), WS4-4 (typed op errors) → WS4-5 (the ONE `CanvasWriteError` envelope) → WS4-6 (ID_REMAPPED plumb) + WS4-7 (lock/cascade/move) + WS4-8 (empty/too-large). **Unlocks:** §3.3, §3.4 all codes, STALE_RELOAD self-heal.

**Phase 6 — Tests, smoothness, the §7 gate (parallel-early, green-late, ~12-16pd).** WS6-1 harness scaffold lands in Phase 0/1 (RED-by-design under xfail-strict). WS6-2/3/6 follow their impl deps. WS6-4 (write_service bounded retry) + WS6-5 (drop redundant pre-flight fetch) are IMPL. WS6-7 (thin thinking probe + epistemic guard) is the **definition-of-done gate**, last to go green.

## 3. Full ticket list (deduped, ordered by phase)

> **Dedup rules applied:** (a) relation/provenance slots are authored ONCE — schema in WS1-1, the 3-schema field add in WS5-1/WS5-5, realtime persistence in WS1-4. WS2-5/WS5-1 do not re-add fields; WS2-5 only *projects* them. (b) The 6 new ops are added ONCE in WS3-1/WS1-1; WS3-2/3-3 only implement executors. (c) `delete_node` cascade lives ONCE in WS3-7/WS4-7 — these two are merged in scope (see note). (d) The `oneOf` op schema has ONE canonical home (`canvas_edit_tool.py:1326-1360`) per WS3-4; WS3-6 must move it before deleting the monolith.

**Phase 0**
- **WS1-1** Author `schemas/canvas-schema.json` (NEW). $defs for NodeBase + 8 type variants (`canvas-link` requires `title`+`deprecated:true` elsewhere per CL2; media variant requires the 6 fields from `api_models.py:61-75`); port real `TableStyles` from `frontend/src/canvas/types/canvas.ts:213-235`; OMIT `linkStyles`; lift enums verbatim (`ACCENT_COLOR_PRESETS` `TextStylePanel.tsx:10-21`, `SHAPE_PRESETS` `:33-67`, mermaid themes §1.2); Connection slots `relation/directed/relationData`; provenance §4.3 on node+conn; `allowedOps` = base 10 (`ops_contract.py:6-17`) + 6 new (`attach_media` EXCLUDED, App. A.6); `canvasPatchKeys` 10 (`ops_contract.py:34-45`); one `canvasEdit` grammar `{operations,expected_version}`; `CanvasWriteError` §3.4 envelope. **Sat:** SCH1,SCH3,CL2,TB4(½),T3,M2. **Dep:** none → blocks all. **Effort:** M(3-4pd). **Risk:** critical-path bottleneck; enums must match FE verbatim or T3/M2 drift fails. Pure-additive.
- **WS1-5** `docs/migration/canvas-schema-v1.md` (NEW). Prove additive-safe: all new fields optional; pydantic keeps `extra="ignore"`; Yjs per-id `Y.Map` (`canvasDoc.js buildEntryMap:170-183`) → additive keys non-breaking, no version bump; NO provenance backfill (absent ⇒ read-projected `human/imported`, not written); `ai?` retained as derived shim; GroupEntity (`canvas.ts:338,359-366`, `api_models.py:102`) marked `@deprecated`, no destructive drop in v1.0. **Sat:** SCH2(policy), supports PR1-4/E1-3. **Dep:** WS1-1. **Effort:** S(1pd). **Risk:** this is the live-doc go/no-go.

**Phase 1**
- **WS1-2** `scripts/gen-canvas-contract.mjs` (NEW) → regenerates `backend/core/canvas/ops_contract.py` + `services/canvas-realtime/src/ops/contract.js` (ALLOWED_OPS, OP_ALIASES, CANVAS_PATCH_KEYS + `*_SET`) as GENERATED; keep `Final`/`frozenset`/`Object.freeze` shape so `ops_normalization.py:6`, `applyCanvasOps.js:2`, `canvasDoc.js:2` imports are unchanged; add `gen:canvas-contract` to prebuild. **Sat:** SCH1,SCH2(½),WC1(enum source). **Dep:** WS1-1 → blocks WS1-4. **Effort:** M(2-3pd). **Risk:** codegen MUST reproduce the exact hand-curated `OP_ALIASES` (`ops_contract.py:21-32`) incl. 6 new aliases or normalizer regresses.
- **WS1-3** `frontend/src/canvas/types/canvas.generated.ts` (NEW); edit ONLY `canvas.ts:112` (`tableStyles?:any`→`TableStyles`), delete `:113` `linkStyles?:any` + `LinkStyles` stub `:238-240` + refs at `:269,:407`; add to `CanvasConnection` slots; add `provenance?` to `CanvasNode`. Pydantic: `api_models.py:77-78` typed `TableStyles`+`Provenance`, drop `linkStyles`, keep `extra="ignore"`. **Sat:** SCH3,E1,E2(storage),PR3(storage),TB4,CL2. **Dep:** WS1-1 → blocks WS1-4,WS2,WS5. **Effort:** M(3-4pd). **Risk:** do NOT replace `canvas.ts` wholesale — re-export the generated module, edit only the 4 cited lines; `extra="ignore"` must stay for back-compat reads.
- **WS5-1** Add `relation?:string; directed?:boolean; relationData?:Record<string,unknown>` to all 3 connection schemas (`canvas.ts:276-304`, `api_models.py:13-32`, realtime `add_connection`/`update_connection`). OPEN vocab — no enum, no state machine; `relationData` not indexed (App. A.12). **Sat:** E1,E2,RD6(partial). **Dep:** none → blocks WS5-5. **Effort:** M(2-3pd). **Risk:** 3 schemas in lockstep.
- **WS5-3** `parentGroupId` authoritative; add `reconcileContainment(nodes,warnings)` after the op loop in `applyCanvasOps.js` (before ~:1090) replacing the silent drop at `:740-748` with a warning; doc-comment `children[]` as derived ordered view (`canvas.ts:74-76`). **Sat:** U1,U2,RD5(read=WS2),G1(container). **Dep:** none → blocks WS5-4. **Effort:** M(3-4pd). **Risk:** reconcile mutates doc every apply — must be idempotent, O(n).

**Phase 2 (first PR — see §4)**
- **WS2-1** `_serialize_read_envelope(envelope,max_chars)` in `cac/tools.py` — `json.dumps(ensure_ascii=False)`, adaptive content-budget (lower `contentPreview` B → drop to outline), stamp `truncation:{level,reason,nodesOmitted}`; never `content[:n]`. **Sat:** RD1,RD3,RD5(partial),RT5. **Dep:** none → blocks WS2-4,2-5. **Effort:** M(2-3pd). **Risk:** verify the `execute_tools.py:174` double-`json.dumps` still yields `json.loads`-clean bytes (R3).
- **WS2-2** Add `CANVAS_READ_TOOL_NAMES={"canvas_read","canvas_graph","workspace_list_canvases"}` short-circuit in `tool_message_truncation.py:35` (`return content,False`). **Sat:** RD2,RD1(enable),RT5. **Dep:** WS2-1 (safe only after self-budget). **Effort:** S. **Risk:** ship WS2-1 first or 5000-node read floods context.
- **WS2-3** `_simplify_nodes` (`cac/tools.py:511-535`) restore `parentGroupId,ai,locked,completed,mediaType,isCollapsed`; keep empty `children`; emit compact mindmap edge-list via new `_compact_mindmap_tree`. **Sat:** RD4,RD5,RT2,RT1/RT3(enable). **Dep:** none → blocks WS2-4. **Effort:** M(2pd). **Risk:** derive order from `children[]` not `siblingOrder` (coordinate WS5-4).

**Phase 3**
- **WS1-4** Fix `canvasDoc.js add_connection:309-331` whitelist that silently drops `relation/directed/relationData/provenance` — switch to `{...op,id}` spread mirroring `add_node:268-280`; add `tests/canvas-schema-drift.test.*` (NEW) asserting 3-runtime op-set equality, no `any`/`Any`, one published `canvas_edit` grammar (reads `native_tool_adapter.py:834-951`). **Sat:** SCH1-3,WC1,E1,E2,PR3(persist). **Dep:** WS1-1/1-2/1-3. **Effort:** M(2-3pd). **Risk:** **single most load-bearing realtime change** — without it E1/E2 fail end-to-end.
- **WS2-4** Replace `full:bool` with `detail∈{outline,structure,full}` (`read` schema `:286-318`, `full` deprecated alias); add `_build_outline`/`_build_structure`/`_summarize_content` (table→`{rows,cols,headers,truncated}`, mermaid/svg→`{codeType,chars,syntaxHash=sha1[:8]}`); whole-canvas `full` (`:430`) becomes id/count-capped. **Sat:** RD1,RD4,RD5,RT3,RT5; Probe step1-2. **Dep:** WS2-1,2-3 → blocks 2-5,2-6. **Effort:** L(5-7pd). **Risk:** removing whole-canvas `full` is a behavior change; keep alias.
- **WS2-5** Replace raw `connections` passthrough (`:431-432`) with `_simplify_connections(conns,detail)` (L1 `{id,from,to,rel,directed,by}`; L2 +`provenance`; EXCLUDE geometry). Default `rel:null/directed:true/by:null` if slots not yet landed. **Sat:** RD6,RT1,RT5. **Dep:** WS2-4. **Effort:** S-M(1-2pd). **Risk:** coordinate ordering with WS5-1/5-5.
- **WS2-6** Extend `_match_where:483-509` with `type/parentId/ai/rel/actor` predicates; add `find(predicate)`+`children_of(containerId,recursive)` surfaces; new `CanvasGraphTool`. Server-side `neighbors_of/subtree_of` DEFERRED (App. A.8). **Sat:** RD4(partial),RD5,RT2. **Dep:** WS2-4,2-3. **Effort:** M(3-4pd). **Risk:** keep `rel` scan O(N).
- **WS2-7** REMOVE `viewport` from `read` scope enum (`:296`); delete `limit=200` lie (`:401-402`). Implement-via-camera deferred (needs FE). **Sat:** E1(read-eyes),RD1. **Dep:** WS2-4. **Effort:** S (remove). **Risk:** camera not sent from FE today — remove-the-lie for v1.0.
- **WS5-5** Add `Provenance` block to node+conn (`canvas.ts` after `:142`/`:281`, pydantic), `updatedAt` on conn; thread `actor` into `applyCanvasOps({...,actor})` (`:513`), stamp `createdBy`/`updatedBy` in add/update/move/style ops, derive `ai=actor==='agent'`; `index.js:896-901` pass `deriveActor(context)` from `context.actor`/`userId:544`. NEVER validate `state`/`origin` (App. A.11). **Sat:** PR1-PR4. **Dep:** WS5-1. **Effort:** M(3-4pd). **Risk:** no enum on state/origin.
- **WS5-2** `directed` is sole logical-direction source; `appearance.arrow` render-only (doc + no server-side arrow mutation). **Sat:** E1(directed),E3. **Dep:** WS5-1. **Effort:** S(1pd).
- **WS5-4** Mark `GroupEntity`/`Canvas.groups`/`mindmap.siblingOrder`/`.collapsed` `@deprecated`; `relayout_mindmap:1055-1085` mirror `siblingOrder`→`children[]`, `collapsed[nodeId]`→node `isCollapsed`. **Backfill migration** of live `Canvas.groups[].nodeIds`→`parentGroupId` + `siblingOrder`→`children[]` ships atomically with deprecation. **Sat:** U3,G3(target). **Dep:** WS5-3. **Effort:** L(1-1.5wk incl. migration). **Risk:** do NOT delete TS interface until migration ships.

**Phase 4**
- **WS3-1** Append 6 ops `update_table_cell,table_row_op,table_col_op,group_nodes,ungroup,set_collapsed` to ALLOWED_OPS + aliases in `ops_contract.py` + `contract.js` (via WS1-2 codegen) + `ops_normalization.py:39-150` & `applyCanvasOps.js normalizeOp:135-251` field branches. **Sat:** WC1,TB1,TB2,G1-G3. **Dep:** none → blocks 3-2/3-3/3-4. **Effort:** S(1pd). **Risk:** keep 3 lists byte-aligned (now codegen-enforced).
- **WS3-2** Implement table cell/row/col executors in `applyCanvasOps.js` loop (after `relayout_mindmap:1085`); mutate `rows[row][col]` only, keep `columnWidths`/`rowHeights` length-consistent; stamp `updatedAt`. **Sat:** TB1,TB2,TB3,SM4,C1. **Dep:** WS3-1. **Effort:** M(2-3pd). **Risk:** full-`data` replace would clobber concurrent CRDT edits — cell-scoped mutation is the point.
- **WS3-3** Implement `group_nodes`/`ungroup`/`set_collapsed` with atomic §4.2 invariant; `genNodeId('group')`, set `parentGroupId`+`children[]`, bbox, `tmp:`→id in idMap; `finalValidate:451-511` assert bidirectional consistency. **Sat:** G1,G2,G3,U1. **Dep:** WS3-1 → blocks 3-7. **Effort:** M(3-4pd). **Risk:** coordinate with WS5-3 so two tickets don't both rewrite `finalValidate`.
- **WS3-4** Reduce `CaCEditArgs` (`native_tool_adapter.py:834-951`) to `{canvas_id,operations,expected_version}`; DELETE the ~8 `$`-shapes + `_normalize_common_mistakes`/`_require_action` validators; extend the canonical `oneOf` (`canvas_edit_tool.py:1326-1360`) with 6 new ops as the single advertised shape. **Sat:** WC1,TB4,C3. **Dep:** WS3-1 → blocks 3-5. **Effort:** M(2-3pd). **Risk:** keep `ops_normalization`/`normalizeOp` as UNadvertised defensive funnel; WC1 test asserts no `$`-key in published schema.
- **WS3-5** `cac/tools.py` `_apply_operations` (`:1547-1576` edit, `:1116-1145` write) — delete legacy `CanvasEditTool` delegation; call `self._write_service.apply_canvas_ops(...)` directly after `normalize_ops`; keep EMPTY_BATCH pre-flight (`:1460-1466`). **Sat:** WC1,C1,C2. **Dep:** WS3-4 → blocks 3-6. **Effort:** M(2-4pd). **Risk:** port AI-timeline + error-unwrap FIRST (WS3-6).
- **WS3-6** Fold error-detail unwrap (`canvas_edit_tool.py:322-331`) into `write_service.apply_canvas_ops`; extract `_log_ai_timeline` to NEW `backend/core/canvas/timeline.py`; DELETE `canvas_edit_tool.py` (importers: `cac/tools.py:1123,1554` only) after move. **Sat:** WC1,C1-C3. **Dep:** WS3-5. **Effort:** L(1-1.5wk). **Risk:** highest single-ticket risk — delete only when v2 is sole runtime (`CANVAS_REALTIME_WRITE_ENABLED`, no `force_legacy_write`); single revert commit.
- **WS3-7 (merge DC scope with WS4-7)** `delete_node:801-808` container-delete strips children `parentGroupId` (implicit ungroup) + removes id from `children[]`; `relayout_mindmap` collapse→node `isCollapsed` convergence. **Sat:** G2,G3,U1,DC1-DC3. **Dep:** WS3-3. **Effort:** S-M(2pd). **Risk:** `applyOpsToYDoc` replays ops not computed doc — may need synthetic child-update op per freed child (shared finding with WS4-7).

**Phase 5**
- **WS4-1** `cac/engine.py:532` `$tree_`→`tmp:tree_`; assert `tmp:` keys in `build_id_map:717-724`; `applyCanvasOps.js isTmpId:65` add one-shot `/^\$tree_/` warning. **Sat:** §3.3(1),RT4. **Dep:** none → blocks 4-2,4-4. **Effort:** S. **Risk:** keep `$tree_` detection one release.
- **WS4-2** Make idMap total: node loop `:556-571` + conn loop `:574-591` record `idMap[givenId]=newId` for any non-null input id change; post-loop `BATCH_INVARIANT` assertion. **Sat:** §3.3(2)(3),RT4,RT6. **Dep:** WS4-1 → blocks 4-5(needs envelope but invariant first). **Effort:** S-M.
- **WS4-3** Deterministic `Idempotency-Key` from batch hash: `mutation_compiler.py:53` + `execution_core.py _apply_batch:615-644` use `_stable_hash(plan,batch)` (`:23`, must include `expected_version`); `canvas_edit_tool.py:306-314` add key. **Sat:** §3.3,SM3,RT4. **Dep:** none → blocks WS6-4. **Effort:** M(2pd). **Risk:** all-or-nothing already holds; rebased resubmit gets fresh key.
- **WS4-4** NEW `services/canvas-realtime/src/ops/errors.js` `CanvasOpError`; `mapTmp:593-599`→`{code:'unknown_tmp_ref',ref,op_index}`; group-child/endpoint throws (`:505,:823-824`)→typed; `index.js:902-918` emit 422 `extras:{op_index,field,ref}`. **Sat:** §3.3(5),§3.4 VALIDATION/NODE_NOT_FOUND/CONNECTION_ENDPOINT_MISSING. **Dep:** WS4-1 → blocks 4-5. **Effort:** M. **Risk:** throws happen pre-mutation — atomicity preserved.
- **WS4-5** NEW `backend/core/canvas/errors.py` `CanvasWriteError` + code→self_heal table; standardize `index.js sendError` (409→STALE_RELOAD, 422→VALIDATION/NODE_NOT_FOUND, 400→EMPTY_BATCH, 500→TRANSPORT_RETRYABLE); `write_service.py:37-62,265-292` map codes + `retryable`+`self_heal` on `CanvasRealtimeError:21-34`; 200+idMap→`ID_REMAPPED`; `execution_core._apply_batch:646-668` envelope-driven. **Sat:** §3.4 all codes. **Dep:** WS4-2,4-4 → blocks 4-6,4-7,4-8. **Effort:** L. **Risk:** cross-service wire shape change — `extras` carrier keeps old clients parsing `message`; contract test asserts identical codes across 3 front-ends.
- **WS4-6** Plumb ID_REMAPPED: `execution_core._trim_response:671-679` keep `idMap` AND call new `_apply_id_remap(context,idMap)` rewriting continuity/resume-token refs (`final_id=idMap[sent]??sent`); success branch `:655-659` attach `self_heal`. **Sat:** §3.4 ID_REMAPPED,RT4,RT6. **Dep:** WS4-2,4-5. **Effort:** M. **Risk:** must run before next batch compiles; land in resume-token path (commit 39ebab1e3).
- **WS4-7 (merged with WS3-7 cascade)** `delete_node` cascade (free children, strip from `children[]`); `move_node` container `moveChildren`/mindmap re-layout; server-side `NODE_LOCKED` throw on `update_node/move_node/apply_style/delete_node` when `locked===true`. **Sat:** DC1-DC3,MV1,NODE_LOCKED,§1. **Dep:** WS4-4. **Effort:** M. **Risk:** cascade child-mutation must be inside the same `applyCanvasOps` compute (shared with WS3-7).
- **WS4-8** `execution_core._apply_batch` after `normalize_ops`: `len==0`→`status:'applied',warning:'empty_batch'`, NO network call; `BATCH_TOO_LARGE` cap with split recipe. **Sat:** §3.4 EMPTY_BATCH/BATCH_TOO_LARGE. **Dep:** WS4-5. **Effort:** S.

**Phase 6**
- **WS6-1** NEW `backend/tests/canvas_contract/{conftest.py,test_matrix_index.py,test_read_validity.py,__init__.py}` — `make_canvas(n)` factory (1/50/500/5000), `served_bytes()` through simplify+truncation, §8-ID registry test (fails on unmapped), RD1/RT5 byte-validity. xfail-strict until impl. **Sat:** RD1,RT5(scaffold). **Dep:** none → blocks 6-2/3. **Effort:** M(3-4pd). **Risk:** 5000-node seeded; mark slow.
- **WS6-2** NEW `test_read_contract.py` — RD2(exempt unaltered),RD3(control/`"`/`\ud83d` clean),RD4(100% ids),RD5(bidirectional containment),RD6(rel/directed/actor or null). **Sat:** RD2-RD6. **Dep:** WS6-1; RED until WS2/WS4. **Effort:** M(2-3pd).
- **WS6-3** NEW `test_round_trip.py` + `fixtures/canvas_50.json` — RT1-RT6. **Sat:** RT1-RT6. **Dep:** WS6-1,6-2,6-6. **Effort:** L(5-7pd). **Risk:** needs faithful `applyCanvasOps` (node shim vs Python port — decide, see §6).
- **WS6-6** NEW `test_ids_idempotency.py` — §3.3(1-6), `batch.idempotency_key==_stable_hash(operations)` at `_apply_batch:641`. **Sat:** §3.3. **Dep:** WS6-1 → blocks 6-3,6-4. **Effort:** M.
- **WS6-4** IMPL `write_service.apply_canvas_ops:229-292` — bounded retry (≤2, backoff ≤~3s) on timeout/5xx ONLY, same `Idempotency-Key`; +`test_smoothness.py` S1. **Sat:** S1,TRANSPORT_RETRYABLE. **Dep:** WS6-6 (key mandatory). **Effort:** M(2pd). **Risk:** never retry 4xx/409; realtime dedup `index.js:819-830` must be live.
- **WS6-5** IMPL delete redundant pre-flight `execution_core._check_pending_preview_valid:581-613` (drop `fetch_snapshot:589`), rely on If-Match+STALE_RELOAD; +SM1/SM2/SM3/SM4 tests; update `test_agent_runtime_v2_canvas_core.py:284,320` to expect rebase-on-apply. **Sat:** S2,SM1-SM4. **Dep:** WS6-1,6-4. **Effort:** M(2-3pd). **Risk:** changes confirm semantics.
- **WS6-7** NEW `test_thin_probe.py` + `_epistemic_guard.py` — 30-node probe, 7 §7 criteria; `assert_no_epistemics` forbids `{claim,evidence,hypothesis,supports,contradicts,rebuttal,cites}`, allow-list `{link,reference,question}`. **Sat:** §7 + E1,E2,PR1,RT4,RD4,SM3 e2e. **Dep:** WS6-2,6-3,6-6 + WS2/3/4 impl. **Effort:** M(3pd). **Risk:** **P2 definition-of-done HARD GATE**, last to go green; reuse forbidden list as a lint over WS1 enums.

## 4. Recommended FIRST PR

**"Read contract: valid, budgeted, topology-complete canvas reads"** — the smallest valuable, lowest-risk slice. **Read-only, no Yjs migration, no live-doc write.** Bundle: **WS2-1 + WS2-2 + WS2-3** (and the harness shell WS6-1).

Exact files:
- `backend/core/canvas/cac/tools.py` — add `_serialize_read_envelope`, restore `_simplify_nodes:511-535` (`parentGroupId,ai,locked,completed,mediaType,isCollapsed,children`), add `_compact_mindmap_tree`.
- `backend/core/langgraph_engine/tool_message_truncation.py:35` — `CANVAS_READ_TOOL_NAMES` short-circuit.
- `backend/tests/canvas_contract/{conftest.py,__init__.py,test_read_validity.py,test_read_contract.py}` (NEW).

Acceptance tests in this PR: **RD1** (valid budgeted JSON at 1/50/500/5000), **RD2** (truncation exemption byte-identical), **RD3** (control-char/lone-surrogate `json.loads`-clean), **RD4** (100% node ids from one read), **RD5** (containment recoverable). Ships immediate AI-operability: the model finally sees containment + a non-truncated, escaping-safe canvas. Reversible (read path only). It does NOT need WS1-1 to land first because it touches no schema artifact — though WS2-4's *detail levels* and `relation` projection (RD6) intentionally land in a follow-up after WS1/WS5 slots exist.

## 5. Effort, critical path, top 3 risks

**Total effort:** Phase0 ~6pd · Phase1 ~9pd · Phase2 ~6pd · Phase3 ~12pd · Phase4 ~14pd · Phase5 ~11pd · Phase6 ~16pd ⇒ **~74 person-days (≈14-16 weeks one engineer; ~7-8 weeks with two on the parallel read/write tracks).** **Critical-path length ≈ 9-10 weeks** (`WS1-1→WS1-3→WS5-1→WS5-5→WS4-5→WS4-6→WS6-7`).

1. **Yjs + 3-schema live-doc migration (WS1-1/1-5/5-4).** *Mitigation:* Phase-0 migration doc proves additive-only (per-id `Y.Map` keys, pydantic `extra="ignore"`, no version bump, no provenance backfill); WS5-4 backfill ships atomically with deprecation behind a single revert commit; CI drift test (WS1-4) fails the build the moment the 3 runtimes diverge.
2. **Cross-service error-envelope plumbing (WS4-5).** Wire JSON shape changes across realtime/`write_service`/`execution_core`. *Mitigation:* `extras` is the additive carrier so old clients still parse `message`; one `errors.py` code→self_heal table is the single source; contract test asserts all three front-ends emit identical codes; land WS4-4 typed throws first.
3. **Executor collapse during v2 transition (WS3-5/3-6).** Deleting the 1400-line `canvas_edit_tool.py` monolith. *Mitigation:* port AI-timeline (`timeline.py`) + error-unwrap into substrate BEFORE deletion; gate on `CANVAS_REALTIME_WRITE_ENABLED` + zero `force_legacy_write` callers (importers confirmed: `cac/tools.py:1123,1554` only); move the canonical `oneOf` schema to a kept location first; single revert commit.

## 6. Open decisions blocking specific tickets (founder either/or)

- **G4 — Are groups connectable?** Either (A) groups are valid `from/to` endpoints (`add_connection` accepts a group id; cleaner mindmap-cross-links) **or** (B) connections only attach to leaf nodes (simpler invariant in WS5-3 reconcile). *Blocks:* WS3-3, WS5-3, RD6. **Recommend B for v1.0** (smaller invariant surface).
- **Viewport — implement vs remove (WS2-7).** (A) Remove `viewport` from the scope enum now (no FE change) **or** (B) plumb `camera:{x,y,zoom,vw,vh}` from FE (M, out of WS2). **Recommend A** — kill the first-200 lie in v1.0, revisit camera post-launch.
- **Round-trip executor (WS6-3).** (A) Spin a real Node `applyCanvasOps` test harness **or** (B) maintain a faithful Python port for RT3/RT4/RT6. *Blocks:* WS6-3. **Recommend A** (single source of truth; a port will drift from the realtime executor).
- **Back-compat field strategy (WS1-3/WS5-5).** Confirm pydantic keeps `extra="ignore"` and `ai?:boolean` is retained as a derived shim (never deleted). *Blocks:* WS1-3, WS5-5, migration. **Recommend keep both** — non-negotiable for parsing pre-migration JSONB.
- **`ungroup` atomicity scope (WS3-3 vs WS5-3).** Decide ONE owner of `finalValidate`/`reconcileContainment` so two tickets don't both rewrite it. **Recommend WS5-3 owns reconcile; WS3-3 calls it.**
