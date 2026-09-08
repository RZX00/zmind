# 2026-03-01 Trigger 完全对齐旧仓最新实现：上线实施总方案

## 1. 目标与结论

目标：在当前仓库 `zmind` 中，实现与旧仓最新基线 **`upstream/main@a081feaa4`** 的 Trigger 能力完全对齐，并具备可验收、可灰度、可回滚、可生产上线能力。

结论：采用“**语义对齐旧 Trigger，调度底座升级为 QStash**”路线最稳妥。

- 业务语义：对齐旧仓 `core/triggers`。
- 基础设施：不回退旧 pg_cron 路线，改为 `ScheduleProviderPort -> Upstash QStash`。
- 发布策略：分阶段双轨 + feature flag + 可观测性门禁。

---

## 2. 对齐基准（Scope Baseline）

```text
Legacy baseline (source of truth):
  repo: upstream/main
  commit: a081feaa4

Current target repo:
  repo: /mnt/e/app/zmind
  date: 2026-03-01
```

验收按“行为一致”判定，不按“代码文本一致”判定。

---

## 3. 验收定义（Definition of Acceptance）

必须全部满足：

1. `/api/triggers/*` 全部可用（CRUD、toggle、run history、test fire）。
2. Schedule Trigger 可创建/暂停/恢复/删除，触发时间与时区行为和旧仓一致。
3. Event Trigger（Composio）可创建，webhook 可去重、匹配、入队、执行。
4. Agent 运行时可调用 `trigger_tool` 全部方法并成功落地。
5. 前端 Trigger 页面恢复旧仓核心体验（向导、详情、运行历史、错误反馈）。
6. 账号隔离与权限边界严格成立（agent/profile/trigger 均 account-scoped）。
7. 生产灰度期 SLO 达标（见第 11 节），并通过回滚演练。

---

## 4. 差距矩阵（Current vs Target）

```text
+----+ 能力项                                + 当前状态(2026-03-01)             + 目标状态                         + 主要动作
+----+---------------------------------------+-----------------------------------+----------------------------------+----------------------------------------------+
| G1 | Legacy trigger API (/api/triggers)    | 已移除/禁用                        | 全量恢复                          | 恢复 core/triggers/api.py 并接入 backend/api |
| G2 | Legacy trigger domain/service          | 不存在                            | 与旧仓语义一致                    | 回迁 trigger_service/provider/execution       |
| G3 | Schedule backend                        | automation tick 路径，非旧语义      | 旧语义 + QStash 调度底座          | 新建 ScheduleProviderPort + QStash adapter    |
| G4 | Composio create/webhook 编排           | 走 automation 语义                 | 走 legacy trigger 语义            | 重建 trigger-centric orchestrator             |
| G5 | Agent trigger_tool runtime             | 配置声明有，运行时无               | 7 个方法全可调用                  | 恢复/重写 trigger tool adapter                |
| G6 | Trigger UI                              | automation 管理页                  | 旧仓触发器完整产品体验            | 回迁 apps/frontend trigger 组件到 frontend    |
| G7 | 旧表结构(agent_triggers/trigger logs) | 未启用                             | 全量可用 + 数据迁移/回填          | 新增迁移 + 双写 + 校验脚本                    |
| G8 | 安全边界(account scope)                | 存在 profile 越权风险点             | 全链路 account 约束               | 统一 ownership guard                          |
+----+---------------------------------------+-----------------------------------+----------------------------------+----------------------------------------------+
```

---

## 5. 目标架构（DDD + 反脆弱）

### 5.1 边界上下文

- `Trigger`（主业务上下文）：规则定义、状态流转、事件匹配、执行编排。
- `Agent Runtime`：负责启动 agent run，不承载 trigger 业务规则。
- `Composio Integration`：仅负责第三方连接与触发器实例同步。
- `Scheduling`（基础设施上下文）：提供“可靠到点触发”，不携带业务语义。

### 5.2 关键数据流

```text
                 (create)
UI/Agent Tool ------------------------------+
                                            v
                                      [Trigger API]
                                            |
                                            v
                                 [Trigger Application]
                                    |               |
                                    |               +--> [Composio Adapter] (event)
                                    |
                                    +--> [ScheduleProviderPort]
                                              |
                                              v
                                       [QStash Schedules]
                                              |
                               signed callback| (verify)
                                              v
                                 /api/triggers/internal/schedule/fire
                                              |
                                              v
                                    [Trigger Execution Service]
                                              |
                                              v
                                        [Start Agent Run]
```

