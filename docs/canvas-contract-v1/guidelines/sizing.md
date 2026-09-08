# Sizing Policy（固定大小与自动大小）

本指南说明各节点类型的“推荐初始尺寸（必填 width/height）”与“自动尺寸（运行期行为）”。契约层不记录“是否自动”的状态，自动尺寸由前端在渲染/编辑时触发。

通用规则：
- 所有节点必须提供初始 `width,height`；
- 前端可能在首次渲染或交互中进行“增高/优化”，以提升可读性；
- 若 AI 需要“更精准”的初始尺寸，请依照下述公式/默认值计算。

---

## 文本（text）
- 推荐初始：
  - `width >= 300`，`height = 60`（对应文本布局预设 classic: minWidth=300, minHeight=60）
- 自动尺寸：
  - 渲染/编辑时会按内容行数自动增高；单行内容保持最小高度。
  - 自适应算法（简化）：
    1) 依据布局预设得到可用宽度；
    2) 估算每行可容纳字符数：`floor(availableWidth / max(8, fontSize * 0.6))`；
    3) 累计视觉行数与行高（标题/列表有不同行高）；
    4) 计算高度 = 外边框 + 内边距 + 内容高度 + 上下留白，最后 clamp 到屏幕上限。
- 参考默认：`DEFAULT_NODE_SIZES.text = { width:300, height:60 }`

## 待办（todo）
- 同“文本”，仅多了前缀 checkbox（布局已考虑前缀间距）。
- 推荐初始：`300 x 60`；自动增高逻辑与文本相同。

## 代码（code）
- HTML：
  - 推荐初始：`650 x 540`（NodeDefaults 中的默认值）
  - 自动尺寸：无；需要时请手动调整。
- Mermaid：
  - 推荐初始：`350 x 250`；
  - 自动尺寸：首次渲染后会测量 SVG 边界，结合外边距/内边距重新设定节点宽高；
    - 具体行为见 `calculateMermaidNodeSize`（基于 `getBBox()` + UI padding + 不同图类型的最小值与比例）

- SVG：
  - 推荐初始：`400 x 400`；
  - 自动尺寸：解析 `<svg>` 的 `viewBox` 或 `width/height` 计算内容宽高比，并结合 UI 外边距/边框计算最终节点尺寸；
    - 具体行为见 `frontend/src/canvas/utils/canvasUtils.ts: calculateSvgNodeSize`
  - 最小尺寸：宽 `>= 200`，高 `>= 150`；

## 表格（table）
- 推荐按行列计算初始尺寸：
  - 宽：`columns * 120 + padding(16*2)`
  - 高：`headerHeight(50) + rows * 40 + padding(16*2)`
- 若 AI 不方便计算，可用默认：`400 x 130`，前端编辑时支持增改。

## 媒体（media）
- 推荐初始：`240 x 160`；
- 自动尺寸：无；但用户手动调整时，图片/视频会强制等比缩放。

## 收集栏（column）
- 推荐初始：`300 x 200`；标题区高度固定 `60`；
- 自动尺寸：
  - 收起（isCollapsed=true）：高度固定为 `60`；
  - 展开：高度 ≈ `60 + sum(childHeight + wrapperPadding(8)) + itemSpacing(8)*(n-1) + containerPadding(12)`。

## 画布链接（canvas-link）
- 推荐初始：`280 x 180`；
- 首次渲染会根据标题自动优化一次尺寸（不会持续改写用户的手动调整）：
  - 宽度估算：`requiredW = titleScrollWidth + 24*2 + 24`，clamp 到 `[200, 800]`
  - 高度估算：`requiredH = max(48, titleRectHeight + statusRectHeight + 16*2)`，clamp 到 `[48, 160]`

## 群组（group / mindmap）
- 推荐：为 group 提供大致位置与尺寸即可；渲染时会根据成员几何与层级计算背景边界；
- 思维导图（groupMode='mindmap'）：
  - 元数据：`spacingX`（列间距，推荐 96）、`spacingY`（兄弟间距，推荐 30）、`rootId`；
  - 算法保持 root 的左侧位置不变，按列对齐，父节点与子树中心对齐；
  - 折叠状态下被折叠节点的后代会被隐藏但不移除。

---

## 默认尺寸速览
- text: `300 x 60`
- todo: `300 x 60`
- code(mermaid): `350 x 250`
- code(html): `650 x 540`
- code(svg): `400 x 400`
- table: `400 x 130`（或按行列计算）
- canvas-link: `280 x 180`
- media: `240 x 160`
- column: `300 x 200`

> 注：上述为“初始尺寸”，系统可能在首次渲染/交互时进行单次或持续性的自动增高/优化（取决于节点类型）。
