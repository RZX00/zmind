# Zmind 架构收敛 Jira 执行计划（30/60/90）

更新时间：2026-02-27  
适用对象：产品负责人、研发负责人、架构委员会、项目经理  
基线文档：
- `docs/reports/2026-02-27-system-architecture-full-report.md`
- `docs/reports/2026-02-27-system-architecture-onepager.md`

---

## 1. 目标与硬指标（Program KPI）

```txt
+--------------------------------------+-------------------+-------------------+-------------------+
| 指标                                 | D30 (2026-03-29)  | D60 (2026-04-28)  | D90 (2026-05-28)  |
+--------------------------------------+-------------------+-------------------+-------------------+
| Canvas Realtime主写入占比            | >= 95%            | >= 99%            | >= 99.5%          |
| Canvas 409冲突可恢复率               | >= 98%            | >= 99%            | >= 99.5%          |
| Projection p95 延迟                  | <= 30s            | <= 10s            | <= 5s             |
| Agent SSE 续传成功率                 | >= 97%            | >= 99%            | >= 99.5%          |
| P1 数据一致性事故                    | 0                 | 0                 | 0                 |
| Legacy fallback 请求占比             | < 5%              | < 1%              | < 0.1%            |
+--------------------------------------+-------------------+-------------------+-------------------+
```

---

## 2. Program 结构（Epic Map）

```txt
PROGRAM: ARC-2026Q2 (Architecture Convergence)
|
+-- ARC-01 Canvas 写路径收敛（Realtime First）
+-- ARC-02 应用层边界瘦身（DDD 解耦）
+-- ARC-03 Outbox/Projection 生产化闭环
+-- ARC-04 Realtime 可靠性与契约测试
+-- ARC-05 Agent 流式稳定性与恢复能力
+-- ARC-06 Legacy 下线与代码清理
```

---

## 3. Epic Backlog（可直接建 Jira）

### ARC-01 Canvas 写路径收敛（Realtime First）

- `Epic Key`: ARC-01  
- `Owner`: Backend Lead（协同 Frontend Lead）  
- `Window`: 2026-03-02 ~ 2026-04-12  
- `Depends On`: 无（先行 Epic）

**Stories**

1. `ARC-01-ST-01` 统一写入入口与埋点
   - 范围：所有 `/apply`、`/update` 写入链路注入统一字段（`request_id`、`idempotency_key`、`server_version`、`path_source`）。
   - 验收：
     - 100% 写入日志可追踪上述 4 字段。
     - 可以按 `path_source=realtime|legacy` 出报表。

2. `ARC-01-ST-02` 默认 Realtime 写入，legacy 仅保留 kill switch
   - 范围：将 legacy fallback 变为默认关闭，按 workspace 白名单回滚。
   - 验收：
     - 默认配置下 legacy 不进入主链路。
     - kill switch 可在 5 分钟内切回。

3. `ARC-01-ST-03` 写路径一致性回归集
   - 范围：同一 ops 输入，在 realtime/legacy 输出一致（画布字段与版本行为）。
   - 验收：
     - 契约测试覆盖 `ALLOWED_OPS` 全集。
     - 关键字段差异率 < 0.1%。

4. `ARC-01-ST-04` 冲突恢复 UX 对齐
   - 范围：409 冲突时前端统一处理流程（提示+重试+续写）。
   - 验收：
     - 冲突处理路径无技术术语外露。
     - 用户可一键恢复继续编辑。

---

### ARC-02 应用层边界瘦身（DDD 解耦）

- `Epic Key`: ARC-02  
- `Owner`: Backend Architect  
- `Window`: 2026-03-09 ~ 2026-04-26  
- `Depends On`: ARC-01-ST-01, ARC-01-ST-02

**Stories**

1. `ARC-02-ST-01` 定义 Canvas Command Port
   - 范围：抽离 Port（`CanvasCommandPort`/`CanvasQueryPort`），封装现有 `legacy_api` 能力。
   - 验收：
     - 应用服务层不直接调用 `legacy_api.*` 内部函数。
     - Port 接口文档和契约测试齐全。

2. `ARC-02-ST-02` 拆分超大应用服务
   - 范围：将 `canvas_command_application_service` 按用例拆为独立 use case。
   - 验收：
     - 单文件控制在可审查规模（建议 < 500 行/文件）。
     - 每个 use case 有独立单测。

3. `ARC-02-ST-03` 业务事件发射点标准化
   - 范围：统一 record_event 的调用时机和 payload schema。
   - 验收：
     - 事件字段 schema 文档化。
     - schema 校验失败可被监控系统捕获。

---

### ARC-03 Outbox/Projection 生产化闭环

- `Epic Key`: ARC-03  
- `Owner`: Platform/Infra Lead  
- `Window`: 2026-03-02 ~ 2026-04-19  
- `Depends On`: 无（可并行）

