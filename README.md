<div align="center">

# Zmind — AI Visual Thinking Studio

![Zmind Canvas](frontend/public/banner.png)

画布 × Agents 的全栈平台：无限画布、智能 Agent、双工具栈（LangGraph 原生工具 + MCP/Composio）、实时协作。

[访问 Zmind 官网](https://zmind.so)

</div>

## 为什么现在的版本值得看
- Canvas × Agent 双向联动：Agent 可读写 Yjs 画布、创建/连接节点、维护跨画布引用和模板。
- 双工具栈：内置 LangGraph 原生工具 + MCP/Composio 外挂工具，统一注册/鉴权/审计。
- 实时协作：独立 `canvas-realtime` WebSocket 服务（Hocuspocus + Redis），支撑多人/AI 同步。
- 多端入口：Next.js 16 Web、FastAPI + Dramatiq 后端、Electron 桌面端、Expo 移动端预览。
- 企业就绪：Supabase + Basejump 的 RLS 多租户、加密凭据、计费与版本管理。

## 架构一览
- Frontend：`frontend/` — Next.js 16 + React 19 + Tailwind v4 + shadcn/ui。
- API & Agent Runtime：`backend/` — FastAPI 0.115 + Dramatiq worker，LangGraph 栈 + MCP/Composio 集成。
- Canvas Realtime：`services/canvas-realtime/` — Hocuspocus WebSocket + Redis，校验 Supabase JWT。
- Data：Supabase Postgres/Storage（RLS via Basejump）、Redis。
- Desktop：`apps/desktop/` — Electron shell（Windows/macOS/Linux 打包、协议深链登录回调）。
- Mobile（预览）：`apps/mobile/` — Expo + React Native 0.79。
- Infra：根目录 `docker-compose.yaml` 编排 redis + backend + worker + canvas-realtime + frontend。

## 仓库结构
- `backend/` FastAPI API、Agent 内核、Dramatiq 任务、Supabase 脚本。
- `frontend/` Next.js 应用，画布/landing/Thinking Studio 组件。
- `services/canvas-realtime/` Hocuspocus + Redis 的 Yjs 服务。
- `apps/desktop/` Electron 桌面端（协议深链、OAuth 弹窗、桌面打包脚本）。
- `apps/mobile/` Expo 客户端。
- `supabase/` 数据库迁移与种子。
- `docs/` 架构/部署/产品文档；`AGENTS.md`、`ALETHEON_*.md` 提供深入分析。
- `scripts/`、`start.py` 等开发辅助工具。

## 快速开始（推荐）
1. 准备环境：Python 3.11+，Node 18+/20+，Docker & Docker Compose，推荐安装 `uv`（或使用 `pip`）。
2. 初始化：在仓库根目录运行 `python setup.py`（生成/更新 `backend/.env`、`frontend/.env.local` 并填入占位符）。
3. 一键启动：`docker compose up -d --build`（启动 redis、backend、worker、canvas-realtime、frontend）。
4. 访问：
   - Web 前端：http://localhost:3000
   - Backend 健康检查：http://localhost:8013/api/health
   - Canvas realtime 探活：http://localhost:6020/healthz
5. 停止：`docker compose down`（如仅关闭前端可单独 `docker compose stop frontend`）。

## 本地开发（分进程）
- Redis（容器）：`docker compose up redis`
- 后端 API（热重载）：`cd backend && uv run uvicorn api:app --reload`
- 后台 Worker：`cd backend && uv run dramatiq --processes 4 --threads 4 run_agent_background`
- 画布实时服务：`cd services/canvas-realtime && npm install && npm run dev`
- 前端：`cd frontend && npm install && npm run dev`
- 桌面端（可选）：`cd apps/desktop && npm install && npm start`
- 移动端（可选）：`cd apps/mobile && npm install && npm start`
- 注意：本地直连 Redis 时将 `backend/.env` 的 `REDIS_HOST` 设置为 `localhost`（容器内使用 `redis`）。

## 环境与配置
- 后端环境：`backend/.env`（Supabase、LLM 提供商、Redis、MCP/Composio 密钥、Webhook 等）。
- 前端环境：`frontend/.env.local`（Supabase 公钥、后端 API、公共 URL 等）。
- Canvas Realtime：`services/canvas-realtime/.env` 或环境变量（见该目录 README）。
- 不要提交密钥，新增变量请同步更新 `.env.example` / 文档。

## LLM 默认与推荐（开源仓库）
- 默认模型已预置为 Leaflow 路线（开箱即用推荐）：
  - `free`: `leaflow/gemini-3-flash-preview`
  - `premium`: `leaflow/claude-sonnet-4-6`
- 对开源自部署用户，推荐优先配置 `LEAFLOW_API_KEY`（见 `backend/.env.example`）。
- 若你要切换到其他 provider，可在模型注册与环境变量中调整；默认配置不要求你在网站 UI 里再做额外设置。

## 测试与质量
- 后端单测/集成：`cd backend && uv run pytest -q`
- 前端检查：`cd frontend && npm run lint && npm run type-check`
- 其他：`frontend` 使用 Turbopack 开发（`npm run dev`），`npm run build` 产出生产包。

## 相关文档
- 架构与 Agent 体系：`ALETHEON_ARCHITECTURE_ANALYSIS.md`、`ALETHEON_TECHNICAL_DOCUMENTATION.md`
- 自部署指南：`docs/SELF-HOSTING.md`、`docs/nginx-server-example.md`
- 画布实时服务：`services/canvas-realtime/README.md`
- 贡献规范与工作流：`CONTRIBUTING.md`、`AGENTS.md`
- 前端/画布规划：`docs/design/canvas-as-code-spec.md`、`docs/global-search.md`

## License

Zmind is open source under [Apache-2.0](LICENSE). You may use, modify,
distribute, and use it commercially under that license. The Zmind name and
logos remain subject to [the trademark policy](TRADEMARK_POLICY.md).

## 贡献与治理
- 提交 PR 前，请阅读 `CONTRIBUTING.md` 并使用 `git commit -s` 签署 DCO。
- 行为规范见 `CODE_OF_CONDUCT.md`。
- 安全漏洞请按 `SECURITY.md` 私下披露，不要公开 issue。
- 商标使用遵循 `TRADEMARK_POLICY.md`。

