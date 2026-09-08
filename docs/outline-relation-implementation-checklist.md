# Outline 关系增强：文件级改造清单与回归计划

## 1. 目标与范围

- 本文用于指导 `Outline` 从“结构目录”升级为“结构 + 关系完整可见”能力。
- 聚焦 **前端优先落地**，后端仅复用现有 `canvas` 通用接口。
- 采用分阶段可回滚方案，确保稳定上线。

---

## 2. 现状关键文件地图（As-Is）

## 2.1 入口与页面层

- `frontend/src/canvas/components/core/CanvasEditor.tsx`
  - 编辑页大纲开关与挂载点。
- `frontend/src/app/share/canvas/[canvasId]/page.tsx`
  - Share 只读页大纲开关与挂载点。
- `frontend/src/components/thread/thread-site-header.tsx`
  - Share 页 outline 入口按钮。
- `frontend/src/canvas/components/shared/toolbar/TopBar.tsx`
  - 编辑页大纲入口按钮。

### 2.2 大纲视图层

- `frontend/src/canvas/components/shared/OutlineView.tsx`
  - 面板、拖拽、折叠、跳转、编辑回调桥接。
- `frontend/src/canvas/components/shared/OutlineTreeGroup.tsx`
  - 树递归渲染。
- `frontend/src/canvas/components/shared/OutlineItem.tsx`
  - 行渲染、todo、标题编辑、内容预览。
- `frontend/src/canvas/components/shared/outline.css`
  - 视觉规范与样式细节。

### 2.3 计算与状态层

- `frontend/src/canvas/stores/outlineSelectors.ts`
  - 树构建、拓扑排序、关系扩展。
- `frontend/src/canvas/stores/canvas.store.ts`
  - 选中、更新、保存、持久化状态。
- `frontend/src/canvas/components/core/InfiniteCanvas.tsx`
  - 响应 `canvas:focus-bbox` 聚焦/高亮。

### 2.4 接口与仓储层

- `frontend/src/canvas/services/canvas-file-repository.service.ts`
  - `snapshot` / `apply` 接口调用与并发头。
- `frontend/src/app/api/[...path]/route.ts`
  - Next API 通配代理。
- `backend/core/canvas/api.py`
  - `/canvases/{id}/snapshot`、`/canvases/{id}/apply`。

---

## 3. 目标架构（To-Be）

新增领域层与 VM 层，形成清晰分层：

1. `Domain`：关系计算（纯函数，独立于 UI）
2. `Application`：把 Domain 输出组装为视图模型
3. `Presentation`：组件只消费 ViewModel，不做重计算

建议新增模块：

- `frontend/src/canvas/domain/outline/relation-graph.ts`
- `frontend/src/canvas/domain/outline/relation-anomalies.ts`
- `frontend/src/canvas/application/outline/build-outline-view-model.ts`
- `frontend/src/canvas/types/outline.ts`

---

## 4. 分阶段实施计划（文件级）

## Phase 1：关系可见性补齐（低风险，快速上线）

### 4.1 新增文件

- `frontend/src/canvas/types/outline.ts`
  - 新增类型：`RelationEdgeVM`、`RelationSummaryVM`、`OutlineItemVM`。

- `frontend/src/canvas/application/outline/build-node-relation-summary.ts`
  - 计算每节点 `in/out/crossContainer` 计数。

### 4.2 修改文件

- `frontend/src/canvas/components/shared/OutlineItem.tsx`
  - 增加关系徽标（↑/↓/↔）渲染位。
  - 增加 `onOpenRelationDrawer(nodeId)` 回调。

- `frontend/src/canvas/components/shared/OutlineView.tsx`
  - 挂载关系抽屉状态（`activeRelationNodeId`）。
  - 增加抽屉打开/关闭控制。

- `frontend/src/canvas/components/shared/outline.css`
  - 增加关系徽标与抽屉样式。

### 4.3 交付物

- 节点行可见关系计数。
- 点击计数可查看该节点完整入/出关系。

---

## Phase 2：领域重构（中风险，质量核心）

### 4.4 新增文件

- `frontend/src/canvas/domain/outline/relation-graph.ts`
  - 输入：`Canvas`
  - 输出：`RelationGraph`
  - 包含：`inboundIndex`、`outboundIndex`、`crossContainerIndex`。

- `frontend/src/canvas/domain/outline/structure-tree.ts`
  - 迁移/抽离当前 `buildOutlineTree` 结构逻辑（不含 UI 细节）。

- `frontend/src/canvas/application/outline/build-outline-view-model.ts`
  - 组合结构树 + 关系索引，生成 `OutlineViewModel`。

### 4.5 修改文件

- `frontend/src/canvas/stores/outlineSelectors.ts`
  - 保留兼容入口，但内部委派到新 domain/application。
  - 标记旧函数 deprecated（不删，先保留）。

- `frontend/src/canvas/components/shared/OutlineView.tsx`
  - 从直接 `buildOutlineTree` 切换到 `buildOutlineViewModel`。

