# 画布输出质量设计 — 节点类型 / 样式 / 布局 → 可读呈现

> 2026-06-29。目标:agent 已能跑通建图/改图,但呈现"最拉胯"(45 个清一色 300×60 text 节点挤成一根竖柱)。本稿先摸清**真实能力盘子**(每条 file:line grounded,8-agent opus workflow + 对抗核验),再给"请求类型→呈现"的决策表与落地路径。**研究稿,未动代码。**
>
> 已应用对抗 agent 的 4 处纠正(见 §6)。

## 1. 能力盘子

### 1a. 节点类型(substrate 仅 8 个原子类型 —— **没有独立的 image/svg/mermaid 类型**)

| 节点 | 本质 | 关键可调字段 | 默认尺寸 | best for |
|---|---|---|---|---|
| `text` | markdown 文本(默认类型) | `content`、`accentColor`、`textStyles{textAlign,opacity}`、`shapeDecoration`、`width/height` | 300×60 | 散文/标题/定义/导图叶/标签 |
| `todo` | 勾选项(`completed` 自动默认 false) | `content`(多行)、`completed` | 300×60 | 行动项/计划/清单 |
| `code` + `codeType:'mermaid'` | 文本源派生的活渲染图 | `content`(源码)、`mermaidThemeId`(9 预设) | 350×250 | 流程/层级/状态/序列/**自平衡导图** |
| `code` + `codeType:'svg'` | 内联矢量渲染 | `content`(`<svg>`)、`svgTheme`、`svgBgMode` | 400×400 | 统计图表(柱/线/饼/雷达)/组织图/精确矢量 |
| `code` + `codeType:'html'` | sandboxed iframe | `content`(HTML) | 650×540 | 网页/界面 mockup |
| `table` | 结构化网格 | `data.rows[][]`、`tableStyles{theme,headerBold,alternateRows…}` | 400×130 | 对比矩阵/要素表/数据 |
| `column` | 子节点纵向自动堆叠容器 | `children[]`、`isCollapsed`、`groupStyles.bgOpacity` | 300×200 | 看板列/分类清单/章节分区 |
| `group` | overlay 边框+标签 / 导图容器 | `children[]`、`groupMode:'normal'\|'mindmap'`、`mindmap{}` | 300×120 | 视觉分组/原生导图单元 |
| `canvas-link` | 跨画布门户(唯一必填 `title`) | `title`、`targetCanvasId` | 280×180 | 链到子画布/详情板 |
| `media` | 上传/外链/AI 生图的不透明资产 | 仅 metadata + caption | 240×160 | 照片/插画/PDF/视频嵌入 |

### 1b. 样式 + 布局

- **节点级样式**(`add_node`/`update_node`/`apply_style`,无白名单 Object.assign 生效):`accentColor`(10 预设色带)、`textStyles{textAlign, opacity}`、`shapeDecoration{type:circle\|diamond\|custom + stroke/fill}`、`width/height`、`tableStyles`、`mermaidThemeId`、`svgTheme/svgBgMode`、`groupStyles.bgOpacity`。
- **画布全局**(`update_canvas`,白名单 `CANVAS_PATCH_KEYS`):`cornerStyle`(square..full)、`fontStyle`(serif\|sans-serif\|mono)、`textOpacityPreset`、`textLayoutPreset`、`backgroundColor`/`backgroundStyleId`(solid\|dots\|grid)/`patternColor`。
- **连线**:`label`、`style:'line'\|'arrow'`、`dashed`、`relation/directed/relationData`、`curveMode/tension`。
- **布局 preset**(canvas_write 顶层 `layout`):`stack`(纵列)/`row`(横排)/`grid`(`columns:N`)/`freeform`(保留 per-node x/y)/`mindmap`\|`tree`(配合 `tree:` 字段);`anchor`(selection.*/viewport.*/node:id.dir/{x,y})、`spacing`。

### GAPS — 必须避开(代码已证实不存在/无效)
- **无 per-node 字号/字重/字色**;字体只有全局 `fontStyle`。
- **无 `node.backgroundColor`**;唯一填充是 `accentColor` 与 `shapeDecoration.fillColor`。
- **连线 `appearance`(箭头形状/线色/线宽) 是 dead 字段**,executor 静默忽略。
- **样式不回读**(read_projection 不含 style):写完读不回,需 agent 自记。
- **`canvas_write` 的 `style:{}` 包装是陷阱**:存成字面键且不渲染——样式必须放 node 顶层。
- **canvas_edit 便捷字段不能建节点/做结构 op**:`add_node`/`group_nodes`/`table_*`/`relayout_mindmap` 只能走 raw `$operations` 数组。

## 2. 请求类型 → 推荐呈现(已按 §6 纠正)

核心:**morphology 分类/diagnostics 没接进 agent,agent 读不出"画布是什么形状"** → 呈现必须**按请求动词在创建时一次定型**,不能依赖事后探测。

