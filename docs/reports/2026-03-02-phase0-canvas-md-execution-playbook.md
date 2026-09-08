# Phase 0 Execution Playbook

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 文档类型 | 执行文档（Phase 0 可落地任务） |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 关联文档 | `docs/prd-canvas-md-unified-knowledge-os.md` |
| 关联文档 | `docs/reports/2026-03-02-canvas-md-unified-execution-plan.md` |

## 1. Phase 0 定义

### 1.1 目标

Phase 0 不做“大功能上线”，只做“架构地基”和“一致性治理”：

1. 统一 BFF 代理层请求/响应头契约，消除 route 间行为差异。
2. 补齐 Doc 一等公民所需最小契约草案（不影响现网流程）。
3. 修复当前已知一致性风险（ETag 作用域、隐式路由依赖、缓存回流策略）。
4. 建立可观测性与验收基线，保障后续 Phase 1/2 安全推进。
5. 冻结 Doc 复用文本节点编辑器和图片上传管线的契约（能力复用，不重复造轮子）。

### 1.2 非目标

1. 不在 Phase 0 交付完整 Markdown 编辑器。
2. 不在 Phase 0 切换数据库主模型到 `items/docs/references`。
3. 不在 Phase 0 扩展 UI 复杂交互，仅提供兼容位与稳定性增强。

## 2. 当前问题与改造方向

```text
现状
  -> canvases 路由使用统一 proxy helper
  -> folders/workspace 仍是手写 proxy
  -> header 透传策略不一致
  -> /api/canvases/meta 等路径依赖动态路由兜底
  -> workspace etagRef 未按 workspace 隔离

Phase 0 目标态
  -> 单一 proxy contract + 单一 header 策略
  -> 显式路由覆盖关键端点
  -> workspace cache/etag 强作用域
  -> mutation 与 websocket 回流形成确定性闭环
```

## 3. 工作包分解（WP）

| WP | 名称 | 优先级 | 结果物 |
|---|---|---|---|
| WP-0 | 契约冻结（Headers/Errors/Patch/Media） | P0 | 接口契约文档 + 类型定义 |
| WP-1 | BFF 代理统一化 | P0 | 共享 proxy helper + 路由改造 |
| WP-2 | 显式路由补齐 | P0 | `/api/canvases/meta` `/api/canvases/trash` |
| WP-3 | Workspace 缓存一致性修复 | P0 | etag 按 workspace 隔离 + 回流策略收敛 |
| WP-4 | 可观测性补齐 | P0 | request_id 全链路 + 关键埋点 |
| WP-5 | Phase 1 数据契约预埋 | P1 | `item/doc/reference` DTO 草案 |
| WP-6 | 验收与回滚演练 | P0 | 测试报告 + 回滚脚本 |

## 4. 关键契约（Phase 0 必须冻结）

### 4.1 请求头契约（BFF -> Backend）

| Header | 是否必需 | 说明 |
|---|---|---|
| `Authorization` | 是 | 用户或 invite token |
| `X-Workspace-Id` | 是 | 当前工作区主边界 |
| `X-Client-Request-Id` | 建议 | 追踪与幂等观察 |
| `Idempotency-Key` | 变更请求建议 | 防重复写 |
| `X-Client-Session-Id` | 协作场景建议 | 客户端会话关联 |
| `X-Canvas-Session-Id` | 画布写入建议 | 画布协作链路 |
| `If-Match` | 条件写必需 | 乐观锁 |
| `If-None-Match` | 条件读建议 | ETag/304 |

### 4.2 响应头契约（Backend -> BFF -> Client）

| Header | 说明 |
|---|---|
| `ETag` | 缓存校验 |
| `Cache-Control` | 缓存策略 |
| `Content-Type` | 内容类型 |
| `X-Snapshot-Source` | 快照来源（命中/回源） |
| `X-Request-Id` | 全链路追踪（新增） |

### 4.3 Patch Envelope 契约（前后端）

```json
{
  "type": "workspace_patch",
  "workspaceId": "ws_xxx",
  "version": 123,
  "ts": 1730000000000,
  "requestId": "req_xxx",
  "changes": [
    { "entity": "canvas|folder|item|doc|reference", "action": "create|update|delete|move", "data": {} }
  ]
}
```

Phase 0 要求：
1. 兼容现有 `canvas/folder`，同时预留 `item/doc/reference` 枚举。
2. requestId 贯通 mutation 与 patch 回流。

