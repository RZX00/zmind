# Phase A 任务拆解：Trigger A 云原生全量迁移

状态: Completed (Phase A backend path closed)  
Owner: Backend Platform / Product Engineering  
最后更新: 2026-02-20  
关联:
- `docs/design/adr-trigger-a-architecture.md`
- `docs/reports/2026-02-20-migration-development-playbook.md`

---

## 0. 当前执行进度（2026-02-20）

```text
PR-01: Completed
PR-02: Completed
PR-03: Completed
PR-04: Completed
PR-05: Completed
PR-06: Completed
PR-07~PR-09: Pending (phase-level observability/rollout hardening)
```

本轮新增完成：

1. 新增 Trigger A 基础 schema migration：
   - `backend/supabase/migrations/20260220170000_trigger_a_automation_schema.sql`
2. 新增 Automation 领域骨架（DDD）：
   - `backend/core/domains/automation/model.py`
   - `backend/core/domains/automation/events.py`
   - `backend/core/domains/automation/ports/automation_repository.py`
3. 新增基础用例骨架：
   - `backend/core/application/use_cases/automation/create_automation.py`
   - `backend/core/application/use_cases/automation/ingest_provider_event.py`
   - `backend/core/application/use_cases/automation/queue_automation_run.py`
4. 新增 Supabase 仓储骨架：
   - `backend/core/infrastructure/automation/supabase_automation_repository.py`
5. 新增 Trigger A API 与兼容路由：
   - `backend/core/automation/api.py`
6. 新增 dispatcher / executor / schedule worker：
   - `backend/core/automation/background_jobs.py`
7. 新增 cron 计算与降级策略：
   - `backend/core/automation/schedule_utils.py`
8. 接入主 API 与 worker 注册：
   - `backend/api.py`
   - `backend/run_agent_background.py`
9. composio 触发创建与 webhook 入站升级：
   - `backend/core/composio_integration/api.py`
10. 扩展仓储端口和 Supabase 实现（event/schedule scan、attempt 状态、最新 run）：
   - `backend/core/domains/automation/ports/automation_repository.py`
   - `backend/core/infrastructure/automation/supabase_automation_repository.py`
11. 新增单测并通过（16 passed）：
   - `backend/tests/automation/test_automation_domain_model.py`
   - `backend/tests/automation/test_supabase_automation_repository.py`
   - `backend/tests/automation/test_automation_background_jobs.py`

---

## 1. 目标与边界

目标：

1. 完成 Trigger A 的后端全链路可运行版本。
2. 支持 schedule + composio event 两种触发。
3. 具备幂等、重试、死信、审计、观测。

边界：

1. 本阶段以后端能力为主，不做最终 UI 美化。
2. 不恢复旧 `core/triggers` 子系统。
3. 不引入 Daytona 或 sandbox 依赖。

---

## 2. 里程碑与迭代切分

建议 5 个 Sprint（每 Sprint 1 周）：

```text
Sprint 1: 数据模型与基础骨架
Sprint 2: Ingestion + Dispatcher
Sprint 3: Executor + 重试/死信
Sprint 4: 管理与查询 API + 测试
Sprint 5: 灰度发布 + 压测 + 稳定性收口
```

---

## 3. 工作流拆解（Workstream）

## WS-1 数据与迁移

目标：

1. 建表与索引。
2. 关键唯一约束与租户隔离。

任务：

1. 新增 migration:
   - `automations`
   - `automation_bindings`
   - `provider_events`
   - `automation_runs`
   - `automation_run_attempts`
2. 建立索引：
   - `provider_events(dedupe_key unique)`
   - `automation_runs(automation_id, triggered_at desc)`
   - `automation_runs(status)`
3. RLS/权限策略按 `account_id` 收敛。

验收：

1. migration 可在空库/增量库成功执行。
2. 幂等约束生效（重复插入 `dedupe_key` 失败）。

---

## WS-2 Ingestion（webhook 入站）

目标：

1. 把 webhook 从“verify+ack”升级为“verify+落库+投递”。

任务：

1. 统一 provider payload normalize。
2. 生成 `dedupe_key` 并写 `provider_events`。
3. 冲突（重复）直接 200 返回。
4. 成功写入后投递 dispatcher 队列。
5. 保留现有入口 `/api/composio/webhook`。

验收：

1. 同一事件重复投递只产生一次有效 dispatch。
2. 验签失败不会入库。

---

## WS-3 Dispatcher 与 Executor

目标：

1. 完成事件匹配、run 创建、执行调用。

任务：

1. Dispatcher:
   - 根据 binding 匹配 automation
   - 生成 `automation_run`（status=queued）
   - 投递 executor
2. Executor:
   - 更新 run 状态 `queued -> running`
   - 调用 agent run 启动（LangGraph 路径）
   - 写 attempt 记录
   - 处理成功/失败
3. 重试与死信：
   - 指数退避
   - 最大尝试 5
   - 超限 dead-letter

