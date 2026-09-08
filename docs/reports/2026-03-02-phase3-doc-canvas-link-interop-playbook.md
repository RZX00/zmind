# Phase 3 Playbook: Doc <-> Canvas Bidirectional Link Interop

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 阶段 | Phase 3 |
| 文档类型 | 执行文档（双链闭环） |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 前置依赖 | Phase 2 |

## 1. 阶段目标

1. 把“文档块插入画布”做成一键主路径。
2. 建立可追踪的双向链接（source -> target + backlinks）。
3. 支持 `reference` 与 `snapshot` 两种模式。
4. 保证含图片的文档块插入画布后仍可读、可回跳。

## 2. 核心业务流

```text
Doc block selected
  -> Insert into Canvas
  -> create reference edge
  -> create/update canvas doc_ref node
  -> workspace patch broadcast
  -> Canvas render + Doc backlink update
```

## 3. 数据与协议

## 3.1 Reference 数据

```text
Reference
  id
  source_type: doc_block | canvas_node
  source_item_id
  source_anchor
  target_type: canvas | doc | doc_block
  target_item_id
  target_anchor
  mode: reference | snapshot
  snapshot_payload(optional)
```

## 3.2 Canvas Node 扩展

在 `CanvasNode` 引入 `doc_ref` 子类型：

```text
doc_ref node
  node.id
  node.type = "text" | "doc_ref" (implementation choice)
  node.ref:
    refId
    sourceDocItemId
    sourceBlockId
    mode
    syncState: synced | stale | missing | forbidden
```

## 4. 前端任务分解

| WP | 名称 | 优先级 | 说明 |
|---|---|---|---|
| WP-3-1 | 块级选择与插入动作 | P0 | Doc 侧 block menu 增加 `Insert into Canvas` |
| WP-3-2 | 画布节点 schema 扩展 | P0 | 支持 doc_ref 渲染与状态 |
| WP-3-3 | 双向跳转 | P0 | Node -> Source, Doc -> Referencing nodes |
| WP-3-4 | backlink panel | P0 | Doc 页显示被引用列表 |
| WP-3-5 | 图片块渲染兼容 | P1 | doc_ref 内图片可读与降级 |
| WP-3-6 | 异常态恢复 | P0 | orphan/forbidden/stale 三类状态处理 |

## 5. 后端任务分解

| WP | 名称 | 优先级 | 说明 |
|---|---|---|---|
| WP-3-B1 | references command API | P0 | create/delete edge |
| WP-3-B2 | backlinks query API | P0 | target 反查 |
| WP-3-B3 | resolve API | P0 | 批量解析并权限过滤 |
| WP-3-B4 | patch 事件扩展 | P0 | `reference_patch` / `item_patch` |
| WP-3-B5 | consistency checker | P1 | 定时扫描孤儿边 |

## 6. 文件级改造清单

### 6.1 前端

1. [`frontend/src/components/docs/DocEditorShell.tsx`](/mnt/e/app/zmind/frontend/src/components/docs/DocEditorShell.tsx)（新增插入动作）
2. [`frontend/src/canvas/types/canvas.ts`](/mnt/e/app/zmind/frontend/src/canvas/types/canvas.ts)
3. [`frontend/src/canvas/components/core/CanvasEditor.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/core/CanvasEditor.tsx)
4. `frontend/src/canvas/components/nodes/DocRefNode*.tsx`（新增）
5. `frontend/src/components/docs/BacklinkPanel.tsx`（新增）
6. [`frontend/src/hooks/useWorkspaceData.ts`](/mnt/e/app/zmind/frontend/src/hooks/useWorkspaceData.ts)（patch 新实体容错）

### 6.2 后端

1. `backend/core/references/api.py`
2. `backend/core/references/service.py`
3. `backend/core/references/repository.py`
4. [`backend/core/workspace/service.py`](/mnt/e/app/zmind/backend/core/workspace/service.py)（patch 扩展）
5. [`backend/core/workspace/api.py`](/mnt/e/app/zmind/backend/core/workspace/api.py)

## 7. 引用模式策略

| 模式 | 行为 | 适用场景 |
|---|---|---|
| reference | 实时反映源块内容变化 | 持续同步知识 |
| snapshot | 记录插入时内容，手动刷新 | 决策留档、审计快照 |

## 8. 图片块插入规范

1. 如果源块含图片，`reference` 模式默认渲染代理 URL 图片。
2. 若图片不可访问，节点降级显示可点击链接和权限提示。
3. snapshot 模式可持有轻量化 `snapshot_payload`（含 markdown + image links）。

## 9. 错误态与恢复

| 状态 | 触发条件 | 恢复动作 |
|---|---|---|
| missing | 源块被删除 | 重新绑定块 / 转快照 |
| forbidden | 权限不足 | 请求权限 / 仅显示摘要 |
| stale | 数据版本过旧 | 一键刷新引用 |

## 10. 测试计划

## 10.1 E2E 核心用例

1. Doc block -> Canvas insert -> backlink visible。
2. 更新源块后，reference 节点同步显示变化。
3. 切换 snapshot/reference 后行为符合预期。
4. 删除源块后出现 missing 状态且可恢复。
5. 含图片块插入后渲染正常或安全降级。

## 10.2 权限用例

1. 无权限用户查看 doc_ref 节点时不泄露源内容。
2. 权限恢复后可重新解析引用。

## 11. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 引用边与节点状态不同步 | 高 | 写操作事务化 + patch 补偿 |
| 图片权限导致空白节点 | 中 | 降级渲染 + 重试入口 |
| 大量 backlink 查询压力 | 中 | 索引与分页 |
| 旧客户端不认识新节点类型 | 中 | schema 兼容 + fallback |

## 12. 里程碑与交付

| Milestone | 产出 |
|---|---|
| M3-1 | references API 可用 |
| M3-2 | Doc 插入 Canvas 一键路径打通 |
| M3-3 | backlink panel 与双向跳转上线 |
| M3-4 | 图片块插入兼容完成 |
| M3-5 | 异常态恢复验证通过 |

## 13. Phase 3 完成判定

1. 用户可从文档块一键插入画布。
2. 文档与画布具备双向可追踪关系。
3. reference/snapshot 两模式可用。
4. 图片块插入在权限边界内稳定可读。

