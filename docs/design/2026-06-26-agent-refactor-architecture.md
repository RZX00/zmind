# Agent 重构架构：内部 agent 怎么搭 + 外部 agent 怎么连

> 2026-06-26 · 6-opus workflow（4 接地维度读真实代码 → 综合 → 对抗批判，run wbi982ot0）
> 触发：一整天给 langgraph supervisor 栈打补丁后,创始人要求重构并确认两件事。

## 0. 头条结论（对抗批判纠正的认知）

**别再叫它"重构"。** 内部痛点的根因不是架构错,是 **supervisor 多 agent 层**——它在画布请求上多打一次路由 LLM + 起**第二个完整 LangGraphEngine** 做委派(这就是 60-100s 和"丢请求"的来源)。

- **内部 agent = 主要靠"删"**:砍掉 supervisor/委派/苏格拉底,**复用本就存在的那条干净单模型循环**(`call_model ↔ execute_tools`)。**不要引入 Claude Agent SDK**(这反转了 memory 里的旧方向,但证据压倒性)。
- **外部 agent = 唯一真正的新功能**:一个 Canvas MCP server(FastMCP 已 vendored),和内部 agent **共用同一个画布工具核心**。

两者共用一条脊柱:`canvas_read/write/edit → CanvasEditTool.edit → apply_canvas_ops → realtime /apply`。

## 1. 内部 agent 怎么搭(KEEP 循环 + 删 supervisor)

**核心决定:保留现有 thin loop,不上 Claude Agent SDK。** 接地验证的硬理由:
- **计费绑死在循环的事件上**:`call_model.py:1516/2353` 发 `llm_response_end` → `event_persister.py:145` → `BillingGuard.deduct_once`。Claude Agent SDK 自己发 Anthropic 调用,**绕过** `make_llm_api_call`(habitat 网关 + 平台 key 计费,`llm.py:337/939`)、前端依赖的 v2 事件总线、checkpoint/stop-signal。
- SDK 的价值(循环 + 工具编排)**正是已经存在的东西**——引入 = 净增依赖 + 平行运行时,换来零新能力。

**循环本体**(KEEP,不重写):`graph.py:194-209` 的 `DefaultCallModelNode ↔ DefaultExecuteToolsNode`,已是干净的单模型 读→工具→观察 循环,带流式/checkpoint/stop。

**要删的**(RIP):
- supervisor 注册 + 委派工具 `transfer_to_canvas_agent` + `run_subagent` 起的**第二个 LangGraphEngine**(`subagent_runner.py:219`)——延迟主因 + 丢请求主因(子 agent 上下文从占位 task 重建,`subagent_runner.py:76`)。
- **`use_supervisor` 门控本身**:`run_agent_background.py:510-514` 只查 `enabled + mode≠chat + surface≠doc`,**没查 canvas**——所以光翻 lane 开关仍会注入委派工具。要加 canvas-surface 门 或 `LANGGRAPH_SUPERVISOR_ENABLED=false`。
- canvas 上的**预路由 LLM**:`route_from_semantic`(`router.py:348`)+ skill plan(`run_agent_background.py:638`)→ canvas 直接进 brain,跳过。
- **苏格拉底引导模式**:base prompt(`prompts/prompt.py:25/151/195` 等)强制开放问题结尾 + `ask` 工具 → 拒绝执行。surface==canvas 时**换成执行优先的系统提示**(不是叠加,要替换)。
- 零-LLM canvas lane brain(`CanvasExecutionCoreV2`)——退役为推理路径(保留它的 /apply + preview 管线)。

## 2. 外部 agent 怎么连(Canvas MCP server)

用户自带的 Claude Code / Codex 通过一个**新的 Canvas MCP server** 驱动同一画布:
- **建**:`backend/core/canvas/mcp_server.py`,用已 vendored 的 FastMCP(`mcp==1.9.4` 带 server 端;repo 现在只有 client `mcp_module/mcp_service.py:11`)。`FastMCP(stateless_http=True)` + 4-5 个 `@mcp.tool()`(canvas_read/write/edit/list_canvases)适配 MCP 参数 → CanvasContext → 共享核心。~150-250 LoC,**零画布逻辑**。
- **传输**:streamable HTTP,`app.mount('/api/canvas-mcp', mcp.streamable_http_app())` 挂成 ASGI 子应用(不进 /api APIRouter)。v1 用 `stateless_http=True` 免 session 生命周期、可水平扩展。
- **鉴权**:v1 = scoped 静态 bearer(新 `canvas_mcp_tokens` 表:token_hash/user_id/workspace_id/canvas 范围/过期);bearer → CanvasContext,强制校验 workspace 成员。GA = OAuth 2.1 resource server(`mcp/server/auth/` 已 vendored)。
- **用户操作**:前端"连接外部 agent"页铸 scoped token → 贴 MCP URL + token 进自家 agent 的 mcpServers 配置 → 用 canvas_read/write/edit 驱动画布。

## 3. 共享核心(脊柱,KEEP 不重写)

