# Canvas 企业级架构清债计划（执行版）

状态：`approved-kickoff`  
Owner：`Architecture + Platform + Canvas`  
最后更新：`2026-02-19`

---

## 1. 目标与边界

本计划用于把当前 Canvas 从“可用但高耦合”升级到“企业级可持续演进架构”。

### 1.1 最终目标（North Star）

1. **单一写入真相源（Single Writer）**：所有画布写操作只走一条权威写路径。
2. **单一协议真相源（Single Contract Source）**：操作语义（ops）只定义一次，三端共享。
3. **DDD 边界清晰**：业务规则在领域层，接口层只做协议适配。
4. **反脆弱运行能力**：冲突、重试、降级、回放、审计均可验证。
5. **可观测可回滚**：关键链路可追踪，发布可灰度，故障可快速回滚。

### 1.2 本计划覆盖范围

- `backend/core/canvas/*`
- `backend/core/application/use_cases/canvas/*`
- `backend/core/application/use_cases/collaboration/*`
- `services/canvas-realtime/src/*`
- `frontend/src/canvas/*`
- `frontend/src/lib/canvas/realtime/*`
- `frontend/src/app/api/canvases/*`

---

## 2. 当前关键架构债（必须一次性治理）

### 2.1 语义重复（最高优先）

同一 ops 语义在以下位置重复实现：

- `backend/core/canvas/ops_normalization.py`
- `backend/core/tools/canvas_edit_tool.py`
- `services/canvas-realtime/src/ops/applyCanvasOps.js`
- `frontend/src/lib/canvas/realtime/applyOpsToYDoc.ts`

这会导致：行为漂移、边界条件不一致、修复成本乘法增长。

### 2.2 超级路由（高优先）

- `backend/core/canvas/api.py` 集中承载 CRUD、协作、分享、AI、媒体等职责。

这会导致：团队并行冲突高、回归面过大、审查难。

### 2.3 写路径双轨并存（高优先）

- realtime path 与 legacy path 并存，长期增加排障复杂度。

### 2.4 前端状态层过载（高优先）

- `frontend/src/canvas/stores/canvas.store.ts` 同时承担 UI 状态、命令编排、冲突重试、持久化策略。

---

## 3. 企业级目标架构（Target Blueprint）

### 3.1 Bounded Context 划分

1. **Canvas Core Context**
   - 聚合：Canvas / Node / Connection
   - 负责：结构不变式、版本语义、操作合法性

2. **Collaboration Context**
   - 聚合：CollaborationSession / OperationBatch
   - 负责：会话、并发、回放、presence 事件

3. **Sharing & Public Context**
   - 聚合：SharePolicy / Invite / PublicProjection
   - 负责：分享策略、公开访问边界

4. **Canvas AI Extension Context**
   - 聚合：AIEditTask / GenerationTask
   - 负责：AI 工作流与 Canvas Core 解耦

5. **Workspace Projection Context**
   - 负责：workspace 列表、meta、patch 投影

### 3.2 分层约束（硬约束）

- `interfaces` 只能依赖 `application`。
- `application` 只能依赖 `domains` 与 `ports`。
- `domains` 不得依赖 `infrastructure`。
- `infrastructure` 只实现 ports，不承载业务规则。

### 3.3 协议治理

- 建立 `Canvas Operation Protocol v1` 作为唯一契约源。
- 三端通过同一 schema + contract test 验证，不允许手写分叉语义。

---

## 4. 迁移阶段（24 周）

## Phase 0（第 1-2 周）：治理启动 + 基线冻结

### 目标

- 建立迁移治理机制与验收门槛。
- 冻结高风险路径新增功能。

### 交付物

1. 架构决策记录（ADR）模板与首批 ADR。
2. 迁移看板（Epic / Milestone / Risk Register）。
3. 链路基线指标（open/apply/import/snapshot）。

### 验收

- 有可审计的架构决策链。
- 有可对比的性能/错误基线。

---

## Phase 1（第 3-6 周）：协议统一（Contract First）

### 目标

- 统一 ops 契约、错误语义、并发语义。

### 交付物

1. `canvas-ops-contract`（schema、错误码、兼容策略）。
2. contract tests：backend / realtime / frontend 全覆盖。
3. 兼容适配层（旧字段映射到新协议）。

### 验收

- 三端对同一输入产生一致输出。
- 协议变更必须经过版本门禁。

---

## Phase 2（第 7-12 周）：后端职责拆分 + 单一写入入口

### 目标

- 将 `backend/core/canvas/api.py` 按上下文拆分。
- 所有写操作统一经应用服务编排。

### 交付物

1. 新接口层目录（`interfaces/http/canvas/*`）与路由拆分。
2. 应用服务层（CanvasCommandApplicationService / CanvasQueryService）。
3. legacy path 进入 deprecation 状态（仅保留回滚窗口）。

### 验收

- 写路径唯一，冲突处理一致。
- API 回归测试全绿。

### 当前执行进展（`2026-02-19`）

- 已完成接口层路由拆分：`command/query/share/ai`。
- 已完成 command 应用服务主编排下沉：`CanvasCommandApplicationService`。
- 已完成 query 应用服务实化：`CanvasQueryService` 承载查询读路径。
- 已完成 query 应用服务依赖去耦：通过 `CanvasQueryDependencies` 显式注入依赖，移除对 `legacy api` 的直接 import。
- 已完成 command/share/ai 服务依赖注入统一化（与 query 同级风格）。
- 已完成低风险冗余精简：删除 `canvas/api.py` 纯转发函数，收敛 service 命名与绑定 provider。
- 已补齐接口层 E2E + frontend normalizer + 三端 parity/fuzz 测试。
- 已完成回归门禁验证：backend suite `41 passed`，frontend type-check `pass`。

