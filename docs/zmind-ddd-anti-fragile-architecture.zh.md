# Zmind DDD 反脆弱系统架构与实施规范（中文版）

状态：草案（待评审）
Owner：Architecture
最后更新：2026-02-04

本文件定义 Zmind 的完整、可立即进入开发的系统架构方案，基于
领域驱动设计（DDD）、六边形架构、事件驱动与反脆弱设计。
业务逻辑与基础设施彻底解耦，系统可在极端边界条件下稳定运行。

--------------------------------------------------------------------------------
## 0. 执行摘要

Zmind 是一款视觉思维画布 + AI 协作系统。本规范将系统拆分为清晰的
有界上下文，所有业务逻辑只存在于纯领域模块；IO 与外部依赖通过端口隔离。
系统具备离线协作、故障降级、事件回放、自愈能力，可应对大规模画布、
网络分区、重复请求与数据漂移。

--------------------------------------------------------------------------------
## 1. 目标与非目标

### 目标
1) 业务逻辑与基础设施完全解耦。
2) 每个领域有清晰有界上下文与统一语言。
3) 系统具备反脆弱性：故障会降级，而不是整体失败。
4) 极端边界与高负载下依旧可预测、可恢复。
5) 文档可直接进入开发，包含端口、事件与模块边界。
6) 架构可演进，支持未来拆分为独立服务。

### 非目标
- 不提供像素级 UI 设计稿。
- 不要求一次性替换现有 UI 流程，提供平滑迁移路径。
- 不指定具体云厂商，除非对不变式/反脆弱性有刚性依赖。

--------------------------------------------------------------------------------
## 2. 设计原则

1) DDD 优先：业务语言统一、模型稳定。
2) 六边形架构：领域纯净，外部通过端口进入。
3) 事件驱动：跨上下文只通过领域事件通信。
4) CQRS：写模型保证一致性，读模型服务体验与性能。
5) Local-first + CRDT：协作冲突天然收敛。
6) 反脆弱默认：故障优雅降级、可恢复。
7) 行为确定性：同输入、同输出。

--------------------------------------------------------------------------------
## 3. 统一语言（核心术语）

- Workspace：租户边界，包含用户、策略与订阅。
- Canvas：画布文档，包含节点与连接关系。
- Node：画布元素（文本、待办、媒体、代码、链接等）。
- Connection：节点之间的连接。
- Canvas Version：画布历史快照。
- Share Link：公共只读访问链接。
- Publication：模板发布（可被发现）。
- Agent：可配置 AI 工作者。
- Agent Run：单次执行实例。
- Knowledge Source：外部或内部知识源。
- Ingestion Job：知识入库流程实例。
- Entitlement：权限与额度能力。
- Usage Ledger：不可变计费账本。
- Domain Event：领域事件（事实）。

--------------------------------------------------------------------------------
## 4. 上下文地图（Context Map）

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

集成规则：
- 跨上下文全部用领域事件 + ACL（Anti‑Corruption Layer）。
- Search/Analytics 只读投影，不反写业务。
- Billing 不能阻断画布编辑，只能约束高级能力。

--------------------------------------------------------------------------------
## 5. 有界上下文（核心领域模型）

### 5.1 Workspace（支持/核心）
用途：租户、成员、策略。

聚合：
- Workspace（根）
- Member（实体）
- Policy（值对象）

不变式：
- Workspace 必须至少有一名 Owner。
- 角色变更需管理员权限。

命令：
- CreateWorkspace, InviteMember, ChangeRole, RemoveMember, UpdatePolicy

事件：
- WorkspaceCreated, MemberInvited, MemberRoleChanged, MemberRemoved

读模型：
- WorkspaceSummaryView, MemberListView

---
### 5.2 Canvas（核心）
用途：画布编辑与版本。

聚合：
- Canvas（根）
  - Nodes（实体）
  - Connections（实体）
  - Groups（实体）
  - CanvasSettings（值对象）

不变式：
- Node ID 在画布内唯一。
- Connection 必须指向已存在节点。
- 版本序列不可逆且单调递增。

