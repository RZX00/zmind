# Zmind DDD Anti-Fragile System Architecture & Implementation Spec

Status: Draft (ready for review)
Owner: Architecture
Last updated: 2026-02-04

This document defines a complete, implementation-ready architecture for Zmind
based on Domain-Driven Design (DDD), Hexagonal Architecture, and event-driven
systems. It is written so development can start immediately after approval.

--------------------------------------------------------------------------------
## 0. Executive Summary

Zmind is a visual thinking canvas with AI-assisted workflows and collaboration.
This spec restructures the system into bounded contexts with explicit domain
models, strict business/infrastructure separation, and anti-fragile behaviors.
All business logic lives in pure domain modules. IO, storage, and external
services are accessed only via ports. The system tolerates extreme edge cases
(offline, large canvases, network partition, replay, duplication) and recovers
without human intervention.

--------------------------------------------------------------------------------
## 1. Goals and Non-Goals

### Goals
1) Business logic and infrastructure are fully decoupled.
2) Every domain has a clear bounded context and ubiquitous language.
3) The system is anti-fragile: faults lead to safe degradation, not failure.
4) Extreme scale and edge cases are handled deterministically.
5) The architecture is implementation-ready, with ports, events, and schemas.
6) The solution is evolvable (bounded contexts can be extracted into services).

### Non-Goals
- This document does not provide pixel-level UI redesign.
- This document does not replace existing UI/UX flows immediately; it provides
  a migration path that preserves user experience while refactoring the core.
- This document does not prescribe vendor-specific tooling unless needed for
  invariants or anti-fragility.

--------------------------------------------------------------------------------
## 2. Guiding Principles

1) DDD first: Align code with business language and invariants.
2) Hexagonal architecture: Domain is pure, IO uses ports/adapters.
3) Event-driven integration: Domain events are the only cross-context contract.
4) CQRS: Write model for invariants; read model for UX and speed.
5) Local-first + CRDT: Collaboration is conflict-free and offline-safe.
6) Anti-fragile defaults: Fail safe, not silent; degrade gracefully.
7) Deterministic behavior: Same inputs lead to same outcomes.

--------------------------------------------------------------------------------
## 3. Ubiquitous Language (Core Terms)

- Workspace: A tenant boundary for users, billing, and policy.
- Canvas: A visual document containing nodes, connections, and metadata.
- Node: An element on a canvas (text, todo, media, code, link, etc.).
- Connection: A relationship between nodes.
- Canvas Version: Snapshot of a canvas at a moment in time.
- Share Link: A public, read-only access link to a canvas.
- Publication: A listed template derived from a canvas.
- Agent: A configurable AI worker with tools and instructions.
- Agent Run: A single execution instance of an agent.
- Knowledge Source: External or internal content used as context.
- Ingestion Job: The pipeline that processes a knowledge source.
- Entitlement: The allowed capability set for a workspace or user.
- Usage Ledger: Immutable accounting of consumption.
- Domain Event: An immutable statement that something happened.

--------------------------------------------------------------------------------
## 4. Context Map (High-Level)

               +------------------+
               |     Identity     |
               +---------+--------+
                         |
                         v
+-----------------+   +-----------------+   +------------------+
|    Workspace    +-->|     Canvas      |<->|  Collaboration   |
+--------+--------+   +--------+--------+   +------------------+
         |                     |
         v                     v
+-----------------+   +-----------------+   +------------------+
|     Billing     |   |     Sharing     |   |    Knowledge     |
+-----------------+   +--------+--------+   +---------+--------+
                                  |                    |
                                  v                    v
                            +-----------------+   +------------------+
                            |  Marketplace    |   |  Agent/Automation|
                            +-----------------+   +------------------+
                                     |                    |
                                     v                    v
                                  +----------------------------+
                                  | Search / Analytics / Audit |
                                  +----------------------------+

Integration rules:
- All integration is via Domain Events and Anti-Corruption Layers (ACL).
- Search/Analytics are read-only projections.
- Billing never blocks core editing; it gates premium execution.

--------------------------------------------------------------------------------
## 5. Bounded Contexts (Domain Models)

