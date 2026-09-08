# Canvas Contract Deprecation Plan（Week 1）

状态：`active`  
关联：`docs/canvas-enterprise-refactor-program.md`、`docs/canvas-contract-v1/schema/canvas.ops.v1.json`

---

## 1. Canonical Source

1. 对外协议（文档契约）：`docs/canvas-contract-v1/schema/canvas.ops.v1.json`
2. 后端运行时契约：`backend/core/canvas/ops_contract.py`
3. Realtime/Frontend 运行时常量（受 contract test 强约束）：
   - `services/canvas-realtime/src/ops/contract.js`
   - `frontend/src/lib/canvas/realtime/opsContract.ts`

---

## 2. 兼容窗口策略

- 旧字段别名（如 `addNode` / `node_id` / `background_color`）继续支持 `2` 个发布周期。
- 新增字段必须先进入 schema，再同步三端常量与 contract test。
- 未进入 schema 的字段，不得进入三端运行时 allowlist。

---

## 3. 弃用路径

### 阶段 A（当前）

- 保留别名解析能力（normalizer）。
- 对命中别名路径打 warning（便于统计迁移进度）。

### 阶段 B（下个发布周期）

- 对高频旧字段输出结构化 warning（含字段名、来源路径）。
- 业务侧开始改造调用端，切换到 canonical 字段。

### 阶段 C（第 2 个发布周期后）

- 删除低使用率别名。
- 保留少量历史关键别名（如跨端老版本依赖）并登记白名单。

---

## 4. 门禁规则

1. schema 变更必须伴随三端常量更新。
2. `backend/tests/test_canvas_ops_contract_consistency.py` 必须通过。
3. 未更新 deprecation 文档，不允许合并协议变更 PR。

