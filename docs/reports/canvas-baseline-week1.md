# Canvas Baseline Report - Week 1

状态：`draft`  
周期：`2026-02-19 ~ 2026-02-25`  
关联计划：`docs/canvas-enterprise-refactor-program.md`

---

## 1. 报告目标

建立清债前的事实基线，作为后续每个迁移波次（wave）的对比标准。

---

## 2. 关键链路基线（待填充真实观测）

| 链路 | 当前实现入口 | Success Rate | p95 Latency | 冲突率 | 备注 |
|---|---|---:|---:|---:|---|
| openCanvas | `GET /canvases/{id}` + snapshot fallback | TBD | TBD | N/A | realtime + db 双来源 |
| applyOps | `POST /canvases/{id}/apply` | TBD | TBD | TBD | optimistic + retry |
| importSnapshot | `POST /import`（realtime） | TBD | TBD | TBD | backend 转发 |
| getSnapshot | `GET /snapshot`（realtime） | TBD | TBD | N/A | source: memory/db |

---

## 3. 当前技术事实（已确认）

1. ops 语义存在多处实现，存在漂移风险。
2. 后端 canvas 路由职责过载，编排复杂度高。
3. realtime 与 legacy 写路径并存，排障路径变长。
4. 前端 store 职责过重，变更耦合度高。

---

## 4. 风险清单（Week 1）

| 风险 | 影响 | 优先级 | 缓解动作 |
|---|---|---|---|
| 协议分叉 | 同输入不同输出 | P0 | 统一 contract source + contract tests |
| 双写路径分叉 | 难以复现故障 | P0 | 逐步收敛到单一写路径 |
| 超级路由冲突 | 回归面扩大 | P1 | 拆分上下文路由与应用服务 |
| store 过载 | 前端改动脆弱 | P1 | 拆分 command/view/sync 三层 |

---

## 5. Week 1 输出要求

- [ ] 填充上述 `TBD` 指标
- [ ] 给出数据采样口径与时间窗口
- [ ] 输出清债前“红线指标”清单
- [ ] 形成 Week 2 目标（契约冻结）输入