**Stories**

1. `ARC-03-ST-01` 将 outbox relay/projection worker 纳入默认部署
   - 范围：容器编排、健康检查、日志采集、重启策略。
   - 验收：
     - 生产环境默认运行且可观测。
     - 任一组件重启不导致事件永久丢失。

2. `ARC-03-ST-02` Projection 游标升级为复合游标
   - 范围：从 `occurred_at` 单游标升级为 `(occurred_at,event_id)`。
   - 验收：
     - 同时戳事件无遗漏。
     - 历史数据可平滑迁移，无全量停机。

3. `ARC-03-ST-03` 失败重放工具链
   - 范围：为 `projection_failures` 提供重放 CLI/API（按事件、按时间窗、按 projection）。
   - 验收：
     - 支持 dry-run 与正式重放。
     - 重放过程可审计（谁、何时、重放了什么）。

4. `ARC-03-ST-04` SLO 告警与运行看板
   - 范围：lag、failure rate、retry depth、dead letter 监控。
   - 验收：
     - 有明确 P1/P2 告警阈值。
     - 值班人员可在 10 分钟内定位问题区域。

---

### ARC-04 Realtime 可靠性与契约测试

- `Epic Key`: ARC-04  
- `Owner`: Realtime Service Owner  
- `Window`: 2026-03-02 ~ 2026-04-26  
- `Depends On`: ARC-01-ST-03

**Stories**

1. `ARC-04-ST-01` 建立 canvas-realtime 测试基线
   - 范围：`/apply`、`/import`、`/snapshot`、鉴权、版本并发。
   - 验收：
     - 关键路径有自动化测试。
     - CI 阶段可阻断回归。

2. `ARC-04-ST-02` 并发与幂等压测
   - 范围：高并发 apply、重复提交、网络抖动场景。
   - 验收：
     - 幂等场景无重复写入。
     - serverVersion 单调递增无回退。

3. `ARC-04-ST-03` 故障注入演练
   - 范围：Redis 抖动、Supabase 延迟、文档 flush 失败。
   - 验收：
     - 系统可降级，不出现数据静默损坏。
     - 失败恢复后状态最终一致。

---

### ARC-05 Agent 流式稳定性与恢复能力

- `Epic Key`: ARC-05  
- `Owner`: AI Infra Lead  
- `Window`: 2026-03-09 ~ 2026-05-10  
- `Depends On`: ARC-03-ST-01

**Stories**

1. `ARC-05-ST-01` SSE 恢复契约测试
   - 范围：`Last-Event-ID` 回放、断线重连、重复消费防护。
   - 验收：
     - 中断后可从正确索引恢复。
     - 不出现 chunk 重复或错序。

2. `ARC-05-ST-02` run lock 与 heartbeat 可观测性
   - 范围：锁冲突率、heartbeat 丢失率、僵尸 run 检测。
   - 验收：
     - 监控面板可区分“慢”与“死锁”。
     - 自动恢复策略文档化并演练通过。

3. `ARC-05-ST-03` 流式失败分级降级
   - 范围：Redis 异常、模型流异常、工具超时的分级处理。
   - 验收：
     - 用户收到可理解状态而不是技术错误。
     - 关键错误具备自动重试与兜底模型策略。

---

### ARC-06 Legacy 下线与代码清理

- `Epic Key`: ARC-06  
- `Owner`: Backend Lead + Frontend Lead  
- `Window`: 2026-04-13 ~ 2026-05-28  
- `Depends On`: ARC-01, ARC-02, ARC-04

**Stories**

1. `ARC-06-ST-01` legacy 路径清单与删除计划
   - 范围：列出所有 fallback 开关、调用点、依赖方。
   - 验收：
     - 清单完整且逐项有 owner。
     - 每项均有回滚策略。

2. `ARC-06-ST-02` 删除死代码与陈旧配置
   - 范围：移除不再使用的 handler、flag、文档。
   - 验收：
     - 删除后通过回归测试。
     - 代码复杂度和主文件长度显著下降。

3. `ARC-06-ST-03` 发布后审计
   - 范围：对比上线前后的错误率、冲突率、回滚率。
   - 验收：
     - 核心指标达到 D90 目标。
     - 形成正式收官报告。

---

## 4. 12 周排期（可直接转 Sprint）

> 建议以周一开 Sprint，这里按 `2026-03-02` 启动周计算。