- `CanvasEditTool.edit()`(`canvas_edit_tool.py:263`)已接受 `account_id_override + canvas_id + expected_version`,REST 路径已证明可 headless 调(`canvas_command_application_service.py:916`)。
- 读 = `read_projection.py` + `fetch_canvas_snapshot`(`write_service.py:359`)。
- 写尾 = `apply_canvas_ops`(`write_service.py:229`)→ realtime `/apply`,带 If-Match/Idempotency-Key/409→version_conflict。
- **唯一要做的重构**:4 个 CaC wrapper(`cac/tools.py`)现在靠查 threads 表解析 account_id/canvas_id;抽一个显式 `CanvasContext{workspace_id, canvas_id, user_id, selection?, camera?}`,4 个 wrapper 改成显式接收(引擎已支持 override,这是 wrapper-only 改动)。把 agent 面的 JSON schema 移到中性模块,内部循环 + MCP server 都 import。**这是唯一真正的代码重构,且它只为外部 agent 服务**。

## 4. 痛点逐条核对(对抗批判验证)

| 观察到的痛点 | 是否消除 | 说明 |
|---|---|---|
| 延迟 60-100s | ✅ 大降(非"单轮") | 删委派子引擎是主因;但还需跳过预路由 + 确认 canvas 不走 plan_task 子图,才能逼近单轮 |
| 委派丢请求 | ✅ 完全 | 删 `transfer_to_canvas_agent` 整条路径 |
| 苏格拉底拒绝执行 | ⚠️ 第一版需替换 base prompt | 仅叠加 guidance 不够(prompt 冲突),surface==canvas 要**替换**而非前置 |
| 消息消失 | ✅ **已修**(本会话) | `utils.ts:314` 已认 run_status,非待办 |
| 模型被拦 | ✅ | `CANVAS_AGENTIC_MODEL` 已 pin claude-sonnet;注意别让 fallback/hedge 重新引入被拦的 gemini |

## 5. 隐藏风险(批判提出,必须先决)

1. **第二个 brain 阴魂不散**:`lane_selector.py:45-50` 仍把 preview/确认消息("yes, do it")路由到旧的零-LLM lane → 两套画布执行路径长期并存。**现在就要决定确认流是否也走新循环。**
2. **外部写的乐观并发坑**:MCP 让 expected_version 可选 → 外部 agent 不读版本就写 = 和真人编辑 last-write-wins 静默丢更新。GA 前必须强制 read→version→write。
3. **鉴权边界搬家(最高危)**:去掉 threads 查询后,信任落到谁构造 CanvasContext。MCP 的 token→workspace 映射成为唯一边界,错的 workspace_id = 跨工作区写。token resolver 必须校验成员 + 加跨工作区拒绝测试。
4. **planning 子图未验证**:`graph.py:158-166` resolve_intent → {plan_task|call_model};若 canvas 走 plan_task,"单轮"不成立。承诺延迟前要验。
5. **模型单点 + 网关锁定**:整条 canvas 硬依赖 habitat/claude-sonnet-4-6 不被拦;加 allowlist/health check,别信单一 pin。

## 6. 迁移路径（每步开关门控、可独立发）

- **STEP 1（最大延迟收益,~配置+3行门）**:`CANVAS_AGENTIC_LANE_ENABLED=true` + 给 `use_supervisor`(`run_agent_background.py:510`)加 canvas-surface 门 → 不再为 canvas 注册委派工具。
- **STEP 2（prompt）**:surface==canvas 替换掉苏格拉底 base prompt。
- **STEP 3（跳预路由）**:canvas 跳过 route_from_semantic + skill plan。
- **STEP 4（抽共享核心）**:CanvasContext + 中性 schema(为外部 agent 解锁,带鉴权边界测试)。
- **STEP 5（MCP server,开关门控）**:先只读,再加写;静态 scoped bearer + canvas_mcp_tokens 表。
- **STEP 6**:确认流路由收口(消除第二个 brain)。
- **STEP 7（GA）**:OAuth 2.1 + 可选 server-side preview 门。

## 7. 第一个 build（test-only,不启栈）

**STEP 1+2+3 合成一次开关门控改动**(批判修正:光翻 STEP 1 会留苏格拉底+预路由半死):
1. `CANVAS_AGENTIC_LANE_ENABLED=true`;2. `use_supervisor` 加 `surface!='canvas'` 门 → 永不注册 `transfer_to_canvas_agent`;3. surface==canvas **替换**苏格拉底系统提示;4. canvas 跳过 route_from_semantic + skill plan;5. 确认模型 pin。
- **验收(仅测试)**:"建 3 节点成链,再加第 4 个" 单条流式跑完;trace 显示 canvas_read → canvas_write/edit,**无 transfer_to_canvas_agent、无 ask/反问**;ops 落库;计费经 llm_response_end 触发;摘要不消失;延迟大降。**加一条负向测试**:确认式回复("yes, do it")**不得**静默路由到退役的零-LLM lane。
- **明确不在第一版**:CanvasContext 重构 + MCP server(证明后再做)。

## 8. 给创始人的决策

1. **内部 brain(反转旧方向)**:KEEP thin loop + 删 supervisor(**推荐**,证据压倒)vs 上 Claude Agent SDK。SDK 会绕过已验证的计费/事件/checkpoint,换零新能力——除非有非计费理由,选 KEEP。
2. **supervisor 范围**:canvas-surface 门(低爆炸半径,research/presentation 委派仍活)vs 全局关。
3. **MCP v1 范围/鉴权/preview 门**:读+写 + 静态 bearer + 无 preview 门(v1 推荐);OAuth + 门留 GA。
4. **确认流路由**:preview/"yes do it" 是否也搬到新循环(否则两个 brain 并存)。