- `frontend/src/canvas/components/shared/OutlineTreeGroup.tsx`
  - 参数由 `OutlineTreeNode` 升级为 `OutlineItemVM`（含关系摘要）。

### 4.6 交付物

- 关系计算逻辑集中化。
- 组件层复杂度下降，后续迭代更稳。

---

## Phase 3：关系全景与异常检测（高价值）

### 4.7 新增文件

- `frontend/src/canvas/domain/outline/relation-anomalies.ts`
  - 检测：cycle / dangling / orphan / duplicate。

- `frontend/src/canvas/components/shared/outline/RelationOverviewPanel.tsx`
  - 关系全景列表（支持筛选）。

- `frontend/src/canvas/components/shared/outline/RelationDrawer.tsx`
  - 关系详情抽屉（可复用）。

### 4.8 修改文件

- `frontend/src/canvas/components/shared/OutlineView.tsx`
  - 增加模式切换：`structure` / `enhanced` / `relation-only`。

- `frontend/src/canvas/components/shared/toolbar/TopBar.tsx`
  - 可选增加“关系模式”入口（若产品确认放在顶部）。

### 4.9 交付物

- 关系全景页可直接审计全部连接。
- 异常关系有显式提示与跳转。

---

## 5. 关键技术决策（必须统一）

1. **不要在组件里做重关系计算**  
   所有关系算法放入 domain/application 层。

2. **渲染层只拿 VM**  
   组件只处理交互，不拼接业务规则。

3. **Feature Flag 控制**
   - `NEXT_PUBLIC_OUTLINE_RELATION_ENHANCED=true/false`
   - 支持灰度与快速回滚。

4. **性能策略**
   - 关系索引 `useMemo + version key`。
   - 大图时分块计算（`requestIdleCallback` 降级 `setTimeout`）。

---

## 6. 回归测试清单（按场景）

## 6.1 功能回归

- 打开/关闭大纲不影响主画布编辑。
- 关系徽标点击可打开抽屉并展示完整入/出边。
- 从抽屉点击目标节点可正确聚焦（`canvas:focus-bbox`）。
- Share 只读场景下不可编辑，但可查看关系与跳转。

### 6.2 数据完整性回归

- 连接总数与关系全景中展示总数一致（允许过滤差异但需可追踪）。
- 跨容器连接计数正确。
- 含环路画布能提示 cycle。
- 脏连接（from/to 缺失节点）不会导致崩溃，并显示异常。

### 6.3 性能回归

- 1k 节点 / 2k 连线：首次打开大纲 < 300ms（目标）。
- 模式切换不卡死，无明显 UI 冻结。
- 抽屉打开延迟可接受（目标 < 100ms）。

### 6.4 兼容性回归

- 旧画布（无 `metadata`、历史脏数据）可正常展示。
- 现有 todo 编辑、title 编辑行为不回归。
- `canvas-link` 跳转行为不回归（含 `?view=outline`）。

---

## 7. 验收指标与口径

- **关系覆盖率**：`displayed_edges / total_edges >= 99%`
- **关系可达率**：任一节点全量关系 1 次点击可达
- **异常可见率**：cycle/dangling/orphan 在 UI 可见
- **回归缺陷**：P0=0，P1<=2（且有 workaround）

---

## 8. 埋点计划（建议接入）

- `outline_mode_switched`
- `outline_relation_badge_clicked`
- `outline_relation_drawer_opened`
- `outline_relation_edge_navigated`
- `outline_relation_anomaly_exposed`

每个事件至少包含：

- `canvas_id`
- `node_id`（适用时）
- `mode`
- `edge_count_in/out`
- `is_share_view`

---

## 9. 风险与回滚机制

## 9.1 风险

- 大图关系计算带来性能波动。
- 旧数据不规范导致异常分支增多。
- 模式升级可能引发交互认知迁移成本。

### 9.2 回滚

- 通过 Feature Flag 一键退回当前结构模式。
- 组件层保留旧 `outlineSelectors` 兼容入口一段时间。
- 发布期对异常统计做实时监控，超阈值自动降级。

---

## 10. 执行建议（团队协作）

1. 产品先确认三种模式命名与默认模式。
2. 设计给出关系徽标、抽屉、全景列表视觉稿。
3. 前端先完成 Phase 1（1~2 个迭代内上线）。
4. Phase 2 在不改变交互前提下做域层重构。
5. Phase 3 作为增强能力灰度给高级用户。

---

## 11. 开发任务拆分模板（可直接贴 Jira）

- `OUTLINE-101`：新增关系摘要 VM 与类型定义
- `OUTLINE-102`：OutlineItem 增加关系徽标与交互回调
- `OUTLINE-103`：RelationDrawer 组件与样式
- `OUTLINE-104`：构建 RelationGraph 领域层
- `OUTLINE-105`：build-outline-view-model 接入
- `OUTLINE-106`：异常检测与全景视图
- `OUTLINE-107`：埋点接入与指标看板
- `OUTLINE-108`：回归测试与灰度发布