### 5.1 Workspace Context (Supporting/Core)
Purpose: Tenant boundary, membership, policies, and workspace metadata.

Aggregates:
- Workspace (root)
- Member (entity)
- Policy (value object)

Invariants:
- Workspace must always have at least one Owner.
- Role changes require admin authority.

Commands:
- CreateWorkspace, InviteMember, ChangeRole, RemoveMember, UpdatePolicy

Events:
- WorkspaceCreated, MemberInvited, MemberRoleChanged, MemberRemoved

Read Models:
- WorkspaceSummaryView, MemberListView

---
### 5.2 Canvas Context (Core)
Purpose: Authoring and versioning of visual canvases.

Aggregates:
- Canvas (root)
  - Nodes (entity)
  - Connections (entity)
  - Groups (entity)
  - CanvasSettings (value object)

Invariants:
- Node IDs are unique within a canvas.
- Connections refer to existing nodes.
- Version sequence is monotonic and immutable.

Commands:
- CreateCanvas, UpdateCanvas, RenameCanvas, ArchiveCanvas
- ApplyCanvasPatch, SaveCanvasVersion

Events:
- CanvasCreated, CanvasRenamed, CanvasUpdated, CanvasArchived
- CanvasVersionSaved

Read Models:
- CanvasListView, CanvasDetailView, CanvasThumbnailView

---
### 5.3 Collaboration Context (Core)
Purpose: Real-time and offline-safe collaboration.

Aggregates:
- DocSession (root)
- Presence (entity)

Invariants:
- CRDT ops are monotonic and commutative.
- Sessions are stateless; recoverable from event log.

Commands:
- OpenSession, ApplyOperation, UpdatePresence, CloseSession

Events:
- SessionOpened, DocOperationAppended, PresenceUpdated, SessionClosed

Read Models:
- PresenceView, CollaborationHealthView

---
### 5.4 Sharing & Publishing Context (Supporting)
Purpose: Public access and template discovery.

Aggregates:
- ShareLink (root)
- Publication (root)

Invariants:
- If is_public is false, the share link is invalid.
- Publication implies is_public and is_listed.

Commands:
- EnableShare, DisableShare, PublishTemplate, UnpublishTemplate

Events:
- ShareEnabled, ShareDisabled, TemplatePublished, TemplateUnpublished

Read Models:
- PublicCanvasView, TemplateListingView

---
### 5.5 Knowledge Context (Core Supporting)
Purpose: Ingest and manage knowledge sources for agents/canvases.

Aggregates:
- KnowledgeSource (root)
- IngestionJob (root)

Invariants:
- Each IngestionJob is idempotent and traceable.
- Source content is immutable once ingested; updates create new version.

Commands:
- RegisterSource, StartIngestion, RetryIngestion, RemoveSource

Events:
- SourceRegistered, IngestionQueued, IngestionSucceeded, IngestionFailed

Read Models:
- KnowledgeIndexView, KnowledgeStatusView

---
### 5.6 Agent/Automation Context (Core)
Purpose: AI agents, tools, and runs.

Aggregates:
- Agent (root)
- AgentRun (root)
- ToolInvocation (entity)

Invariants:
- AgentRun is append-only; results are immutable.
- ToolInvocation must belong to a run.

Commands:
- CreateAgent, UpdateAgent, StartRun, StopRun, RetryRun

Events:
- AgentCreated, AgentUpdated, AgentRunStarted, ToolInvoked,
  AgentRunCompleted, AgentRunFailed

Read Models:
- AgentListView, AgentRunHistoryView

---
### 5.7 Billing Context (Supporting)
Purpose: Entitlements and usage accounting.

Aggregates:
- Subscription (root)
- Entitlement (value object)
- UsageLedger (append-only)

Invariants:
- Ledger is immutable.
- Entitlements derive from subscription state only.

Commands:
- StartSubscription, ChangePlan, RecordUsage, RefundUsage

Events:
- SubscriptionStarted, PlanChanged, UsageRecorded, UsageRefunded

Read Models:
- BillingSummaryView, UsageHistoryView