### 4.4 Media Contract（Doc 与 Canvas 共用）

1. Doc 图片上传沿用现有文件上传能力，新增 `source=doc` 语义标签。
2. 图片 URL 必须走统一 media proxy，不在文档中持久化裸存储路径。
3. 编辑器层统一使用 `onUploadImage(file) => Promise<string>` 能力注入。
4. 粘贴/拖拽/文件选择三种入口的上传和错误态行为一致。

## 5. 文件级改造清单（精准到路径）

## 5.1 WP-1: BFF 代理统一化

### 新增

1. `frontend/src/app/api/_shared/proxy.ts`
2. `frontend/src/app/api/_shared/proxy-headers.ts`
3. `frontend/src/app/api/_shared/proxy-types.ts`

### 改造

1. [`frontend/src/app/api/folders/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/folders/route.ts)
2. [`frontend/src/app/api/folders/[folder_id]/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/folders/[folder_id]/route.ts)
3. [`frontend/src/app/api/folders/[folder_id]/canvases/[canvas_id]/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/folders/[folder_id]/canvases/[canvas_id]/route.ts)
4. [`frontend/src/app/api/workspace/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/workspace/route.ts)
5. [`frontend/src/app/api/workspace/meta/route.ts`](/mnt/e/app/zmind/frontend/src/app/api/workspace/meta/route.ts)
6. [`frontend/src/app/api/canvases/_proxy.ts`](/mnt/e/app/zmind/frontend/src/app/api/canvases/_proxy.ts)（适配 shared helper）
7. [`frontend/src/app/api/canvases/proxyHeaders.ts`](/mnt/e/app/zmind/frontend/src/app/api/canvases/proxyHeaders.ts)（迁移为 shared）

### 交付标准

1. 所有上述 route 使用同一套 header 白名单策略。
2. 支持统一选项：`includeIfMatch/includeIfNoneMatch/allow304/allow204/forwardCookie`。
3. 避免 route 手写分叉逻辑。

## 5.2 WP-2: 显式路由补齐

### 新增

1. `frontend/src/app/api/canvases/meta/route.ts`
2. `frontend/src/app/api/canvases/trash/route.ts`

### 说明

当前 `meta`/`trash` 依赖动态 `[canvas_id]` 兜底，Phase 0 改为显式路由避免未来命名冲突与行为不确定。

## 5.3 WP-3: Workspace 缓存一致性修复

### 改造

1. [`frontend/src/hooks/useWorkspaceData.ts`](/mnt/e/app/zmind/frontend/src/hooks/useWorkspaceData.ts)
2. [`frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts)
3. [`frontend/src/hooks/react-query/workspace/apply-patch.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/apply-patch.ts)
4. [`frontend/src/hooks/react-query/workspace/keys.ts`](/mnt/e/app/zmind/frontend/src/hooks/react-query/workspace/keys.ts)

### 必做项

1. `etagRef` 改为 `Map<workspaceId, etag>`，切 workspace 自动隔离。
2. mutation 成功后增加“保底 revalidate”策略（延迟触发，可被 patch 抵消）。
3. patch 版本断档逻辑继续保留，增强日志与指标。
4. 为后续 `item/doc/reference` 增加字段容错，不导致旧客户端崩溃。

## 5.4 WP-4: 可观测性补齐

### 前端

1. mutation 请求注入 `x-client-request-id`（若未提供自动生成）。
2. WS patch 应用日志包含：`workspaceId version requestId changeCount`。

### 后端

1. [`backend/core/workspace/service.py`](/mnt/e/app/zmind/backend/core/workspace/service.py) 补 `requestId` 回传与日志。
2. [`backend/core/folders/api.py`](/mnt/e/app/zmind/backend/core/folders/api.py) 在关键写接口标准化 `X-Client-Request-Id` 使用。
3. 统一 warning/error 结构字段，便于聚合检索。

## 5.5 WP-5: Phase 1 契约预埋

### 新增（仅 DTO/类型，不启用主流程）

1. `backend/core/items/api_models.py`
2. `backend/core/docs/api_models.py`
3. `backend/core/references/api_models.py`
4. `frontend/src/types/workspace-item.ts`
5. `frontend/src/types/reference.ts`

### 目标

1. 先冻结字段，后续 Phase 1/2 可并行开发，避免反复改 schema。

## 6. 执行顺序与依赖

