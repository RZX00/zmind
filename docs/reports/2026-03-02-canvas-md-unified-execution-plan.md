# Execution Plan: Canvas + Markdown Unified Knowledge OS

| Field | Value |
|---|---|
| Program | ZMind Canvas+MD Unification |
| Type | Architecture + Delivery Execution Document |
| Version | v1.0 |
| Date | 2026-03-02 |
| Based on | `docs/prd-canvas-md-unified-knowledge-os.md` |
| Phase 0 Playbook | `docs/reports/2026-03-02-phase0-canvas-md-execution-playbook.md` |
| Phase 1 Spec | `docs/reports/2026-03-02-phase1-item-doc-reference-implementation-spec.md` |
| Phase 2 Playbook | `docs/reports/2026-03-02-phase2-doc-editor-notion-parity-playbook.md` |
| Phase 3 Playbook | `docs/reports/2026-03-02-phase3-doc-canvas-link-interop-playbook.md` |
| Phase 4 Playbook | `docs/reports/2026-03-02-phase4-unified-search-ai-enhancement-playbook.md` |
| Phase 5 Playbook | `docs/reports/2026-03-02-phase5-obsidian-compat-ga-playbook.md` |

## 1. Objective

Implement a production-grade, anti-fragile system where:

1. `Doc(Markdown)` and `Canvas` are first-class entities under one item model.
2. Markdown blocks can be inserted into canvas as text/reference nodes.
3. Bidirectional links are always traceable and permission-safe.
4. Existing canvas/folder workflows remain compatible during migration.

## 2. Current Baseline (Code Reality)

### 2.1 Frontend baseline

- Workspace aggregate reading and patch handling:
  - [`frontend/src/hooks/useWorkspaceData.ts`](/mnt/e/app/zmind/frontend/src/hooks/useWorkspaceData.ts)
  - [`frontend/src/hooks/react-query/workspace/apply-patch.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/apply-patch.ts)
- Tree/workspace UI:
  - [`frontend/src/components/file-tree/SidebarFileTree.tsx`](/mnt/e/app/zmind/frontend/src/components/file-tree/SidebarFileTree.tsx)
  - [`frontend/src/canvas/components/workspace/CanvasWorkspaceFlattened.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/workspace/CanvasWorkspaceFlattened.tsx)
- Existing folder and canvas services:
  - [`frontend/src/canvas/services/folder-manager.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/folder-manager.service.ts)
  - [`frontend/src/canvas/services/canvas-manager.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/canvas-manager.service.ts)
- Reusable editor and image upload pipeline already exists in canvas text flow:
  - [`frontend/src/canvas/components/editors/TextNodeEditor.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/editors/TextNodeEditor.tsx)
  - [`frontend/src/components/editor/novel/NovelRichTextEditor.tsx`](/mnt/e/app/zmind/frontend/src/components/editor/novel/NovelRichTextEditor.tsx)
  - [`frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts`](/mnt/e/app/zmind/frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts)
  - [`frontend/src/canvas/services/canvas-media.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/canvas-media.service.ts)

### 2.2 BFF / API baseline

- Canvas proxy set:
  - [`frontend/src/app/api/canvases/_proxy.ts`](/mnt/e/app/zmind/frontend/src/app/api/canvases/_proxy.ts)
- Folders/workspace routes:
  - [`frontend/src/app/api/folders/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/folders/route.ts)
  - [`frontend/src/app/api/workspace/meta/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/workspace/meta/route.ts)

### 2.3 Backend baseline

- Workspace aggregate and WS:
  - [`backend/core/workspace/service.py`](/mnt/e/app/zmind/backend/core/workspace/service.py)
  - [`backend/core/workspace/api.py`](/mnt/e/app/zmind/backend/core/workspace/api.py)
- Folder APIs:
  - [`backend/core/folders/api.py`](/mnt/e/app/zmind/backend/core/folders/api.py)
- Canvas command/query services:
  - [`backend/core/application/services/canvas_command_application_service.py`](/mnt/e/app/zmind/backend/core/application/services/canvas_command_application_service.py)
  - [`backend/core/application/services/canvas_query_service.py`](/mnt/e/app/zmind/backend/core/application/services/canvas_query_service.py)

### 2.4 Data baseline

- `canvases` and `folders` tables exist.
- Canvas folder relation currently encoded in `canvases.doc.folderId`.
- Workspace aggregate depends on `folders + canvases.doc` scanning.

## 3. Target Architecture

