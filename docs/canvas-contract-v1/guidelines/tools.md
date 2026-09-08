# Canvas Tools Handbook (CaC)

本手册面向编排/提示工程，说明 Agent 如何通过 **Canvas as Code (CaC)** 工具读取与修改画布。

> 重要：LLM 可见的画布工具只有 `canvas_read` / `canvas_write` / `canvas_edit` / `canvas_generate_image`。  
> 底层落库与校验由 realtime apply + 后端写入服务完成；本手册只描述 **LLM 侧调用契约** 与关键约束。

## 1) 工具与能力边界

### canvas_read(scope?, where?, limit?)
- 作用：读取画布（或选区/视口）节点与连线，供后续定位 id 与理解现状。
- 参数：
  - `scope`: `"all" | "selection" | "viewport"`（默认 all）
  - `where`: 过滤条件（示例：`{ "type": "text", "content": { "$contains": "关键词" } }`）
  - `limit`: 最多返回多少节点
- 输出：`{ canvas: { id,title,nodes[],connections[] }, selection?: [...] }`

### canvas_write(nodes?, connections?, tree?, anchor?, layout?, spacing?, columns?)
- 作用：创建 **新节点**，并可在同一次调用中创建 **节点-节点连线**（仅 node endpoints）。
- 关键约束：
  - 必须提供 `nodes` 或 `tree`（不能只“加一条连线”）。
  - 节点 id 由系统生成；如需在一次调用中引用新节点，使用临时 `$id`（如 `$1/$2`）。
  - `group/column` 等容器节点的 `children[]` 也允许引用本次新建节点的 `$id`，会在同一次 `canvas_write` 内自动解析。
  - `layout="mindmap"` 且提供 `tree` 时：工具会自动创建一个 `groupMode="mindmap"` 的导图组，并返回 `groupId`。
  - `connections` 支持：
    - `{ preset: "none" | "chain" | "star" | "tree" }`
    - `{ items: [{ from, to, label?, style?, dashed? }, ...] }`
- 返回：包含 `idMap`（临时 `$id` -> 真实 id），用于后续 `canvas_edit` 精修。

### canvas_edit({ nodeId: patch, ... } + $delete/$select/$set/$canvas/$connections)
- 作用：修改/删除现有节点；修改/删除现有连线；更新画布级属性。
- 能力范围（当前 CaC）：
  - **更新节点**：`{ "<nodeId>": { ...patch } }`
  - **删除节点**：`{ "$delete": ["<nodeId1>", "<nodeId2>"] }`
  - **批量更新**：`{ "$select": "<selector>", "$set": { ...patch } }`
  - **更新画布属性**：`{ "$canvas": { "title": "...", "backgroundColor": "...", ... } }`
  - **更新/删除连线（按 id）**：`{ "$connections": { "<connId>": { ...patch }, "$delete": ["<connId>"] } }`
- 重要限制：
  - `canvas_edit` **不会创建新节点**；新建节点请用 `canvas_write`。
  - `canvas_edit` 可以新增“已有节点之间”的连线：用 `$connections: [{from,to,...}]` 或 `$connections: { $add:[...] }`；如果同时在创建节点，优先在 `canvas_write` 里用 `$id` + `connections` 一次完成。
  - 连线更新必须有 `connection.id`；如果不知道 id，先 `canvas_read` 查找再更新。

### canvas_generate_image(prompt, aspect_ratio?, quantity?, reference_image_ids?, model?)
- 作用：生成图片并自动插入画布的 media 节点（用于插画/海报/视觉草图等）。

## 2) 关键数据规则（避免写入失败）

### 连接端点（必须二选一）
- 节点连线：只使用 `from/to`（且两端必须引用存在的 **非 group** 节点）。
- 自由线：只使用 `fromPoint/toPoint`（不要同时携带 `from/to`）。

### group / column
- `group.children[]` 去重且不得包含自身；成员节点 `parentGroupId` 需要与之保持一致。
- `column.children[]` 不能包含 `column`（禁止列嵌套列）。

### ID 原则
- 把 id 当作不透明字符串：历史画布可能混用多种 id 形态。
- 需要跨调用引用新节点：用 `canvas_write` 的 `$id` + 返回的 `idMap`，不要猜测真实 id。

## 3) 推荐工作流
1) **读**（仅在需要定位 id/理解现状时）：`canvas_read()`；用户有选区时优先 `scope="selection"`。
2) **写结构**：`canvas_write(...)` 创建新节点/基本连线。
3) **精修**：`canvas_edit(...)` 更新内容、children、样式、画布属性等。
4) 必要时再 `canvas_read` 复核关键变更。

## 4) 选择器语法（$select 的可用子集）
当前选择器匹配为“轻量 CSS 子集”，建议只用以下形态：
- `*`（全部节点）
- `#<id>`（精确 id）
- `.<type>`（按类型，如 `.text`、`.canvas-link`）
- `[attr=value]`、`[attr*=value]`、`[attr^=value]`、`[attr$=value]`
- 组合：`.type[attr*=value]`
- 逗号分隔：`".text[content*='TODO'], .todo"`

不要依赖复杂选择器（层级/空格/伪类等），以免匹配为空导致“看起来没生效”。

## 5) 常见片段（function calling 形态，仅示例）

### A. 新建两个节点并串联
```json
{
  "tool_calls": [
    { "type": "function", "function": {
      "name": "canvas_write",
      "arguments": {
        "layout": "stack",
        "anchor": "viewport.center",
        "nodes": [
          { "type": "text", "content": "A", "$id": "$1" },
          { "type": "text", "content": "B", "$id": "$2" }
        ],
        "connections": { "preset": "chain" }
      }
    }}
  ]
}
```

### B. 新建一个节点并连接到已有节点
```json
{
  "tool_calls": [
    { "type": "function", "function": { "name": "canvas_read", "arguments": { "where": { "type": "text", "content": { "$contains": "目标关键词" } }, "limit": 10 } } },
    { "type": "function", "function": {
      "name": "canvas_write",
      "arguments": {
        "layout": "row",
        "anchor": "selection.right",
        "nodes": [
          { "type": "text", "content": "新节点", "$id": "$new" }
        ],
        "connections": {
          "items": [
            { "from": "<existing_node_id_from_canvas_read>", "to": "$new", "label": "关联" }
          ]
        }
      }
    }}
  ]
}
```

### C. 修改节点内容 / 批量转换 TODO
```json
{
  "tool_calls": [
    { "type": "function", "function": {
      "name": "canvas_edit",
      "arguments": {
        "node-id-1": { "content": "更新后的内容" },
        "$select": ".text[content*='TODO']",
        "$set": { "type": "todo" }
      }
    }}
  ]
}
```

### D. 更新/删除连线（按 connection.id）
```json
{
  "tool_calls": [
    { "type": "function", "function": { "name": "canvas_read", "arguments": {} } },
    { "type": "function", "function": {
      "name": "canvas_edit",
      "arguments": {
        "$connections": {
          "<conn_id_from_canvas_read>": { "label": "引用", "style": "arrow", "dashed": false }
        }
      }
    }}
  ]
}
```

---

与本手册配套：
- 契约 Schema：`docs/canvas-contract-v1/schema/canvas.v1.json`
- 尺寸策略：`docs/canvas-contract-v1/guidelines/sizing.md`
- Ops 归一化：`docs/canvas-contract-v1/guidelines/ops-normalization.md`
