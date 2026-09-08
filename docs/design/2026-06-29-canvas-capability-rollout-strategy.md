# 画布呈现能力 — 推进策略(已并入对抗压测修正)

> 2026-06-29。来源:12-agent opus workflow(6 资产勘察 → 4 立论方案 → 综合 → 对抗压测)。本稿是**可落地的推进策略**,已按压测的 6 条 TOP fix 修正综合稿。原则:**质量是 substrate 测量并强制的属性,不是 prompt 里断言的形容词**。诚实标注:prompt 仍承担"命名/分类"等语言任务,机器承担"测量/几何/强制"。

## 0. 裁决(压测后)
- **真正越过 prompt 的核心** = content-agnostic 的 `LayoutCritic` 标量 + golden corpus CI(零-flag、可离线证伪的适应度函数)+ **闭环**(写后即测、低分即修)。
- **综合稿的过度/冲突部分被砍**:不复活 flagged 的 native 子图(与 thin-loop 决策 #2 冲突);不把 repair 路由进 `verify_outcome→repair_plan`(只在 flag-on 时存在);morphology/role 分类器移出本能力关键路径(那是 argument-quality 轴,非 dead-column 轴);PresIR + LLM-emit-kind 暂不进 canvas 直连 loop(与"canvas=CRUD、关 thinking"决策冲突)。
- **闭环的关键修正(压测 fix #1)**:开环根因不是"critic 没挂上",而是**感知时机**——live loop 写完从不重测。**最优解:在写工具的返回结果里就地给出 `presentation_score` + findings**(写后内部抓一次 snapshot 打分,不是 LLM 重读回合),agent 同一轮即看见自己刚造的死柱。

## 1. 分层(精简到可建且非-prompt 的部分)
- **L0 感知地面真值**:`read_projection`(已在)。Phase 0 的 column 检测**只看 width/x-variance/count/单调 Y**,default 几何即可工作,**不依赖 geometry-sync**(压测确认)。
- **L1 理解 = `LayoutCritic` 标量**(纯 stdlib 几何+拓扑函数,content-agnostic)。**machinery 全部**。morphology(LLM)不在本轴,推迟。
- **L2 substrate 几何能力**:升级 `CaCEngine` 布局算法(per-column grid 宽、按内容定高),让"好表征"渲染得真好——确定性机器。
- **L3 thin loop**:写工具结果带 `presentation_score`→agent 当成地面真值(如它现在收 diagnostics)→低分时 bounded loop-back 自修。**不碰 flagged 子图**。
- **L4 skills 可发布**:`output_schema` 从 advisory 升运行时校验 gate(warn-then-gate)。
- 棘轮/morphology/PresIR/蒸馏 = 后期,本轮不做。

## 2. 直接回答三问(压测后诚实版)
- **Q1 内部 agent 真懂** = 闭环。写后即测把 `presentation_score:0.2, dead_column(45 nodes, aspect 1:54)` 放进**写工具的返回结果**(agent 没亲手编造的地面真值)→ 低于地板时注入"死柱,请改用 table/row-of-columns/mermaid mindmap"的具体 finding 纠正 nudge → bounded 回 call_model 重写。prompt 只剩:命名内容 + 按 finding 决定怎么改。**它之前不可能懂,因为从不观测自己的渲染后果。**
- **Q3 底层真能力(应变+高抽象)** = `LayoutCritic` 用**连续 content-agnostic 几何特征**(aspect ratio / x-variance / overlap / off-viewport / 节点数)评判任意输出图,未知形态退化到通用判据(total function 永不崩)——泛化不靠 per-scenario。`CaCEngine` 的几何算法是确定性 substrate 能力。golden corpus 是让算法诚实、永久防回归的地板。
- **Q2 skills 真懂可发布** = `output_schema` 运行时 gate:skill 写完产物若不符 schema → fail-closed/warn。(完整"打分渲染后 doc + 出站 publish"是后续;本轮先补 schema gate 这块最小真缺口,压测 fix #6 记录了 plan→render→critic 缝待后续接。)

## 3. 本轮 build(按序,每步带验证)
1. **`backend/core/canvas/inference/layout_critic.py`**(纯 stdlib,仿 `diagnostics.py`):`score_layout(doc)→{score, dimensions, findings[]}`。detectors:`overflow_column`(≥N 近等宽、x-variance≈0、单调 Y → 死柱)、`node_overlap`(复用 `_rectangles_overlap`)、`offscreen_sprawl`(复用 `nodes_in_viewport`)、`oversized_for_content`(300×60 装长文本)。每 finding 带 `code/severity/detail/suggestion(改用什么表征)`。
2. **写后即测**:`cac/tools.py` 的 `canvas_write`/`canvas_edit` 成功 apply 后,内部 `fetch_canvas_snapshot` → `score_layout` → 把 `presentation_score`+`findings` 挂进**工具结果 meta**。同时 `canvas_read` 整画布 meta 也挂(读时信号)。
3. **闭环 repair**:在 live 终止决策里,若上一次写的结果 `presentation_score` < 地板且有可修 finding → 注入 finding.suggestion 纠正 nudge + `force_continue`(bounded,计数器**声明为 GraphStateInternal channel**,防像 canvas_followthrough_count 那样重置失效)。**不进 flagged 子图。**
4. **`CaCEngine` 布局打磨**(`cac/engine.py`):grid 用 per-column 最大宽算 pitch(修 ragged)、tree/flat 写路径按内容字符数/行数定高(修 300×60 截断)。给 agent 一个"好的可 relayout 进去的目标"。
5. **`skills_tool.py` output_schema 运行时 gate**(warn-then-gate)。
6. **测试**:`tests/canvas_contract/test_layout_critic.py`(persona disaster 45×300×60 → below floor + dead_column;健康 5×9 grid → above floor;golden corpus 种子)+ 布局算法测试。容器内 `uv run pytest` 跑。
7. **live 验证**:harness 发"讲解某主题"类宽浅请求 → 确认 (a) 写结果带 presentation_score (b) 若死柱被自动重写成更好表征 (c) 不破坏既有 create/modify/readonly。

## 4. 不做(graveyard / 决策对齐)
不复活 native 子图;不在 canvas 直连 loop 加 LLM morphology/PresIR-kind(与 canvas=CRUD 冲突);无 user-facing role/relation picker;无常驻认知裁决引擎(critic 仅 presentation/layout 几何质量、hint 级);relayout 既有节点尊重 `pinned`/`positionIsIntentional`;加权/版本化 rubric + 蒸馏 = 后期。
