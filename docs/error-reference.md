<!--
Error reference for PM/Support. Focus on可见报错、对应HTTP/业务码、触发原因、用户影响、建议行动/提示语。保持常更新，新增错误时补充本表。
-->
# 错误对照表（PM/支持）

## 如何使用
- 对照接口/页面返回的 HTTP 状态码、`error_code`、报错文案快速定位原因。
- “提示语”可直接给到用户（中性、非技术化）；“客服动作”是支持侧需要做的下一步。
- 若后端新增 `error_code` 或业务校验，请同步补表。

## 汇总表

| 场景 | HTTP/业务码 | 触发条件/根因 | 用户影响 | 建议提示语 (中文 / English) | 客服动作 |
| --- | --- | --- | --- | --- | --- |
| 鉴权缺失/失效 | 401 `Invalid token` / `No valid authentication credentials found` | Authorization 头缺失或过期；JWT 无 `sub` | 所有受保护接口被拒绝 | “登录状态已失效，请重新登录后再试。” / “Your session expired. Please sign in again.” | 引导重新登录；如频繁出现，检查前端 token 刷新逻辑 |
| 未分配角色 | 403 `No role assigned` | 新账号未写入角色或角色列为空 (`core/auth.py`) | 登录后接口仍被拒绝 | “账号尚未开通权限，请联系管理员。” / “Your account isn’t activated yet. Please contact an admin.” | 为用户写入 basejump `user_roles` 或同步角色初始化 |
| 管理员 API Key 校验失败 | 401/403 `Invalid admin API key` | `X-Admin-Api-Key` 未提供或不匹配 (`auth_utils.verify_admin_api_key`) | 管理端接口无法调用 | “管理员凭证无效，请确认后台配置的 API Key。” / “Invalid admin credential. Check the configured API key.” | 核对环境变量 `ZMIND_ADMIN_API_KEY` |
| Workspace 成员校验失败 | 403 `Not a member of workspace` (`auth_utils._ensure_workspace_membership`) | 用户不在请求的 workspace | 页面/接口拒绝访问 | “您尚未加入该空间，无法访问。” / “You’re not a member of this workspace.” | 确认 `basejump.account_user` 成员关系；必要时为用户添加 |
| Agent 不存在/越权 | 404 `Agent not found or access denied` / `Agent not found` | 访问/启动/编辑的 agent 不属于当前账号或已删除 | Agent 配置/启动失败 | “该 Agent 不存在或您暂无权限访问。” / “This agent either doesn’t exist or you don’t have access.” | 确认 agent 所属账号；检查 workspace header；如已删除需重新创建 |
| 线程访问越权 | 403 `Not authorized to access this thread` | 线程不属于用户/账号且项目非公开 | 线程页加载失败 | “此对话未向您开放，可能未分享或已删除。” / “This thread isn’t shared with you or may have been removed.” | 确认线程所属项目是否公开/成员是否加入账号 |
| 项目/Canvas 公共访问关闭 | 403 `Canvas is not public` / `Timeline is not enabled for this canvas` | 访问公共 canvas 接口但未公开或未启用时间线 | 公共查看失败 | “当前画布/时间线未开放访问，请联系所有者开启。” / “This canvas/timeline isn’t public. Please ask the owner to enable access.” | 提示项目 owner 修改公开设置 |
| 媒体/文件访问拒绝 | 403 `Not authorized to access this file` (`media/api.py`) | 文件不属于用户或非公开路径 | 文件预览/下载失败 | “您暂无权限访问该文件。” / “You don’t have permission to access this file.” | 确认存储对象 owner、路径前缀；必要时授予访问或重新上传 |
| 知识库权限/不存在 | 403/404 `Access denied` / `Folder/Entry not found` | 目标文件夹/条目不属于当前账号或不存在 | 知识库列表/下载/删除失败 | “目标内容不存在或已下线，请确认后重试。” / “The item is missing or unavailable. Please check and try again.” | 检查 `knowledge_base_entries` 归属；确认是否已被删除 |
| 知识库容量超限 | 413 `File size limit exceeded` | 账户 KB 总容量 > 50MB | 上传被拒 | “知识库容量已满（上限 50MB），请清理后再上传。” / “Knowledge base is full (50MB limit). Please delete files before uploading.” | 让用户删除旧文件；必要时调高配额 |
| Agent 数量超限 | 402 `AGENT_LIMIT_EXCEEDED` | 套餐可创建的 agent 数量已达上限 (`agent_crud`) | 无法创建新 Agent | “已达当前套餐的 Agent 上限，请升级或删除后再创建。” / “Agent limit reached for your plan. Upgrade or remove one to proceed.” | 提供套餐升级或提升限额 |
| 项目数量超限 | 402 `PROJECT_LIMIT_EXCEEDED` | 账户项目数达上限 (`agent_runs`) | 无法新建项目（创建 agent run 时） | “项目数量已达上限，请升级套餐或清理旧项目。” / “Project limit reached. Upgrade your plan or remove old projects.” | 升级/临时提额或引导删除项目 |
| Agent 运行并发超限 | 429 `Too many agent runs running` | 24h 内并发 Agent Run 超过 `MAX_PARALLEL_AGENT_RUNS` | 新任务被拒 | “当前并发任务过多，请稍后再试。” / “Too many runs in progress. Please try again later.” | 建议等待/取消其他运行；必要时调高并发上限 |
| 模型访问受限 | 403 `model_access_denied` | 模型不在用户可用列表或未授权 | 对话/调用无法开始 | “当前模型未为您开放，请更换模型或联系管理员。” / “This model isn’t enabled for you. Switch models or contact an admin.” | 调整账户模型白名单；核查计费/合同 |
| Agent 启动被拒（通用 403） | 403 `(Error starting agent ...)` | 启动 Agent 时服务端返回 403，多见于模型未授权、线程/项目不属于当前账户、workspace header 缺失或无成员权限 | 任务无法启动 | “没有权限启动该对话/模型，请确认空间与模型权限后重试。” / “You don’t have permission to start this run/model. Confirm workspace membership and model access.” | 检查 workspace header；确认用户在账号内；看 `allowed_models`；核查权限日志 |
| 余额/额度不足 | 402 `insufficient_credits` | 账户余额/订阅额度不足 | 任务被拒 | “账户额度不足，请充值或升级套餐。” / “Insufficient credits. Please top up or upgrade your plan.” | 协助充值/续费；检查计费流水 |
| 计费：信用购买限制 | 403 `Credit purchases not available for your tier` | 当前层级不支持购买信用点 | 无法下单 | “当前套餐不支持购买额度，请升级套餐。” / “Your plan can’t purchase credits. Please upgrade first.” | 指导套餐调整 |
| 邀请码限制 | 403 `Only new accounts are eligible to redeem the invite code` | 老账号使用新人邀请码 | 兑换失败 | “该邀请码仅限新账号使用，请更换邀请码。” / “This invite code is for new accounts only. Please use a different code.” | 校验用户是否新注册；必要时发放适配邀请码 |
| Traces/工具权限不足（MCP/Composio 等） | 403 `Access denied` | 工具/凭据归属校验失败 | 无法保存/调用工具 | “该工具/凭据归属不匹配，无法使用。” / “You don’t have access to this tool/credential.” | 检查用户是否为资源 owner 或成员 |
| 工具配置缺必填 | 400 `X-MCP-URL header is required` / `MCP URL is required` / `custom_mcps array is required` | 新增/更新 agent 工具时缺少必填字段 | 保存失败 | “请补全工具地址/配置后再保存。” / “Please fill in the tool URL/config before saving.” | 提示前端补齐字段；检查表单校验 |
| Zmind 默认 Agent 禁止修改/删除 | 400 `Cannot delete default agent` / `This default agent's ... cannot be modified` | 对内置 Zmind 默认 Agent 进行重命名、改 Prompt、改工具或删除 | 操作被拒 | “系统内置 Agent 不支持修改或删除。” / “This built-in agent can’t be edited or deleted.” | 解释为产品限制；如需变更走配置发布流程 |
| Google 集成未授权/过期 | 401 `User not authenticated with Google` / `Failed to refresh token` | OAuth token 缺失/失效 | 同步/导入失败 | “Google 授权已过期，请重新连接账户。” / “Google access expired. Please reconnect your account.” | 引导重新 OAuth；检查回调配置 |
| LLM 上下文超长 | 流水错误 `context_window_exceeded` | prompt 过长超出模型窗口 | 生成失败 | “内容过长，请精简后再试。” / “Content exceeds the model limit. Please shorten and retry.” | 建议用户裁剪输入或换更大窗口模型 |
| LLM 凭证错误 | 流水错误 `authentication_error` | 模型 key 无效/权限不足 | 生成失败 | “模型授权无效，请检查 API Key。” / “Model credential invalid. Please verify the API key.” | 检查服务端保存的模型凭证、额度 |
| LLM 速率限制 | 流水错误 `rate_limit_error` | 调用命中频控 | 生成失败/延迟 | “请求过于频繁，请稍后再试。” / “Too many requests. Please try again shortly.” | 观察流量，必要时做队列或提升配额 |
| LLM 预算超限 | 流水错误 `budget_exceeded_error` | LiteLLM 预算上限触发 | 生成失败 | “当日/本月预算已用完，请调整额度。” / “Budget limit reached. Please increase the budget or wait for reset.” | 调整预算或重置预算窗口 |
| Canvas 版本冲突 | 409 `Version conflict` | 保存时版本号不一致 | 保存失败 | “画布已被他人更新，请刷新后重试。” / “Canvas was updated elsewhere. Refresh and try again.” | 让用户刷新并重新提交 |
| Canvas Patch 校验失败 | 422 `operations must be non-empty` | 提交操作列表为空/非法 | 操作被拒 | “无有效变更，请检查后再试。” / “No valid changes detected. Please review and retry.” | 指导前端/用户确认操作数据 |
| Env vars 管理仅限本地 | 403 `Env vars management only available in local mode` | 非 local 环境调用 env 读写接口 | 管理接口被拒 | “当前环境禁用在线修改配置，请在本地/运维侧操作。” / “Editing env vars is disabled in this environment. Please manage them locally or via the ops team.” | 在本地/运维侧操作；避免线上写配置 |
| Agent API 未初始化 | 500 `Agent API not initialized with instance ID` | 服务启动时未设置/传递 `instance_id`（线程管理器未初始化） | 线程/agent 启动型接口全部失败 | “服务启动异常，请稍后再试或联系管理员。” / “Service failed to initialize. Please retry or contact support.” | 重启服务，确认 `instance_id` 初始化逻辑；检查部署脚本 |
| Server 启动/健康检查失败 | 500 `Health check failed` / 初始化异常 (`api.py`) | Supabase/Redis 初始化异常、配置缺失 | 服务不可用 | “服务启动异常，请稍后再试。” / “Service failed its health check. Please try again shortly.” | 查看 `docker compose logs`/环境变量，排查依赖连接 |
| 配置缺失（Self-hosting） | 启动报缺失配置字段 | `.env` 关键变量缺少 | 服务启动失败 | “服务配置缺失，请补全环境变量。” / “Required config is missing. Please complete the .env setup.” | 参考 `docs/SELF-HOSTING.md` 检查必填配置 |

## 常见改进建议（供产品/前端）
- 前端根据 `error_code` 或特定 detail 文案，覆盖更友好的提示语（特别是权限/配额类），避免通用 “Access denied”。
- 后端在 403/402/429 中尽量填充 `error_code` 和 `user_friendly_message`，便于前端直出。
- 支持/PM 根据本表核对：如无对应条目，提醒研发补充并更新此文档。
