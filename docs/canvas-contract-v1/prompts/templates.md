# Prompts Templates（第 2 层：AI 生成与调用模板）

本文件提供两类模板：
- 生成契约 v1 的 Canvas JSON（直接落盘/导入）
- 通过工具对现有画布进行增改（函数调用序列）

> 参照：契约与尺寸规范（README.md, sizing.md, schema/canvas.v1.json）

## A. 生成 Canvas JSON（契约 v1）

目标：一次性生成完整 JSON，可直接导入；也可作为后续 `canvas_write`（分批创建 nodes + connections）的参考草稿。

提示模板：
```
你是画布结构工程师。请生成符合 Zmind Canvas Contract v1 的 JSON（只输出 JSON）：
- 必须字段：Canvas 顶层 id,title,nodes,connections,createdAt,updatedAt,version
- 每个节点必须有 id,type,x,y,width,height,content,createdAt,updatedAt
- 初始尺寸必须给出（见默认值）
- 连接 from/to 只能指向非 group 节点
- group/mindmap：group.children 去重且不含自身；成员节点需设置 parentGroupId；
- column.children 不允许包含 column
- 不要输出任何几何控制点到连接

默认尺寸参考（可按需要调整）：
- text/todo: 300x60; code(mermaid): 350x250; code(html): 650x540; table: 400x130; canvas-link: 280x180; media: 240x160; column: 300x200

输出 JSON 仅包含字段：id,title,nodes,connections,createdAt,updatedAt,version（以及契约允许的可选字段）。
```

自检清单：
- [ ] 必填字段齐全
- [ ] 节点坐标与尺寸均为数值
- [ ] 连接引用有效，且不指向 group
- [ ] group.children 与 parentGroupId 配套且一致
- [ ] column.children 不含 column
- [ ] 表格使用 data.rows（二维数组，必要时附带 columnWidths/rowHeights，不放在 content）

## B. 修改现有画布（原生函数调用, JSON）

推荐流程：
1) 读取：调用 `canvas_read`（选区优先 `scope="selection"`，不确定再读全量）
2) 规划：把要新增/修改的内容拆成“最小必要的节点与关系”
3) 执行：
   - 新增内容：用 `canvas_write`（带 `layout` + `anchor`；需要引用新节点时用临时 `$id`，再用返回的 `idMap` 取真实 id）
   - 修改/删除：用 `canvas_edit`（nodeId->patch、`$delete`、`$select+$set`、`$canvas`、`$connections`）
4) 复核：必要时再次 `canvas_read` 确认关键变更

片段模板（见 guidelines/tools.md）：
- 添加文本 + 连线（JSON tool_calls）
- 移动并套用样式（JSON tool_calls）
- 构建思维导图组（JSON tool_calls）

共识约束（Do / Don’t）：
- 给新增节点提供初始 `width,height`
- 连接只连非 group 节点
- 不落盘连接几何信息
- 避免无意义的删除全图 / 重建；沿用既有 ID

## C. 语义化 ID 建议
- 优先策略：**不提供真实 id**，让系统生成（更安全，避免冲突）。
- 需要在同一次创建中做引用时：用 `canvas_write` 的临时 `$id`（如 `$1/$2`），再用返回的 `idMap` 获取真实 id。
- 如确实需要可读 id（仅建议用于离线样例/固定数据集）：可用 `text-1/todo-2/...`，但必须全局唯一；注意线上历史数据可能混用多种 id 形态，永远把 id 当作不透明字符串，不要自行猜测/改写。

---

> 本模板服务于“压缩上下文后”的快速对齐，涵盖契约要点、尺寸策略、工具调用流程与自检清单。
