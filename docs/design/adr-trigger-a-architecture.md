# ADR-2026-02-20 Trigger A 云原生自动化架构

状态: Proposed  
Owner: Architecture / Backend Platform  
最后更新: 2026-02-20  
关联文档:
- `docs/reports/2026-02-20-migration-development-playbook.md`
- `docs/reports/phase-a-trigger-a-task-breakdown.md`

---

## 1. 背景

当前系统中的 Trigger 处于“开关+占位”状态：

1. 前端路由由 feature flag 控制，页面主体仍为占位。
2. 后端 `composio` webhook 可验签，但只 ack，不执行本地触发链。
3. 旧仓 Trigger 体系依赖 `agent_triggers` 与旧执行路径，不符合当前 DDD + LangGraph + Dramatiq 方向。

业务目标：

1. 构建可生产的自动化能力（定时与事件触发）。
2. 保持与当前架构一致，不回退旧链路。
3. 实现幂等、重试、审计、可观测。

---

## 2. 决策

采用 **Trigger A（云原生自动化域）**，核心决策如下：

1. 新建 `Automation` 领域上下文，替代旧 `agent_triggers` 语义。
2. 统一触发执行入口：`Provider Event Ingestion -> Dispatcher -> Worker -> LangGraph Agent Run`。
3. 所有 Provider webhook 必须先进入幂等层（`provider_events`），再做匹配与调度。
4. 调度与执行使用 Dramatiq 队列，不在 webhook 请求线程内直接执行。
5. 保持 `composio` 入口地址兼容，但内部实现切换到新域。
6. 全链路必须可追踪：每次自动化执行都有 run 记录、attempt 记录、状态流转和错误归因。

---

## 3. 范围与非目标

### 范围

1. 自动化配置 CRUD。
2. 定时触发（schedule）。
3. 事件触发（provider webhook）。
4. 执行调度、重试、死信。
5. 运行历史查询与审计。

### 非目标

1. 不在本 ADR 中处理 UI 最终样式。
2. 不恢复旧 `core/triggers` 执行服务。
3. 不引入 Daytona/Sandbox 依赖。

---

## 4. 目标架构

```text
┌────────────┐
│ Frontend   │
└─────┬──────┘
      │ CRUD / Query
┌─────▼───────────────────────────────┐
│ Automation API                      │
│  - create/update/list/delete        │
│  - run history                      │
└─────┬───────────────────────────────┘
      │
      │ webhook events
┌─────▼───────────────────────────────┐
│ Provider Ingestion Adapter          │
│  - verify signature                 │
│  - normalize payload                │
│  - write provider_events (dedupe)   │
└─────┬───────────────────────────────┘
      │ enqueue
┌─────▼───────────────────────────────┐
│ Automation Dispatcher (Dramatiq)    │
│  - match bindings                   │
│  - create automation_run            │
│  - enqueue executor                 │
└─────┬───────────────────────────────┘
      │
┌─────▼───────────────────────────────┐
│ Automation Executor (Dramatiq)      │
│  - start agent run                  │
│  - update attempts/status           │
│  - retry / DLQ                      │
└─────────────────────────────────────┘
```

---

## 5. 领域模型设计

## 5.1 表设计（建议）

### `automations`
- `automation_id` (uuid, pk)
- `account_id` (uuid, tenant)
- `agent_id` (text)
- `name` (text)
- `description` (text, nullable)
- `trigger_type` (`schedule` | `event`)
- `provider` (text, nullable; e.g. `composio`)
- `provider_binding_key` (text, nullable; e.g. `composio_trigger_id`)
- `is_active` (bool)
- `config` (jsonb)
- `created_at` / `updated_at`
- `created_by`

约束：
1. `schedule` 必须有 `config.cron_expression`。
2. `event` 必须有 `provider` 与匹配键。
3. 同租户同 `provider_binding_key` 不允许冲突（按策略可唯一）。

### `automation_bindings`
- `binding_id` (uuid, pk)
- `automation_id` (fk)
- `provider` (text)
- `match_strategy` (`exact` | `prefix` | `jsonpath`)
- `match_value` (text/jsonb)
- `is_active` (bool)
- `created_at` / `updated_at`

用途：
1. 支持一条 automation 对接多个 provider 规则。
2. 与 `automations` 解耦，便于后续多源触发扩展。

### `provider_events`
- `provider_event_id` (uuid, pk)
- `provider` (text)
- `external_event_id` (text)
- `signature_valid` (bool)
- `event_type` (text)
- `payload` (jsonb)
- `received_at`
- `dedupe_key` (text, unique)
- `processing_status` (`received` | `dispatched` | `ignored` | `failed`)

约束：
1. `dedupe_key` 唯一，保障 webhook 幂等。

### `automation_runs`
- `run_id` (uuid, pk)
- `automation_id` (fk)
- `provider_event_id` (fk nullable for schedule)
- `triggered_at`
- `status` (`queued` | `running` | `completed` | `failed` | `cancelled`)
- `agent_run_id` (text, nullable)
- `error_code` / `error_message`
- `metadata` (jsonb)

### `automation_run_attempts`
- `attempt_id` (uuid, pk)
- `run_id` (fk)
- `attempt_no` (int)
- `status` (`running` | `completed` | `failed`)
- `started_at` / `ended_at`
- `error_code` / `error_message`

