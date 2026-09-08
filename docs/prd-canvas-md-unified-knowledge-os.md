# PRD: Canvas + Markdown Unified Knowledge OS

| Field | Value |
|---|---|
| Product | ZMind |
| Doc Type | Product Requirements Document (PRD) |
| Version | v1.0 |
| Status | Draft for architecture execution |
| Date | 2026-03-02 |
| Owner | Product + Architecture |
| Decision | `Canvas` and `Markdown` are first-class, equal content types; Doc editor reuses existing text-node editor kernel |

## 1. Executive Summary

ZMind will evolve from a primarily canvas-centric experience into a dual-core knowledge system:

1. `Markdown` for fast capture, long-form writing, and durable knowledge artifacts.
2. `Canvas` for visual reasoning, decomposition, and relational thinking.
3. A shared link graph to connect both via stable IDs and bidirectional references.

The product will adopt a hybrid organization model:

- `Folder` for governance boundaries (permission, archive, batch operations, import/export).
- `Hierarchy` for user mental model (parent-child structure).
- `Backlink Graph` for semantic relationships (cross-branch, cross-folder, cross-type connections).

## 2. Product Vision and Goals

### 2.1 Vision

Build an AI-native knowledge operating system where users can:

- capture fast,
- think deeply,
- connect broadly,
- and reuse continuously.

### 2.2 Goals

1. Unify note-taking and visual thinking without forcing context switches.
2. Ensure all content is linkable, traceable, and durable.
3. Improve AI outcomes by grounding generation in explicit references.
4. Provide Obsidian-compatible Markdown interoperability.
5. Deliver Notion-grade editing experience while preserving Markdown portability.

### 2.3 Non-Goals (v1)

1. No custom query language UI for end users.
2. No multi-model permission system divergence; reuse workspace permissions.
3. No advanced graph analytics UI in first release.

## 3. Target Users and JTBD

| User Segment | Core Job | Success Signal |
|---|---|---|
| Solo creators/researchers | Capture insight and develop structure | Create note -> map into canvas -> publish output in one session |
| Product/design teams | Turn meeting output into strategy and execution | Shared references across docs/canvases without duplication |
| Learners/students | Build linked knowledge, not isolated notes | High backlink density and retrieval speed |

## 4. Product Principles

1. One-click path over multi-step workflows.
2. Result-first UI, process details hidden unless needed.
3. Stable ID over path-based coupling.
4. References before duplication.
5. Progressive disclosure for advanced options.
6. Single editor kernel: Doc editor and canvas text node editor share the same core editing capability.
7. Interaction parity over visual mimicry: align core editing behavior with Notion before visual polish.

## 5. Information Architecture

```text
Workspace
├── Folder* (optional boundary)
│   └── Item (Doc | Canvas)
└── Item (root)

Item relations:
1) Containment: folder_id
2) Hierarchy: parent_item_id
3) Semantic: link_edges / backlinks
```

## 6. Domain Model (Conceptual)

```text
[Item]
  id (stable)
  type: doc | canvas
  title
  folder_id
  parent_item_id
  status
  created_at / updated_at

[Doc]
  item_id (1:1)
  content_md
  frontmatter_json

[DocBlock]
  block_id (stable)
  doc_id
  range_start / range_end
  hash

[Canvas]
  item_id (1:1)
  doc_json
  version
  server_version

[Reference]
  source_type: canvas_node | doc_block
  source_id
  target_type: doc | doc_block | canvas
  target_id
  mode: reference | snapshot
```

## 7. Core User Flows

### 7.1 Fast Capture to Visual Reasoning

```text
Create Doc -> Write Markdown -> Select block ->
Insert to Canvas as node(reference default) ->
Explore on Canvas -> Jump back to source block ->
Consolidate into Doc
```

### 7.2 Canvas to Document Consolidation

```text
Select Canvas region -> Generate structured outline ->
Create or update Doc section -> preserve source references
```

### 7.3 Bidirectional Traceability

```text
From Doc block -> "Referenced by N nodes"
From Canvas node -> "Open source block/doc"
```

## 8. Functional Requirements