```txt
+------+-------------------+-----------------------------------------------+-----------------------------+
| 周次 | 日期              | 重点交付                                      | 对应Epic                    |
+------+-------------------+-----------------------------------------------+-----------------------------+
| W1   | 03-02 ~ 03-08     | 指标埋点统一、部署 outbox/projection 基线       | ARC-01, ARC-03             |
| W2   | 03-09 ~ 03-15     | Realtime 默认主写、Agent/SSE 契约测试启动       | ARC-01, ARC-05             |
| W3   | 03-16 ~ 03-22     | 写路径一致性回归集第一版、Projection 游标设计    | ARC-01, ARC-03             |
| W4   | 03-23 ~ 03-29     | D30 Gate：95% 主路径占比，lag<=30s              | ARC-01, ARC-03, ARC-04     |
| W5   | 03-30 ~ 04-05     | Canvas Port 抽象落地、服务层解耦第一批           | ARC-02                     |
| W6   | 04-06 ~ 04-12     | Realtime 并发/幂等压测、故障注入第一轮           | ARC-04                     |
| W7   | 04-13 ~ 04-19     | Projection 复合游标上线、重放工具 MVP            | ARC-03                     |
| W8   | 04-20 ~ 04-26     | D60 Gate：99% 主路径占比，fallback<1%            | ARC-01, ARC-02, ARC-04     |
| W9   | 04-27 ~ 05-03     | legacy 清单冻结，删除计划执行                    | ARC-06                     |
| W10  | 05-04 ~ 05-10     | Agent 流式降级与恢复能力验收                     | ARC-05                     |
| W11  | 05-11 ~ 05-17     | 大规模回归、运行手册和值班手册                   | ARC-03, ARC-05, ARC-06     |
| W12  | 05-18 ~ 05-24     | D90 预验收、收官修复                             | ARC-06                     |
| W13  | 05-25 ~ 05-28     | D90 正式 Gate 与汇报                             | 全部                        |
+------+-------------------+-----------------------------------------------+-----------------------------+
```

---

## 5. 阶段闸门（Go/No-Go）

### D30 Gate（2026-03-29）

```txt
Go 条件
- Realtime 主写入占比 >= 95%
- Projection p95 lag <= 30s
- 关键写入链路日志可追踪（request_id, path_source）

No-Go 触发
- 任意周出现 P1 数据一致性事故
- 无法在 10 分钟内定位 projection 卡点
```

### D60 Gate（2026-04-28）

```txt
Go 条件
- Realtime 主写入占比 >= 99%
- legacy fallback 请求占比 < 1%
- 复合游标上线且通过并发回归

No-Go 触发
- contract parity 失败率 > 0.1%
- agent/sse 恢复回放出现错序
```

### D90 Gate（2026-05-28）

```txt
Go 条件
- 关键 SLO 全达标（见第1章）
- legacy 仅保留紧急开关，不在主链路
- 有收官审计报告与值班手册

No-Go 触发
- 任意核心 SLO 连续 2 周未达标
- 无法完成回滚演练签核
```

---

## 6. Jira 落地模板（建议）

### 6.1 Issue 类型与字段

1. Epic：承载业务目标与 KPI。  
2. Story：可在 1 个 Sprint 内闭环。  
3. Task：工程子任务。  
4. Bug：回归问题。  
5. Spike：不超过 2 天的探索任务。

**必填字段**

- `Component`: canvas-backend / canvas-realtime / agent-runtime / infra / frontend
- `Labels`: `arc-2026q2`, `phase-d30|d60|d90`, `risk-high|medium|low`
- `Definition of Done`: 测试、监控、文档、回滚策略

### 6.2 Epic 看板泳道（建议）

```txt
Backlog -> Ready -> In Progress -> In Review -> Staging Verify -> Done
```

### 6.3 Story 验收模板（复制即用）

```txt
[验收标准]
1) 功能行为:
2) 并发/幂等:
3) 监控与告警:
4) 回滚策略:
5) 用户体验文案:
```

---

## 7. 关键风险与预案

```txt
+---------------------------+---------+-----------------------------------------+-----------------------------+
| 风险                      | 等级    | 表现                                    | 预案                        |
+---------------------------+---------+-----------------------------------------+-----------------------------+
| 双路径长期共存            | 高      | 同输入不同输出，排障复杂度上升           | D60 前强制收敛为单路径       |
| Projection 游标漏事件     | 高      | 读模型不完整                             | 复合游标 + 定时审计比对      |
| Realtime 缺少测试护栏     | 高      | 小改动引入隐性回归                       | 建立 contract + chaos 测试   |
| Agent 流式链路中断        | 中      | 用户看到“卡住/重复输出”                  | SSE 恢复测试 + 锁监控         |
| 清理 legacy 触发回归      | 中      | 老入口调用失败                           | 灰度、Kill switch、回滚手册   |
+---------------------------+---------+-----------------------------------------+-----------------------------+
```

---

## 8. 汇报口径（管理层 60 秒）

1. 我们不是“推翻重做”，而是“在现网上收敛复杂度”。  
2. 三个阶段目标明确：D30 建基线，D60 单路径，D90 去遗留。  
3. 每个阶段都有量化 Gate，过不了就不进入下一阶段。  
4. 目标是把架构从“能跑”升级为“可控、可审计、可规模化”。  

