# Canvas Migration Wave 1 Scope

状态：`implemented`  
范围类型：`低风险 / 高收益`

---

## 1. Wave 1 目标

在不做大规模路由拆分的前提下，优先消除协议分叉与写路径可观测性短板。

---

## 2. 已交付项

1. `/apply` 显式 Next API 路由，避免依赖隐式代理路径。
2. 三端 ops 契约常量收敛（backend/realtime/frontend）。
3. contract consistency test（以 backend 为门禁入口）落地。
4. 前端写请求补齐 `X-Client-Session-Id`。
5. 后端冲突语义统一为结构化 payload（含 `code/message/hint/serverVersion/expectedVersion`）。
6. 后端写服务统一透传 tracing headers 到 realtime：
   - `X-Client-Request-Id`
   - `X-Client-Session-Id`
7. Next API 代理头策略统一（`canvases/*` 路由）：
   - workspace/request/session/idempotency/if-match/if-none-match（按路由能力透传）

---

## 3. 本波次明确不做

1. `backend/core/canvas/api.py` 全量拆分（Phase 2 主任务）。
2. `canvas.store.ts` 大规模拆分（Phase 4 主任务）。
3. realtime 故障注入压测与 SLO 验证（Phase 3 主任务）。

---

## 4. 风险与后续输入

1. `pytest` 运行链路尚未在当前环境打通，需在 CI 复核。
2. normalizer 跨语言“行为级”一致性仍需补集成测试（目前主要是常量一致性）。
3. 下一波建议优先：`apply/update/restore` 路由收敛到应用服务层（薄路由）。