命令：
- CreateCanvas, UpdateCanvas, RenameCanvas, ArchiveCanvas
- ApplyCanvasPatch, SaveCanvasVersion

事件：
- CanvasCreated, CanvasRenamed, CanvasUpdated, CanvasArchived
- CanvasVersionSaved

读模型：
- CanvasListView, CanvasDetailView, CanvasThumbnailView

---
### 5.3 Collaboration（核心）
用途：实时/离线协作。

聚合：
- DocSession（根）
- Presence（实体）

不变式：
- CRDT 操作单调、可交换。
- 会话可从事件日志恢复。

命令：
- OpenSession, ApplyOperation, UpdatePresence, CloseSession

事件：
- SessionOpened, DocOperationAppended, PresenceUpdated, SessionClosed

读模型：
- PresenceView, CollaborationHealthView

---
### 5.4 Sharing & Publishing（支持）
用途：公开分享与模板发布。

聚合：
- ShareLink（根）
- Publication（根）

不变式：
- is_public 为 false 时 ShareLink 无效。
- Publication 必须同时 is_public 与 is_listed。

命令：
- EnableShare, DisableShare, PublishTemplate, UnpublishTemplate

事件：
- ShareEnabled, ShareDisabled, TemplatePublished, TemplateUnpublished

读模型：
- PublicCanvasView, TemplateListingView

---
### 5.5 Knowledge（支持/核心）
用途：知识入库与索引。

聚合：
- KnowledgeSource（根）
- IngestionJob（根）

不变式：
- IngestionJob 幂等、可追溯。
- 知识源更新以新版本形式保存。

命令：
- RegisterSource, StartIngestion, RetryIngestion, RemoveSource

事件：
- SourceRegistered, IngestionQueued, IngestionSucceeded, IngestionFailed

读模型：
- KnowledgeIndexView, KnowledgeStatusView

---
### 5.6 Agent/Automation（核心）
用途：AI 代理与工具执行。

聚合：
- Agent（根）
- AgentRun（根）
- ToolInvocation（实体）

不变式：
- AgentRun 只增不改。
- ToolInvocation 必须归属 AgentRun。

命令：
- CreateAgent, UpdateAgent, StartRun, StopRun, RetryRun

事件：
- AgentCreated, AgentUpdated, AgentRunStarted, ToolInvoked,
  AgentRunCompleted, AgentRunFailed

读模型：
- AgentListView, AgentRunHistoryView

---
### 5.7 Billing（支持）
用途：额度与用量账本。

聚合：
- Subscription（根）
- Entitlement（值对象）
- UsageLedger（追加型）

不变式：
- 账本不可变。
- 权限完全由订阅状态推导。

命令：
- StartSubscription, ChangePlan, RecordUsage, RefundUsage

事件：
- SubscriptionStarted, PlanChanged, UsageRecorded, UsageRefunded

读模型：
- BillingSummaryView, UsageHistoryView

---
### 5.8 Marketplace（支持）
用途：代理/技能市场。

聚合：
- Listing（根）
- ListingVersion（实体）

不变式：
- 已发布版本不可修改。
- 安装前必须通过兼容性校验。

命令：
- PublishListing, DeprecateListing, InstallListing

事件：
- ListingPublished, ListingDeprecated, ListingInstalled

读模型：
- MarketplaceSearchView

---
### 5.9 Search/Analytics/Audit（通用）
用途：只读搜索与分析投影。

事件消费：
- 消费所有核心域相关事件。

--------------------------------------------------------------------------------
## 6. 架构分层（Hexagonal）

1) Domain 层（纯）
   - 实体、值对象、聚合、领域服务、领域事件
   - 不依赖框架/IO

2) Application 层
   - 用例、事务边界、流程编排
   - 发布领域事件

3) Infrastructure 层
   - Repository、DB 适配、消息中间件、缓存

4) Interface 层
   - HTTP/BFF、WebSocket、CLI、Worker

--------------------------------------------------------------------------------
## 7. 事件与一致性

