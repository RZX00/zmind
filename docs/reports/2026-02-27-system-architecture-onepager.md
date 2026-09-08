# Zmind 单页汇报图（System One-Pager）

更新时间：2026-02-27  
用途：管理层/跨团队快速同步（1页投屏）

```mermaid
flowchart TB
  U["用户操作\n(编辑/协作/发起Agent)"]

  subgraph FE["体验层 (Frontend)"]
    UI["Canvas UI\n(One-click / Result-first)"]
    ST["Zustand Store"]
    YJS["Y.Doc + HocuspocusProvider"]
  end

  subgraph BFF["接入层 (Next API)"]
    Proxy["/api/canvases/*\nHeader透传: If-Match / Idempotency-Key"]
  end

  subgraph BE["业务层 (FastAPI + DDD)"]
    CanvasCmd["Canvas Command/Query/Share"]
    CanvasApp["CanvasCommandApplicationService"]
    CanvasWrite["CanvasWriteService -> Realtime /apply|/import"]
    AgentStart["/thread/{id}/agent/start"]
    AgentStream["/agent-run/{id}/stream (SSE)"]
    WorkspaceWS["/workspace/ws"]
  end

  subgraph RT["实时协作层 (canvas-realtime)"]
    Apply["/apply /import /snapshot"]
    Hocus["Hocuspocus + Yjs"]
    Persist["Debounced Persist"]
  end

  subgraph AG["智能执行层 (Worker)"]
    Dramatiq["run_agent_background"]
    LG["LangGraphEngine\nload_context -> call_model <-> execute_tools"]
  end

  subgraph INFRA["基础设施层"]
    Redis[(Redis\nversioning / pubsub / stream cache)]
    DB[(Supabase\ncanvases / threads / agent_runs / outbox / read models)]
  end

  U --> UI --> ST --> Proxy --> CanvasCmd --> CanvasApp --> CanvasWrite --> Apply
  ST --> YJS
  YJS <--> Hocus
  Apply --> Hocus --> Persist --> DB
  Apply --> Redis
  WorkspaceWS <--> Redis

  U --> AgentStart --> Dramatiq --> LG --> Redis
  AgentStream <--> Redis
  AgentStart --> DB
  LG --> DB
```

## 30秒口播

1. 前端把复杂协作收敛成两条可控路径：Realtime 增量写 + REST apply 兜底写。  
2. 后端通过 DDD 服务层做协议治理与并发控制（`If-Match/serverVersion`）。  
3. Agent 是异步执行架构：API 启动、Worker 运行、Redis 回放、SSE 推送。  
4. Outbox + Projection 让系统具备可审计、可重放、可降级的反脆弱能力。  
5. 当前演进重点是继续压缩 legacy 分叉，向单一路径收敛。

## 关键词（便于答疑）

- 并发控制：`If-Match` + `serverVersion`  
- 幂等：`Idempotency-Key` + 唯一索引 + 中间件缓存  
- 协作模型：`Canvas JSON -> Ops -> Y.Doc -> JSONB`  
- 流式保证：Redis list 回放 + pubsub 增量 + SSE `Last-Event-ID`  
- 事件化：`domain_outbox -> projection_* -> read models`
