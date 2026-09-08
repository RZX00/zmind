# Phase 2 Playbook: Doc Editor Notion-Parity (Reuse First)

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 阶段 | Phase 2 |
| 文档类型 | 前端执行文档（Doc 编辑体验） |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 前置依赖 | Phase 0 + Phase 1 |

## 1. 阶段目标

Phase 2 目标是交付“可用即强”的 Doc 体验，标准是 Notion 级核心编辑交互，但路径是复用现有能力：

1. Doc 编辑器复用现有 `NovelRichTextEditor` 核心能力。
2. Doc 与 Canvas 在树结构里并列为一等内容。
3. 图片插入能力完整（粘贴/拖拽/文件选择）。
4. Markdown round-trip 可控，避免编辑后内容结构漂移。

## 2. 体验定义（Notion-Parity Baseline）

### 2.1 范围定义

```text
目标是交互同级，不追求像素级视觉复刻
优先级:
1) 编辑行为一致性
2) 输入延迟与稳定性
3) 内容结构可靠性
4) 视觉细节
```

### 2.2 Phase 2 必达能力

| 能力域 | 必达项 |
|---|---|
| Block 编辑 | enter split, backspace merge, multi-line stable behavior |
| Slash 命令 | 基础命令集可用且响应快 |
| 快捷键 | bold/italic/code/link/highlight + undo/redo |
| 结构操作 | block reorder（拖拽或键盘操作） |
| 媒体 | 图片粘贴/拖拽/上传 |
| 稳定性 | autosave + crash-safe recover |

## 3. 复用策略

### 3.1 复用来源（现有代码）

1. 编辑器内核：[`frontend/src/components/editor/novel/NovelRichTextEditor.tsx`](/mnt/e/app/zmind/frontend/src/components/editor/novel/NovelRichTextEditor.tsx)
2. Canvas 文本节点编辑入口：[`frontend/src/canvas/components/editors/TextNodeEditor.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/editors/TextNodeEditor.tsx)
3. 图片上传 adapter：[`frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts`](/mnt/e/app/zmind/frontend/src/canvas/infrastructure/expanded-editor/novel-image-upload.adapter.ts)
4. 媒体上传服务：[`frontend/src/canvas/services/canvas-media.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/canvas-media.service.ts)

### 3.2 复用原则

1. 先适配，不重写内核。
2. Doc 与 TextNode 共享编辑能力边界，行为不分叉。
3. 图片能力复用上传链路，仅新增 `source=doc` 标识。

## 4. 前端架构与路由

```text
/workspace tree
  -> item(type=doc) click
  -> /doc/{itemId} (personal) or /team/{slug}/doc/{itemId}
  -> DocPage
      -> DocEditorShell
          -> NovelRichTextEditor
          -> Backlink/Meta side panels (phase2 minimal)
```

## 5. 实施任务（Work Packages）

| WP | 名称 | 优先级 | 说明 |
|---|---|---|---|
| WP-2-1 | Doc 路由与页面壳层 | P0 | 新增 doc page、team doc page |
| WP-2-2 | 树结构接入 Doc Item | P0 | 侧栏/工作区列表支持 doc 类型 |
| WP-2-3 | 编辑器内核接入 | P0 | Doc 页面接入 Novel 编辑器 |
| WP-2-4 | 图片插入与上传 | P0 | paste/drop/picker 三入口 |
| WP-2-5 | Markdown round-trip 约束 | P0 | 支持语法集定义与回归测试 |
| WP-2-6 | 自动保存与恢复 | P0 | optimistic + debounce save + crash recover |
| WP-2-7 | Notion parity 验证 | P0 | 关键交互一致性测试 |

## 6. 文件级改造清单

### 6.1 新增文件（建议）

1. `frontend/src/app/(dashboard)/doc/[itemId]/page.tsx`
2. `frontend/src/app/(dashboard)/(teamAccount)/team/[accountSlug]/doc/[itemId]/page.tsx`
3. `frontend/src/components/docs/DocEditorShell.tsx`
4. `frontend/src/components/docs/hooks/useDocEditor.ts`
5. `frontend/src/hooks/react-query/docs/use-doc-query.ts`
6. `frontend/src/hooks/react-query/docs/use-doc-mutations.ts`

