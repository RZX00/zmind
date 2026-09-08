# Canvas Migration Wave 1 Retro（阶段复核）

状态：`reviewed`

---

## Phase A：协议统一（已复核）

### 已完成

1. 三端 ops 契约常量收敛（backend/realtime/frontend）。
2. `backend/tests/test_canvas_ops_contract_consistency.py` 建立跨层一致性校验。

### 复核结论

- ✅ 关键常量一致性可自动化验证。
- ⚠️ 仍存在 normalizer 逻辑跨语言实现（行为级一致性后续补）。

---

## Phase B：冲突语义与追踪契约（已复核）

### 已完成

1. 新增 `backend/core/canvas/request_contract.py`。
2. `update/apply/restore` 冲突语义统一结构化返回。
3. 后端对 realtime 写链路透传 `X-Client-Request-Id` 与 `X-Client-Session-Id`。

### 复核结论

- ✅ 409 响应可携带 `serverVersion` 与 `expectedVersion`。
- ✅ request/session 追踪链路从 API 进入 realtime。
- ⚠️ 端到端冲突集成测试仍需在 CI 完整环境补跑。

---

## Phase C：前端代理一致化（已复核）

### 已完成

1. 新增 `frontend/src/app/api/canvases/proxyHeaders.ts` 统一头策略。
2. `canvases/route.ts`、`[canvas_id]/route.ts`、`[canvas_id]/apply/route.ts`、`[canvas_id]/snapshot/route.ts` 已接入。

### 复核结论

- ✅ 写入链路头透传策略从“散落实现”收敛为“单点策略”。
- ✅ 已通过前端 `type-check`。

---

## 本波次遗漏与下一步

1. 未完成 `backend/core/canvas/api.py` 大规模拆分（Phase 2 主任务）。
2. 未完成 `canvas.store.ts` 分层重构（Phase 4 主任务）。
3. 需补齐 CI 级 pytest 与 realtime 集成测试后，才能关闭 Week 1 所有验收项。

