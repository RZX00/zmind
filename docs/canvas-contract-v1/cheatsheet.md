# Canvas Contract v1 — Cheat Sheet

目的：压缩上下文时快速对齐“节点 ⇄ 底层 JSON ⇄ 渲染/工具”的核心规则。详解见同目录 README、guidelines 与 schema。

—

核心对象
- Canvas 必填: id, title, nodes[], connections[], createdAt, updatedAt, version
- Node 必填: id, type, x, y, width, height, content, createdAt, updatedAt
- Connection 必填: id, createdAt；端点二选一：
  - 节点连线：from, to（必须指向非 group 节点）
  - 自由线：fromPoint{x,y}, toPoint{x,y}（仅使用点端点；不要同时设置 from/to）
  - 可持久化“用户意图”：curveAnchor/style/dashed/anchorParams/curveMode/tension（update_connection 已支持这些字段）；

节点类型与附加字段
- text: 纯文本/Markdown；样式可用 textStyles, accentColor
- todo: 同 text，新增 completed:boolean
- code: 需 codeType: mermaid | html | svg；
  - mermaid 可带 mermaidTheme/mermaidThemeId
  - svg 可带 svgTheme/svgMetadata（viewBox/preserveAspectRatio/width/height）
- table: 需 data.rows[][]（可选 columnWidths[], rowHeights[]），样式可用 tableStyles
- media: fileName, fileType, fileExtension, fileSize, mediaType, uploadStatus
- column: children[]（不允许包含 column），展开/收起由前端态管理
- canvas-link: title（首次渲染可自适应尺寸），可选 linkStyles
- group: children[]；可选 groupMode: mindmap 与 mindmap 元数据（rootId, spacingX, spacingY, ...）

尺寸策略（固定 vs 自动）
- 所有新增节点必须提供初始 width/height（契约必填）
- 自动尺寸为“运行期行为”，不写入 JSON：
  - text/todo：按内容行数自动增高（首次/编辑时）
  - code(mermaid)：首次渲染测量 SVG 后自适配一次
  - code(svg)：解析 <svg> 的 viewBox 或 width/height 推断尺寸
  - table：推荐按行列估算初始；后续交互增改
  - media：手动调整时强制等比
  - column：收起固定为标题高；展开随子项总高增高
- 默认初始尺寸：
  - text/todo: 300×60；mermaid: 350×250；html: 650×540；svg: 400×400
  - table: 400×130；canvas-link: 280×180；media: 240×160；column: 300×200

渲染映射（数据 → UI）
- 容器定位：绝对定位 left=x, top=y, width, height（NodeContainer）
- 编辑器分发：按 type 路由至各编辑器（EditorManager）
- 连线：几何由渲染层实时计算（ConnectionsLayer + dynamicConnectionRenderer）；
  - 节点连线：端点锚位基于矩形法线与间距动态选择；
  - 自由线：使用 fromPoint/toPoint 渲染；
  - 曲线：支持 curveAnchor/anchorParams 持久化并用于渲染（工具仅支持 curveAnchor）
- 思维导图：group(type=group, groupMode=mindmap, mindmap.meta) + children[] + 节点 parentGroupId → 布局函数计算节点位置

???????/??/???
- ???canvas_read (scope/where/limit)
- ???canvas_write (nodes/connections/anchor/layout/spacing)
- ??/???canvas_edit ($set/$delete/$connections/$operations/$transform)
- ?????
  1) ??? ? ?? canvas_write
  2) ????? ? canvas_read??? scope=selection?? canvas_edit
- ?? operations?
  - add_node { node:{ id,type,x,y,width,height,content?... } }
  - update_node { id, patch:{} } / move_node { id, x?, y? }
  - apply_style { id, patch:{ textStyles/accentColor/... } }
  - add_connection { from, to, label? } / delete_connection { id }

Do / Don’t（关键约束）
- Do：新增节点务必给出 width/height（固定初始）
- Do：节点连线仅指向“非 group 节点”；自由线请使用 fromPoint/toPoint
- Do：group.children 去重且不含自身；成员节点需标注 parentGroupId
- Don’t：column.children 里放 column（禁止嵌套列）
- Don’t：把“计算出来的”控制点落盘（由渲染层计算）；允许写入 curveAnchor/anchorParams 这类“用户意图”参数

最小示例（片段）
```
{
  "id": "canvas_1",
  "title": "示例",
  "nodes": [
    {"id":"n1","type":"text","x":100,"y":80,"width":300,"height":60,"content":"# 想法","createdAt":0,"updatedAt":0}
  ],
  "connections": [],
  "createdAt": 0,
  "updatedAt": 0,
  "version": "1.0.0"
}
```

函数调用片段（添加节点+连线，原生 JSON）
```
{
  "tool_calls": [
    { "type": "function", "function": { "name": "canvas_read", "arguments": {} } },
    { "type": "function", "function": {
        "name": "canvas_edit",
        "arguments": {
          "operations": [
            {"op":"add_node","node":{"id":"text-101","type":"text","x":120,"y":100,"width":300,"height":60,"content":"# 新想法"}},
            {"op":"add_connection","from":"text-101","to":"text-2","label":"ref"}
          ]
        }
    }}
  ]
}
```

代码与文档索引
- 工具注册：backend/core/langgraph_engine/tools/adapters/native_tool_adapter.py
- 读工具：backend/core/canvas/cac/tools.py
- 写工具：backend/core/tools/canvas_edit_tool.py
- 渲染容器：frontend/src/canvas/components/nodes/shared/NodeContainer.tsx
- 编辑器分发：frontend/src/canvas/components/editors/EditorManager.tsx
- 连线层：frontend/src/canvas/components/core/layers/ConnectionsLayer.tsx
  - 动态曲线：frontend/src/canvas/utils/dynamicConnectionRenderer.ts
  - 曲率设置：frontend/src/canvas/stores/settings.store.ts
- 尺寸与默认值：frontend/src/canvas/components/core/systems/NodeDefaults.ts
- 契约与示例：docs/canvas-contract-v1/schema/canvas.v1.json，docs/canvas-contract-v1/examples/
- 尺寸规则：docs/canvas-contract-v1/guidelines/sizing.md
- 工具手册：docs/canvas-contract-v1/guidelines/tools.md

—

压缩建议
- 仅保留本页 + schema 文件路径与关键工具名；遇到细节查询再展开查阅 README/guidelines。