---
### 5.8 Marketplace Context (Supporting)
Purpose: Discovery and installation of agent/skills.

Aggregates:
- Listing (root)
- ListingVersion (entity)

Invariants:
- Versions are immutable once published.
- Compatibility must be validated before installation.

Commands:
- PublishListing, DeprecateListing, InstallListing

Events:
- ListingPublished, ListingDeprecated, ListingInstalled

Read Models:
- MarketplaceSearchView

---
### 5.9 Search/Analytics/Audit Context (Generic)
Purpose: Read-only projections for fast search and analytics.

Aggregates:
- SearchIndexProjection (not a true domain aggregate)

Events Consumed:
- All core events relevant to search and analytics.

--------------------------------------------------------------------------------
## 6. Architecture Layers (Hexagonal)

1) Domain Layer (pure)
   - Entities, Value Objects, Aggregates, Domain Services, Domain Events
   - No IO, no framework dependencies

2) Application Layer
   - Use cases, orchestration, transaction boundaries
   - Publishes domain events

3) Infrastructure Layer
   - Repositories, DB adapters, message brokers, caches
   - External service integrations

4) Interface Layer
   - HTTP APIs (BFF), WebSocket, CLI, background worker

--------------------------------------------------------------------------------
## 7. Eventing & Consistency

### 7.1 Event Envelope (Canonical)
```json
{
  "event_id": "uuid",
  "event_type": "CanvasUpdated",
  "schema_version": 1,
  "occurred_at": "2026-02-04T12:00:00Z",
  "aggregate_id": "canvas_123",
  "aggregate_type": "Canvas",
  "tenant_id": "workspace_abc",
  "actor_id": "user_456",
  "payload": { "...": "..." }
}
```

### 7.2 Outbox Pattern
- Every write transaction inserts domain events into an outbox table.
- A relay publishes outbox events to the message bus.
- Consumers use idempotency keys to avoid duplicates.

### 7.3 Consistency Model
- Intra-aggregate: strong consistency.
- Inter-aggregate/inter-context: eventual consistency via events.

### 7.4 Sagas / Process Managers
- Long-running processes (e.g., Knowledge ingestion, Agent runs)
  are modeled as Sagas with compensations.

--------------------------------------------------------------------------------
## 8. Data Model (Storage Strategy)

Primary DB: PostgreSQL (per-tenant partitioning or schema-based isolation).
Object Store: S3-compatible for large assets.
Vector Store: pgvector or dedicated vector DB.
Event Bus: Kafka/NATS (event streaming).
Search: OpenSearch/Meilisearch (read projections).

### 8.1 Core Tables (examples)

Canvas:
- canvases(id, workspace_id, title, doc, version, created_at, updated_at)
- canvas_versions(id, canvas_id, version, doc, created_at)
- canvas_events(id, canvas_id, event_type, payload, created_at)

Collaboration:
- doc_sessions(id, canvas_id, started_at, ended_at)
- doc_ops(id, session_id, op, seq, created_at)
- presence(id, session_id, user_id, status)

Sharing:
- share_links(id, canvas_id, is_public, token, created_at)
- publications(id, canvas_id, listed_at, author_display_name)

Agent:
- agents(id, workspace_id, name, config)
- agent_runs(id, agent_id, status, started_at, ended_at)
- tool_invocations(id, run_id, tool_name, input, output)

Knowledge:
- knowledge_sources(id, workspace_id, type, config)
- ingestion_jobs(id, source_id, status, attempt, started_at, ended_at)

Billing:
- subscriptions(id, workspace_id, plan, status, started_at)
- entitlements(id, subscription_id, limits)
- usage_ledger(id, workspace_id, type, units, created_at)

Outbox:
- domain_outbox(id, event_type, payload, created_at, published_at)

Indexes:
- All tables indexed by (workspace_id, updated_at)
- Time-based indexes for event/ledger tables

--------------------------------------------------------------------------------
## 9. API Contracts (BFF / HTTP)

Principles:
- APIs expose use cases, not raw persistence operations.
- All write APIs are idempotent (Idempotency-Key header).
- All responses are user-facing and never leak infra details.

