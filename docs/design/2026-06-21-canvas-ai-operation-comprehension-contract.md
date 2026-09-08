# Canvas AI Operation & Comprehension Contract v1.0

> Scope: zmind canvas. This is the contract that makes the canvas's UNIVERSAL/ATOMIC node substrate something an AI can PERFECTLY OPERATE and PERFECTLY COMPREHEND, *before* any thinking-visualization layer is built. Ground truth is pinned as `file:line`. Everything cut as gold-plating or deferred to the thinking layer is moved to Appendix A so nothing is lost but nothing out-of-scope leaks into v1.0.

---

## TL;DR — what to build first (in order)

1. **Fix the read (the spine).** `canvas_read` must emit JSON-valid, structure-complete topology with `parentGroupId` + compact mindmap tree restored, content budgeted with explicit truncation markers, and be EXEMPT from the 8 KB head-truncation that cuts JSON mid-array (`tool_message_truncation.py:67`). Three detail levels: `outline | structure | full`. (§2)
2. **One closed write op-set, one grammar, one executor.** Advertise exactly ONE `canvas_edit` grammar `{operations:[…], expected_version}` (today ~8 ambiguous shapes, `native_tool_adapter.py:834-951`). Add the table-cell / group / collapse ops that close UI-only gaps. (§3.1–3.2)
3. **Make ids total + idempotency mandatory.** Server is id authority; `idMap` is total and always returned for nodes AND connections; one `tmp:` temp convention everywhere; idempotency key mandatory + deterministic. (§3.3)
4. **One typed error envelope with self-heal recipes.** Every write failure returns `CanvasWriteError{code, retryable, self_heal, …}`; AI fixes-and-retries once, silently. (§3.4)
5. **Add the universal structural slots NOW:** open-vocab typed-edge `relation`/`directed`, unified containment (`parentGroupId` source-of-truth + derived `children[]`), provenance/actor/judgment-state on nodes AND edges. Slots only — zero baked epistemics. (§4)
6. **Specify the failure-mode contract:** delete-cascade, move-on-container, NODE_LOCKED, BATCH_TOO_LARGE. (§3.4, §1)
7. **Gate on the Thin Thinking Probe** (§7) using ONLY generic relation values — not feature-completeness.
8. **Collapse to one machine-readable schema artifact** (§9).

