# Canvas Ops 语义差异矩阵（Week 1）

状态：`draft`  
目的：定位 backend / realtime / frontend 在 ops 语义上的差异，并明确统一策略。

---

## 1. 差异总览

| 维度 | Backend | Realtime | Frontend | 风险等级 | 统一策略 |
|---|---|---|---|---|---|
| op 归一化 | 有（normalize_ops） | 有（normalizeOp） | 基本无 | P0 | 统一到单一 schema + 共享 normalizer |
| 临时 ID 映射 | 有 | 有 | 部分依赖返回 | P0 | 统一 id_map 语义与字段命名 |
| update_canvas patch allowlist | 有 | 有 | 有 | P1 | 统一 allowlist 来源与版本 |
| 错误码规范 | 弱一致 | 较完整 | 依赖字符串与 code | P0 | 统一错误码字典与状态码映射 |
| 幂等策略 | header + middleware | redis cache | 调用方感知弱 | P1 | 明确端到端 idempotency 规范 |
| 冲突语义 | 409 + if-match | 409 + version check | retry on conflict | P0 | 固化冲突重试协议与上限 |

---

## 2. 已识别实现位置

### Backend

- `backend/core/canvas/ops_normalization.py`
- `backend/core/tools/canvas_edit_tool.py`

### Realtime

- `services/canvas-realtime/src/ops/applyCanvasOps.js`
- `services/canvas-realtime/src/ydoc/canvasDoc.js`

### Frontend

- `frontend/src/lib/canvas/realtime/applyOpsToYDoc.ts`
- `frontend/src/canvas/stores/canvas.store.ts`

---

## 3. P0 必做统一项

1. **统一 op canonical 字段**：`op`, `id`, `patch`, `from`, `to`。
2. **统一 `id_map` 返回语义**：前后端字段命名、作用范围一致。
3. **统一冲突返回结构**：固定 `status=409` + `serverVersion` + 可操作提示。
4. **统一 validation error 结构**：固定 `code` + `message` + `field`。

---

## 4. 待决策项（Week 2 必须关闭）

- [ ] normalizer 放在哪个仓库（单一来源）
- [ ] schema 发布方式（手工维护 or 自动生成）
- [ ] 老字段兼容窗口（建议 2 个发布周期）
- [ ] 何时强制开启 `enforceClientIds`

