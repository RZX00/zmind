# ADR: Sandbox Replacement Layer (Cloud Runtime Access)

状态: Accepted  
日期: 2026-02-20  
作者: Backend Platform / Product Engineering

---

## 1. 背景

历史系统以 Daytona sandbox 为运行时中心，`projects.sandbox` 字段及 `/sandboxes/*` API 与权限校验强耦合。  
当前系统已迁移到 cloud-only 架构，但仍存在残留引用，导致：

1. 字段级运行时错误（`projects.sandbox` 已移除）。
2. 权限校验逻辑与真实执行模型不一致。
3. 前后端对“运行时身份”的语义分裂。

---

## 2. 决策

不恢复 Daytona，不回滚 `projects.sandbox`。  
采用“兼容别名 + 新 runtime 访问层”：

1. 新增 `core/runtime/access.py`，统一运行时访问校验。
2. `verify_sandbox_access*` 保留函数名作为兼容别名，但内部改为 runtime 校验。
3. Dashboard project 输出改为 `runtime` 元数据，不再查询/返回 `sandbox` 字段。

---

## 3. 目标架构（B1 完成态）

```text
Client/API
   |
   v
Auth Utils (compat aliases)
   |
   v
Runtime Access Layer
   |
   +--> resolve project(runtime_ref=project_id)
   +--> public/private access check
   +--> account membership validation
```

---

## 4. 数据契约

运行时元数据统一为：

```json
{
  "runtime": {
    "mode": "cloud",
    "runtime_ref": "<project_id>"
  }
}
```

说明：

1. `runtime_ref` 现阶段绑定 `project_id`。
2. 后续若引入独立 executor 资源，可在不改 API 语义的前提下扩展解析策略。

---

## 5. 权限策略

| 场景 | 规则 |
|---|---|
| Public Project | 允许匿名访问（optional 模式） |
| Private Project + 未登录 | 401 |
| Private Project + 非成员 | 403 |
| Project 不存在 | 404 |

---

## 6. 影响范围

后端：

1. `backend/core/runtime/access.py`（新增）
2. `backend/core/utils/auth_utils.py`（sandbox alias -> runtime）
3. `backend/core/services/dashboard_service.py`（移除 sandbox 查询/返回）

前端（兼容过渡）：

1. `Project` 增加 `runtime` 字段。
2. 去除线程删除流程中的 sandbox 字段查询与 Daytona 删除调用。
3. 保留 `sandbox` 可选字段仅用于历史 UI 兼容，不再作为后端事实来源。

---

## 7. 风险与缓解

风险：

1. 旧前端仍调用 `/sandboxes/*`。
2. 部分组件仍从 `project.sandbox` 读取展示信息。

缓解：

1. 逐步把调用迁移到 runtime/cdn/file API（后续 B2）。
2. 在过渡期保留前端 `sandbox?` 可选字段，避免一次性破坏 UI。

---

## 8. 后续（B2）

1. 定义 `Capability Router`：
   - `file.read`
   - `file.write`
   - `artifact.export`
2. 统一执行器端口：
   - `RuntimeExecutorPort`
   - `CloudExecutorAdapter`
3. 将现存 `/sandboxes/*` 前端调用迁移到新 capability API，并删除旧路径依赖。