```
┌─ SCOPE BOUNDARY ──────────────────────────────────────────────────────────┐
│ IN  (v1.0 — universal substrate perfection):                              │
│   • 8 atomic node types operate + comprehend perfectly                    │
│   • One read contract (JSON-valid, structure-complete, content-budgeted)  │
│   • One closed write op-set, one grammar, one executor, total idMap       │
│   • One typed self-healing error envelope                                 │
│   • Structural SLOTS: open-vocab edge relation/direction; unified         │
│     containment; provenance/actor/judgment-state (slots, NOT semantics)   │
│   • Round-trip fidelity + smoothness + thin probe                         │
│                                                                            │
│ OUT (Appendix A — thinking layer / deferred):                             │
│   • Epistemic vocab (claim/evidence/hypothesis/supports/contradicts)      │
│   • Any validator/state-machine over relation or provenance.state         │
│   • SVG sub-element editing, binary media upload, server graph-traversal  │
│     verbs, optimistic echo, snapping, mermaid/svg theme seeding           │
│   The substrate STORES open strings for relation/state; it never          │
│   validates the value. Vocabulary is supplied by the layer above.         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 0. Principles

**P0 — Substrate is universal and atomic; thinking-orientation is a layer ABOVE.**
The 8 node types (`frontend/src/canvas/types/canvas.ts:43`: text | code | column | table | canvas-link | todo | media | group) and the edge/containment model are a general-purpose visual-graph substrate — the same primitive class as tldraw/Figma/Miro/Excalidraw. The substrate MUST NOT bake epistemic semantics (claim/evidence/hypothesis/rebuttal) into node types or edge kinds. Those are vocabulary supplied by a layer above.

**P1 — A few STRUCTURAL SLOTS are universal primitives and belong in the substrate NOW.** Specifically (§4): (a) a typed-edge `relation` field with OPEN vocabulary (substrate stores and indexes it but never validates the value), (b) provenance/actor/judgment-state on nodes and edges, (c) a unified containment model. These are slots, not semantics — they carry zero epistemics until a vocabulary is supplied. Every graph tool needs an edge "kind" and an author; that is why they are substrate.

**P2 — "Perfect" is defined by a THIN PROBE, not by gold-plating.** The definition of done is not "every conceivable feature has an op." It is: an AI can (1) read any canvas and get a JSON-valid, structure-complete representation within budget, (2) write any human-reachable mutation through ONE closed op-set, (3) round-trip read→understand→write-back with identical durable result, and (4) pass the §7 thin thinking probe. The probe — not feature-completeness — gates "perfect enough."

**P3 — Structure is first-class; content is budgeted.** Topology (ids, types, edges, containment, mindmap tree, provenance) is cheap and always emitted complete and JSON-valid. Only node *content* is summarized/truncated, and only at the semantic level with explicit `contentTruncated` markers — never at the JSON-byte level. The current 8 KB head-truncation (`TOOL_MESSAGE_CONTEXT_MAX_CHARS=8000`, `tool_message_truncation.py:17,26,67`) that cuts JSON mid-array is FORBIDDEN for canvas reads.

**P4 — One closed op-set, one grammar, one executor.** The write surface is the ops in `backend/core/canvas/ops_contract.py:6-17` extended to cover UI-only gaps. The `canvas_edit` tool advertises exactly ONE grammar (today it advertises ~8, `native_tool_adapter.py:834-951`). All front-ends funnel to one transport, `CanvasWriteService.apply_canvas_ops` → realtime `/apply` → `applyCanvasOps()`.

**P5 — Errors are machine-actionable.** Every write failure returns a single typed envelope with a `self_heal` recipe so the AI fixes-and-retries once, silently, without bugging the user (§3.4).

**P6 — Schema is a single machine-readable artifact.** The schema is triplicated and drifting today (`frontend canvas.ts`, `backend api_models.py`, `services/canvas-realtime/src/ops/contract.js`, with `Any` escape hatches; "no machine-readable schema artifact" `report-canvas-model.md:45`). v1.0 produces ONE canonical JSON Schema all three import or codegen from (§9).

---

## 1. Node Type Contract

Conventions used in every subsection:
- **Universal payload** is `content:string` (`canvas.ts`). For `column`/`group`, the title is the first line of `content`; `title` is deprecated except for `canvas-link` (`canvas.ts:73`).
- **Geometry** is `x,y,width,height`. **No `zIndex` field exists** — z-order is implicit array order in the doc. v1.0 keeps array-order z but documents it (an explicit `z` is OUT of scope).
- **CRUD** = `add_node` / read (§2) / `update_node` (+`apply_style`,`move_node`) / `delete_node`. `update_node` patch is a blind `n.update(patch)` (`canvas_edit_tool.py:922-943`) so any field is writable, but only listed fields are validated/normalized.
- **Universal optional slots** (all types): `locked?:boolean`, `parentGroupId?:string`, plus the provenance block (§4.3) and `ai?:boolean` (`canvas.ts:142`).
- **Locked nodes:** there is NO server-side lock check anywhere in `applyCanvasOps.js` (verified: no `locked` reference in the apply path); `locked` is FE-only today. v1.0 enforces it server-side and returns `NODE_LOCKED` (§3.4) for any mutating op (`update_node`/`move_node`/`apply_style`/`delete_node`) targeting a locked node.

### 1.1 text

**Canonical schema.** Required: `type:'text'`. Optional: `content` (default `''`), geometry (default 300×60, `NodeDefaults.ts:3`), `textStyles` (typed, `canvas.ts`), `shapeDecoration`, `accentColor`, `opacity`.
**Styles.** `textStyles` is the only typed style block. Top-level `opacity` is silently folded into `textStyles.opacity`, clamped 0..1 (`canvas_edit_tool.py:631-644`; `normalizeTextOpacity` `applyCanvasOps.js:253-268`). v1.0: the read MUST echo the canonicalized location, and the op result MUST emit `STYLE_NORMALIZED{from:'opacity',to:'textStyles.opacity'}` so the round-trip is not surprising.
**Operation set.** Create/read/update/delete via the universal ops. `apply_style{textStyles,shapeDecoration,accentColor}`. `move_node`. No type-specific ops.
**Style enums AI must know (FE-only today, must be published):** `ACCENT_COLOR_PRESETS` (10 named, `TextStylePanel.tsx:10-21`), `SHAPE_PRESETS` (`none|circle|diamond`, `TextStylePanel.tsx:33-67`).
**Current gap.** Whole-`content` replace only — no incremental/range edit. Inline rich-text caret editing is FE-only.
**Acceptance.**
- T1: `add_node{type:'text',content}` → re-read returns `content` byte-identical (≤ budget).
- T2: `apply_style{opacity:0.5}` → re-read returns `textStyles.opacity===0.5` AND the op result carries `STYLE_NORMALIZED{from:'opacity',to:'textStyles.opacity'}`.
- T3: The accent/shape enum set is present in the published JSON Schema (§9); a test asserts the schema's enum equals `TextStylePanel.tsx:10-21,33-67`.

### 1.2 code/mermaid

**Canonical schema.** Required: `type:'code'`, `codeType:'mermaid'` (defaults to `mermaid` when `type==code` and absent, `canvas_edit_tool.py:868-869`; `applyCanvasOps.js:716-718`). Optional: `content` (mermaid source), `mermaidThemeId`, `mermaidTheme` (default 350×250, `NodeDefaults.ts:5`).
**Styles.** `mermaidTheme.config.themeVariables: Record<string,string>` is a fully open ~13-key map (`canvas.ts:247`; `MermaidStylePanel.tsx:31-150`). Valid theme IDs (`professional|minimal|sunset|dark|forest|cb-set3|cb-paired|d3-category10|echarts-macarons`) live only in FE constants — must be published in §9.
**Operation set.** CRUD; `apply_style{mermaidThemeId,mermaidTheme}`. `codeType` is validated to `{mermaid,html,svg}` (`canvas_edit_tool.py:729-732`).
**Acceptance.**
- M1: Invalid `codeType` → typed `VALIDATION{op_index,field:'codeType'}`, never a bare 422.
- M2: Theme-id enumeration is fetchable from §9 schema (not guessed).
- (CUT — server-seeding a default mermaid theme is rendering parity, not operability. See Appendix A.)

### 1.3 code/html

**Canonical schema.** Required: `type:'code'`, `codeType:'html'`. Optional: `content` (HTML string) (default 650×540, `NodeDefaults.ts:6`).
**Styles.** None beyond content.
**Operation set.** CRUD. No op-layer HTML sanitization (security review item, not a substrate slot).
**Current gap.** No sub-document addressing; whole-`content` replace only.
**Acceptance.**
- H1: Create→read→update content round-trips exactly when ≤ budget.
- H2: Content over budget returns a shape summary `{codeType:'html', chars, truncated:true}` not a broken prefix (§2.3), and `json.loads` succeeds on the served bytes.

### 1.4 code/svg

**Canonical schema.** Required: `type:'code'`, `codeType:'svg'`. Optional: `content` (SVG markup), `svgTheme`, `svgMetadata`, `svgBgMode` (`transparent|auto`, FE-only enum) (default 400×400, `NodeDefaults.ts:7`).
**Styles.** `svgTheme`/`svgMetadata`/`svgBgMode` writable via blind patch.
**Contract decision — whole-content replacement.** The v1.0 contract is: SVG is edited by whole-`content` replacement. The AI reads the SVG string, mutates, rewrites. Sub-element selection/edit (`frontend/src/canvas/components/svg/`) is NOT in the substrate (deferred — Appendix A).
**Operation set.** CRUD; `apply_style{svgTheme,svgBgMode,svgMetadata}`.
**Acceptance.**
- S1: Whole-content SVG round-trips byte-identical when ≤ budget.
- S2: Content over budget returns `{codeType:'svg', chars, truncated:true}` summary; never broken markup; served bytes `json.loads`-clean.
- (CUT — server-seeding default svgTheme. See Appendix A.)

### 1.5 column

**Canonical schema.** Required: `type:'column'`. Optional: `children:string[]` (ordered), `content` (title = first line), `isCollapsed`, `groupStyles` (default 300×200). Title maps to content first-line (`canvas_edit_tool.py:850-852`; `NodeFactory.ts:180-194`).
**Styles.** `groupStyles`.
**Operation set.** CRUD; `update_node{children}` to reorder (this IS the reorder op — no separate `reorder_siblings`, see §3.1); `update_node{isCollapsed}` to collapse. tmp `$id` children resolve in same call (`applyCanvasOps.js:616-617`). `applyCanvasOps` drops unknown child ids with a warning (`:741-743`). `_final_validate` rejects column-in-column nesting (`canvas_edit_tool.py:808-815`; mirrored `applyCanvasOps.js:491-495`).
**Current gap.** Drag-into/out-of-column with insertion index and column auto-layout are client-only (`useNodesDnd.ts:484-546`); AI `add_node` into a column does NOT trigger `applyColumnLayout`/`adjustNodeSizeForColumn`.
**Acceptance.**
- C1: `children[]` order round-trips and is the single ordering source (§4.2).
- C2: `add_node` with `parentGroupId=<column>` → re-read: node appears exactly once in `column.children[]` and its `parentGroupId===column.id` (server reconciles, §4.2).
- C3: A `column.children` entry that is itself a column → typed `VALIDATION{op_index,field:'children'}`.

### 1.6 table

**Canonical schema.** Required: `type:'table'`. `data.rows[][]` required or auto-seeded 2×2 (`canvas_edit_tool.py:876-886`). Accepts `content` as JSON `{rows,columnWidths,rowHeights}` auto-parsed into `data`, blanking content (`_parse_table_content_payload` `canvas_edit_tool.py:413-440`; `parseTableContentPayload` `applyCanvasOps.js:724-728`). Rows validated as list-of-list (`:733-742`).
**Styles.** `tableStyles` is an UNTYPED `any` hole (`canvas.ts:112`). Real shape is `TableStyles` (`canvas.ts:213-235`). Valid `theme` enum: `booktabs|nature|ieee`. v1.0: retype `tableStyles` to the published `TableStyles` interface (no `any`); unknown keys → `VALIDATION{field}`.
**Operation set — NEW type-specific ops (closed-set additions).** Today the ops are blob-only and `ADD_TABLE_ROW/ADD_TABLE_COLUMN/UPDATE_TABLE_CELL`/delete are FE events with NO op (`canvas.ts:519-523`). Add:
- `update_table_cell{id,row,col,value}`
- `table_row_op{id,action:'insert'|'delete',index}`
- `table_col_op{id,action:'insert'|'delete',index}`
**Why KEEP (not gold-plating):** cell-level edit is otherwise impossible without a full-table read→mutate→rewrite; combined with content truncation on read (§2), the rewrite can corrupt the table. These ops are core operability.
**Acceptance.**
- TB1: `update_table_cell{row,col,value}` changes exactly one cell; re-read shows only that cell changed; idempotent under retry (same idempotency key → single effect).
- TB2: `table_row_op{action:'insert',index:k}` shifts rows ≥k by one and keeps `columnWidths/rowHeights` length-consistent; symmetric for `delete`.
- TB3: Reading a 100-cell table never returns broken JSON; over budget it returns `{rows:R,cols:C,headers:[…],truncated:true}` (the `tableData.truncated` field already models this, `canvas.ts:472-478`).
- TB4: `tableStyles` with an unknown key → `VALIDATION{field}`; with a valid `theme∈{booktabs,nature,ieee}` → accepted.

### 1.7 canvas-link

**Canonical schema.** Required: `type:'canvas-link'`, **`title` REQUIRED** (`canvas_edit_tool.py:750-751`; auto-derived from content first-line if absent `:853-857`; `applyCanvasOps.js:701-709`). Optional: `content`, `targetCanvasId`, `thumbnailUrl`, `lastSyncedAt` (default 280×180).
**Styles.** `linkStyles` is an EMPTY stub interface (`canvas.ts:113,238-240` "预留占位") — no shape exists. **v1.0: DROP the `linkStyles` slot from the published schema** (do not advertise an unfillable field). Re-add only if a real `LinkStyles` shape is defined.
**Operation set.** CRUD.
**Current gap.** This is the ONLY node type where `title` is load-bearing/required, while `title` is deprecated for all other types (`canvas.ts:73`). Models that treat title as universally deprecated emit invalid canvas-link.
**Acceptance.**
- CL1: `add_node{type:'canvas-link'}` without `title` is auto-filled from content first-line (or `"Canvas Link"` per `applyCanvasOps.js:703`) — never a silent failure.
- CL2: The published schema (§9) explicitly marks `title` required for `canvas-link` and deprecated elsewhere; a test asserts this.
- (CUT — `targetCanvasId` existence validation is app-layer referential integrity, not substrate atomicity. See Appendix A.)

### 1.8 todo

**Canonical schema.** Required: `type:'todo'`. Optional: `content`, `completed` (auto-defaults `false`, `canvas_edit_tool.py:725-727`).
**Styles.** Inherits text styles.
**Operation set.** CRUD; toggle via `update_node{completed:true}` — same field the checkbox writes, so NO parity gap.
**Acceptance.**
- TD1: `update_node{completed}` round-trips boolean; a test asserts the checkbox handler and the op write the identical field name.

### 1.9 media

**Canonical schema.** Required: `type:'media'` plus **6 required fields**: `fileName, fileType, fileExtension, fileSize, mediaType, uploadStatus` (`canvas_edit_tool.py:743-749`). `_fill_media_defaults` / `fillMediaDefaults` (`canvas_edit_tool.py:507-536`; `applyCanvasOps.js:711-712`) auto-infers from `fileUrl`/`externalUrl`; `uploadStatus` defaults to `"mock"`. Optional: `mediaSource`, `externalUrl`/`embedUrl`/`externalProvider`, `kbStatus`/`kbEntryId`/`kbJobId`, `storagePath`/`fileId`, `mediaHasTransparentBg`, `opacity`.
**Styles.** `opacity` clamped 0..1 (`NodeStylePanel.tsx:87-97`). `mediaHasTransparentBg`.
**Operation set.** CRUD; `apply_style{opacity}`.
**v1.0 contract — placeholder/external-URL only.** No op uploads a binary; `fileUrl`/`fileDownloadUrl`/`localPath` are STRIPPED before persist (`_strip_media_signed_urls` `canvas_edit_tool.py:1218-1229`). The AI can (a) create `uploadStatus:"mock"` placeholders, or (b) reference an existing external URL. **The AI cannot re-read its own freshly-uploaded binary** — this is the explicit v1.0 limitation so the AI does not assume otherwise. Binary upload (`attach_media`) is DEFERRED (Appendix A).
**Acceptance.**
- MD1: `add_node{type:'media',externalUrl}` auto-fills the 6 required fields → no `VALIDATION`; re-read shows all 6 populated.
- MD2: `add_node{type:'media'}` with none of {fileUrl,externalUrl,embedUrl} and no required fields → typed `VALIDATION{op_index,field}` listing the missing set, never a bare 422.

### 1.10 group

**Canonical schema.** Required: `type:'group'`, `children:string[]` (`canvas_edit_tool.py:753-757`; `applyCanvasOps.js:434-446`). Optional: `groupMode` (`mindmap|normal`, `canvas.ts:122`), `mindmap` blob (`canvas.ts:123-135`: `rootId,spacingX,spacingY,compactY,showCrossLinks,orientation,collapsed,siblingOrder`), `groupStyles`, `attachedConnections`.
**Styles.** `groupStyles`.
**Operation set.** CRUD; `relayout_mindmap{groupMode,mindmap}` — the only op with real server-side layout semantics (`applyCanvasOps.js:1055-1085`). NEW type-specific ops (closed-set additions):
- `group_nodes{ids[],mode}` — allocate group id, set each child's `parentGroupId`, populate `children[]`, compute bbox.
- `ungroup{groupId}` — delete the group node, strip children's `parentGroupId`, ATOMICALLY (no dangling refs).
- `set_collapsed{containerId,collapsed}` — generalizes column `isCollapsed` to mindmap collapse (§4.2 normalizes `mindmap.collapsed` → node-level `isCollapsed`).

(Sibling reorder is NOT a new op — it is `update_node{children}` once `children[]` is the single ordering source, §4.2. A dedicated `reorder_siblings` would be a second way to do one thing.)

**Current gaps (verified).**
- Group create/ungroup as a gesture is client-only (`useBoxSelection.ts:186-191`, `useGroups.ts:102-117`); ungroup via raw ops leaves children's `parentGroupId` dangling.
- Mindmap `collapsed`/`siblingOrder` only reachable via undocumented raw `relayout_mindmap{patch:{mindmap:{…}}}` (`canvas_edit_tool.py:1195-1203`) — the model won't find it.
- **Connections to/from group nodes are HARD-rejected** (`canvas_edit_tool.py:794-795,972-983`; group endpoints flagged `isGroupNodeId` `applyCanvasOps.js:657-660`). Group is uniquely un-connectable.
**Acceptance.**
- G1: `group_nodes{ids}` then read: every listed id has `parentGroupId===<group>` and appears exactly once in `children[]`.
- G2: `ungroup{groupId}` then read: zero nodes retain `parentGroupId===<deleted group>`; the group node is gone.
- G3: `set_collapsed` + read returns node-level `isCollapsed` consistently for column AND mindmap container.
- G4: **Decision (v1.0 recommends SUPPORT):** connections with a group endpoint are accepted (a group is a node; graph tools connect containers). If a deployment chooses to reject, the rejection MUST be a typed `CONNECTION_ENDPOINT_INVALID{reason:'group'}` (§3.4), NOT the current silent skip.

### 1.11 canvas document (`update_canvas`)

**Why this section exists (ADD).** `update_canvas` is in the op-set but had no acceptance criteria. Canvas-level fields are part of "perfectly operate."
**Patch keys (verified `ops_contract.py:34-45`, enforced `applyCanvasOps.js:674-685`):** `title, cornerStyle, fontStyle, textOpacityPreset, textLayoutPreset, folderId, backgroundColor, backgroundStyleId, patternColor, metadata`. Unknown keys are silently stripped (`:676-678`); an all-unknown patch throws (`:680-682`).
**Operation set.** `update_canvas{patch:{…}}`.
**Acceptance.**
- DOC1: Setting each allowed key round-trips on re-read.
- DOC2: An unknown key in the patch is reported (the op result lists which keys were applied vs dropped — `applied.push({keys})` `applyCanvasOps.js:687`), not silently dropped with no signal.
- DOC3: An all-unknown patch returns typed `VALIDATION{field}`, not a bare throw.
**Note (coverage):** `metadata.connectionAnchors` (`canvas.ts:335`) are persisted human-drawn curvature anchors. These are written via `metadata` on `update_canvas` OR are render-only. v1.0 declares connection curvature anchors **render-only / not AI-authored** (an AI need not reproduce a human-curved edge's exact control points to operate the graph). If a future need arises, route through `update_connection` (§3.1). Explicitly in-scope-listed so it is not silently missing.

---

## 2. The Read Contract (AI's Eyes)

**Problem being fixed.** Three divergent read paths exist and none produces the canonical `AIContext` (`canvas.ts:456-506`): Layer A full raw HTTP doc (`canvas_query_service.py:260-334,336-427`, lossless but huge), Layer B `canvas_read` simplified (`cac/tools.py:511-535`, but `content` copied RAW/untruncated `:518`, connections passed raw, **`parentGroupId` and the `mindmap` blob DROPPED** `:515-532`), Layer C 8 KB head-truncation that cuts JSON mid-array (`tool_message_truncation.py:67`; applied `execute_tools.py:257-261`). `scope='viewport'` is advertised but UNIMPLEMENTED (`tools.py:393-402`).

### 2.1 Hard rules
- **R1 — Never truncate mid-structure.** Truncation happens only at node-content level with explicit `contentTruncated:true` + `contentChars`. Byte-level head truncation is BYPASSED for canvas reads (whitelist canvas read tools out of `truncate_tool_message_content`, or have the tool self-budget so output is always valid and < max_chars).
- **R2 — Structure complete, content budgeted (P3).** Topology always complete and valid; content is the only thing budgeted.
- **R3 — Always valid JSON, escaping-safe.** The tool computes its own serialized size and adaptively lowers per-node content budget (or drops detail level) until it fits, then stamps a `truncation` summary. **The served payload MUST be produced via `json.dumps` (proper escaping of control chars, quotes, lone surrogates) — never slice-then-embed a raw substring** (which would reintroduce invalid JSON if `content` contains control chars or unescaped sequences). The exact bytes the model receives parse with `json.loads`.
- **R4 — Restore dropped topology.** `parentGroupId`, container `children[]`, a compact mindmap tree, and `ai?` (dropped today by `_simplify_nodes`) MUST be present.

### 2.2 Three read levels (`detail: outline | structure | full`)

**L1 `outline`** (~30-60 tokens/node) — orient on large canvases:
```jsonc
{
  "canvas": {"id","title","nodeCount","connectionCount","version","etag"},
  "nodes": [{"id","type","label": "<content line1 ≤80>", "parentId": "<parentGroupId>", "ai":true, "locked":false}],
  "containers": [{"id","type":"group|column","childCount","groupMode","mindmapRootId"}],
  "edges": [{"id","from","to","rel": "<relation|null>", "directed": true, "by": "<provenance.createdBy.actor|null>"}],
  "freeEdges": 0,
  "truncation": {"contentOmitted": true}
}
```
No coordinates, no styles, no geometry. A 50-node canvas fits well under 8 KB and is always valid.

**L2 `structure`** (default, ~80-150 tokens/node) — outline + geometry + summarized content + provenance:
- Adds `x,y,width,height`, `parentGroupId`, `codeType`, `completed`, `mediaType`, per-node `contentPreview` (≤ N chars) + `contentChars` + `contentTruncated`, and per-node `provenance:{createdBy,updatedBy,state}` (§4.3).
- Mindmap containers expose a **compact tree** `mindmap:{rootId, tree:[[parentId,childId,order],…]}` (edge-list, not the full `siblingOrder`/`collapsed` maps).
- Connections: `{id,from,to,rel,directed,provenance:{createdBy,state}}` only — render geometry (`controlPoints`/`appearance`/`anchorParams`) EXCLUDED. **(ADD: edge `rel`/`directed`/`provenance` are emitted here; §4 defines the slots and §2 MUST thread them through the projection. `_simplify_nodes` has no connection path today — add one.)**

**L3 `full`** — complete raw node(s)/connection(s) incl. styles/geometry/full content/render hints. **MUST be id-scoped or count-capped**, never "full for the whole canvas." Replaces `canvas_read(full=true)` whole-canvas behavior (`tools.py:430`).

### 2.3 Content summarization rule
Per node, content budget `B` (e.g. 240 chars at L2):
- `len ≤ B` → verbatim (still `json.dumps`-escaped).
- else → for prose: first `B` chars emitted as a properly-escaped JSON string + `contentTruncated:true`, `contentChars`. For `code/mermaid/svg/table` prefer a SHAPE summary over a prefix: table → `{rows,cols,headers,truncated}`; mermaid/svg/html → `{codeType,chars,syntaxHash}`.
- Envelope budget = sum of node budgets + topology; tool adaptively lowers `B` (or drops to L1) until serialized result fits `max_chars`, then stamps `truncation:{level,reason:'budget',nodesOmitted}`. Result always complete and parseable.

### 2.4 Predicate query verb (`find`) + container resolution
Replaces the brittle flat `where` (`_match_where` `tools.py:483-509` is flat exact/`$contains`/`$startsWith`/`$regex` only):
- `find(predicate)` — keeps `where` operators PLUS `type`, `parentId`, `ai`, `rel`, `actor` predicates; returns L1 rows.
- `children_of(containerId, recursive)` — resolves `children` + `parentGroupId` both directions.

(Server-side graph-traversal verbs `neighbors_of` / `connected_component` / `subtree_of` are DEFERRED — Appendix A. Rationale: if L1/L2 emit the complete edge list + idMap, the AI computes neighbors/components/subtrees client-side. `find` and `children_of` are kept because flat `where` cannot express type/containment predicates and bidirectional containment resolution is the load-bearing comprehension primitive.)

### 2.5 Viewport: make real or remove the lie
`scope='viewport'` MUST either (a) accept `camera:{x,y,zoom,vw,vh}` via the existing selection-context channel (`tools.py:349`) and filter by bbox intersection, or (b) be removed from the schema. The silent first-200 fallback (`tools.py:393-402`) is worse than absent and MUST be deleted.

### 2.6 Read acceptance
- RD1: For canvases of 1/50/500/5000 nodes at each `detail` level, `json.loads` succeeds on the exact bytes the model receives (post-`execute_tools`).
- RD2: Canvas reads are exempt from byte-level head truncation; a test asserts `truncate_tool_message_content` does not alter a canvas read payload.
- RD3: A node whose `content` contains control chars / quotes / a lone surrogate still yields `json.loads`-clean output (verifies R3 escaping).
- RD4: From one default (`structure`) read of a 50-node canvas, the AI enumerates 100% of node ids and edge ids (no guessing, no re-read for enumeration).
- RD5: Containment bidirectionally recoverable: for every child the AI can name its container, and for every container its ordered children.
- RD6: Each edge row at L2 carries `rel`, `directed`, and `provenance.createdBy.actor` (or explicit `null`).

---

## 3. The Write Contract

### 3.1 The one closed op-set (extended)
Base (`ops_contract.py:6-17`): `add_node, update_node, delete_node, move_node, apply_style, add_connection, update_connection, delete_connection, update_canvas, relayout_mindmap`. v1.0 ADDS (closing the UI-only gaps):
- `update_table_cell`, `table_row_op`, `table_col_op` (§1.6)
- `group_nodes`, `ungroup` (§1.10)
- `set_collapsed` (§1.10, §4.2)
- `attach_media` (DEFERRED — Appendix A; NOT in v1.0 op-set)

Expressible WITHOUT new ops (document as macros, do not add primitives): **sibling reorder** = `update_node{children}` (once `children[]` is authoritative, §4.2); align/distribute (client computes coords → N×`move_node`; `NodeAlignmentService` math, `AlignmentToolbar.tsx:74-111`); lock = `update_node{locked}`. Out of write-op scope by design: selection, box-select, pan/zoom (UI state), undo/redo (browser-local `canvas.store.ts:1894-1949`).

### 3.2 ONE grammar for `canvas_edit`
Today `canvas_edit` accepts ≥8 overlapping shapes that all collapse to the same op-list: node-id map, `$delete`, `$select`+`$set`, `$select`+`$transform`, `$connections`-as-object, `$connections`-as-list, `$canvas`, `$operations`, plus a 9th native `{operations,expected_version}` schema for the SAME tool name (`canvas_edit_tool.py:1326-1360`) and an `updates`→`nodes` alias. The advertised schema is genuinely ambiguous (`additionalProperties:{node-id→patch}` AND named `$`-fields simultaneously — a model cannot tell if `{"foo":{…}}` is a node patch or unknown field).
**v1.0:** advertise exactly ONE grammar = `{operations:[<op>…], expected_version}` where each op is one of the closed set. The tolerance/normalization layer (`ops_normalization.py` tolerating snake/camel/spaced; realtime `normalizeOp`; key aliases `applyCanvasOps.js:199-214`) STAYS as a defensive funnel but is NOT advertised. Delete the alternative grammars from the published tool schema so models stop emitting variants (`native_tool_adapter.py:834-951`).
**Acceptance.** WC1: the published `canvas_edit` JSON Schema has exactly one top-level shape `{operations,expected_version}`; a test asserts no `$`-prefixed alternative or `additionalProperties` node-map remains in the advertised schema.

### 3.3 Idempotency + id-stability
**Idempotency.** Today `Idempotency-Key` is optional and inconsistent — v2 may pass `None` (`execution_core.py:641`), legacy passes none (`canvas_edit_tool.py:306`), realtime only dedups on the header (`index.js:812,819`) → retried timeouts can double-apply. **v1.0: idempotency key is MANDATORY, derived deterministically from the batch hash** (`_stable_hash` exists, `execution_core.py:23`). Apply is all-or-nothing; safe to retry under the same key.

**Id-stability contract (verified against `applyCanvasOps.js:531-605`).** Two incompatible temp conventions exist: CaC `$tree_N` (`engine.py:532`) vs realtime `tmp:` (`isTmpId` `applyCanvasOps.js:65`). Node ids: tmp/null → server generates a semantic id; `tmp:` ids are recorded in `idMap` (`:563-565`), a non-tmp plain id you supply SURVIVES (`:569`). Connection ids: `/^connection-\d+$/` survive (`:578`); a `tmp:` id is recorded in idMap (`:583-584`); a **non-tmp non-conforming string IS already recorded in idMap** (`:581-582`); a `null` id gets a fresh id with no idMap entry (nothing to map). `mapTmp` THROWS on unknown tmp ref (`:596`), aborting the batch.
**v1.0 contract — server is the id authority; idMap is total and returned:**
1. **Single temp convention everywhere** = `tmp:`. CaC engine MUST emit `tmp:`, not `$tree_`.
2. **idMap covers nodes AND connections, ALWAYS returned**, total over every input id that was changed (tmp-resolved OR non-conforming-rewritten). Invariant: `final_id = idMap[sent_id] ?? sent_id`.
3. **No silent id change without an idMap entry** for any non-null input id (forbid any code path that does so).
4. **Reference lifecycle:** within one batch the AI uses `tmp:foo` for ids it creates+references (resolved by `mapTmp`/`mapRemappedId`); across batches it MUST use durable ids from the prior response's idMap. `tmp:` ids are batch-scoped, never reused across batches.
5. **`mapTmp` unknown-ref is a structured batch-level error** `{code:'unknown_tmp_ref', ref, op_index}` with zero partial writes (atomicity preserved), not a bare `Error` (`:596`).
6. **Same-batch connection ref resolution (verified):** `update_connection` and `delete_connection` already apply `mapRemappedId(op.id)` (`:643,647`) and `update_connection` maps `from`/`to` via `mapTmp` (`:649-650`). v1.0 PRESERVES this so an `update_connection`/`delete_connection` targeting a same-batch-created edge by its `tmp:`/original id resolves (RT6).

### 3.4 Structured-error self-heal vocabulary
Today error shapes diverge: realtime `{error:{code,message,hint,field,extras}}`; `CanvasRealtimeError{code,status_code,detail}` (`write_service.py:21-34`); v2 reduces to a bare `retryable:bool` (`execution_core.py:662`); legacy hand-unwraps detail (`canvas_edit_tool.py:322-331`). **v1.0: ONE typed envelope on every write failure:**
```
CanvasWriteError {
  code: STALE_RELOAD | ID_REMAPPED | VALIDATION | NODE_NOT_FOUND
      | CONNECTION_ENDPOINT_MISSING | CONNECTION_ENDPOINT_INVALID
      | NODE_LOCKED | EMPTY_BATCH | BATCH_TOO_LARGE | TRANSPORT_RETRYABLE
  retryable: bool
  self_heal: { action, params }
  op_index?: int
  field?: string
  message: string
}
```
Self-heal recipes (AI applies ONCE, silently):
- **STALE_RELOAD** ← 409 version_conflict (`index.js:887`). `{action:'reload_rebase', params:{serverVersion}}`. Re-fetch snapshot, re-pin `expected_version`, re-resolve refs, resubmit same idempotency-keyed batch. Surface to user only if the rebase target vanished. Drop the redundant pre-flight `_check_pending_preview_valid` fetch (`execution_core.py:589`) — rely on If-Match + auto-rebase.
- **ID_REMAPPED** ← `id_map`/`idMap` present in a 200 (`index.js:974-975`). NOT an error — a continuation contract. `{action:'rewrite_refs', params:{idMap}}`. **MUST be plumbed: `execution_core` currently drops idMap into the trimmed response only (`execution_core.py:676`) and never rewrites subsequent references — fix.**
- **VALIDATION{op_index,field}** ← 422 (`index.js:902-918`). Deterministic; do NOT blind-retry. `{action:'fix_field'}`. Realtime's 422 path MUST add `op_index` and `field` (today flat message only).
- **NODE_NOT_FOUND / CONNECTION_ENDPOINT_MISSING** ← `group.children references unknown node id` (`applyCanvasOps.js:505`), endpoint-missing throws (`:823-824`), `Unknown temporary id reference` (`:596`). `{action:'drop_or_create_ref'}`.
- **CONNECTION_ENDPOINT_INVALID{reason}** ← e.g. group endpoint when a deployment rejects them (§1.10 G4). Replaces the current silent skip.
- **NODE_LOCKED** ← (NEW; no server enforcement today — verified no `locked` check in `applyCanvasOps.js`) a mutating op targets a `locked:true` node. `retryable:false`, `{action:'abort_op'}`. Prevents silent no-op or silent override.
- **EMPTY_BATCH** ← empty `operations` (`applyCanvasOps.js:514`). Pre-flight in substrate; empty batch = success no-op with `warning:'empty_batch'`, NEVER a network call (v2 lacks this guard and would 400 `index.js:806`; CaC short-circuits `cac/tools.py:1460-1465`).
- **BATCH_TOO_LARGE** ← (NEW; verified NO `operations.length` upper bound in `applyCanvasOps.js`, only the empty check at `:514`) op count exceeds a documented cap (e.g. 500). `retryable:false`, `{action:'split_batch', params:{maxOps}}`. Prevents undefined behavior on a 5000-op batch.
- **TRANSPORT_RETRYABLE** ← 5xx/timeout. `{action:'retry_backoff'}` under same idempotency key, bounded (e.g. 2 tries). Replaces the current 8.0s no-retry hard-fail (`write_service.py:263`).

**Delete-cascade contract (ADD — verified `applyCanvasOps.js:801-808`).** `delete_node` currently removes the node and filters connections where `from===id || to===id` (attached edges ARE deleted), but does NOT strip `parentGroupId` on the node's children nor remove the deleted id from any container's `children[]`. v1.0 specifies:
- Deleting a **container** (`group`/`column`): the container node is removed; its children are NOT deleted; each child's `parentGroupId` is stripped (becomes free); the children survive as free nodes. (Equivalent to an implicit `ungroup` then delete.)
- Deleting a **member node**: it is removed from its container's `children[]` (no dangling child ref), and its `parentGroupId` is moot.
- Deleting **any node**: connections with either endpoint on it are deleted (preserve current behavior `:804`).
- **Acceptance DC1:** after deleting a container, re-read shows zero surviving nodes with `parentGroupId===<deleted>` and no `children[]` anywhere referencing the deleted id. **DC2:** after deleting a member, its former container's `children[]` no longer lists it. **DC3:** after deleting a connected node, no connection references it.

**Move-on-container contract (ADD).** `move_node` on a container must have defined child behavior:
- A `group` in `mindmap` mode re-layouts via its layout descriptor — moving the group root translates the subtree (existing mindmap layout semantics, `applyCanvasOps.js:1055-1085`).
- A `group`/`column` in `normal` mode: `move_node` translates ONLY the container box by default; children keep absolute coordinates UNLESS the op carries `moveChildren:true` (macro = container delta applied to each child via the server). v1.0 default = box-only, documented, so AI behavior is predictable.
- **Acceptance MV1:** `move_node` on a normal container by (dx,dy) with `moveChildren` unset → children coordinates unchanged; with `moveChildren:true` → each child shifted by (dx,dy).

### 3.5 The 3-stack collapse (one executor)
Correction to the common framing: the "3 stacks" are NOT 3 executors — all converge on ONE transport `CanvasWriteService.apply_canvas_ops` → `/apply` → `applyCanvasOps()`. They are 3 grammar/orchestration FRONT-ENDS. Collapse:
- **DELETE the CaC→legacy delegation** (`cac/tools.py:1123-1136` instantiating `CanvasEditTool.edit()`); CaC calls `apply_canvas_ops` directly (it already holds `_write_service` `cac/tools.py:1164`).
- **DELETE the legacy monolith** `core/tools/canvas_edit_tool.py` once CaC is rewired and v2 is the only runtime; move its unique value (AI-timeline logging `:359`, error-detail unwrapping `:322-331`) INTO the substrate (§3.4).
- **KEEP CaC engine** (`cac/engine.py` layout/anchor/selector compute) — substrate-grade op generation; v2's mutation compiler reuses it.
- One transport, one op compiler (CaC engine), one normalizer, one advertised grammar.

---

## 4. Universal Structural Slots (substrate, not thinking-layer)

### 4.1 Typed-edge OPEN relation field
Truth: `CanvasConnection` (`canvas.ts:276-304`) carries `id/from/to` + `label?:string` FREE-TEXT (`:280`) + render hints (`type,controlPoints,fromPoint/toPoint,curveMode,tension,curveAnchor,anchorParams,appearance` `:284-323`). NO machine-readable relation. Direction is implicit `from→to` BUT the arrow is cosmetic and independently settable (`appearance.arrow.start/end` `:314-316`) → a connection can be `from:A,to:B` with visual B→A. No "undirected" declaration.
**Add (substrate, open vocabulary):**
```jsonc
relation?: string;       // OPEN. Machine-readable kind. Substrate NEVER validates the value.
                         // Generic examples a caller MAY use: "link","parent","reference","flow".
                         // Thinking layer MAY later use "supports","cites" — substrate is agnostic.