```text
                    +-----------------------------+
                    |        Workspace UI         |
                    | Tree / Doc Editor / Canvas  |
                    +--------------+--------------+
                                   |
                    +--------------v--------------+
                    |   Unified Workspace Query   |
                    | item(doc|canvas), links     |
                    +--------------+--------------+
                                   |
                   +---------------v----------------+
                   |          Domain APIs            |
                   | items/docs/canvases/references |
                   +---------------+----------------+
                                   |
             +---------------------+---------------------+
             |                     |                     |
   +---------v---------+ +---------v---------+ +---------v---------+
   | Item Repository   | | Doc Repository    | | Canvas Repository |
   +-------------------+ +-------------------+ +-------------------+
             |                     |                     |
             +---------------------+---------------------+
                                   |
                        +----------v-----------+
                        | Link/Backlink Index  |
                        +----------------------+
```

## 4. DDD Bounded Contexts and Ownership

| Context | Responsibility | Key Deliverables |
|---|---|---|
| Organization Context | Item tree, folder boundary, ordering | unified item API, cycle-safe move |
| Authoring Context | Doc editing and block identity | markdown block anchors, stable IDs |
| Canvas Context | Node graph and referenced nodes | node ref schema + rendering states |
| Knowledge Graph Context | Link edges and backlinks | create/link/delete/recover semantics |
| Search Context | unified index and retrieval | cross-type search and ranking |
| Collaboration Context | patch/version/permission | convergence, consistency, safe resolution |

## 5. Execution Strategy

1. Backward-compatible additive rollout.
2. Feature-flagged activation by workspace.
3. Dual-read and selective dual-write during migration window.
4. Stage-gate delivery with formal verification before next phase.

## 6. Phased Delivery Plan

## Phase 0: Foundation and Contracts (P0)

### Goals

1. Lock canonical contracts for `Item`, `Doc`, `Reference`.
2. Add feature flags and telemetry foundations.
3. Eliminate known proxy/header inconsistencies before expansion.

### Work Items

| Stream | Tasks |
|---|---|
| API Contract | Define `items`, `docs`, `references` schemas and error model |
| BFF Hygiene | Unify forwarded headers across canvases/folders/workspace routes |
| Observability | Add trace IDs and structured logs for insert-link flow |
| Flags | Add `feature_doc_first_class`, `feature_doc_canvas_reference` |

### Expected File Touchpoints

- [`frontend/src/app/api/canvases/proxyHeaders.ts`](/mnt/e/app/zmind/frontend/src/app/api/canvases/proxyHeaders.ts)
- [`frontend/src/app/api/folders/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/folders/route.ts)
- [`frontend/src/app/api/workspace/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/workspace/route.ts)
- `backend/core/interfaces/http/*` new contract modules

### Exit Criteria

1. Proxy behavior is consistent for auth/workspace/idempotency/version headers.
2. Feature flags can toggle at workspace granularity.

## Phase 1: Data Model and Backend Domain (P0)

### Goals

1. Introduce unified item model and doc model.
2. Add durable reference storage and backlink queries.
3. Keep existing canvas/folder behaviors stable.

### Database Changes

```text
New tables:
- items
- docs
- doc_blocks (or virtual index table)
- references

Compatibility:
- keep canvases/folders unchanged initially
- map canvas rows to items(type=canvas) incrementally
```

### Backend Work Items

| Stream | Tasks |
|---|---|
| Item API | create/list/update/move/delete items with hierarchy validation |
| Doc API | create/update/get doc, block anchor extraction |
| Reference API | create/remove/list backlinks, permission-filtered resolver |
| Workspace Aggregator | extend aggregate payload with docs/items/references metadata |
| Realtime | publish `item_patch`, `doc_patch`, `reference_patch` with versioning |

### Expected File Touchpoints

- [`backend/core/workspace/service.py`](/mnt/e/app/zmind/backend/core/workspace/service.py)
- [`backend/core/workspace/api.py`](/mnt/e/app/zmind/backend/core/workspace/api.py)
- New modules under `backend/core/items/`, `backend/core/docs/`, `backend/core/references/`
- Migrations under `backend/supabase/migrations/`

### Exit Criteria

1. Backend can serve unified workspace payload including docs.
2. References can be created and queried safely with permission checks.

## Phase 2: Frontend Doc-first Experience (P0)

### Goals

1. Add doc item to workspace tree and list.
2. Ship doc editor with block-level actions.
3. Maintain low-friction quick capture workflow.
4. Reuse existing text-node editor kernel and image upload path for doc editor.