### 8.1 Content Model

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-001 | Add `Doc` as first-class content type | P0 | Doc appears in same tree as Canvas |
| FR-002 | Unified `Item` identity for Doc/Canvas | P0 | Shared list/search/sort behavior |
| FR-003 | Support Doc root and folder placement | P0 | Move Doc to folder/root without link break |
| FR-004 | Parent-child hierarchy for items | P0 | Drag to set parent, cycle blocked |

### 8.2 Doc <-> Canvas Interop

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-010 | Insert Markdown block into Canvas node | P0 | One click from block menu; render under 1s |
| FR-011 | Default insertion mode is `reference` | P0 | Source edits reflect in node view |
| FR-012 | Optional insertion mode `snapshot` | P1 | Snapshot remains frozen until manual refresh |
| FR-013 | Node can open source Doc block | P0 | Single click jump to exact anchor |
| FR-014 | Doc shows backlink list of referencing nodes | P0 | Backlinks update within real-time tolerance |

### 8.3 Linking and Identity

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-020 | Stable IDs for docs/blocks/nodes | P0 | Rename/move does not break reference |
| FR-021 | Support `[[wikilink]]` and block anchors | P0 | Parse and resolve in editor and preview |
| FR-022 | Broken reference state handling | P0 | Show recover/replace actions, no silent drop |

### 8.4 Search and Retrieval

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-030 | Unified search across docs and canvases | P0 | Results include type and snippet |
| FR-031 | Block-level hit navigation | P0 | Open at exact block |
| FR-032 | Reference-aware ranking | P1 | Linked content boosted in rank |

### 8.5 Collaboration and Permissions

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-040 | Permission checks on reference resolution | P0 | No unauthorized source reveal |
| FR-041 | Real-time updates for links and metadata | P0 | WS patch convergence with fallback refetch |

### 8.6 Import / Export (Obsidian compatibility)

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-050 | Import Markdown + wikilink graph | P1 | >=99% valid file parse success |
| FR-051 | Export Markdown preserving link syntax | P1 | Obsidian opens and resolves links |
| FR-052 | Asset path migration and reconciliation | P1 | No unresolved asset on export |

### 8.7 Editor Reuse and Media

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-060 | Doc editor must reuse the existing rich text editor kernel used by canvas text nodes | P0 | Doc and text-node editing behaviors are consistent for formatting/markdown conversion |
| FR-061 | Doc supports image insertion by paste, drag-drop, and file picker | P0 | User can insert image in <=1 interaction path and see preview immediately |
| FR-062 | Doc image upload uses unified media pipeline with permission-safe URLs | P0 | Uploaded images render correctly for authorized viewers and do not leak raw storage path |
| FR-063 | Inserting a doc block containing images into canvas preserves visual fidelity | P1 | Canvas node renders image references or fallback links without content loss |

### 8.8 Notion-Parity Editing Baseline

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-070 | Doc editor must support block-level slash commands and keyboard-first editing | P0 | slash command latency and command success meet baseline UX target |
| FR-071 | Doc editor must provide predictable block operations (enter/split, backspace/merge, multi-block select) | P0 | operation behavior is deterministic and consistent with canvas text editing |
| FR-072 | Inline formatting parity set (`bold/italic/code/link/highlight`) | P0 | all parity actions available in toolbar and shortcuts |
| FR-073 | Stable drag-and-reorder of blocks with undo/redo safety | P1 | reorder persistence and history rollback are reliable |
| FR-074 | Markdown round-trip fidelity for supported syntax | P0 | serialize -> parse -> render content equivalence for supported subset |

### 8.9 Obsidian Bulk Compatibility

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-080 | Support bulk import of Obsidian vault via zip upload | P0 | user can import multi-file vault in one job |
| FR-081 | Support directory-style batch import of `.md` + assets | P1 | folder hierarchy and links preserved after import |
| FR-082 | Two-pass import resolver (`create docs` then `resolve links`) | P0 | unresolved links reported, no silent loss |
| FR-083 | Preserve wikilinks and embeds (`[[...]]`, `![[...]]`, headings, block refs) where supported | P0 | parse success and link mapping report available |
| FR-084 | Export to Obsidian-compatible markdown with asset remap | P1 | exported vault opens with valid links/assets in Obsidian |

