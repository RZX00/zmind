# Canvas as Code (CaC) - AI Canvas 编辑范式设计

> 行业最佳实践：让 AI 像编辑代码一样编辑画布

## 设计哲学

### 核心洞察

**AI Coding 的成功模式**：
```
Read  → 读取文件内容
Write → 创建新文件
Edit  → 修改现有文件
```

**Canvas as Code 采用相同范式**：
```
canvas_read  → 读取画布内容
canvas_write → 创建新内容（节点、连接、思维导图）
canvas_edit  → 修改/删除现有内容
```

### 设计原则

1. **标准范式** - 遵循 Read/Write/Edit 行业标准，开发者零学习成本
2. **最短路径** - AI 输出到画布的距离最短，没有中间翻译层
3. **结构即代码** - Canvas JSON 就是"源码"，AI 直接编辑
4. **渐进复杂度** - 简单任务一行搞定，复杂任务也能表达
5. **协作原生** - 基于 CRDT，AI 是协作者之一
6. **容错友好** - 宽松解析，智能修复，清晰报错

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  "在选中节点右边创建思维导图，主题是产品规划"              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Read    │ │  Write   │ │  Edit    │
              │  读取画布 │ │  创建内容 │ │  修改内容 │
              └──────────┘ └──────────┘ └──────────┘
                    │           │           │
                    └───────────┼───────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CaC Engine (核心引擎)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Parser   │→ │ Resolver │→ │ Layout   │→ │ Applier  │        │
│  │ 解析输入  │  │ ID/选择器 │  │ 自动布局  │  │ 应用变更  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Yjs / Realtime Service                        │
│                    (CRDT 同步到所有客户端)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 工具设计

### 三个标准工具

| 工具 | 用途 | 类比 Claude Code |
|------|------|------------------|
| `canvas_read` | 读取画布内容 | `Read` |
| `canvas_write` | 创建新内容 | `Write` |
| `canvas_edit` | 修改/删除现有内容 | `Edit` |

### 设计理念

- **canvas_read**: 只读操作，获取画布状态，安全无副作用
- **canvas_write**: 创作操作，添加新节点、创建结构，专注于"从无到有"
- **canvas_edit**: 编辑操作，修改属性、删除节点，专注于"改变现有"

---

## canvas_read - 读取画布

> 类比：Claude Code 的 `Read` 工具

只读操作，获取画布当前状态。

### 基础用法

```json
canvas_read()
```

返回完整 Canvas JSON（自动精简，隐藏内部字段）。

### 带过滤的读取

```json
canvas_read({
  "select": ["nodes", "connections"],
  "where": {
    "type": ["text", "todo"],
    "content": { "$contains": "产品" }
  },
  "limit": 50
})
```

### 读取选中内容

```json
canvas_read({ "scope": "selection" })
```

### 返回格式