### Frontend Work Items

| Stream | Tasks |
|---|---|
| Tree/UI | show doc and canvas under same item tree with type icon and filters |
| Routing | add doc route and team doc route |
| Editor Kernel | reuse `NovelRichTextEditor` capability set used by canvas text node editor |
| Editor UX | markdown editor with stable block anchors, slash actions, and selection actions |
| Media | support image insert via paste/drop/file picker and unified upload pipeline |
| Query Layer | unify workspace query cache structures for doc/canvas |

### Expected File Touchpoints

- [`frontend/src/components/file-tree/SidebarFileTree.tsx`](/mnt/e/app/zmind/frontend/src/components/file-tree/SidebarFileTree.tsx)
- [`frontend/src/hooks/useWorkspaceData.ts`](/mnt/e/app/zmind/frontend/src/hooks/useWorkspaceData.ts)
- [`frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts)
- [`frontend/src/canvas/components/editors/TextNodeEditor.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/editors/TextNodeEditor.tsx)
- [`frontend/src/components/editor/novel/NovelRichTextEditor.tsx`](/mnt/e/app/zmind/frontend/src/components/editor/novel/NovelRichTextEditor.tsx)
- [`frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts`](/mnt/e/app/zmind/frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts)
- [`frontend/src/canvas/services/canvas-media.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/canvas-media.service.ts)
- New doc editor modules under `frontend/src/components/editor/` or `frontend/src/components/docs/`

### Exit Criteria

1. Users can create/edit docs in same workspace structure.
2. Existing canvas operations are unaffected.
3. Doc editor formatting behavior is aligned with canvas text node editor.
4. Doc images can be inserted by paste/drop/picker and resolve to valid URLs.

## Phase 3: Doc-to-Canvas Reference Integration (P0)

### Goals

1. Insert selected markdown block into canvas as node.
2. Create bidirectional links and status states.
3. Support reference and snapshot modes.
4. Preserve image rendering semantics for doc blocks inserted into canvas.

### Work Items

| Stream | Tasks |
|---|---|
| Interaction | block context action: `Insert into Canvas` |
| Canvas Node | add node subtype `doc_ref` with source metadata |
| Link Engine | on insert, create reference edge and backlink |
| Rendering | display sync state: synced/stale/missing/forbidden |
| Media Rendering | doc_ref node supports inline image render or safe fallback link |
| Jump | open source block from node; open referencing nodes from doc |

### Expected File Touchpoints

- [`frontend/src/canvas/types/canvas.ts`](/mnt/e/app/zmind/frontend/src/canvas/types/canvas.ts)
- [`frontend/src/canvas/components/core/CanvasEditor.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/core/CanvasEditor.tsx)
- `frontend/src/canvas/components/nodes/*` doc-ref renderer
- Backend reference command/query APIs

### Exit Criteria

1. End-to-end one-click insert path works with backlink visibility.
2. Orphan and permission-blocked states are explicit.
3. Doc blocks containing images remain readable when inserted into canvas.

## Phase 4: Search, Compatibility, and Migration (P1)

### Goals

1. Unified search results across docs/canvases.
2. Obsidian import/export compatibility.
3. Legacy data migration and integrity enforcement.

### Work Items

| Stream | Tasks |
|---|---|
| Search | index docs blocks + canvas nodes + references |
| Import | parse markdown, wikilinks, assets, folder mappings |
| Export | write markdown with stable wikilinks and attachments |
| Migration | backfill items from existing canvases and folders |
| Validation | integrity checker for broken refs and cycle anomalies |

### Exit Criteria

1. Migration dry-run and production run both pass integrity thresholds.
2. Obsidian round-trip smoke tests pass.

## Phase 5: Obsidian Compatibility and GA Rollout (P1)

### Goals

1. Deliver Obsidian bulk import/export compatibility.
2. Operationalize at scale with anti-fragile fallback paths.
3. Complete GA rollout gates and runbook verification.

### Work Items

| Stream | Tasks |
|---|---|
| Obsidian Import | zip/folder ingest, two-pass link resolver, deterministic report |
| Obsidian Export | markdown + assets remap for round-trip compatibility |
| Performance | pagination/chunked aggregate load, selective hydration |
| Reliability | retry policies, dead-letter handling for patch/import pipeline |
| Security | strict permission tests for backlinks and shared contexts |
| QA | regression + load + chaos test packs + round-trip suites |

### Exit Criteria

1. Obsidian round-trip smoke tests and large-vault import tests pass.
2. SLO/SLA targets met under load.
3. Incident and rollback runbooks verified.