反脆弱设计点：

1. 调度与业务解耦（provider 可替换）。
2. callback 签名验证 + 幂等键（防重放、防重复执行）。
3. 执行链带重试、死信、人工重放入口。

---

## 6. 文件级实施清单（必须修改/新增）

## 6.1 Backend

```text
1) 恢复并改造（以 upstream/main 为底稿）
- backend/core/triggers/api.py
- backend/core/triggers/trigger_service.py
- backend/core/triggers/provider_service.py
- backend/core/triggers/execution_service.py

2) 新增（调度抽象 + QStash 适配）
- backend/core/triggers/scheduling/ports.py
- backend/core/triggers/scheduling/qstash_provider.py
- backend/core/triggers/scheduling/signature.py

3) API 装配
- backend/api.py
  - 重新 include trigger router
  - 注册 schedule callback internal route

4) Composio 对齐改造
- backend/core/composio_integration/api.py
- backend/core/composio_integration/composio_profile_service.py
  - get_profile_config 必须 account-scoped

5) Runtime 工具恢复
- backend/core/tools/agent_builder_tools/trigger_tool.py
  或等价落位到当前 native adapter（但方法名与行为必须兼容旧仓）
- backend/core/langgraph_engine/tools/adapters/native_tool_adapter.py
- backend/core/langgraph_engine/tools/policy.py

6) 数据库迁移
- backend/supabase/migrations/20260301xxxxxx_trigger_legacy_parity.sql
- backend/supabase/migrations/20260301xxxxxx_trigger_legacy_backfill.sql
```

## 6.2 Frontend

```text
1) 触发器页面与组件（从 upstream/apps/frontend 对齐回迁）
- frontend/src/components/triggers/*
- frontend/src/components/agents/triggers/event-based-trigger-dialog.tsx
- frontend/src/app/(dashboard)/triggers/page.tsx
- frontend/src/app/(dashboard)/(teamAccount)/team/[accountSlug]/triggers/page.tsx
- frontend/src/app/[locale]/(dashboard)/(teamAccount)/team/[accountSlug]/triggers/page.tsx

2) Hook 与 API client 对齐
- frontend/src/hooks/react-query/triggers/*
- frontend/src/lib/api/triggers.ts (若不存在则新增)
```

---

## 7. 数据模型与迁移方案

## 7.1 目标表（Legacy Parity）

最小集合：

1. `agent_triggers`
2. `trigger_events`（原始入站事件）
3. `trigger_event_logs`（执行日志；若旧代码依赖该名必须提供）

关键约束：

- `agent_triggers(account_id, agent_id, is_active, trigger_type)` 组合索引。
- `trigger_events(provider, external_event_id)` 唯一键（幂等）。
- `trigger_event_logs(trigger_id, created_at desc)` 检索索引。

## 7.2 迁移阶段

```text
Phase M1: 建表与索引（不切流量）
Phase M2: 从 automations 回填到 agent_triggers（一次性脚本）
Phase M3: 双写（create/update/delete 同步写 old+new）
Phase M4: 验证一致性（每日对账）
Phase M5: 切主读到 legacy trigger 表
Phase M6: 稳定后下线双写
```

## 7.3 回填映射规则

```text
automations.trigger_type = schedule -> agent_triggers.trigger_type = schedule
automations.trigger_type = event    -> agent_triggers.trigger_type = event
automations.provider_binding_key    -> agent_triggers.provider_trigger_id
automations.config                  -> agent_triggers.config (字段映射/归一化)
```

---

## 8. 调度提供方：QStash 集成方案

## 8.1 为什么用 QStash（替代旧 pg_cron）

1. 可靠性与重试机制成熟，避免 DB 级定时任务耦合。
2. 更适合多环境与弹性部署。
3. 支持签名验证，便于零信任回调。

## 8.2 接口契约

创建 schedule：

- 输入：`trigger_id`, `cron_expression`, `timezone`, `callback_url`, `dedup_key`
- 输出：`provider_schedule_id`, `next_run_at`

暂停/恢复/删除：

- 输入：`provider_schedule_id`
- 输出：状态变更结果 + provider 原始响应摘要

callback 校验：

- 必须验证签名（`QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`）。
- 验签失败直接 `401`，不入队。

## 8.3 环境变量

```text
QSTASH_TOKEN=
QSTASH_BASE_URL=https://qstash.upstash.io
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
TRIGGER_INTERNAL_CALLBACK_BASE_URL=
```

