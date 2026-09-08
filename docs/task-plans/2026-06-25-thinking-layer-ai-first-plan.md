# 思考层实施计划（AI-First）

> 2026-06-25 · 6-opus 规划 workflow（4 工作线设计 → 综合 → 对抗批判，run wh73xuml2）
> 前置研究：`docs/design/2026-06-24-canvas-thinking-substrate-research.md`
> 拍板修正：**AI 推断层最先建**——让开放底座可被采纳的是"AI 替用户付形式化的税",不是底座本身。

## 不可违背的法则（研究 + 批判）
- **CAPTURE-FIRST**：内容存在前绝不要求节点类型/关系/标签/角色。用户**永远看不到**"选个角色/关系"的控件。AI 提议;用户接受/忽略;绝不强制。
- **AI 付税**：AI 读 freeform prose + 空间 → **提议**(给无标签边 propose 开放 relation、按需聚类、推断**隐形**角色标签、浮现诊断)。开放词汇,底座存不校验。
- **空间免费干语义活**：从几何读 proximity/对齐/包围/颜色,喂 AI。
- **守护空间意图(正确性)**:Gestalt 不自主;AI 不能静默重排版吃掉它。pinned 标志;每个 AI 造的节点/边带 provenance createdBy:agent + 派生引用,可查可撤。
- **已截肢的坟场器官(用户面绝不建)**:边瞄准边(仅 AI 侧派生注释)、可见 defended/defeated 状态、用户选角色/关系、常驻 Walton 引擎、发散收敛模式开关。

## 关键事实(设计 agent 读真实代码确认)
- **canvas lane 确实零 LLM**:`kernel.py:193` 路由 `lane==canvas` → `CanvasExecutionCoreV2`(regex/keyword planner,`canvas_native_planner_service.py`)。唯一 LLM 路径是 general lane。**这就是用户诊断的痛根。**
- **AI 的"眼睛"已具备**:`read_projection.py`(纯 stdlib 离线)投影几何/拓扑/relation/directed/provenance。`canvas_read`(`cac/tools.py:369`)暴露 scope/where/children_of/camera/detail。
- **AI 的"手"已具备**:`intent_compiler.py` + `cac/engine.py` 携带 relation/directed/relationData 到 ops;ALLOWED_OPS 覆盖 add_node/add_connection/update_connection/group_nodes。
- **provenance 半接线(present-but-dead)**:`applyCanvasOps.js:1338` 只在 `actor.actor=="agent"` 时盖 createdBy/ai;但 `write_service.py:261` 硬编码 `actor:"service"`,且 `index.js:897` 调 applyCanvasOps **不传 actor** → v2 写入永不被标 agent。**D5 复活它。**
- **完全没有**:inference 子包、suggestion 模型、accept/reject 路径、空间读取器。

## 引用更正(批判逮到,fan-out 前必须用对坐标)
- `canvas.ts` 真实路径 = **`frontend/src/canvas/types/canvas.ts`**(非 `frontend/src/lib/canvas.ts`);CanvasNode 在 :40(非 :142)。
- `cac/tools.py` 的 jwt 污染来自 `write_service.py:8 import jwt`(非 Tool 基类)→ 仅 py_compile 离线。
- `contracts.py` **没有** pending_suggestions 字段(:170-177 是 pending_plan_ref/confirm_token)→ A5 须新增。
- WS5-5 provenance pass 确认 present-but-dead(`applyCanvasOps.js:1338-1356` 盖章,但 `index.js:897` 不传 actor)。

## 分阶段计划(AI-first)