验收：

1. schedule 和 event 都能触发 agent run。
2. 异常场景按策略重试与终结。

---

## WS-4 管理/查询 API 与契约测试

目标：

1. 让前端可接入管理和历史查询能力。

任务：

1. 管理 API:
   - create/list/get/update/delete/toggle/test-fire
2. 查询 API:
   - list runs
   - run detail
   - attempts
3. 契约测试：
   - API schema
   - webhook ingestion schema
   - run state transitions

验收：

1. API 覆盖 Happy path + 关键异常路径。
2. 契约测试稳定通过。

---

## WS-5 可观测、灰度与发布

目标：

1. 可控上线，不冒险全量。

任务：

1. 埋点/指标：
   - received/deduped/dispatched/succeeded/failed/dead-letter
2. 审计日志接入。
3. feature flag 分阶段上线：
   - ingestion
   - dispatch
   - execution
   - api
4. 灰度发布与回滚脚本。

验收：

1. 灰度期无严重丢单或重复执行。
2. 出现故障可在 5 分钟内回滚。

---

## 4. PR 切分建议（可直接执行）

```text
PR-01: Migration + Repository skeleton + domain models
PR-02: Provider ingestion service + dedupe write path
PR-03: Dispatcher actor + run creation flow
PR-04: Executor actor + retry/dlq flow
PR-05: Automation CRUD API + run query API
PR-06: Scheduler bridge (for schedule triggers)
PR-07: Observability + audit + metrics
PR-08: Contract tests + integration tests + load tests
PR-09: Feature flags + rollout scripts + docs
```

规则：

1. 每个 PR 必须可独立回滚。
2. 关键写路径 PR 必须附带测试。
3. 不允许在同一 PR 里同时做大规模重构和新功能。

---

## 5. 测试矩阵（最小集）

## 5.1 单测

1. dedupe key 生成与冲突行为。
2. run 状态机转移。
3. retry 分类策略（可重试/不可重试）。

## 5.2 集成测试

1. webhook -> provider_events -> dispatch -> run 全链路。
2. schedule -> dispatch -> run 全链路。
3. 重放同一 webhook，确认只执行一次。

## 5.3 压测

1. webhook 并发写入（突发 1k/s）稳定性。
2. 队列积压恢复能力。
3. 执行器故障恢复与重试风暴控制。

---

## 6. 发布计划

## 6.1 灰度阶段

```text
阶段 1: 仅开 ingestion（不执行）
阶段 2: 开 dispatch（仅记录 run，不执行）
阶段 3: 开 execution（白名单租户）
阶段 4: 扩容灰度租户
阶段 5: 全量
```

## 6.2 回滚策略

1. 一键关 execution flag，保留 ingestion。
2. 必要时关闭 dispatch flag，仅保留落库审计。
3. 通过 run 状态与队列清理脚本快速止损。

---

## 7. 风险与缓解

```text
+----+----------------------------------+---------+--------+-----------------------------------+
| ID | 风险                             | 概率    | 影响   | 缓解                              |
+----+----------------------------------+---------+--------+-----------------------------------+
| A1 | webhook 事件重复执行             | 中高    | 高     | dedupe_key unique + 幂等处理      |
| A2 | 执行失败重试导致队列风暴         | 中      | 高     | 指数退避 + 最大重试 + DLQ         |
| A3 | provider payload 不稳定          | 中      | 中高   | normalize 层 + schema 校验        |
| A4 | 租户隔离缺陷                     | 低中    | 高     | account_id 全链路校验 + RLS       |
| A5 | 发布后观测不足                   | 中      | 高     | 指标/日志/trace 强制门禁          |
+----+----------------------------------+---------+--------+-----------------------------------+
```

---

## 8. 团队协作建议

角色建议：

1. Platform Lead：负责 WS-1/2/3 架构与执行链。
2. API Engineer：负责 WS-4 管理与查询接口。
3. SRE/Infra：负责 WS-5 指标、发布、回滚。
4. QA：从 Sprint 2 开始介入集成回归。

节奏建议：

1. 每周固定一次架构评审（30 分钟）。
2. 每周固定一次风险盘点（30 分钟）。
3. 每个 Sprint 结束必须产出阶段报告。

---

## 9. DoD（Phase A 完成定义）

Phase A 只有在以下全部满足时才算完成：

1. schedule/event 两类 trigger 在生产灰度下稳定运行。
2. 幂等与重试机制经压测验证有效。
3. run 历史与 attempt 历史可查询可审计。
4. 指标与日志可直接定位失败根因。
5. 可以安全关闭执行开关并快速回滚。

---

## 10. 下一步执行项（T+0）

1. 评审并确认 `docs/design/adr-trigger-a-architecture.md`。
2. 建立 Phase A issue board（按 WS 和 PR 切分）。
3. 开工 PR-01（migration + domain skeleton）。