### 6.2 修改文件（重点）

1. [`frontend/src/components/file-tree/SidebarFileTree.tsx`](/mnt/e/app/zmind/frontend/src/components/file-tree/SidebarFileTree.tsx)
2. [`frontend/src/canvas/components/workspace/CanvasWorkspaceFlattened.tsx`](/mnt/e/app/zmind/frontend/src/canvas/components/workspace/CanvasWorkspaceFlattened.tsx)
3. [`frontend/src/hooks/useWorkspaceData.ts`](/mnt/e/app/zmind/frontend/src/hooks/useWorkspaceData.ts)
4. [`frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts)
5. [`frontend/src/components/editor/novel/NovelRichTextEditor.tsx`](/mnt/e/app/zmind/frontend/src/components/editor/novel/NovelRichTextEditor.tsx)（保持向后兼容）
6. [`frontend/src/canvas/services/canvas-media.service.ts`](/mnt/e/app/zmind/frontend/src/canvas/services/canvas-media.service.ts)（支持 doc source）

## 7. 图片能力详细规范

## 7.1 上传入口

1. 粘贴图片：`Ctrl/Cmd + V`
2. 拖拽图片到编辑区
3. 工具栏/Slash 命令选择图片上传

## 7.2 处理流程

```text
User image input
  -> Novel editor onUploadImage(file)
  -> uploadFileToStorage(file, { source: 'doc' })
  -> resolve proxy-safe URL
  -> insert markdown/image node
  -> optimistic render + retry on failure
```

## 7.3 失败策略

1. 上传失败显示 block-level 错误态与重试按钮。
2. 不阻塞文档其他内容编辑与保存。
3. 失败节点可降级为普通链接文本。

## 8. 数据与接口

### 8.1 必需接口

| API | Method | 用途 |
|---|---|---|
| `/docs/{item_id}` | GET | 拉取文档 |
| `/docs/{item_id}` | PUT | 保存文档（If-Match） |
| `/docs/{item_id}/images` | POST | 图片上传（可选，或走统一 upload service） |

### 8.2 保存策略

1. 变更 debounce 保存（建议 500-1000ms）。
2. 手动保存快捷键 `Cmd/Ctrl + S` 立即 flush。
3. 冲突返回时触发差异恢复 UI（最小版本可 toast + reload merge）。

## 9. 测试计划

## 9.1 功能测试

1. 文档创建、编辑、重命名、删除。
2. 图片三入口插入及预览。
3. 文档切页后状态恢复。

## 9.2 一致性测试

1. 同内容在 TextNode 与 Doc 编辑行为一致。
2. markdown serialize/deserialize 后结构保持。
3. 并发编辑冲突处理可预期。

## 9.3 性能测试

1. 长文档滚动与输入延迟。
2. 图片较多时编辑流畅性。
3. 自动保存频率与后端负载。

## 10. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 复用内核引入 canvas 回归 | 高 | 文本节点回归套件必须先绿 |
| 图片上传链路权限异常 | 高 | 统一 proxy URL 与权限验证 |
| markdown round-trip 漂移 | 中 | 语法白名单 + golden tests |
| 文档大体积性能问题 | 中 | 虚拟化/懒渲染后续优化 |

## 11. 里程碑与交付

| Milestone | 产出 |
|---|---|
| M2-1 | 路由和 Doc 页面壳层上线（灰度） |
| M2-2 | 树结构 Doc 一等公民接入 |
| M2-3 | 编辑器复用与基础编辑闭环 |
| M2-4 | 图片插入全入口可用 |
| M2-5 | parity 回归通过并进入下一阶段 |

## 12. Phase 2 完成判定

满足以下全部条件即完成：

1. 用户可在工作区直接创建并编辑 Doc。
2. Doc 编辑核心行为与文本节点编辑一致。
3. 图片粘贴/拖拽/上传都可用且 URL 安全。
4. 无明显回归影响现有 canvas 编辑流程。