```text
WP-0 (契约冻结)
  -> WP-1 (BFF 统一)
  -> WP-2 (显式路由)
  -> WP-3 (缓存一致性)
  -> WP-4 (可观测性)
  -> WP-6 (验收/回滚)

WP-5 可在 WP-1 之后并行推进
```

## 7. 验收清单（DoD）

## 7.1 功能验收

1. `folders/workspace/canvases` BFF 代理行为一致（头透传、304、content-type）。
2. `/api/canvases/meta`、`/api/canvases/trash` 命中显式 route。
3. workspace 切换后不复用旧 ETag。
4. websocket 断开情况下，mutation 后仍能在窗口内回收一致性（保底 revalidate 生效）。
5. media contract 文档完成并与现有上传实现对齐（`onUploadImage` + proxy URL）。

## 7.2 工程验收

1. 新增 shared proxy helper 被所有相关 route 使用。
2. 无新增 ESLint/TS 错误。
3. 有最小测试覆盖：
   - route proxy header forwarding
   - etag scoped by workspace
   - patch gap fallback refetch

## 7.3 质量闸门

| Gate | 标准 |
|---|---|
| G1 | 单元测试通过 |
| G2 | 核心集成测试通过 |
| G3 | 手工回归（新建/移动/删除/切 workspace）通过 |
| G4 | 观测面板可见 requestId 贯通 |

## 8. 回滚预案

```text
触发条件:
  - 代理层错误率突增
  - workspace 数据不一致频发

回滚动作:
  1) 关闭 Phase0 相关 feature flag
  2) route 回退到旧 proxy 实现（保留新文件不删除）
  3) 清空受影响 workspace cache key
  4) 导出 requestId 错误样本用于复盘
```

## 9. 风险矩阵（Phase 0）

| 风险 | 等级 | 对策 |
|---|---|---|
| 代理重构引入 header 丢失 | 高 | 契约测试 + 金丝雀 workspace |
| ETag 逻辑调整导致过度回源 | 中 | 观测 304 命中率并调优 |
| 显式路由覆盖不全 | 中 | 添加 route snapshot 测试 |
| requestId 不连续 | 中 | 前端兜底生成 + 后端透传断言 |

## 10. 本周可直接开工任务（Task Board）

| ID | 任务 | 文件 | 预计 |
|---|---|---|---|
| T-001 | 新建 shared proxy helper | `frontend/src/app/api/_shared/*` | 0.5d |
| T-002 | folders routes 全量迁移 shared helper | `frontend/src/app/api/folders/**` | 0.5d |
| T-003 | workspace routes 全量迁移 shared helper | `frontend/src/app/api/workspace/**` | 0.5d |
| T-004 | canvases proxy 接入 shared helper | `frontend/src/app/api/canvases/_proxy.ts` | 0.5d |
| T-005 | 补显式 meta/trash route | `frontend/src/app/api/canvases/{meta,trash}` | 0.25d |
| T-006 | 修复 etag workspace 作用域 | `frontend/src/hooks/useWorkspaceData.ts` | 0.5d |
| T-007 | mutation 保底 revalidate | `frontend/src/hooks/react-query/workspace/use-workspace-mutations.ts` | 0.5d |
| T-008 | patch/type 向前兼容字段 | `frontend/src/hooks/react-query/workspace/apply-patch.ts` | 0.25d |
| T-009 | requestId 全链路日志 | `backend/core/workspace/service.py` 等 | 0.5d |
| T-010 | 测试与回归报告 | `frontend/backend tests + report` | 1d |
| T-011 | 冻结 Doc 图片上传契约（复用现有上传管线） | `docs + api contract` | 0.25d |

## 11. 提交策略（Phase 0）

建议按子阶段提交，确保每次可回滚：

1. `refactor(bff): unify proxy helper and header contract`
2. `feat(bff): add explicit canvases meta/trash routes`
3. `fix(workspace): scope etag by workspace and stabilize revalidate`
4. `chore(observability): propagate request ids across workspace mutations`
5. `test(workspace): add proxy and cache consistency coverage`

## 12. Phase 0 完成判定

满足以下全部条件即视为完成：

1. 代码层完成 WP-1/2/3/4，WP-5 至少冻结 DTO。
2. 手工验证通过以下链路：
   - 新建画布
   - 文件夹移动
   - 删除文件夹并迁移画布
   - 切 workspace 并刷新
3. 观测系统可按 requestId 追踪一次完整 mutation -> patch -> UI 回流。
4. 产出 Phase 0 复盘报告并进入 Phase 1。