## 7. Migration Plan

## 7.1 Data migration sequence

```text
Step 1: Create new tables (items/docs/references) - additive
Step 2: Backfill items(type=canvas) from canvases
Step 3: Backfill folder/item hierarchy mapping
Step 4: Enable dual-read (legacy + new)
Step 5: Enable doc features for pilot workspace
Step 6: Enable dual-write for references
Step 7: Cut over reads to new unified item APIs
Step 8: Keep compatibility adapters until deprecation window closes
```

## 7.2 Integrity checks (must pass)

1. Item count parity with legacy canvas scope.
2. Parent-child cycle check = zero.
3. Reference target resolvability >= 99.99%.
4. Folder and root placement parity for existing canvases.

## 8. API Surface (Target)

| API | Method | Purpose |
|---|---|---|
| `/items` | GET/POST | list/create unified items |
| `/items/{id}` | GET/PUT/DELETE | item details and lifecycle |
| `/items/{id}/move` | POST | move with folder/parent semantics |
| `/docs` | POST | create doc |
| `/docs/{item_id}` | GET/PUT | get/update markdown |
| `/docs/{item_id}/blocks` | GET | block anchors |
| `/references` | POST/DELETE | create/remove edge |
| `/references/backlinks` | GET | reverse lookup |
| `/workspace/meta` | GET | unified aggregate (doc+canvas) |

## 9. Frontend Implementation Map

| Area | Existing | Target |
|---|---|---|
| Workspace cache | canvas/folder-centric | unified `items + docs + canvases + refs` |
| Tree rendering | folder + canvas | folder + item(type-aware) |
| Editor | canvas-focused | doc editor + canvas editor side by side |
| Interop action | not present | doc block -> canvas insert |
| Backlinks UI | not present | doc panel + node inspector |

## 10. QA and Verification Strategy

## 10.1 Test Matrix

| Layer | Coverage |
|---|---|
| Unit | item hierarchy, reference resolver, block anchor parser |
| Integration | API + DB + permissions + WS patch |
| E2E | doc create -> insert to canvas -> backlinks -> update -> delete source |
| Performance | workspace load with 10k items and high link density |
| Chaos | WS packet loss, redis reset, partial migration failures |

## 10.2 Critical E2E cases

1. Create doc, insert block to canvas, update source block, verify node sync.
2. Move doc across folder/hierarchy, verify backlinks still resolve.
3. Delete source block, verify orphan state and recovery action.
4. Permission downgrade user, verify protected references are masked.

## 11. Observability and Operational Readiness

### 11.1 Required telemetry

- `doc_created`, `doc_updated`
- `doc_block_inserted_to_canvas`
- `reference_created`, `reference_broken`, `reference_recovered`
- `workspace_patch_applied`, `workspace_patch_gap_refetch`
- `permission_filtered_reference_count`

### 11.2 Alerts

1. Broken reference ratio > threshold.
2. Patch gap refetch ratio spike.
3. Insert-to-node latency p95 breach.
4. Permission check failures or anomalies.

## 12. Rollout and Rollback

## 12.1 Rollout gates

| Gate | Criteria |
|---|---|
| Internal alpha | full E2E green + migration dry-run green |
| Pilot workspaces | no P0 incidents for 7 days |
| 25% rollout | metrics stable and integrity > target |
| 100% rollout | completion of rollback drill + executive sign-off |

## 12.2 Rollback strategy

```text
Feature flag off -> route back to legacy read path ->
disable reference insertion endpoint ->
retain data writes for forensic analysis ->
run integrity report and recovery
```

## 13. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Legacy/new model divergence | High | dual-read diff checker, canary cutover |
| Multi-client state conflict | High | version guards + deterministic patch merge |
| Permission leakage via backlinks | High | server-side filtered resolver only |
| Migration lock/contention | Medium | chunked backfill + resumable jobs |
| Search indexing lag | Medium | async rebuild queue + freshness SLIs |

## 14. Delivery Governance

1. Weekly architecture review with mandatory diff demo.
2. Phase-end review requires:
   - requirements traceability matrix,
   - test evidence,
   - rollback proof.
3. Each phase must end with tagged release and changelog entry.

## 15. Immediate Next Actions (Execution Start)

1. Approve API contract for `items/docs/references`.
2. Start Phase 0 proxy/header unification and flags.
3. Start migration DDL draft and dry-run scripts.
4. Define E2E acceptance suite for doc->canvas linking before Phase 2 coding.
