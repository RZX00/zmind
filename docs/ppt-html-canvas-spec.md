# PPT HTML Canvas 规格（V1）

## 1. 目标

- 仅保留 HTML-based presentation 路径，彻底不走 image-based presentation 组件链路。
- PPT 工作流必须是画布原生闭环：
  - 大纲在画布（文本节点）
  - 结果在画布（HTML 代码节点）
  - 图片来源可追踪（复用画布图片或自动生成）
- 不新增画布节点类型，最大化复用现有能力。

## 2. 已冻结决策

1. 图片检索范围：全画布  
2. 图片策略：复用优先，不足再生成  
3. 大纲形态：结构化卡片（多个文本节点）  
4. 关联方式：连线（edge）  
5. 大纲更新策略：手动确认后更新结果  
6. 降认知策略：不暴露“锁图”概念，仅提供“重新配图/更新PPT”动作  

## 3. 节点契约（不新增节点类型）

统一写入 `node.data.presentation`：

- 公共字段：
  - `schema: "presentation.v1"`
  - `projectId: string`
  - `role: "outline_card" | "result_html" | "image_asset"`

- 大纲文本节点（`role="outline_card"`）建议字段：
  - `slideId`
  - `order`
  - `title`
  - `keyPoints[]`
  - `imageIntent`

- 结果 HTML 节点（`role="result_html"`）建议字段：
  - `kind: "ppt_html"`
  - `version: "1"`
  - `title`
  - `slideCount`
  - `sourceOutlineNodeIds[]`
  - `presentationPath`（可选，存在则用于导出链路）
  - `capabilities`（`fullscreen/downloadPptx/exportGoogleSlides`）
  - `exports`（状态机）

- 图片节点（`role="image_asset"`）建议字段：
  - `source: "canvas_existing" | "generated"`
  - `linkedSlideIds[]`

## 4. 连线契约

- 使用现有连接（connection）机制表达关系，不新增 edge 类型。
- 推荐连接关系：
  - `outline -> result`
  - `outline -> image`
  - `image -> result`（可选）
- 连接标签建议使用可读值：`slide-link`、`visual-link`。

## 5. 用户流程（端到端）

1. 用户在画布上组织大纲文本卡片  
2. 系统读取全画布图片并执行复用优先匹配  
3. 不足部分自动生成图片并回写画布  
4. 用户确认后生成/更新结果 HTML 节点  
5. 自动建立大纲、结果、图片的连线关联  
6. 结果节点提供专属操作：全屏、下载 HTML、导出 PPTX、导出 Google Slides  

## 6. 结果节点动作状态机

- 通用状态：`idle -> running -> success | failed`
- 失败可重试；同一动作 running 时禁止重复触发。
- 状态落地在：`node.data.presentation.exports.{html|pptx|googleSlides}`。

## 7. 图片策略（反脆弱）

- 先匹配全画布已有图片，再生成缺口。
- 任一页图片解析失败不应阻断整份 PPT 产出。
- 对用户只展示“来自画布/自动生成”，不展示评分细节。

## 8. 主要代码落点

- HTML 渲染/识别：`frontend/src/canvas/components/editors/HTMLNodeEditor.tsx`
- 右键动作入口：`frontend/src/canvas/hooks/useCanvasContextMenu.ts`
- PPT 元数据工具：`frontend/src/canvas/utils/presentationMetadata.ts`
- 导出工具复用：`frontend/src/components/thread/tool-views/utils/presentation-utils.ts`
- Presentation Agent 提示：`prompts/subagents/presentation.prompt.md`
- PPT Skill 提示：`prompts/skills/builtin.ppt_plan.prompt.md`
- PPT Skill 文档：`backend/core/skills/builtin/ppt-plan/SKILL.md`

## 9. 兼容策略

- 无 `data.presentation` 的普通 HTML 节点保持原行为。
- 旧 HTML 演示节点可通过内容特征识别并懒补齐 `presentation` 元数据。
- 保留 Google Slides 导出路径；不清理原有通用图像生成工具。
