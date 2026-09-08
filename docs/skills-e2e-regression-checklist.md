# Skills 全链路回归清单

> 目标：确保 Skills 从“安装 → 匹配/自动触发 → 执行 → 结果展示”全链路可用。

## 0. 运行前配置
- 后端关键环境变量（`backend/.env`）：
  - `LANGGRAPH_SUPERVISOR_ENABLED=true`
  - `LANGGRAPH_SUPERVISOR_MODE=handoff_only`（或 `hybrid`）
  - `LANGGRAPH_ROUTER_ENABLED=true`
  - `LANGGRAPH_ROUTER_HARD_GATE=false`（默认建议）
  - `ZMIND_SKILLS_AUTO_RUN=true`
  - `ZMIND_SKILLS_AUTO_RUN_SCORE=7`
  - `ZMIND_SKILLS_COMMAND_HOOKS_MODE=deny`
  - `ZMIND_SKILLS_PROMPT_HOOKS_MODE=skip`

## 1. 后端自动化冒烟
- 命令：
  - `cd backend && UV_CACHE_DIR=/tmp/uv-cache UV_PYTHON_INSTALL_DIR=/tmp/uv-python UV_PROJECT_ENVIRONMENT=/tmp/zmind-backend-venv311 uv run --python 3.11 pytest -q tests/test_skills_fullchain_smoke.py tests/test_skills_orchestrator.py tests/test_call_model_forced_tool.py tests/test_skills_official_standard.py tests/test_skillsmp_client.py`
- 预期：
  - 自动匹配命中后产生 `forced_tool_call`
  - `call_model` 生成 `pending_tool_calls`，首个工具为 `run_skill`
  - `run_skill` 支持 `fork` 模式
  - skills 触发的画布工具输出可被正确提取回传
  - marketplace client 契约测试全部通过

## 2. 前端展示回归
- 命令：
  - `npm --prefix frontend run lint -- src/components/thread/tool-inline/summarizers.tsx`
- 预期：
  - `install_skill` 有可读摘要（安装/更新、来源、兼容性）
  - 无新增 lint error（历史 warning 可暂存）

## 3. 人工联调（建议）
- 场景 A：安装 skill
  - 用 `install_skill` 安装一个手动 skill
  - 预期：对话流内显示“已安装/已更新 + skill 名称”
- 场景 B：自动触发
  - 发送与某个 skill 强相关的请求（无附件）
  - 预期：命中 matcher 分数阈值后，首轮直接触发 `run_skill`
- 场景 C：画布技能
  - skill 内调用 `canvas_edit` 或 `canvas_write`
  - 预期：最终响应中能看到结构化输出，不是原始调试 JSON 垃圾信息

## 4. 失败排查优先级
- `forced_tool_call` 没触发：
  - 查 `ZMIND_SKILLS_AUTO_RUN`、`ZMIND_SKILLS_AUTO_RUN_SCORE`
  - 查 `disable-model-invocation`、`user-invocable`
- `run_skill` 失败：
  - 查 `skill_id` 是否存在
  - 查 `run_config` 是否注入
  - 查 fork 下 `project_id`/`account_id` 是否完整
- hooks 干扰执行：
  - command hooks 按 `ZMIND_SKILLS_COMMAND_HOOKS_MODE` 管控
  - prompt hooks 当前未实现，默认 `skip`