### 7.1 事件信封（Canonical）
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

### 7.2 Outbox 模式
- 写事务中同时写 outbox。
- relay 异步发布到消息总线。
- 消费侧使用幂等键去重。

### 7.3 一致性模型
- 聚合内强一致。
- 跨上下文最终一致。

### 7.4 Saga/Process Manager
- 知识入库、Agent 运行等流程用 Saga 编排。

--------------------------------------------------------------------------------
## 8. 数据策略（存储组合）

Primary DB: PostgreSQL
Object Store: S3 兼容
Vector Store: pgvector 或独立向量库
Event Bus: Kafka/NATS
Search: OpenSearch/Meilisearch

### 核心表（示例）
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

--------------------------------------------------------------------------------
## 9. API 合约（BFF / HTTP）

原则：
- API 暴露用例，而不是直接暴露存储。
- 写入 API 必须幂等（Idempotency-Key）。
- 返回仅面向用户，不泄漏内部错误细节。

示例：
- POST /api/canvas/create
- POST /api/canvas/update
- POST /api/canvas/share/enable
- POST /api/agent/run
- POST /api/knowledge/ingest
- GET  /api/workspace/summary

--------------------------------------------------------------------------------
## 10. 前端架构（DDD 对齐）

1) BFF 层
   - Web/Mobile 各自聚合用例响应。

2) Domain Stores
   - 每个上下文独立 store，状态只来自用例响应。

3) 本地优先
   - 操作离线排队，重连后合并。
   - CRDT 保障协作一致性。

4) UI 策略
   - 不显示技术细节。
   - “结果优先”。

--------------------------------------------------------------------------------
## 11. 反脆弱与极端边界

- 离线编辑：本地队列 + CRDT 合并。
- 重复请求：幂等键 + 去重存储。
- 大画布：分块渲染、视口裁剪、延迟加载。
- 网络分区：本地继续，恢复后收敛。
- 事件风暴：限流、断路器、隔离。
- 跨区延迟：主动-主动 + 冲突收敛。
- 数据漂移：事件重放 + 校验修复。

--------------------------------------------------------------------------------
## 12. 测试策略

- 领域单元测试：不变式。
- 性质测试：CRDT 合并、幂等性。
- 契约测试：事件与 API Schema。
- 端到端：创建画布 -> 协作 -> 分享 -> 回放。
- Chaos：故障注入与恢复演练。

--------------------------------------------------------------------------------
## 13. 迁移与落地计划

Phase 0：领域模块 + Outbox
Phase 1：Canvas 上下文重构（feature flag）
Phase 2：Collaboration（CRDT baseline）
Phase 3：Sharing & Publishing
Phase 4：Agent/Knowledge
Phase 5：Billing/Marketplace 解耦
Phase 6：读模型投影服务

--------------------------------------------------------------------------------
## 14. 实施清单（可直接开发）

1) 建立后端领域目录：
   - backend/core/domains/{workspace,canvas,collaboration,sharing,knowledge,agent,billing,marketplace}
2) 定义聚合、值对象与不变式。
3) 应用层用例与事务边界。
4) Outbox + 事件总线。
5) 基础设施适配器：DB、对象存储、消息。
6) 读模型投影服务。
7) BFF 用例 API。
8) 客户端 domain store + 离线队列。
9) CRDT 性质测试与不变式测试。
10) Chaos 测试与回滚预案。

--------------------------------------------------------------------------------
## 15. 审批门槛

文档通过后：
- 进入 Phase 0（领域模块 + Outbox）。
- 新功能必须在对应上下文内实现。
- 旧式直连存储逻辑逐步废弃。

--------------------------------------------------------------------------------
## 附录 A：后端推荐代码结构

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
## 附录 B：前端推荐代码结构

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
## 附录 C：完成定义（Definition of Done）

- 领域不变式由领域层保证。
- 所有写操作通过 Outbox 发布事件。
- 前端只调用用例，不直连数据表。
- 离线编辑可用且可收敛。
- 自动化测试覆盖不变式与边界。
