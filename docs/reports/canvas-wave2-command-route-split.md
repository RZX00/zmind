# Canvas Wave 2 - HTTP Route Split (Step 1-10)

状态：`implemented`  
日期：`2026-02-19`

---

## 1. 本步目标

在不改变外部 API 协议的前提下，把 Canvas HTTP 路由按上下文从超级路由中抽离到接口层目录，作为 Phase 2 的第一刀。

---

## 2. 本步改动

1. 新增接口层路由模块：
   - `backend/core/interfaces/http/canvas/command_routes.py`
   - `backend/core/interfaces/http/canvas/query_routes.py`
   - `backend/core/interfaces/http/canvas/share_routes.py`
   - `backend/core/interfaces/http/canvas/ai_routes.py`
2. 新增应用服务与绑定层：
   - `backend/core/application/services/canvas_command_application_service.py`
   - `backend/core/application/services/canvas_query_service.py`
   - `backend/core/interfaces/http/canvas/service_bindings.py`
3. `core.api` 增加按上下文路由挂载：
   - `backend/core/api.py`
4. `backend/core/canvas/api.py` 仅保留业务处理函数与 websocket 路由，HTTP 装饰迁移到接口层。
5. 新增路由唯一性回归测试（覆盖全量 canvas HTTP 路径）：
   - `backend/tests/test_canvas_command_routes.py`
6. 新增应用服务委托单测：
   - `backend/tests/test_canvas_application_services.py`
7. command 应用服务下沉（非纯委托）：
   - `backend/core/application/services/canvas_command_application_service.py`
   - 覆盖 `create/update/apply/delete/restore/restore_version` 核心编排
   - `backend/core/canvas/api.py` 对应入口改为服务转发
8. share/ai 路由绑定统一至服务层：
   - `backend/core/application/services/canvas_share_service.py`
   - `backend/core/application/services/canvas_ai_service.py`
   - `backend/core/interfaces/http/canvas/share_routes.py`
   - `backend/core/interfaces/http/canvas/ai_routes.py`
9. 契约 CI 门禁激活：
   - `.github/workflows/canvas-contract-gate.yml`
   - 覆盖 schema-sync / backend contract suite / frontend type-check
10. Query 服务实化（非委托）：
   - `backend/core/application/services/canvas_query_service.py`
   - `get/list/snapshot/meta/thread/versions` 读取路径下沉至 Query 应用服务
   - `backend/core/canvas/api.py` 查询入口改为 Query 服务转发
   - `backend/core/interfaces/http/canvas/service_bindings.py` Query 绑定改为直接服务实例
11. Query 服务依赖去耦（显式依赖注入）：
   - `CanvasQueryService` 不再直接 `import core.canvas.api`
   - 新增 `CanvasQueryDependencies`，由 `service_bindings` 注入 legacy 依赖
   - 读路径保持不变，去除应用层对接口实现细节的硬耦合
12. Command/Share/AI 服务依赖注入统一化：
   - `CanvasCommandApplicationService` 新增 `CanvasCommandDependencies`
   - `CanvasShareService` / `CanvasAIService` 改为 `deps` 注入风格
   - `service_bindings` 统一用 dependencies/ports 绑定 legacy 实现
13. 接口与三端一致性测试补齐：
   - 新增接口层 E2E：`backend/tests/test_canvas_interface_routes_e2e.py`
   - 新增前端 normalizer 行为测试：`backend/tests/test_canvas_frontend_ops_normalization.py`
   - 扩展三端 parity/fuzz：`backend/tests/test_canvas_ops_behavior_parity.py`
14. 低风险架构精简：
   - 删除 `backend/core/canvas/api.py` 中纯转发到 service 的遗留函数（query/command 路径）
   - 移除 `CanvasShareHandlers` / `CanvasAIHandlers` 兼容别名，仅保留 dependencies 命名
   - `service_bindings` 拆为小粒度 provider（command/query/share/ai 各自构建）

---

## 3. 可回滚性

- 回滚仅需：
  1) 恢复 `backend/core/canvas/api.py` 的 HTTP 路由装饰（当前已移除）
  2) 从 `backend/core/api.py` 移除 `canvas_query_router` / `canvas_command_router` / `canvas_share_router` / `canvas_ai_router` 挂载

---

## 4. 下一步建议

1. 进入 Phase 3：补 `/apply` `/import` `/snapshot` 幂等/冲突/重放集成测试。
2. 建立 realtime 压测与故障注入基线（并发编辑、网络抖动、Redis 短故障）。
3. 将 command 服务内部对 `legacy api` 的直接调用逐步替换为细粒度 ports（仓储/事件/缓存）。