```json
{
  "canvas": {
    "id": "canvas-123",
    "title": "产品规划",
    "nodes": [
      {
        "id": "n1",
        "type": "text",
        "content": "核心功能",
        "x": 100,
        "y": 100,
        "width": 200,
        "height": 60
      }
    ],
    "connections": [
      { "id": "c1", "from": "n1", "to": "n2", "label": "依赖" }
    ]
  },
  "selection": ["n1", "n2"],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

---

## canvas_write - 创建新内容

> 类比：Claude Code 的 `Write` 工具

创作操作，专注于"从无到有"——添加新节点、创建结构。

### Level 1: 直接添加节点

最简单的方式，AI 直接输出要添加的节点：

```json
canvas_write({
  "nodes": [
    { "type": "text", "content": "新想法" },
    { "type": "text", "content": "另一个想法" },
    { "type": "todo", "content": "待办事项" }
  ]
})
```

**系统自动处理**：
- 生成 ID
- 计算坐标（基于 anchor 或默认布局）
- 设置默认尺寸

### Level 2: 带布局的添加

```json
canvas_write({
  "layout": "stack",
  "anchor": "selection.right",
  "spacing": 20,
  "nodes": [
    { "type": "text", "content": "步骤1" },
    { "type": "text", "content": "步骤2" },
    { "type": "text", "content": "步骤3" }
  ],
  "connections": "chain"
})
```

**Layout 选项**：
- `stack` - 垂直堆叠
- `row` - 水平排列
- `grid` - 网格（可指定列数）
- `mindmap` - 思维导图
- `tree` - 树形结构

**Anchor 选项**：
- `selection` / `selection.right` / `selection.below`
- `viewport.center`
- `{ "x": 100, "y": 200 }`
- `node:n1.right`

**Connections 快捷方式**：
- `"chain"` - 串联（1→2→3）
- `"star"` - 星形（1→2, 1→3, 1→4）
- `"none"` - 不创建连接

### Level 3: 结构化创建（思维导图/树）

```json
canvas_write({
  "layout": "mindmap",
  "anchor": "selection.right",
  "tree": {
    "content": "产品规划 2024",
    "children": [
      {
        "content": "Q1 目标",
        "children": [
          { "content": "用户增长 50%" },
          { "content": "营收翻倍" }
        ]
      },
      {
        "content": "Q2 目标",
        "children": [
          { "content": "国际化" },
          { "content": "新产品线" }
        ]
      }
    ]
  }
})
```

系统自动：
- 创建所有节点
- 建立父子连接
- 应用思维导图布局
- 创建 mindmap group

### Level 4: 带连接的添加

```json
canvas_write({
  "nodes": [
    { "$id": "$1", "type": "text", "content": "原因" },
    { "$id": "$2", "type": "text", "content": "结果" }
  ],
  "connections": [
    { "from": "$1", "to": "$2", "label": "导致" }
  ]
})
```

---

## canvas_edit - 修改现有内容

> 类比：Claude Code 的 `Edit` 工具

编辑操作，专注于"改变现有"——修改属性、移动位置、删除节点。

### 基础用法：通过 ID 修改

```json
canvas_edit({
  "n1": { "content": "修改后的内容" },
  "n2": { "x": 300, "y": 200, "width": 400 }
})
```

### 删除节点

```json
canvas_edit({
  "$delete": ["n1", "n2", "n3"]
})
```

### 混合操作

```json
canvas_edit({
  "n1": { "content": "更新内容" },
  "n2": { "type": "todo" },
  "$delete": ["n3"],
  "$connections": {
    "c1": { "label": "新标签" },
    "$delete": ["c2"]
  }
})
```

### 选择器模式（批量操作）

```json
canvas_edit({
  "$select": ".text",
  "$set": { "width": 300 }
})
```

```json
canvas_edit({
  "$select": "[content*='TODO']",
  "$set": { "type": "todo" },
  "$transform": {
    "content": { "$replace": ["TODO: ", ""] }
  }
})
```

### 批量操作列表

```json
canvas_edit({
  "$operations": [
    {
      "$select": ".text",
      "$set": { "width": 300 }
    },
    {
      "$select": "#n1, #n2, #n3",
      "$delete": true
    }
  ]
})
```

**选择器语法**（类 CSS）：
- `#id` - 精确 ID
- `.type` - 按类型（`.text`, `.todo`, `.table`）
- `[attr=value]` - 属性匹配
- `[attr*=value]` - 属性包含
- `*` - 所有节点

---

## 临时 ID 系统

AI 创建新节点时使用 `$` 前缀的临时 ID：

```json
canvas_write({
  "nodes": [
    { "$id": "$1", "type": "text", "content": "节点A" },
    { "$id": "$2", "type": "text", "content": "节点B" }
  ],
  "connections": [
    { "from": "$1", "to": "$2" }
  ]
})
```

**返回结果包含 ID 映射**：

```json
{
  "success": true,
  "idMap": {
    "$1": "node-a7b3c9d2",
    "$2": "node-e4f5g6h7"
  },
  "applied": {
    "nodesAdded": 2,
    "connectionsAdded": 1
  }
}
```

---

## 智能布局引擎

### 自动坐标计算

当 AI 不指定坐标时，系统根据 `layout` 和 `anchor` 自动计算：

```
输入:
{
  "layout": "stack",
  "anchor": "selection.right",
  "spacing": 20,
  "nodes": [A, B, C]
}

计算过程:
1. 获取 selection 的边界框 { right: 500, top: 100 }
2. 起始点 = (500 + 40, 100)  // 40px 间距
3. A.position = (540, 100)
4. B.position = (540, 100 + A.height + 20)
5. C.position = (540, B.y + B.height + 20)
```