## 9. UX Requirements

### 9.1 Interaction Rules

1. Doc block context menu must include `Insert into Canvas`.
2. Insertion must immediately show result node and backlink indicator.
3. Advanced sync options are hidden under node settings.
4. Orphan reference state must be visible and actionable.
5. Image insertion affordance must be obvious in doc toolbar/slash menu and support paste/drop.
6. Notion-parity baseline interactions must be shipped before advanced graph controls in doc editor.

### 9.2 Minimal UI States

| Component | Required States |
|---|---|
| Doc block action | idle, inserting, success, error |
| Canvas referenced node | synced, stale, source-missing, permission-blocked |
| Backlink panel | empty, list, loading, error |
| Doc image | uploading, uploaded, failed, permission-blocked |

## 10. Technical Requirements (Product-facing)

1. All references resolve by stable IDs, not path strings.
2. Workspace-level eventual consistency via patch + refetch fallback.
3. Idempotent write semantics for insertion/move operations.
4. Time-travel/version history must preserve reference lineage.
5. Doc editor and canvas text-node editor share one editor kernel to avoid behavior drift.
6. Doc image upload must use the existing storage/media proxy pipeline and keep markdown-compatible references.
7. Obsidian import must support batch jobs with resumable progress and deterministic reports.

## 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Workspace first meaningful load p75 < 1.5s |
| Performance | Insert block-to-canvas optimistic feedback < 200ms |
| Performance | Unified search p95 < 500ms |
| Reliability | Link integrity >= 99.99% |
| Reliability | Core mutation success >= 99.9% |
| Security | Permission-safe reference rendering |
| Observability | Full tracing for create/link/move/delete flows |

## 12. Metrics

### 12.1 North Star

`Closed Knowledge Loop Count / week`  
(Doc capture -> Canvas reasoning -> Doc consolidation completed)

### 12.2 Supporting Metrics

| Metric | Target |
|---|---|
| Doc adoption in new content | >= 50% |
| Avg valid backlinks per item | >= 3 |
| Broken reference rate | < 0.5% |
| Time from capture to first structured output | -40% |
| 30-day retention for power users | +15% |

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Multi-source state drift | stale UI / wrong hierarchy | single source reconciliation + version guard |
| Reference break on edits | knowledge loss | stable IDs + orphan recovery |
| Permission leakage through backlinks | security incident | server-side filtered backlink resolver |
| Migration complexity | rollout delays | phased flags + dual-write window |

## 14. Release Scope and Phasing

| Phase | Scope |
|---|---|
| Phase 0 | Foundation and contracts (consistency + observability) |
| Phase 1 | Item/Doc/Reference backend domain and migration foundation |
| Phase 2 | Notion-parity doc editor (reuse-first) + media support |
| Phase 3 | Doc-to-canvas bidirectional linking and rendering parity |
| Phase 4 | Unified search, AI linkage, and migration hardening |
| Phase 5 | Obsidian compatibility, ecosystem integration, GA rollout |

## 15. Launch Criteria

1. End-to-end path works in one session:
   Doc create -> block select -> insert to canvas -> backjump -> consolidate.
2. Rename/move operations do not break existing references.
3. Broken reference state is explicit with actionable recovery.
4. Search can open exact doc block and referenced canvas node.
5. Permission model passes cross-workspace access tests.
6. Bulk Obsidian vault import finishes with deterministic success/failure report.

## 16. Open Product Decisions (for architecture sign-off)

1. Snapshot mode update policy: manual only vs scheduled refresh.
2. Backlink panel default placement: right sidebar vs floating inspector.
3. Import conflict strategy: keep both vs overwrite with mapping.

## 17. Appendix: Terminology

| Term | Definition |
|---|---|
| Doc | Markdown-first document item |
| Canvas | Visual graph workspace item |
| Reference | Live link to source content |
| Snapshot | Time-frozen copy of source at insertion time |
| Backlink | Reverse index from target to all sources |
| Orphan Reference | Link whose target no longer resolves |
