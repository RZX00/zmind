# Canvas 迁移期冗余清理矩阵

状态：`implemented`  
日期：`2026-02-19`

---

## 1. 清理目标

在不改变对外 API 与业务行为的前提下，移除迁移期“纯转发”冗余，收敛到单一路径，降低认知负担。

---

## 2. 文件级决策矩阵

| 文件 | 当前角色 | 处理决策 | 原因 | 风险级别 |
|---|---|---|---|---|
| `backend/core/application/services/canvas_command_application_service.py` | Canvas command 主编排 | **保留** | 已承载 create/update/apply/delete/restore 核心逻辑 | 低 |
| `backend/core/application/services/canvas_command_service.py` | 纯 handlers 转发包装 | **淘汰** | 与主编排服务职责重叠，增加跳转层级 | 低 |
| `backend/core/application/services/canvas_query_service.py` | query 服务边界 | **保留并实化** | 已承载 `get/list/meta/snapshot/head/thread/versions` 读取逻辑，并改为显式依赖注入（不再直接 import `legacy api`） | 低 |
| `backend/core/application/services/canvas_share_service.py` | share 服务边界 | **保留并依赖注入化** | 通过 `CanvasShareDependencies` 显式注入，统一到 ports 风格 | 低 |
| `backend/core/application/services/canvas_ai_service.py` | ai 服务边界 | **保留并依赖注入化** | 通过 `CanvasAIDependencies` 显式注入，统一到 ports 风格 | 低 |
| `backend/core/interfaces/http/canvas/service_bindings.py` | 绑定聚合入口 | **保留并拆分 provider** | command/query/share/ai 分别构建依赖，降低单文件认知复杂度 | 低 |
| `backend/core/canvas/api.py` | legacy 业务实现集合 | **删除纯转发冗余** | query/command 的 service 转发壳已无路由职责，删除可降噪 | 低 |
| `backend/core/application/services/__init__.py` | 统一导出入口 | **收敛** | 删除过渡导出，避免误引用已淘汰模块 | 低 |
| `backend/tests/test_canvas_application_services.py` | 服务层单测 | **重构** | 移除已淘汰服务测试，改为主路径测试 | 低 |
| `docs/canvas-enterprise-refactor-program.md` | 总体方案文档 | **更新** | 与实际服务名保持一致，避免误导 | 低 |
| `docs/reports/canvas-wave2-command-route-split.md` | 波次记录 | **更新** | 去除已淘汰路径引用 | 低 |

---

## 3. 执行顺序

1. 删除 `canvas_command_service.py` 并收敛 `__init__` 导出。
2. 调整应用服务测试，覆盖保留路径。
3. 更新相关架构文档引用。
4. 运行 contract + route + service 回归测试。

---

## 4. 回滚策略

若出现回归：

1. 恢复 `backend/core/application/services/canvas_command_service.py`。
2. 恢复 `backend/core/application/services/__init__.py` 旧导出。
3. 恢复 `backend/tests/test_canvas_application_services.py` 对旧包装服务用例。

此回滚不会影响对外 API 路径与协议。

---

## 5. 分批发布建议（执行版）

### Batch A（低风险，先发）

1. 文档与测试收敛（不改运行路径）：
   - `docs/reports/canvas-migration-redundancy-cleanup-matrix.md`
   - `backend/tests/test_canvas_application_services.py`

### Batch B（核心清理）

1. 删除冗余包装：
   - 删除 `backend/core/application/services/canvas_command_service.py`
2. 收敛导出：
   - `backend/core/application/services/__init__.py`

### Batch C（一致性收尾）

1. 方案文档同步：
   - `docs/canvas-enterprise-refactor-program.md`
   - `docs/reports/canvas-wave2-command-route-split.md`

---

## 6. 回滚校验清单（本轮已验证）

- [x] 路由入口不变（`test_canvas_command_routes.py` 通过）。
- [x] 契约一致性不变（contract/normalization/parity tests 通过）。
- [x] 应用服务绑定不变（`test_canvas_application_services.py` 通过）。
- [x] 前端类型安全不受影响（`npm --prefix frontend run type-check` 通过）。

### 本轮验证结果

1. Backend suite：`41 passed`  
   覆盖 contract、route、application service、behavior parity、frontend normalization parity、interface E2E。
2. Frontend type-check：`pass`。