### 布局算法

| Layout | 算法 |
|--------|------|
| `stack` | 垂直堆叠，y 递增 |
| `row` | 水平排列，x 递增 |
| `grid` | 行优先网格 |
| `mindmap` | 调用前端 `tidyLayout()` |
| `tree` | 层次布局（上→下或左→右）|

### 尺寸自适应

```json
{
  "nodes": [
    { "type": "text", "content": "短文本" },
    { "type": "text", "content": "这是一段很长的文本内容，需要更大的宽度来展示", "width": "auto" }
  ]
}
```

`width: "auto"` 时：
- 文本节点：根据内容估算（min 150, max 450）
- 表格节点：根据列数计算
- 代码节点：根据代码类型设置默认值

---

## 高级查询（通过 canvas_read）

### 查找特定类型节点

```json
canvas_read({
  "where": {
    "type": "text",
    "content": { "$contains": "产品" }
  }
})
```

### 查找连接关系

```json
canvas_read({
  "where": {
    "$connected": "n1",
    "$direction": "outgoing"
  }
})
```

### 返回统计

```json
canvas_read({
  "aggregate": {
    "count": { "$group": "type" }
  }
})
```

---

## 错误处理

### 宽松解析

系统尽可能接受不完美的输入：

```json
// AI 输出（不完美）
{
  "action": "write",
  "nodes": [
    { "type": "text", "content": "Hello", "x": "100" }  // x 是字符串
  ]
}

// 系统自动修正
{
  "type": "text",
  "content": "Hello",
  "x": 100  // 转换为数字
}
```

### 清晰报错

```json
{
  "success": false,
  "error": {
    "code": "INVALID_NODE_TYPE",
    "message": "Unknown node type 'textbox'. Did you mean 'text'?",
    "path": "nodes[0].type",
    "suggestions": ["text", "todo", "table"]
  }
}
```

### 部分成功

```json
{
  "success": "partial",
  "applied": {
    "nodesAdded": 3,
    "connectionsFailed": 1
  },
  "errors": [
    {
      "path": "connections[0]",
      "message": "Target node 'n999' not found"
    }
  ]
}
```

---

## 完整示例

### 示例 1：简单添加（canvas_write）

用户：「在右边加三个想法」

```json
canvas_write({
  "layout": "stack",
  "anchor": "selection.right",
  "nodes": [
    { "type": "text", "content": "想法一：提升用户体验" },
    { "type": "text", "content": "想法二：优化性能" },
    { "type": "text", "content": "想法三：增加新功能" }
  ]
})
```

### 示例 2：创建思维导图（canvas_write）

用户：「帮我做一个产品规划的思维导图」

```json
canvas_write({
  "layout": "mindmap",
  "anchor": "viewport.center",
  "tree": {
    "content": "2024 产品规划",
    "style": { "fontSize": 18, "fontWeight": "bold" },
    "children": [
      {
        "content": "🎯 核心目标",
        "children": [
          { "content": "MAU 突破 100万" },
          { "content": "付费转化率 5%" },
          { "content": "NPS > 50" }
        ]
      },
      {
        "content": "🚀 重点项目",
        "children": [
          { "content": "AI 功能升级" },
          { "content": "协作体验优化" },
          { "content": "移动端适配" }
        ]
      },
      {
        "content": "📅 里程碑",
        "children": [
          { "content": "Q1: 基础设施" },
          { "content": "Q2: 核心功能" },
          { "content": "Q3: 增长运营" },
          { "content": "Q4: 商业化" }
        ]
      }
    ]
  }
})
```

### 示例 3：批量修改（canvas_edit）

用户：「把所有包含 TODO 的文本节点改成待办类型」

```json
canvas_edit({
  "$select": ".text[content*='TODO']",
  "$set": { "type": "todo" },
  "$transform": {
    "content": { "$replace": ["TODO: ", ""] }
  }
})
```

### 示例 4：精确编辑（canvas_edit）

用户：「修改节点 n1 的内容，删除 n2」

```json
canvas_edit({
  "n1": { "content": "更新后的内容" },
  "$delete": ["n2"]
})
```

### 示例 5：混合操作

用户：「修改 n1，删除 n2，然后在 n3 下方添加一个新节点」