---

## 9. 分阶段实施路线（可直接执行）

## Stage 0 - 冻结与基线（0.5 天）

1. 锁定对齐目标：`a081feaa4`。
2. 导出旧仓 Trigger API contract（请求/响应样例 + 错误语义）。
3. 建立 parity checklist（逐项打钩）。

退出条件：基线文档评审通过。

## Stage 1 - 后端功能恢复（2-3 天）

1. 回迁 `core/triggers` 核心服务。
2. 恢复 `/api/triggers/*` 路由与鉴权。
3. 加入 account ownership guard。

退出条件：本地 API contract tests 通过。

## Stage 2 - QStash 调度替换（1-2 天）

1. 落地 `ScheduleProviderPort`。
2. 实现 `qstash_provider` + 回调验签。
3. schedule create/pause/resume/delete 全流程跑通。

退出条件：schedule e2e（create->fire->run）稳定通过。

## Stage 3 - Composio 事件链对齐（1-2 天）

1. 将 create/webhook 编排切回 legacy trigger semantics。
2. 修复 profile account-scoped 读取。
3. 增加 webhook 幂等与去重日志。

退出条件：event e2e（webhook->match->execute）通过。

## Stage 4 - Agent Tool 对齐（1 天）

1. 暴露 7 个 trigger 方法。
2. `native_tools.trigger_tool` 开关生效。
3. 运行时 catalog 与 tool_groups 声明一致。

退出条件：对话内可创建/管理 trigger 并可执行。

## Stage 5 - 前端完整回迁（2 天）

1. 回迁 trigger 页面与向导。
2. 接口改回 `/api/triggers/*`。
3. i18n 与团队路由全覆盖。

退出条件：UI 验收脚本全部通过。

## Stage 6 - 数据迁移与灰度上线（2-3 天）

1. 建表 + 回填 + 双写。
2. 灰度 10% -> 30% -> 100%。
3. 达标后切主读并关闭双写。

退出条件：SLO 连续 48h 达标，无 P1/P0。

---

## 10. 测试与验收矩阵

```text
+----+ 场景                                       + 用例类型              + 通过标准
+----+--------------------------------------------+-----------------------+--------------------------------------+
| T1 | Trigger CRUD API contract                  | integration           | 与旧仓 contract 一致                 |
| T2 | Schedule create/pause/resume/delete        | integration + e2e     | provider 状态与本地状态一致           |
| T3 | QStash callback signature                  | unit + integration    | 非法签名拒绝；合法签名可执行           |
| T4 | Event webhook dedup                        | integration           | 重复 event 不重复执行                  |
| T5 | Account ownership guard                    | unit + integration    | 跨账户访问 403                        |
| T6 | Agent trigger_tool methods                 | e2e                   | 7 方法全部可调用成功                   |
| T7 | Trigger UI user flow                       | playwright/cypress    | 创建->查看->启停->删除->历史可见       |
| T8 | Migration/backfill reconciliation          | data-check script     | old/new 行为字段一致率 100%            |
| T9 | Chaos: provider transient failure          | resilience test       | 重试后恢复，死信可重放                 |
+----+--------------------------------------------+-----------------------+--------------------------------------+
```

---

## 11. 生产 SLO 与可观测性门禁

核心指标：

1. `trigger_dispatch_success_rate >= 99.9%`
2. `schedule_trigger_delay_p95 <= 30s`
3. `event_to_run_latency_p95 <= 60s`
4. `duplicate_execution_rate <= 0.1%`
5. `callback_signature_failure_rate` 可监控且告警

必须有：

- 结构化日志关联键：`trigger_id`, `event_id`, `run_id`, `provider_schedule_id`。
- Prometheus 指标 + 告警规则。
- 失败事件死信队列与人工重放脚本。

---

## 12. 灰度与回滚 Runbook

## 12.1 灰度步骤

1. `TRIGGER_PARITY_ENABLED=false`（部署不生效）。
2. 预发全链路压测通过后，生产开 10%（内部账户）。
3. 稳定 24h 后升 30%，再升 100%。

## 12.2 回滚开关（分钟级）

```text
TRIGGER_PARITY_ENABLED=false
TRIGGER_WRITE_DUAL_MODE=old_only
TRIGGER_READ_MODE=automation_fallback
```

回滚目标：新链路关闭后，旧 automation 路径仍可兜底，不丢任务。

---

## 13. 风险与对策