---

## Phase 3（第 13-18 周）：Realtime 工程化

### 目标

- realtime 具备企业级可靠性保障。

### 交付物

1. 集成测试：`/apply` `/import` `/snapshot` 幂等/冲突/重放。
2. 压测报告：并发编辑、抖动网络、Redis 短暂故障。
3. 故障注入与自动恢复策略（backpressure/retry/jitter）。

### 验收

- 在故障注入下满足 SLO。
- 无不可恢复数据分叉。

---

## Phase 4（第 19-24 周）：前端状态体系重构 + 债务清算

### 目标

- store 从“全能层”拆为“命令层 + 视图层 + 同步层”。

### 交付物

1. `canvas-command-pipeline`（命令执行与冲突策略）。
2. `canvas-view-store`（纯 UI 状态）。
3. 删除遗留分支与特性开关，完成债务归档。

### 验收

- 关键页面交互无感迁移。
- 代码复杂度与变更风险显著下降。

---

## 5. 文件级迁移矩阵（从哪里拆）

### 5.1 Backend

- 现状入口：`backend/core/canvas/api.py`
- 目标拆分：
  - `backend/core/interfaces/http/canvas/query_routes.py`
  - `backend/core/interfaces/http/canvas/command_routes.py`
  - `backend/core/interfaces/http/canvas/share_routes.py`
  - `backend/core/interfaces/http/canvas/ai_routes.py`
- 应用服务：
  - `backend/core/application/services/canvas_command_application_service.py`
  - `backend/core/application/services/canvas_query_service.py`

### 5.2 Realtime

- 现状入口：`services/canvas-realtime/src/index.js`
- 目标拆分：
  - `services/canvas-realtime/src/http/applyRoute.js`
  - `services/canvas-realtime/src/http/importRoute.js`
  - `services/canvas-realtime/src/http/snapshotRoute.js`
  - `services/canvas-realtime/src/domain/opsEngine.js`

### 5.3 Frontend

- 现状入口：`frontend/src/canvas/stores/canvas.store.ts`
- 目标拆分：
  - `frontend/src/canvas/stores/canvas-view.store.ts`
  - `frontend/src/canvas/application/canvas-command-pipeline.ts`
  - `frontend/src/canvas/application/canvas-persistence-orchestrator.ts`
  - `frontend/src/canvas/realtime/canvas-sync-adapter.ts`

---

## 6. SLO / KPI（企业级门槛）

### 6.1 可用性与正确性

- `apply` 成功率：`>= 99.95%`
- 错误幂等重试后最终成功率：`>= 99.99%`
- 冲突后恢复成功率：`>= 99.9%`

### 6.2 性能

- `apply` p95：`< 200ms`
- `snapshot` p95：`< 250ms`
- 首屏可编辑时间（TTI-like）：`< 2.0s`

### 6.3 运维

- MTTR：`< 30 分钟`
- 重大事故复盘闭环：`100%`

---

## 7. 组织与职责（建议配置）

- **Architecture Owner**：边界与决策守门。
- **Backend Lead**：命令服务/路由拆分/一致性策略。
- **Realtime Lead**：并发语义/持久化可靠性/压测。
- **Frontend Lead**：状态层分层与迁移兼容。
- **QA/SRE**：契约测试、故障注入、发布演练。

---

## 8. 发布与回滚策略

1. **Feature Flag 分层**：协议层、写路径层、前端状态层分别开关。
2. **灰度规则**：先内部 workspace，再小流量租户，最后全量。
3. **回滚原则**：保留至少一个稳定版本窗口，支持一键切回。
4. **审计要求**：所有写请求保留 request-id / idempotency-key / serverVersion 链路。

---

## 9. 即刻开工清单（本周）

### Day 1-2

- 锁定 baseline 指标：open/apply/import/snapshot（成功率、p95、冲突率）
- 建立迁移看板：Epic、风险、依赖、里程碑

### Day 3-4

- 冻结高风险新增功能（仅允许 bugfix）
- 定义 `Canvas Operation Protocol v1` 的“唯一源目录与版本策略”

### Day 5-7

- 补齐 contract tests 骨架（backend/realtime/frontend）
- 明确第一批拆分目标文件与回滚路径

### Day 8-10

- 发布首个灰度版本（协议兼容层上线）
- 输出第一轮基线对比报告（before/after）

---

## 10. 完成定义（Definition of Done）

本计划完成时，必须同时满足：

1. Canvas 写路径仅一条权威链路。
2. ops 语义仅一份契约源，三端无分叉实现。
3. 路由层不再承载业务编排。
4. realtime 具备可回放、可压测、可故障注入验证能力。
5. 前端状态层职责单一，协作与持久化逻辑解耦。
6. 关键 SLO 全部达标并持续观测。

---

## 11. 本文档与现有文档关系

- 本文档是“执行编排蓝图”。
- 详细 DDD 理论与背景见：`docs/zmind-ddd-migration-roadmap.md`。
- 现有 Canvas 合同资产见：`docs/canvas-contract-v1/`。

后续所有清债 PR 必须引用本文件中的阶段、任务和验收条款。