```json
// Step 1: 修改和删除
canvas_edit({
  "n1": { "content": "更新后的内容" },
  "$delete": ["n2"]
})

// Step 2: 添加新节点
canvas_write({
  "anchor": "node:n3.below",
  "nodes": [
    { "type": "text", "content": "新节点" }
  ]
})
```

### 示例 6：读取后编辑

用户：「找到所有包含"重要"的节点，把它们的背景改成黄色」

```json
// Step 1: 先读取确认
canvas_read({
  "where": { "content": { "$contains": "重要" } }
})

// Step 2: 批量修改
canvas_edit({
  "$select": "[content*='重要']",
  "$set": { "style": { "backgroundColor": "#fef3c7" } }
})
```

---

## 与现有系统的关系

### ???????CaC 4?

| ?? | ?? |
|------|------|
| `canvas_read` | ?????scope/where/limit? |
| `canvas_write` | ??????nodes/connections/anchor/layout/spacing? |
| `canvas_edit` | ??/??/???$set/$delete/$connections/$operations/$transform? |
| `canvas_generate_image` | ??????? media ?? |

### 后端架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Layer (3 个工具)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ canvas_read │  │canvas_write │  │ canvas_edit │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
└─────────┼────────────────┼────────────────┼─────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    CaC Engine (新增)                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Parser       → 解析输入，标准化格式                    │   │
│  │ Resolver     → 解析 $id 临时ID、选择器                 │   │
│  │ LayoutEngine → 计算坐标（stack/row/grid/mindmap）     │   │
│  │ Validator    → 校验，自动修复，友好报错               │   │
│  │ Applier      → 生成底层操作                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 CanvasWriteService (现有)                    │
│                 apply_canvas_ops()                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Realtime Service / Yjs (现有)                │
│                 CRDT 同步到所有客户端                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现路线图

### Phase 1: 核心功能（MVP）
- [ ] `canvas_read` - 基础读取 + 过滤
- [ ] `canvas_write` - L1/L2（直接添加 + 带布局）
- [ ] `canvas_edit` - 基础修改/删除
- [ ] 临时 ID 系统（$1, $2...）
- [ ] 简单布局引擎（stack, row, grid）
- [ ] 锚点系统（selection, viewport, node:id）

### Phase 2: 高级功能
- [ ] `canvas_write` - L3（树形结构/思维导图）
- [ ] `canvas_edit` - 选择器系统
- [ ] 思维导图布局集成（调用前端 tidyLayout）
- [ ] 连接快捷方式（chain, star, tree）

### Phase 3: 优化 & 打磨
- [ ] 批量操作（$operations）
- [ ] 高级查询（aggregate）
- [ ] 智能错误修复建议
- [ ] 性能优化（大画布处理）
- [ ] 废弃旧工具

---

## 成功指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 工具数量 | 14 个 | **3 个** |
| 工具调用成功率 | ~70% | **>95%** |
| 创建思维导图 | 多次调用 | **1 次调用** |
| 批量修改 | 循环调用 | **1 次调用** |
| AI 学习成本 | 高 | **低（标准范式）** |

---

## 设计对比

### vs 当前实现

| 方面 | 当前 | CaC |
|------|------|-----|
| 工具选择 | AI 需要选对工具 | 3 个工具，职责清晰 |
| 参数格式 | 每个工具不同 | 统一 JSON 结构 |
| 坐标计算 | AI 必须指定 | 系统自动计算 |
| 批量操作 | 多次调用 | 单次完成 |
| 错误处理 | 各工具不一致 | 统一错误格式 |

### vs Claude Code

| Claude Code | Canvas CaC | 说明 |
|-------------|------------|------|
| `Read` | `canvas_read` | 只读，获取状态 |
| `Write` | `canvas_write` | 创建新内容 |
| `Edit` | `canvas_edit` | 修改现有内容 |
| `Grep` | `canvas_read` + where | 搜索/过滤 |

---

## 附录

### JSON Schema

完整的 TypeScript 类型定义见 `canvas-as-code.types.ts`

### 参考资料

- Claude Code 工具设计：Read/Write/Edit 范式
- JSON Patch (RFC 6902)
- CSS Selectors Level 3
- Yjs CRDT 文档