---

## 5.2 状态机

```text
automation_run
queued -> running -> completed
queued -> running -> failed -> (retry) -> running
queued -> running -> failed -> dead_lettered
```

---

## 6. API 契约（建议）

## 6.1 管理接口

1. `POST /api/automations`
2. `GET /api/automations`
3. `GET /api/automations/{automation_id}`
4. `PATCH /api/automations/{automation_id}`
5. `DELETE /api/automations/{automation_id}`
6. `POST /api/automations/{automation_id}/toggle`
7. `POST /api/automations/{automation_id}/test-fire`

## 6.2 运行查询接口

1. `GET /api/automations/{automation_id}/runs`
2. `GET /api/automations/runs/{run_id}`
3. `GET /api/automations/runs/{run_id}/attempts`

## 6.3 Provider webhook 接口

保留兼容入口：

1. `POST /api/composio/webhook`（兼容现有）

内部行为变更：

1. 验签通过后写入 `provider_events`。
2. `dedupe_key` 冲突则直接返回 200（幂等 ack）。
3. 异步投递 dispatcher，不阻塞 provider 请求。

---

## 7. 幂等、重试与死信

## 7.1 幂等规则

`dedupe_key` 计算建议：

```text
dedupe_key = sha256(provider + ":" + external_event_id + ":" + event_type)
```

若 provider 不提供稳定 `external_event_id`：

```text
dedupe_key = sha256(provider + ":" + signature_timestamp + ":" + normalized_payload_fingerprint)
```

## 7.2 重试策略

1. 指数退避：`1m -> 5m -> 15m -> 1h`
2. 最大尝试次数：5
3. 可按错误类型分级：
   - 可重试：网络、限流、上游暂时失败
   - 不可重试：签名错误、配置错误、权限错误

## 7.3 死信策略

1. 超过最大重试进入 `dead_letter`（可用状态字段或单独表）。
2. 提供后台“重放”入口。
3. 重放必须保留原始 `provider_event_id` 和审计链。

---

## 8. 安全与权限

1. 所有 CRUD 接口以 `account_id` 为租户边界。
2. webhook 必须严格验签，失败返回 401/403。
3. webhook 原始 payload 允许落库，但必须做敏感字段脱敏策略。
4. `test-fire` 接口仅允许具备管理权限角色调用。

---

## 9. 可观测与审计

建议指标：

1. `automation_events_received_total`
2. `automation_events_deduped_total`
3. `automation_dispatch_latency_ms`
4. `automation_run_success_total`
5. `automation_run_failed_total`
6. `automation_run_retry_total`
7. `automation_dead_letter_total`

日志要求：

1. 每条链路有统一 `trace_id`。
2. 关键日志必须带：
   - `provider`
   - `external_event_id`
   - `automation_id`
   - `run_id`
   - `attempt_no`

审计要求：

1. automation 的 create/update/delete/toggle 都要出审计事件。
2. run 的状态变更要可追踪。

---

## 10. 与当前代码的迁移策略

## 10.1 迁移分步

1. 第一步：引入新表与新域服务，不改现有 UI。
2. 第二步：`/api/composio/webhook` 切到新 ingestion 逻辑。
3. 第三步：上线 scheduler + dispatcher + executor。
4. 第四步：开放新管理 API，接入新 trigger 页面。
5. 第五步：清理旧 trigger 占位逻辑。

## 10.2 兼容策略

1. 当前 `FEATURE_TRIGGERS` 保留，新增 `FEATURE_AUTOMATIONS_V2`。
2. 分阶段开关：
   - `FEATURE_AUTOMATIONS_INGESTION`
   - `FEATURE_AUTOMATIONS_DISPATCH`
   - `FEATURE_AUTOMATIONS_EXECUTION`
   - `FEATURE_AUTOMATIONS_UI`

---

## 11. 备选方案与否决理由

### 方案 B：恢复旧 `core/triggers`
否决理由：
1. 重新引入旧耦合，违背当前架构方向。
2. 与当前 DDD + LangGraph worker 体系重复且冲突。
3. 后续还要二次迁移，长期成本更高。

### 方案 C：Provider webhook 内同步执行
否决理由：
1. 无法抗突发流量。
2. 上游重试会放大执行重复风险。
3. 可观测和补偿难做。

---

## 12. 验收标准（DoD）

1. Trigger 配置可创建、启停、删除。
2. schedule 与 event 两种触发都能成功发起 agent run。
3. webhook 重放不会重复触发 run（幂等成立）。
4. 失败重试和死信可观测。
5. 运行历史可查询，可追溯到 provider event。
6. 压测下队列和执行链稳定，无明显丢单。

---

## 13. 待决议问题

1. `automation_bindings` 是否首版就支持复杂匹配（jsonpath）？
2. `dead_letter` 采用单独表还是状态字段？
3. schedule 首版是 DB scheduler 还是外部调度服务？
4. 是否首版即支持多 provider（除 composio）？

---

## 14. 附录：上下文关系图（ASCII）

```text
Provider Event
   |
   v
[Automation Ingestion] --> [provider_events]
   |
   v
[Automation Dispatcher] --> [automation_runs]
   |
   v
[Automation Executor] --> [agent_runs] --> [LangGraph Worker]
```

