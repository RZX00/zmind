# Rendering Mapping（代码 ↔ 渲染对照）

本文件说明节点数据如何映射到 UI 渲染与交互，便于调试与提示工程严格对齐。

## 总览
- 节点容器（定位/交互/外观）：frontend/src/canvas/components/nodes/shared/NodeContainer.tsx:480
- 节点编辑/渲染分发：frontend/src/canvas/components/editors/EditorManager.tsx:41
- 连线层（动态几何）：frontend/src/canvas/components/core/layers/ConnectionsLayer.tsx:1
- 思维导图布局与元数据：frontend/src/canvas/utils/mindmapLayout.ts:1

## 定位与容器（NodeContainer）
- 绝对定位：`left=x, top=y, width, height`
- 选中与拖拽：容器负责鼠标事件，编辑态禁用拖拽
- 背景与透明度：
  - 非媒体/非形状装饰：根据 `node.textStyles.opacity` 设置卡片背景与毛玻璃
  - 有 `shapeDecoration` 时，内容区透明，由装饰层绘制背景/边框（ShapeDecorationLayer）
- zIndex：列（column）优先级最低；选中节点提升 zIndex
- 滚轮锁：选中节点若内部存在可滚动区，拦截滚轮避免触发画布缩放

## 节点类型到编辑器的映射（EditorManager）
- text → TextNode / TextNodeEditor（Markdown 渲染/编辑，支持 `textStyles` 与 `accentColor`）
- todo → TextNodeEditor + 前缀 checkbox（`completed`）
- code →
  - codeType=mermaid → MermaidNodeEditor（`mermaidTheme`）
  - codeType=html → HTMLNodeEditor
  - codeType=svg → SvgNodeEditor（`svgTheme`、`svgMetadata`）
  - 其它 → CodeNodeEditor
- table → TableNode（结构化 `data.rows`（二维数组，附加 columnWidths/rowHeights 可选），选中/编辑态显示行列号）
- media → MediaNodeEditor（图片/视频手动等比缩放）
- column → ColumnContainer（`children[]` 顺序栈式布局，展开/收起）
- canvas-link → CanvasLinkNode（首次渲染根据标题优化尺寸；双击跳转）

## 连线渲染（ConnectionsLayer + dynamicConnectionRenderer）
- 计算渲染几何（不落盘）：
  - 基于节点矩形边界与中点法线，动态选择出入边（左右/上下）；
  - 计算贝塞尔控制点并输出路径；
- 视图裁剪：节点数较多时基于视口剔除非可视连线
- 跳过 group 端点：若连线端点为 group 节点，不渲染（仅渲染非 group 节点间连线）

- 用户可编辑参数（会持久化）：
  - 自由线：`fromPoint{x,y}, toPoint{x,y}`（仅使用点端点；不要同时携带 `from/to`）；
  - 曲率：`curveAnchor{x,y}` 或 `anchorParams{u,v}`；
  - 模式/强度：`curveMode: 'auto'|'tension'|'manual'|'orthogonal'`，`tension` 默认 `0.35`（见 `stores/settings.store.ts`）；
  - 样式：`style: 'line'|'arrow'`，`dashed?: boolean`

## 思维导图（Group + mindmap）
- 识别：`type='group' && groupMode='mindmap' && mindmap.meta`；成员为 `children[]`
- 归属：成员节点需设置 `parentGroupId=group.id`
- 布局：
  - `tidyLayout(canvas, groupId)` 依据 root 保持左侧位置、按列对齐；父节点与子树中心对齐；
  - `applyLayout(result)` 将新位置回写成员节点 `x/y`；
- 折叠：`mindmap.collapsed[nodeId]=true` 隐藏其后代（不隐藏自身）
- 连接：参与布局的连线仅限“组内成员之间”的边；跨组连线可视为“跨引用”，不参与布局

## Column（收集栏）
- 显示顺序即 `children[]` 顺序；内部以固定 padding/间距栈式排布
- 收起：高度固定为标题区（60）；展开：高度随子项总高自动增高
- 禁止嵌套：`column.children` 不允许包含 `type='column'`

## 形状装饰（ShapeDecorationLayer）
- 类型：`none|circle|diamond|custom`；
- 内容区域：
  - circle：使用最大内接正方形区域居中；
  - diamond：使用四边中点矩形（50% 尺寸）居中；
- 透明度：结合 `node.textStyles.opacity` 计算最终填充透明度

## 表格（TableNode）
- 选中态：展示行列号、细网格线；
- 编辑：单击选中→再单击进入编辑；回车保存；Esc 取消；右键菜单插入/删除行列

## 媒体（MediaNode）
- 初始尺寸：`240 x 160`；
- 等比缩放：用户手动 resize 时对图片/视频强制保持纵横比

---

> 本映射基于当前前端实现；核心不变量：
> - 连接几何不落盘；
> - group/mindmap 通过成员与元数据确定布局；
> - 表格优先使用结构化数据。