### P0 — 让 AI 端到端有用(三轨并行,各自单独都是惰性的)
- **轨 γ(脑,先行)**:`backend/core/canvas/inference/` —— `diagnostics.py`(确定性:orphan-claim / unsupported / cycle(DFS 回边)/ MECE 重叠(sibling Jaccard);**角色只读 AI 派生的 `metadata.role`,无角色时退化为纯拓扑——角色永不是用户可编辑字段**)+ `suggestions.py`(冻结 dataclass `Suggestion{id(稳定哈希),kind,title,rationale,target_ids,proposed_ops(过 normalize_ops 的 ALLOWED_OPS 闭集),derivation(createdBy:agent+来源+model+inputs hash,**per-batch id 非 per-run**),confidence}`,role_tag→update_node patch 写**隐形** metadata.role,relation_label→update_connection patch)→ `InferenceCoreV2`(kernel + lane_selector 的**窄触发**:"tidy/find issues/propose structure" 或前端 canvas.infer,**绝不**截走既有 create/layout)→ LLM 循环(单次结构化调用,提议**仅**针对既有无标签边/freeform dump/角色推断,绝不新节点类型、绝不要求用户分类)。
- **轨 β(手+槽+安全)**:β1 一次性类型编辑(CanvasConnection 加 relation?/directed?/relationData?/provenance?;CanvasNode 加 provenance?/positionIsIntentional?——合并 A7+B1+D8,单 owner 避免三路撞车)→ D3(write_service 结构化 actor payload,默认 'service' 兼容)→ D4(execution_core 传 actor='agent')→ D5(index.js 把 actor 接进 applyCanvasOps + 传到 live Y.Doc;**actor 类型来自鉴权 context,body 只给 model/derivation——防 user JWT 伪造 agent 绕过 pinned 守护**,安全攸关,P0 末)+ D1/D2(positionIsIntentional 守护,两执行器,**必须先于任何 AI 聚类**)+ B2/B3(前端 store reducer 停止丢 slots + AI-context 序列化)。
- **轨 α(眼,空间读取器)**:`spatial_reader.py`(纯 stdlib:enclosure / alignment / proximity 单链 / color-size 等价类,SPATIAL_NODE_CAP=300,**绝不重报 parentGroupId 已有 containment**)→ 输出进 `canvas_read` 的 `meta.derived`(**不入存储节点/边**)。**批判警告:聚类信号必须在 D1/D2 pinned 守护落地之后才接,否则 auto-cluster 会吃掉 Gestalt 意图。**

### P1 — 质量 + 活证(docker 栈)
A4 真 LLM 调用质量调优(habitat gateway);C 诊断/proximity 阈值在真画布上调;栈上验证 actor 到 realtime 后真盖 createdBy:agent;GESTURE_PINNED → ask-then-override 协商(非盲重试)。

### P2 — 渲染 + 表面打磨
ConnectionsLayer 区分 relation 边样式(v0 仅 label);读投影暴露 derivation "why";前端 canvas.infer 单一动词按钮(绝不扩成"选哪种结构"菜单);prose/outline 一等面 + AI 从 dump 填的低-schema 模板。

## 依赖图 / 关键路径
独立叶(可立即并行,均离线):**诊断 A1、suggestion 模型、β1 类型、D3、D1、空间读取器**。
关键链:`A1 → A3(Suggestion+ops 编译)→ A5(InferenceCore 接线)→ A4(活 LLM)`;`β1 → D3 → D4 → D5`(D5 唯一栈门控)。A5 依赖 A3 + D7(reject-by-derivation = undo 原语)+ D3 离线半。D1/D2 必须先于任何 A 聚类。

## 第一个 PR(采纳批判修正)
**PR #2 = 确定性推断核心:`backend/core/canvas/inference/` 的 `diagnostics.py` + `suggestions.py`(+ ops 编译)。**
- **为何这个**:批判驳回了"空间读取器先行"(= eyes 没 brain,等于痛根)。诊断+建议是脑的**确定性核心**:"找问题→提议修复"——这是真正的 AI-first 能力(用户接受/忽略),且**无需 LLM、纯 Python、离线可单测、对原生 lane 零回归**,正是 LLM 循环 + 接线要消费的地基。比"全 stub 端到端循环"更小更稳(不碰 jwt 污染的 agent_runtime_v2),又比"空间读取器"更 AI-first(是脑不是眼)。
- **验收**:WSL pytest——已知 cycle/孤立 claim/重叠 siblings/claim±inbound evidence → 精确有序诊断集;每个 compiled proposed_ops 过 normalize_ops 零 warning 且仅 ALLOWED_OPS;stable id 可复现;locked/pinned 守护丢弃越界 op;角色只读派生、无角色退化纯拓扑。
- **之后**:PR #3 = InferenceCore + kernel 窄触发 + write_service actor(docker 内测);PR #4 = 活 LLM 循环;空间读取器在 D1/D2 守护后接入。

## 待决（批判 + 综合的 open decisions）
- **角色来源**:必须 AI-派生-only、存 provenance/derived、**永不**用户可编辑字段(否则 IBIS 重生)——A1 之前钉死。
- **per-batch derivation id**:reject-by-derivation 须 per-batch(非 per-run),否则一次 reject 误删无关提议。
- **D5 actor 调和(安全)**:类型来自鉴权 context,body 只给 model/derivation;须用伪造 body 测过。
- **窄触发谓词**:inference 路径绝不截走既有 canvas create/layout 请求。
- **accept 再校验**:提议的 stable id 须挺过 propose→accept 间的版本 bump(复用 `_check_pending_preview_valid` execution_core.py:581)。
- **DEDUP**:A 的 spatial.py 不建,用 C 的 spatial_reader.py;前端类型三 ticket 合并 β1 单 owner;provenance/actor 用 D3+D5 一处实现。