| 请求类型 | 推荐呈现 |
|---|---|
| **流程/步骤**(线性) | 少步骤:`layout:'stack'`/`'row'` 卡 + `connections:{preset:'chain'}`(默认渲染箭头);分支判断:单个 `code` mermaid `flowchart TD/LR` |
| **流程**(可执行清单) | 1 个 `column` + 若干 `todo` children |
| **对比**(N×属性) | **首选 `table`** + `tableStyles{theme:'nature',headerBold,alternateRows}`;定性并排:`layout:'row'` 多 `column`,每列一 `accentColor` |
| **分类/要素清单**(并行同级) | **`layout:'row'` 的多 `column`**(看板),每列一类、children 为 text/todo、列头 `accentColor`;**或** `table`;**或** `grid columns:N` 但**仅限"一类=一张扁平卡(无子节点)"且卡尺寸统一**。**严禁 `mindmap`/`tree:`**(见 §5 病因) |
| **层级/导图** | 真·深且平衡:**单个 `code` mermaid `mindmap`**(自平衡 2D,绕开退化);必须原生且确实深:`tree:`(深度铺开多列);浅而宽:回退 row+column |
| **矩阵/象限**(2×2/SWOT) | 无专用 matrix 节点:`table`(行列头) **或** `grid columns:2` 的 **4 张扁平卡**(非带子节点的 column),每象限一 `accentColor` |
| **时间线** | 少事件:`layout:'row'` 卡 + `chain` 箭头;丰富:`code` mermaid `timeline`/`gantt` |
| **定义讲解**(单点) | 1 个 `text`,**显式 `width≥360, height≥120`**(>6 行 ≥180)、markdown、`accentColor` |
| **数据/表格** | `table` + `tableStyles`,后续 `update_table_cell`/`table_row_op`/`table_col_op` 增量改 |
| **统计图表** | `code` `codeType:'svg'`(柱/线/饼/雷达);占比可 mermaid `pie`。**不要 canvas_generate_image** |
| **单一概念深讲** | **中心 `text` 必须是 `nodes[0]`** + 周边方面卡 + `connections:{preset:'star'}`(hub 取 nodes[0]);或单个 mermaid `mindmap`;或 `column` 分章节 |

**贯穿原则**(取自 research 可落地部分):选布局本身=认知提示;所有 ~14 拓扑都是 {内容原子 + 容器 + 有向边 + 2D 位置} 的视图,**不要找"create SWOT/fishbone"这种 op**,而是组合原语 + 选 layout。**不提案被截肢的形态**(edge-on-edge / 可见防御态 / role 选择器 / 模式开关 —— research 明令禁用)。

## 3. 可编辑 / 渲染 / 纯展示三层

| 层 | 类型 | 编辑性 | 何时用 |
|---|---|---|---|
| **Tier 1 可编辑结构化 JSON** | `text` `todo` `table` `group` `column` `canvas-link` | 整 payload 在 doc 里,逐字段改(update_node / update_table_cell / table_row/col_op / group_nodes / set_collapsed) | 任何之后还会反复修订的内容;`table` 粒度最细 |
| **Tier 2 源码派生渲染** | `code`(mermaid/svg/html) | 改 `content` 源码重渲染;改 `mermaidThemeId`/`svgTheme` 换主题 | 要引擎替你布局→mermaid(自平衡,绕开退化导图);要精确/统计图→svg;真网页→html |
| **Tier 3 纯展示资产** | `media`(上传/外链/`canvas_generate_image`) | 只能改 metadata+caption,像素改=重新生成 | 仅用于无法用 SVG/mermaid 表达的栅格/写实图:照片/AI 插画/PDF/视频 |

要点:**手写 SVG → Tier 2 code 节点(codeType:'svg'),不是 media**(上传的 .svg 文件才落 media,两条路)。生成图 → Tier 3 media,display-only。**默认优先 Tier 1/2**(可再编辑/可重渲染),只有本质是不可约栅格图才落 Tier 3。`attach_media` op 未上线。

## 4. "用户画像"例子重做(每个 1-2 次调用,无缺失能力)

**病因**:agent 把"两个扁平并行结构(how-to + 6 类×5-9 项)"塞进最不适合的 `tree:`/`groupMode:'mindmap'`。该路径硬编码 `spacingX=96/spacingY=30/orientation='right'`,前端 mindmap right 模式把**所有叶子放到同一个 x、纵向堆叠** → 6 类约 40 叶挤成 x=792、y=0..3240 的 ~3240px 死柱;又全 `text`、无色、默认 300×60 截断长句。

