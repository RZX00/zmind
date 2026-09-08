# Canvas Contract Test Plan（Week 1）

状态：`active`

---

## 1. 测试目标

确保 Canvas 写协议在 backend / realtime / frontend 三端一致，重点覆盖：

1. op 枚举一致性
2. alias 映射一致性
3. update_canvas patch allowlist 一致性
4. 冲突语义与追踪头传递一致性

---

## 2. 用例矩阵

| 维度 | Backend | Realtime | Frontend | 现状 |
|---|---|---|---|---|
| `ALLOWED_OPS` 一致 | ✅ `test_canvas_ops_contract_consistency.py` | ✅（被 backend 合同比对） | ✅（被 backend 合同比对） | 已接入 |
| `OP_ALIASES` 一致 | ✅ | ✅ | ✅ | 已接入 |
| `CANVAS_PATCH_KEYS` 一致 | ✅ | ✅ | ✅ | 已接入 |
| normalizer 行为 | ✅ `test_canvas_ops_normalization.py` + `test_canvas_ops_behavior_parity.py` | ✅（通过 Node 调用 `applyCanvasOps` 对齐） | ⚠️ 待补 TS 单测 | 基本完成 |
| tracing headers 透传 | ✅ `test_canvas_write_service_headers.py` | ✅（apply/import 日志补齐 request/session/if-match） | ⚠️ 待补前端端到端 | 基本完成 |
| 冲突详情结构 | ✅ `test_canvas_request_contract.py`（构造层） | ⚠️ 待补端到端 | ⚠️ 待补端到端 | 部分 |

---

## 3. 执行命令

- Backend unit: `cd backend && uv run pytest -q tests/test_canvas_ops_contract_consistency.py tests/test_canvas_ops_normalization.py tests/test_canvas_ops_behavior_parity.py tests/test_canvas_request_contract.py tests/test_canvas_write_service_headers.py tests/test_canvas_command_routes.py tests/test_canvas_application_services.py`
- Frontend type safety: `npm --prefix frontend run type-check`
- Python syntax gate: `python3 -m py_compile <changed_backend_files>`

---

## 4. CI 门禁状态

已落地：`.github/workflows/canvas-contract-gate.yml`

1. contract consistency + normalizer parity + request contract + write headers + route/service tests 纳入必过。
2. Frontend `type-check` 纳入必过。
3. schema 变更触发同步校验：若修改 `docs/canvas-contract-v1/schema/canvas.ops.v1.json`，必须同时改动至少一个三端运行时契约文件。

## 5. 待补项

1. Frontend normalizer 行为单测（目前由 backend 的跨语言 parity test 兜底）。
2. 冲突语义端到端测试（跨 FE -> Next -> Backend -> Realtime）。