Example Endpoints:
- POST /api/canvas/create
- POST /api/canvas/update
- POST /api/canvas/share/enable
- POST /api/agent/run
- POST /api/knowledge/ingest
- GET  /api/workspace/summary

Each endpoint calls Application Use Case and emits domain events.

--------------------------------------------------------------------------------
## 10. Frontend Architecture (DDD-Aligned)

1) BFF per client (Web/Mobile)
   - Aggregates UI-specific responses from multiple contexts.

2) Domain Stores
   - Each context has its own client-side state store.
   - All state transitions are driven by use-case responses.

3) Local-first and Offline
   - Write operations enqueue locally and replay on reconnect.
   - CRDT for live collaboration state.

4) UI Policy
   - Never show raw errors or IDs.
   - Always show action result first (links, outputs, confirmations).

--------------------------------------------------------------------------------
## 11. Anti-Fragility & Edge Cases

- Offline edits: queued and merged via CRDT.
- Duplicate requests: idempotency store and dedupe keys.
- Large canvases: chunked rendering, viewport culling, lazy hydration.
- Network partition: local-first buffer; eventual convergence.
- Event storms: rate limiting, circuit breakers, and priority queues.
- Cross-region latency: active-active replication with conflict-free merging.
- Data corruption: snapshot validation + event replay recovery.

--------------------------------------------------------------------------------
## 12. Testing Strategy

- Domain unit tests for invariants (fast, deterministic).
- Property-based tests for CRDT merge correctness.
- Contract tests for events and API schemas.
- E2E flows for: create canvas -> collaborate -> share -> replay.
- Chaos tests (fault injection, partial outages).

--------------------------------------------------------------------------------
## 13. Migration & Rollout Plan

Phase 0: Domain scaffolding + Outbox
Phase 1: Canvas context refactor under feature flag
Phase 2: Collaboration context refactor (CRDT baseline)
Phase 3: Sharing and Publishing context
Phase 4: Agent and Knowledge contexts
Phase 5: Billing/Marketplace decoupling
Phase 6: Read model projection services

All phases are backward compatible until cutover.

--------------------------------------------------------------------------------
## 14. Implementation Checklist (Ready to Execute)

1) Create bounded context modules in backend:
   - backend/core/domains/{workspace,canvas,collaboration,sharing,knowledge,agent,billing,marketplace}
2) Define domain models and invariants.
3) Implement application use cases with transaction boundaries.
4) Add Outbox + Event Relay.
5) Implement adapters for DB, message bus, object store.
6) Build read model projections (search, listing, summaries).
7) Add BFF endpoints for core use cases.
8) Add client-side domain stores and offline queue.
9) Add property-based tests for CRDT and invariants.
10) Add chaos test harness and rollback playbooks.

--------------------------------------------------------------------------------
## 15. Approval Gate

Once this document is approved:
- Implementation starts at Phase 0 (Domain scaffolding + Outbox).
- All new features must be implemented inside a bounded context.
- Legacy direct data access is deprecated and removed incrementally.

--------------------------------------------------------------------------------
## Appendix A: Recommended Code Layout (Backend)

backend/
  core/
    domains/
      canvas/
        model/
        services/
        events/
        repository_ports/
      collaboration/
      agent/
      knowledge/
      sharing/
      workspace/
      billing/
      marketplace/
    application/
      use_cases/
      dtos/
    infrastructure/
      repositories/
      event_bus/
      storage/
    interfaces/
      http/
      websocket/
      workers/

--------------------------------------------------------------------------------
## Appendix B: Recommended Code Layout (Frontend)

frontend/src/
  domains/
    canvas/
    collaboration/
    agent/
    knowledge/
    sharing/
    workspace/
    billing/
  application/
    use-cases/
  infrastructure/
    api/
    storage/
    sync/
  ui/
    components/
    pages/

--------------------------------------------------------------------------------
## Appendix C: Definition of Done

- Domain invariants are enforced in domain layer.
- All writes emit events through Outbox.
- Frontend uses use cases, not raw API calls.
- Local-first editing works offline and merges safely.
- Automated tests cover invariants and edge cases.