- **方案 A — 列看板(最适合分类清单)**:一次 `canvas_write`,**`layout:'row'`**(对抗纠正:不用 grid,见 §6),建 6 个 `column`,每列 children 为该类要素的 text/todo(`$id` 引用),每列头不同 `accentColor`。→ 6 个并排、带标题、色编码的列,横向可读。
- **方案 B — 对比表(最适合"核心要素")**:一个 `table`,`data.rows` = `['要素','含义','研究方法/数据来源']` + 每要素一行,`tableStyles{theme:'nature',headerBold:true,alternateRows:true}`。
- **方案 C — 单个 mermaid 导图(想要层级视图)**:一个 `code` `codeType:'mermaid'`,首行 `mindmap`,`width~560 height~480`,`mermaidThemeId:'professional'`。mermaid 自平衡,整棵树一张紧凑图。

**推荐成品**:B(核心要素表)+ A(研究方法列看板)+ 研究步骤用 `row`+`chain` 箭头或 mermaid `flowchart`。唯一要避开的引擎硬伤:宽浅分类别走 mindmap-group。

## 5. 落地路径(按 impact/effort)

> 硬约束:同名工具 ~2-3 次后被 `_detect_tool_loop` 杀;**没有对已存在节点的 layout op**(`relayout_mindmap` 只改元数据不重排)。→ "少调用、一次成型"是前提,放大了 (a) 的价值。

### (a) 纯 prompt/grammar 改动(最高 ROI,改 §6.1/§8.1 与 canvas header,零代码风险)
1. **反模式硬规则**:root+多直接子 / 并行同级分类 **禁用** `mindmap`/`tree:` → 路由到 `row`+`column` / `table` / 扁平卡 `grid`;层级想要就用**单个 mermaid mindmap code 节点**(自平衡)。附病因一句。
2. **把被埋没的样式杠杆写进 grammar**(现仅暴露一小撮):`accentColor` 10 预设(按类/层级编码)、`tableStyles{theme,headerBold,alternateRows}`、`textStyles.textAlign`、画布 `cornerStyle/fontStyle/backgroundStyleId`。
3. **把 §2 请求→呈现表并入 §8.1 选型 playbook**。
4. **重申尺寸规则并绑定 tree 截断**:长句叶必须显式 `width/height`(tree 路径不按内容增高)。
5. **一次成型**:一个 `canvas_write`(`$id` 引用 + connections preset + accentColor + 尺寸)建完整表示,别靠多次 `move_node`/`relayout_mindmap` 补救;连线只用 `label/style(line|arrow)/dashed`,不发 `appearance`(dead)。

### (b) 新布局/样式 helper 或默认值(中等 effort,无需新 op)
1. **tree/flat 写路径按内容自动定高**(现恒 300×60)。
2. **canvas_write 缺省按 depth/category 自动分配 `accentColor`** + 可选全局 `cornerStyle/fontStyle` 默认。
3. **grid 用 per-column/row 最大值算 cell pitch**(现用各节点自身宽高 → ragged grid)。
4. **"board" 语法糖**:让 `layout:'row'` 把 `category→items` 自动包装成 `column` 节点,省手写 `$id` 接线(直接产出方案 A)。

### (c) 需新 node/op 支持(更大 effort,后置)
1. **把前端 `tidyLayout` 共享给后端写路径,或让 `relayout_mindmap` 真正重算子节点 x/y**(subtree-height 预留 + 父居中 + `orientation:'both'`)——让原生导图达人工质量的根本修复。
2. **canvas_write mindmap 暴露 `orientation:'both'`**(现硬编码 'right',须配合 c1)。
3. 大批量自动分页/分块,防 off-screen 死柱。
4. 针对已存在节点的 layout/re-arrange op(绕开 loop-kill)。

**明确不在本次 readability 范围**(未接入/aspirational):连线 appearance 接线、多视图 re-render、graph-morphology 分类、diagnostics-in-agent、spatial_reader、relationData 读回。可读性靠 (a)+(b) 即可基本解决。

## 6. 对抗核验纠正(已并入上文)
1. **`grid` 不能配 `column` 容器**:`calculate_layout`(engine.py:273-298)对 `nodes[]` 里**每个**节点(含 ~40 个 column 子节点)都分配 grid cell → 6 个 column 头不会成 3×2,会被子节点打散。列看板用 `layout:'row'`;`grid columns:N` **仅限"一类=一张扁平卡(无子节点)"**。
2. **矩阵同理**:`grid columns:2` 适合 **4 张扁平卡**,不适合 4 个带子节点的 column。
3. **grid 仅在卡尺寸统一时可靠**(engine.py:297 用 per-node w/h → 否则 ragged);grid 卡应显式给相等 `width/height`。
4. **`star` preset 的 hub 是 `nodes[0]`**(engine.py:491-499,非中心感知):中心节点必须是数组第一个。

**通过核验无需改的关键点**:`preset:'chain'` 在扁平节点上默认渲染箭头(ConnectionsLayer 默认 aEnd=true,仅 mindmap 内部边抑制);节点类型表/默认尺寸/样式杠杆/Tier 谱系/svg 双身份/`canvas_generate_image→media`/全部 GAPS 均与代码一致,无臆造 op/字段。
