# Zmind Canvas Contract v1

本文件定义了前端/后端共同遵循的画布数据契约（v1），提供：
- 顶层 Canvas 对象、节点与连接的字段与约束
- 固定大小与自动大小的尺寸策略（Sizing Policy）
- JSON Schema（用于结构化校验）与示例（examples/）

## 快速索引
- 契约 JSON Schema: `docs/canvas-contract-v1/schema/canvas.v1.json`
- 操作集 JSON Schema: `docs/canvas-contract-v1/schema/canvas.ops.v1.json`
- 意图层 JSON Schema: `docs/canvas-contract-v1/schema/canvas.intent.v1.json`
- 示例数据集: `docs/canvas-contract-v1/examples/`
- 尺寸策略（固定大小与自动大小）: `docs/canvas-contract-v1/guidelines/sizing.md`
- 操作归一化规则: `docs/canvas-contract-v1/guidelines/ops-normalization.md`
- 错误结构约定: `docs/canvas-contract-v1/guidelines/errors.md`
- 意图层说明: `docs/canvas-contract-v1/guidelines/intent.md`

## 契约概要
- Canvas 必填: `id,title,nodes[],connections[],createdAt,updatedAt,version`
- Canvas 可选: `serverVersion`（并发控制，If‑Match 使用此字段）、`metadata`（如 `connectionAnchors/connectionAnchorParams`）
- Node 必填: `id,type,x,y,width,height,content,createdAt,updatedAt`
- Connection 必填: `id,createdAt`；端点二选一：
  - 节点连线：`from,to`（必须为非 group 节点）
  - 自由线：`fromPoint{x,y},toPoint{x,y}`（仅使用点端点；不要同时设置 `from/to`）
- 节点类型：`text,todo,code(mermaid|html|svg),table,media,column,canvas-link,group`
- group 可选 `groupMode:'mindmap'` 和 `mindmap` 元数据（`rootId,spacingX,spacingY,...`）
- 连接的几何“计算结果”不持久化（实时计算）。但以下“用户意图/可编辑参数”允许持久化：
  - 自由线（纯线条）：`fromPoint{x,y}, toPoint{x,y}`（注意：不应同时携带 `from/to`；历史数据若存在占位值应清洗掉）
  - 曲率锚点：`curveAnchor{x,y}` 或规范化参数 `anchorParams{u,v}`；可选 `curveMode, tension`
  - 渲染提示：`style: 'line'|'arrow', dashed?: boolean`

## 固定大小与自动大小（结论）
- 契约层要求所有节点提供初始 `width,height`（固定初始值）。
- 自动大小是“运行期行为”，不是数据契约字段：
  - 文本/待办：前端会根据内容和全局预设在编辑/渲染时自动增高；
  - Mermaid：前端测量 SVG 内容边界后自适配；
  - SVG：基于 `<svg>` 的 viewBox/width/height 推断内容尺寸并适配；
  - 表格：推荐按行列计算初始尺寸；
  - Canvas Link：首次渲染会依据标题自动优化尺寸；
  - 媒体：图片/视频手动调整时保持等比；
  - Column：展开时可基于子项高度自动增高，收起时高度固定为标题区高度。
- 为确保 AI 生成的节点即刻“看起来合理”，请遵循各类型“推荐初始尺寸”和“自动尺寸行为说明”（见 sizing.md）。

## 设计原则
- 简单且稳定：Schema 只描述持久化字段；自动尺寸不作为持久化状态存储。
- 可前向扩展：未知字段在后端被忽略；渲染层不依赖非必要字段。
- 明确的 Do/Don't：避免“连线指向 group”、避免 `column` 嵌套 `column` 等。

## 校验与清洗
- 结构校验：使用 JSON Schema（见 `schema/canvas.v1.json`）。
- 后置规则（非 JSON Schema 能力范围）：
  - `nodes[].id` 与 `connections[].id` 全局唯一；
  - 连接端点：
    - 节点连线：`connections[].from/to` 必须引用存在的“非 group”节点；
    - 自由线：当存在 `fromPoint/toPoint` 时，`from/to` 必须缺省（或为 null）；不要用占位字符串；
  - `group.children[]` 去重且不得包含自身，成员节点 `parentGroupId` 与之匹配；
  - `column.children[]` 不能包含 `column`；
- 服务端清洗（摘要）：
  - 移除 UI 态 `selected,isEditing` 与 `locked:false`；
  - 非 `code` 节点移除 `codeType/mermaidTheme*`；非 SVG 节点移除 `svgTheme/svgMetadata`；
  - 不写入“计算得到的几何数据”（如实时控制点）；仅保留用户意图字段（`curveAnchor/anchorParams/fromPoint/toPoint/style/dashed`）。
  - `title` 仅对 `canvas-link` 有意义；`column/group` 的标题语义统一映射在 `content` 首行，若出现 `title` 应予移除。

## 示例
- 最小可用：`examples/minimal.json`
- 思维导图：`examples/mindmap.json`
- 表格：`examples/table.json`
- 混合：`examples/mixed.json`
- SVG 节点：`examples/svg.json`
- 自由线（纯线条）：`examples/free_line.json`

更多细节与尺寸规则见 `guidelines/sizing.md`。另见 `guidelines/mapping.md`（连接曲线与自由线渲染）。

## 新增默认值要点（v1 扩展）
- SVG 节点（code:svg）：
  - 默认尺寸：`400×400`；
  - 默认主题：`svgTheme.colorScheme = 'light'`，`colors.primary = '#3b82f6'` 等；
  - 默认元数据：`svgMetadata.viewBox = '0 0 200 200'`，`preserveAspectRatio = 'xMidYMid meet'`；
  - 参见：`frontend/src/canvas/components/core/systems/NodeDefaults.ts`。
- 连线曲率：
  - 默认策略：`curveModeDefault = 'auto'`，`tension = 0.35`；
  - 参见：`frontend/src/canvas/stores/settings.store.ts`。
