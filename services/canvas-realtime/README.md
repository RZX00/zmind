# Canvas Realtime Service

`@zmind/canvas-realtime` 是即将承载画布 Yjs 文档的独立 WebSocket 服务。它基于 [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) + Redis，负责：

- 校验来自 Supabase 的 JWT，确认用户和 workspace。
- 为每个 `canvasId` 维护 Y.Doc 实例，并对快照写入做去抖持久化。
- 将文档快照持久化到 Supabase，并自动同步 workspace 版本 / Redis 通知。
- 将所有客户端（AI/人工）流量统一收敛到同一实时链路。

当前阶段实现了服务骨架、JWT 鉴权、Redis 扩展、快照持久化与 `/apply` 写入入口，便于后续迭代。

## 开发与运行

```bash
cd services/canvas-realtime
npm install
npm run dev    # 使用 Node --watch
# or
npm start
```

### 核心环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SUPABASE_JWT_SECRET` | Supabase 颁发 token 的签名密钥（必填） | — |
| `SUPABASE_URL` | Supabase REST URL | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key（仅在服务端运行，必填） | — |
| `CANVAS_REALTIME_SUPABASE_SCHEMA` | Supabase schema，默认 `public`，仅 membership 校验需访问 `basejump` | `public` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_SSL` | Redis 连接配置 | `127.0.0.1:6379`, 无密码, `false` |
| `REDIS_CLUSTER_ENABLED` / `REDIS_CLUSTER_NODES` | Redis Cluster 配置（逗号分隔 host:port） | `false` / 空 |
| `CANVAS_REALTIME_PORT` / `CANVAS_REALTIME_HOST` | WebSocket 监听地址 | `6020` / `0.0.0.0` |
| `CANVAS_REALTIME_REDIS_PREFIX` | Redis key 前缀 | `canvas-yjs` |
| `CANVAS_REALTIME_ALLOWED_ORIGINS` | 允许的 `origin` 白名单，逗号分隔。为空则放行所有。 | 空 |
| `CANVAS_REALTIME_JWT_AUDIENCE` | Supabase JWT `aud` 校验值 | `authenticated` |
| `CANVAS_REALTIME_LOG_LEVEL` | `error`/`warn`/`info`/`debug` | `info` |
| `CANVAS_REALTIME_PERSIST_DEBOUNCE_MS` | 画布快照写入去抖延迟（毫秒）；`0` 表示立即写入 | `1500` |
| `CANVAS_REALTIME_APPLY_ENABLED` | 是否启用 `/apply` 写入入口 | `false` |

> 可以通过 `CANVAS_REALTIME_ENV=<path>` 指定额外 env 文件，便于本地运行独立配置。

## 接口

- `ws://<host>:<port>/<canvasId>?token=<jwt>&workspaceId=<id>`：Yjs WebSocket 入口，鉴权失败会直接关闭连接。
- `GET /healthz`：健康检查，返回 `200 OK` / `ok`。
- `POST /apply`：写入画布操作集（需启用 `CANVAS_REALTIME_APPLY_ENABLED`）。

## 下一步

1. 在 Y.Doc 更新后写入 Supabase（阶段 1）。
2. 前端/AI 工具迁移到统一的 Y.Doc 事务（阶段 2）。
3. 引入版本号、断线补偿与 fallback（阶段 3）。

该 README 将随着各阶段实现同步更新，确保运行/部署信息始终可查。