```text
+----+ 风险                                      + 等级 + 对策
+----+-------------------------------------------+------+--------------------------------------------+
| R1 | QStash 回调抖动/短时不可用                 | 高   | 幂等重试 + 死信 + 手动补偿脚本              |
| R2 | old/new 双写期间数据漂移                    | 高   | 每日对账 + 自动纠偏任务                      |
| R3 | profile/account 越权漏洞                    | 高   | 强制 account-scoped 查询 + 安全测试          |
| R4 | workflow route_type 误用导致执行失败        | 中   | 创建时严格校验，仅允许已支持 route_type       |
| R5 | 前端回迁引入 i18n 或 team route 回归        | 中   | e2e 覆盖三套路由 + locale 快照               |
+----+-------------------------------------------+------+--------------------------------------------+
```

---

## 14. 交付物清单（上线前必须齐全）

1. 后端代码 PR（trigger core + qstash adapter + composio + tool runtime）。
2. 前端代码 PR（trigger 页面与向导回迁）。
3. DB migrations + backfill + reconciliation scripts。
4. API contract tests + e2e tests + chaos report。
5. 灰度发布记录与回滚演练记录。
6. 生产配置文档（env、告警、值班手册）。

---

## 15. 执行顺序建议（推荐）

```text
PR-1  restore trigger core services and router
PR-2  add ownership guards + security hardening
PR-3  introduce scheduling port + qstash adapter
PR-4  align composio trigger orchestration
PR-5  restore trigger tool runtime methods
PR-6  restore frontend trigger UX
PR-7  migrations + backfill + dual-write
PR-8  observability + alerts + rollout runbook
PR-9  full regression + staged production rollout
```

---

## 16. 一句话执行原则

对齐目标是“**旧仓行为**”，不是“旧仓实现细节”；在行为一致前提下，用更稳健的基础设施（QStash、严格鉴权、双写回滚）达成可长期维护的生产级 Trigger 系统。

---

## 17. 实际落地状态（2026-03-01）

本次已在 `main` 分批完成以下实施（代码已提交）：

1. `feat(trigger): restore core trigger backend and qstash scheduling`  
   - 恢复 `backend/core/triggers/*` 全量模块。  
   - 恢复 `/api/triggers/*` 路由装配。  
   - 完成 QStash 调度 provider 与签名验签链路。  
2. `refactor(composio): align trigger flows and enforce account-scoped profiles`  
   - Composio 创建/回调路径切回 trigger 语义。  
   - profile 读取统一 account-scoped。  
   - 增补 `/composio/triggers/schema/{trigger_slug}`。  
3. `feat(trigger): expose trigger native tools and policy gating`  
   - 新增 `backend/core/tools/trigger_tool.py`。  
   - Native tool adapter 暴露 7 个 trigger 方法。  
   - `policy/native_tools/tool_groups/config_helper/zmind_config` 完成 `trigger_tool` 接入。  

前端与数据层同步落地（待本轮后续提交）：

1. Trigger UI 回迁到旧仓路径语义（页面、创建向导、详情侧栏、运行历史）。  
2. 新增 `hooks/triggers/*` 并接回 `/api/triggers/*`。  
3. 新增迁移 `20260301173000_trigger_legacy_parity.sql`：  
   - 建表：`agent_triggers` / `trigger_events` / `trigger_event_logs`  
   - 补齐 `custom_trigger_providers` / `oauth_installations`  
   - 包含 `automations -> agent_triggers` 回填 SQL。  

---

## 18. 上线推进路线（可直接执行）

```text
Step 1: 合并后端 Trigger 基础能力（已完成）
Step 2: 合并 Composio 对齐与账号隔离（已完成）
Step 3: 合并 Trigger Tool 运行时（已完成）
Step 4: 合并前端 Trigger 页面回迁（进行中）
Step 5: 执行 DB migration + backfill（待执行）
Step 6: 预发全链路验收（API + UI + webhook + schedule）
Step 7: 生产灰度 10% -> 30% -> 100%
Step 8: 连续观察 48h，关闭 fallback / 结束双写
```

验收门槛（上线前）：

1. 预发环境创建 schedule/event trigger 均可成功执行。  
2. QStash 签名验证可拒绝非法请求。  
3. Composio webhook 仅精确命中 `composio_trigger_id`。  
4. Trigger UI 支持创建、编辑、启停、删除、查看执行历史。  
5. 迁移后 `agent_triggers` 行数与回填口径一致，关键字段抽样一致。  
