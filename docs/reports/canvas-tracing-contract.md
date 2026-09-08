# Canvas Tracing Contract

状态：`active`  
日期：`2026-02-19`

---

## 1. 目标

统一 Canvas 写链路的追踪字段，确保 `frontend -> next api -> backend -> realtime` 可串联排障。

---

## 2. Header 约定

| Header | 作用 | 来源 | 传递路径 |
|---|---|---|---|
| `X-Client-Request-Id` | 单次请求追踪主键 | FE Repository / Tool | FE -> Next -> Backend -> Realtime |
| `Idempotency-Key` | 幂等去重键 | FE Repository / API Caller | FE -> Next -> Backend -> Realtime |
| `X-Client-Session-Id` | 客户端会话追踪 | FE `sessionStorage` | FE -> Next -> Backend -> Realtime |
| `X-Canvas-Session-Id` | 协作会话追踪（可选） | Collaboration layer | FE -> Next -> Backend |
| `If-Match` | 乐观并发版本约束 | FE apply/update caller | FE -> Next -> Backend -> Realtime |
| `X-Workspace-Id` | 租户边界标识 | FE workspace session | FE -> Next -> Backend |

---

## 3. 当前实现点

1. FE 统一代理头透传：`frontend/src/app/api/canvases/proxyHeaders.ts`
2. FE 写请求会话头：`frontend/src/canvas/services/canvas-file-repository.service.ts`
3. Backend 统一请求头解析：`backend/core/canvas/request_contract.py`
4. Backend -> Realtime 透传头：`backend/core/canvas/write_service.py`
5. Backend 结构化冲突返回：`backend/core/canvas/api.py`
6. Realtime apply/import 日志统一追踪字段：`services/canvas-realtime/src/index.js`

---

## 4. 日志事件

`backend/api.py` 对以下指标事件打点：

- `openCanvas`
- `applyOps`
- `importSnapshot`
- `getSnapshot`

日志事件名：`canvas_http_metric`，字段包含：

- `metric_name`
- `status_code`
- `success`
- `conflict`
- `latency_ms`
- `client_request_id`
- `client_session_id`
- `workspace_id`
- `if_match`

---

## 5. Realtime 日志约定（新增）

`services/canvas-realtime/src/index.js` 在以下关键日志中补齐：

- `requestId`（`X-Client-Request-Id` / `Idempotency-Key`）
- `sessionId`（`X-Client-Session-Id` / `X-Canvas-Session-Id`）
- `ifMatch`（`If-Match`）

覆盖路径：

1. `/apply`：版本冲突、校验失败、幂等缓存读写失败、端点异常
2. `/import`：缺失 If-Match、版本冲突、幂等缓存读写失败、端点异常