directed?: boolean;      // default true => from=source,to=target. false => undirected (order non-semantic).
relationData?: Record<string, unknown>;  // open per-relation bag, typed by the layer above.
                         // NOT indexed/queryable by the substrate; only top-level `relation` is queryable.
```
Rules:
- `relation` is DISTINCT from `label` — `label` = human display text, `relation` = machine kind; AI filters/reasons on `relation`, renders `label`.
- `directed` is the SINGLE source of truth for logical direction; `appearance.arrow` becomes pure rendering preference (default `arrow.end=true` when `directed=true` & unset; no arrows when `directed=false`).
- Endpoint invariant: if `from`/`to` references a live node id, that end re-derives geometry on node move; `fromPoint/toPoint` coords are advisory. Mixed (one node end, one free end) is legal (`applyCanvasOps.js:816-824`).
- **`relationData` is a slot, NOT a query target.** The substrate does not index it; only the top-level `relation` string is queryable via `find(rel=…)`. This prevents it becoming a dumping ground the read contract must serialize.
Why substrate: every graph tool (tldraw/Figma/Miro/Excalidraw) carries an edge "kind" + direction. Zero epistemics until a vocabulary is supplied.
**Acceptance.** E1: `add_connection{from,to,relation:"reference",directed:true}` → re-read returns `relation:"reference"`, `directed:true`, unvalidated. E2: an arbitrary `relation:"xyzzy"` is stored verbatim (no rejection). E3: `find(rel:"reference")` returns the edge; `find` over a `relationData` field is NOT supported.

### 4.2 Unified grouping / containment
Truth: THREE overlapping, partially-dead membership mechanisms — (1) `type:'group'` node + `parentGroupId` back-pointer (`canvas.ts:43,76`), (2) container `children:string[]` forward-list (`:74`), (3) `GroupEntity{nodeIds[]}` in `Canvas.groups?` (`:338,359-366`) which is ORPHANED — no op writes it; the apply loop never references `groups` (verified `applyCanvasOps.js` has no `groups` handling). Plus `mindmap.siblingOrder` (a SECOND ordering store) and `mindmap.collapsed` (competes with column `isCollapsed`).
**Unify:**
- **`parentGroupId` = single source of truth for membership** (back-pointer), for BOTH `column` and `group` (both are just nodes).
- **`children[]` = DERIVED ordered view.** Kept because order matters. Server-enforced invariant on apply: every id in `container.children[]` has `parentGroupId===container.id`, and every node with `parentGroupId===C` appears exactly once in `C.children[]`. Extend the existing reconcile to enforce bidirectional consistency and emit a `warning` on mismatch (today `applyCanvasOps.js:741-743` only drops unknown child ids).
- **Retire `GroupEntity`** — mark `@deprecated` at `canvas.ts:359` now; migrate `nodeIds[]` → per-node `parentGroupId` + a `group` node; drop `Canvas.groups`.
- **`attachedConnections`** (`:78`) = documented cache (re-derivable from connections whose both ends are in the group), not source of truth.
- **Mindmap blob normalize:** keep layout params (`spacingX/Y,compactY,orientation`) as a typed sub-object; route sibling order through the unified `children[]` (retire `mindmap.siblingOrder` as a competing store); move per-node `collapsed` to node-level `isCollapsed` (generalize the existing column flag `canvas.ts:75`); keep `rootId`. Mindmap stays an OPTIONAL layout descriptor on `group` nodes — NOT promoted to universal substrate. The substrate-universal part is just: containers have ordered `children[]` + per-node `isCollapsed`.
**Acceptance.** U1 (invariant): after any batch, for every container, `children[]` ⟷ `parentGroupId` are bidirectionally consistent (a test scans the doc). U2: `update_node{children:[reordered]}` is the only path to reorder siblings and it round-trips. U3: `Canvas.groups` is never read or written by the apply path (test asserts).

### 4.3 Provenance / actor / judgment-state
Truth: only `createdAt/updatedAt` exist (`canvas.ts:138`); `ai?:boolean` (`:142`) is a single bit. NO actor, no which-model, no edited-by, no accept/reject state. `_simplify_nodes` even drops `ai?`.
**Add a universal provenance block to BOTH nodes and connections (open, epistemics-free):**
```jsonc
provenance?: {
  createdBy?: { actor: "human" | "agent" | "system", id?: string, model?: string };
  updatedBy?: { actor, id?, model? };
  // judgment-state is an OPEN slot the thinking layer keys off; the substrate ONLY stores it.
  // It imposes NO vocabulary and NO state machine. The values below are NON-NORMATIVE EXAMPLES —
  // substrate stores ANY string and never validates it. Do NOT harden these into a validator.
  state?: string;          // non-normative examples: "draft" | "accepted" | "rejected" | "pending"
  origin?: string;         // non-normative examples: "user-typed" | "ai-suggested" | "imported"
}
```
Rules:
- Substrate records `createdBy/updatedBy` on every op automatically from the request context (the actor/model is known at the write boundary).
- `state`/`origin` are OPEN strings the substrate NEVER validates — the thinking layer (e.g. accept/reject of an AI suggestion) keys off them. **No state machine, no enum enforcement at the substrate.**
- `ai?:boolean` becomes a derived convenience (`provenance.createdBy.actor==='agent'`); keep it readable for back-compat but stop dropping it in the read projection.
Why substrate: "who made this / by what / what's its review state" is universal to any collaborative/agentic canvas; the VALUES are layer-defined.
**Acceptance.** PR1: an AI write → re-read shows `provenance.createdBy.actor:"agent"` (+ `model` if known) on the created node/edge, auto-recorded. PR2: a human edit → `updatedBy.actor:"human"`. PR3: setting `provenance.state:"anything"` is stored verbatim and never rejected. PR4: `ai:true` ⟺ `provenance.createdBy.actor==='agent'` (a test asserts the derivation).

---

## 5. Round-Trip Fidelity Spec

**Guarantee.** read(`structure`) → AI understands topology+ids → write-back via the closed op-set → the durable doc is identical (for the fields the op touched) AND all references the AI used resolve. No guessing of ids, no re-read needed for enumeration.

**The 50-node test.** Canvas = 1 mindmap group (root + 20 descendants) + 2 columns (6 children each) + 8 free text + 4 media + ~35 connections (incl. 5 free-floating). Procedure: one `canvas_read(structure)` → model must (a) enumerate all node+edge ids, (b) know mindmap parent/child + order, (c) know which column owns which children, (d) know the connection graph, (e) issue `update_node`/`move_node`/`add_connection`/`update_node{children}` against correct ids.
**Today it fails** on: (1) JSON validity — output crosses 8 KB, head-truncation cuts mid-array around node 25-40, ids past the cut unknowable (`tool_message_truncation.py:67`); (2) mindmap/group topology — `parentGroupId` and `mindmap` blob dropped (`cac/tools.py:515-532`), tree must be inferred from coordinates (the forbidden "guessing"); (3) inverse containment — `parentGroupId` gone so "what column is X in?" requires scanning every container.
**v1.0 passes** because §2 keeps topology complete+valid, restores `parentGroupId` + `ai`, exposes the compact mindmap tree, threads edge `rel`/provenance, and budgets only content.

**Acceptance tests:**
- RT1 — id-set diff: returned node+edge id set == ground-truth doc id set (exact).
- RT2 — containment bidirectional: for every child the AI names its container; for every container the ordered children; both match the doc after enforcing the §4.2 invariant.
- RT3 — write-back identity: read every node, write each back unchanged via the closed grammar → durable doc diff is empty, modulo server-canonicalized fields (e.g. `opacity`→`textStyles.opacity`) which MUST be reported via `STYLE_NORMALIZED` so the AI's doc model stays consistent.
- RT4 — tmp-ref survival: a batch that creates nodes with `tmp:` ids and connections referencing them resolves 100% via the returned total idMap; `final_id = idMap[sent_id] ?? sent_id` reproduces every durable id.
- RT5 — serialized-bytes validity: at 1/50/500/5000 nodes, the exact bytes the model receives `json.loads` cleanly (incl. content with control chars / lone surrogates — produced via `json.dumps`).
- RT6 — same-batch edge mutation: an `update_connection` (or `delete_connection`) referencing a connection created earlier in the SAME batch by a `tmp:` id resolves via `mapRemappedId` (`applyCanvasOps.js:643,647`) and targets the durable edge.

---

## 6. Smoothness Spec

**Latency anatomy.** Dominant cost = 1 backend→realtime HTTP hop + (DB read of baseDoc if canvas not already active in realtime memory `index.js:843`) + DB persist. Warm canvas reads from in-memory `server.documents`; cold canvas pays a full doc fetch. Targets:
- **S1 — Bounded write latency.** httpx timeout 8.0s (`write_service.py:263`) gets bounded retry-with-backoff on 5xx/timeout under the same mandatory idempotency key; no single cold stall blocks a run for 8s then hard-fails.
- **S2 — No redundant round-trips.** Drop the pre-flight `fetch_snapshot` in `_check_pending_preview_valid` (`execution_core.py:589`) — it duplicates the server-side If-Match check; rely on If-Match + auto-rebase (§3.4 STALE_RELOAD).
- **S5 — Atomic small edits.** Table cell edit (§1.6 `update_table_cell`) replaces full-blob rewrite → no racey re-serialize, cell-level idempotency.

(Optimistic local echo (S3) and AI snapping / `place_node` (S4) are DEFERRED — pure frontend rendering polish with zero bearing on the operate/comprehend contract. Appendix A.)

**Conflict UX.** A 409 auto-rebases silently (STALE_RELOAD self-heal); the user is interrupted ONLY when the rebase target vanished (e.g. the node the AI was editing was deleted concurrently). 422 never blind-retries (no loop). EMPTY_BATCH never hits the network. ID_REMAPPED is invisible to the user (the AI rewrites refs). NODE_LOCKED aborts the single op with a typed error, not a silent no-op.

**Acceptance:** SM1 — median AI single-op apply on a warm canvas is under the human-perceptible jank threshold. SM2 — a concurrent human edit during an AI batch resolves via one silent rebase in the common case. SM3 — no double-apply under a retried timeout (idempotency key dedup, verified path `index.js:812,819`). SM4 — `update_table_cell` does not re-serialize the whole table blob.

---

## 7. The Thin Thinking Probe

The minimal test that VALIDATES the substrate is "perfect enough" WITHOUT building the thinking layer. It exercises read-comprehension + structural reasoning + a precise typed-relation write, using ONLY substrate primitives.

**HARD GATE on probe authoring:** the probe MUST use ONLY generic `relation` values (`"link"`, `"reference"`, `"question"`) and generic provenance — NEVER `claim`/`evidence`/`supports`/`contradicts`/`hypothesis`. If the probe uses an epistemic vocabulary it is testing the thinking layer, not the substrate, and is INVALID. A reviewer rejects any probe variant that embeds epistemics.

**Probe (single shot, no human help):**
1. AI calls `canvas_read(structure)` on a test canvas of ~30 nodes with a mix of connected and isolated nodes.
2. From the L2 envelope alone (no re-read), AI identifies a node that has NO inbound connection (`edges` where no `to===nodeId`) and is not a container.
3. AI proposes ONE new `text` node placed beside it (geometry computed from the target's `x,y,w,h` — to the right, non-overlapping) whose content is a question about that node, and ONE `add_connection{from:<newNode>, to:<target>, relation:"question", directed:true}` using a `tmp:` id for the new node referenced by the connection in the same batch.
4. AI submits one idempotency-keyed batch.

**Pass criteria (each maps to a substrate guarantee):**
- The isolated node was correctly identified from L2 alone → §2 read completeness (R3,R4; RD4).
- The new node lands beside the target without overlap → geometry exposed at L2.
- The `tmp:` new-node id is resolved and the connection points at the durable id via the returned total idMap → §3.3 id-stability (RT4).
- The connection carries `relation:"question"` (an OPEN, generic value the substrate stored without validating) and `directed:true` → §4.1 typed-edge slot works with arbitrary vocabulary.
- A re-read shows the new node with `provenance.createdBy.actor:"agent"` → §4.3 provenance auto-recorded (PR1).
- The batch applied atomically under one idempotency key; a retry produced no duplicate (SM3).
- No epistemic vocabulary was used anywhere in the probe → confirms the substrate alone (not a thinking layer) was exercised.

If all criteria pass with ONLY generic relations/provenance, the substrate is "perfect enough" per P2. The thinking layer is then built ABOVE this contract.

---

## 8. Acceptance Matrix (rollup — every criterion is concrete and testable)

| Area | IDs | Gates |
|---|---|---|
| Node types | T1-T3, M1-M2, H1-H2, S1-S2, C1-C3, TB1-TB4, CL1-CL2, TD1, MD1-MD2, G1-G4, DOC1-DOC3 | Each type CRUDs + type-specific ops + typed validation |
| Read | RD1-RD6 | JSON-valid at 1/50/500/5000 nodes; topology complete; escaping-safe; edges carry rel/provenance |
| Write grammar/ids/errors | WC1, §3.3(1-6), all `CanvasWriteError` codes incl. NODE_LOCKED/BATCH_TOO_LARGE; DC1-DC3 (cascade); MV1 (move-on-container) | One grammar; total idMap; one self-healing envelope; defined cascade + container-move |
| Slots | E1-E3, U1-U3, PR1-PR4 | Open relation/direction; unified containment invariant; auto provenance — all unvalidated/open |
| Round-trip | RT1-RT6 | id-set, containment, write-back identity, tmp survival, byte validity, same-batch edge mutation |
| Smoothness | S1-S2, S5, SM1-SM4 | bounded latency, no redundant fetch, atomic cell edit, idempotent retry |
| Probe | §7 (7 criteria) | Substrate validated with generic vocabulary only |

**Definition of done:** all of §8 pass. NOT "every feature has an op."

---

## 9. Single Machine-Readable Schema Artifact

Today the schema is triplicated and drifting (`frontend canvas.ts`, `backend api_models.py`, `services/canvas-realtime/src/ops/contract.js`) with `Any` escape hatches and "no machine-readable schema artifact" (`report-canvas-model.md:45`). v1.0 produces ONE canonical artifact:
- **`canvas-schema.json`** (JSON Schema) is the single source. It defines: the 8 node types + per-type required/optional fields (incl. `canvas-link.title` required, deprecated elsewhere), the typed `TableStyles` (replacing `any`), `textStyles`, the published style enums (`ACCENT_COLOR_PRESETS`, `SHAPE_PRESETS`, mermaid theme ids, table `theme`), the connection shape WITH the §4.1 `relation`/`directed`/`relationData` slots, the §4.3 `provenance` block, the closed op-set + the ONE `canvas_edit` grammar (§3.2), and the `CanvasWriteError` envelope (§3.4).
- The three runtimes import or codegen from it (frontend types, backend Pydantic, realtime validator). A CI test asserts no `any`/`Any` escape hatch remains for `tableStyles`; `linkStyles` is removed unless a real shape is defined.
- The `update_canvas` patch-key allowlist (`ops_contract.py:34-45`) and `ALLOWED_OPS` (`:6-17`, extended per §3.1) are generated FROM this artifact, not hand-maintained in three places.
**Acceptance.** SCH1: a single `canvas-schema.json` exists and the published `canvas_edit` tool schema is generated from it. SCH2: a drift test fails CI if frontend/backend/realtime diverge from the artifact. SCH3: no `any`/`Any` for `tableStyles`/`linkStyles` in the generated types.

---

## Appendix A — Deferred / Thinking-Layer (OUT of v1.0, not lost)

Everything here was CUT (gold-plating) or DEFERRED (real value, not a substrate prerequisite). It is recorded so it is not re-discovered later, and explicitly NOT in the v1.0 definition of done.

**Cut as gold-plating (rendering/UX parity, not operate/comprehend):**
- A.1 — Server-seeded default **mermaid** theme for AI-created nodes (FE default exists `NodeDefaults.ts:231-256`; a themeless node still renders). [§1.2]
- A.2 — Server-seeded default **svg** theme (`NodeDefaults.ts:258-276`). [§1.4]
- A.3 — `targetCanvasId` existence validation / `NODE_NOT_FOUND`-class for canvas-link — cross-resource referential integrity is app-layer. [§1.7]
- A.4 — S4 **AI snapping / `place_node{near,side}`** — a few px misalignment does not break operation. [§6]

**Deferred (real value; build after the substrate is proven):**
- A.5 — S3 **optimistic local echo for AI ops** — pure frontend rendering; zero bearing on the operate/comprehend contract or round-trip fidelity. [§6]
- A.6 — `attach_media` **binary-upload op** + KB ingestion as op — v1.0 contract is mock-placeholder/external-URL only; the AI explicitly cannot re-read its own uploaded binary. [§1.9]
- A.7 — **SVG sub-element editing** `edit_svg_element{id,selector,patch}` — v1.0 is whole-`content` SVG replacement; sub-element addressing (`components/svg/`) is not substrate. [§1.4]
- A.8 — Server-side **graph-traversal verbs** `neighbors_of` / `connected_component` / `subtree_of` — derivable client-side from the complete L1/L2 edge list. [§2.4]
- A.9 — Server-side **undo/redo history op** — undo is browser-local (`canvas.store.ts:1894-1949`); a server history op is optional, not gating. [§3.1]

**Thinking-layer ONLY (must NEVER enter the substrate):**
- A.10 — Any epistemic vocabulary for `relation` (`supports`/`contradicts`/`cites`/`claim`/`evidence`/`hypothesis`/`rebuttal`).
- A.11 — Any validator or state-machine over `provenance.state`/`origin` (the comment examples `draft|accepted|rejected|pending` are NON-NORMATIVE; the substrate stores any string).
- A.12 — Indexing/querying `relationData` (the substrate indexes only the top-level `relation` string).
- A.13 — The thinking-visualization layer itself (claim/evidence graphs, argument maps) — built ABOVE this contract once §7 passes.
