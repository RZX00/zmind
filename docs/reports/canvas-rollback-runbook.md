# Canvas Rollback Runbook（Wave 1）

状态：`ready`

---

## 1. 触发条件（任一满足即回滚）

1. `apply` 5 分钟错误率持续高于基线 + 1%。
2. 冲突错误（409）异常飙升且用户无法恢复。
3. 请求链路追踪字段缺失导致无法定位故障。

---

## 2. 回滚策略

### Step A：后端写路径降级

1. 关闭 `CANVAS_REALTIME_WRITE_ENABLED`（切回 legacy 持久化路径）。
2. 保留已有结构化冲突 payload（不回滚错误语义）。

### Step B：realtime 入口降级

1. 关闭 realtime apply（`CANVAS_REALTIME_APPLY_ENABLED=false`）。
2. 保留 snapshot 读取，避免全链路不可用。

### Step C：前端代理回退

1. 保持 `/api/canvases/*` 路由不变。
2. 如需紧急回退头策略，仅回退 `proxyHeaders.ts` 相关提交。

---

## 3. 核验清单

1. `GET /api/canvases/{id}/snapshot` 可成功返回。
2. `PUT /api/canvases/{id}` 可成功保存。
3. `POST /api/canvases/{id}/apply` 在降级路径仍返回可解释错误或成功。
4. 关键日志包含 request/session/idempotency 信息。

---

## 4. 回滚后补救

1. 导出故障窗口日志（backend + realtime）。
2. 对比回滚前后 `apply` 错误率/时延。
3. 形成 RCA：根因、修复、再发布条件。

