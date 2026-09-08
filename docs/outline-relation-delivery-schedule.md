# Outline 关系增强：可执行开发排期表（Execution Schedule）

## 1. 计划概览

- **项目**：Outline 关系完整性增强（结构轨 + 关系轨）
- **计划周期**：2026-02-09（周一）~ 2026-04-03（周五）
- **总时长**：8 周（含 1 周稳定期与灰度缓冲）
- **发布策略**：Alpha -> Beta -> GA
- **范围基线**：以 `docs/prd-outline-relation-enhancement.md` 与 `docs/outline-relation-implementation-checklist.md` 为准

---

## 2. 团队编制与投入（建议最小配置）

| 角色 | 人数 | 投入 | 主要职责 |
|---|---:|---:|---|
| PM | 1 | 50% | 需求冻结、优先级、里程碑推进、验收 |
| 设计（UX/UI） | 1 | 50% | 关系徽标、抽屉、全景视图交互与视觉 |
| FE Lead | 1 | 100% | 架构拆分、Domain/VM 设计、关键代码评审 |
| FE Engineer | 1 | 100% | 组件实现、交互联调、埋点接入 |
| QA | 1 | 100%（W3 起） | 回归矩阵、性能回归、发布验证 |
| Data/Telemetry | 1 | 20% | 埋点 schema、看板口径、指标校验 |
| BE Support（可选） | 1 | 20% | API 兼容协助、异常排查支持 |

---

## 3. 里程碑排期（按周）

| 周次 | 日期 | 目标里程碑 | 可交付物 | 发布动作 |
|---|---|---|---|---|
| W1 | 2026-02-09 ~ 2026-02-13 | 需求冻结 + 设计定稿 | PRD Freeze、交互稿、技术设计评审通过 | 无 |
| W2 | 2026-02-16 ~ 2026-02-20 | Phase 1 开发完成 | 关系徽标 + 关系抽屉主流程可用 | 内部 Alpha |
| W3 | 2026-02-23 ~ 2026-02-27 | Phase 1 稳定与回归 | Bug 收敛、埋点初版、性能基线报告 | Alpha 扩大 |
| W4 | 2026-03-02 ~ 2026-03-06 | Phase 2 架构重构完成 | RelationGraph + OutlineVM 接入 | 无 |
| W5 | 2026-03-09 ~ 2026-03-13 | Phase 2 联调收口 | 兼容与性能通过、关键指标可观测 | Beta |
| W6 | 2026-03-16 ~ 2026-03-20 | Phase 3 功能完成 | 关系全景 + 异常检测（cycle/dangling） | 无 |
| W7 | 2026-03-23 ~ 2026-03-27 | 全链路 QA/UAT | 全量回归通过、发布候选 RC | RC 灰度 |
| W8 | 2026-03-30 ~ 2026-04-03 | 生产发布与复盘 | GA 发布、复盘报告、后续 backlog | GA |

---

## 4. 任务分解（可执行工单级）

## 4.1 Sprint 1（W1-W2）：Phase 1 快速价值交付

| 工单 | 负责人 | 预计工时 | 依赖 | 完成定义 |
|---|---|---:|---|---|
| OUTLINE-101 新增关系摘要类型与 VM | FE Lead | 2d | 无 | 节点可输出 in/out/cross 计数 |
| OUTLINE-102 OutlineItem 增加关系徽标 | FE Engineer | 2d | 101 | 行内正确显示关系徽标 |
| OUTLINE-103 RelationDrawer 组件实现 | FE Engineer | 3d | 101 | 可查看节点完整入/出边 |
| OUTLINE-107 埋点首版（badge/drawer） | FE Lead + Data | 1.5d | 102/103 | 事件可上报，字段齐全 |
| UI-REL-01 抽屉与徽标视觉稿 | 设计 | 2d | 无 | 设计评审通过 |
| QA-PLAN-01 Phase1 回归用例 | QA | 1d | 需求冻结 | 用例入库并可执行 |

### Sprint 1 发布闸门（2026-02-20）

- P0=0，P1<=3（且有 workaround）
- 关系抽屉打开成功率 >= 99%
- Share 只读页流程无回归

---

## 4.2 Sprint 2（W3-W5）：Phase 2 架构重构与性能稳态

| 工单 | 负责人 | 预计工时 | 依赖 | 完成定义 |
|---|---|---:|---|---|
| OUTLINE-104 RelationGraph 领域层 | FE Lead | 4d | Sprint1 | inbound/outbound 索引稳定 |
| OUTLINE-105 build-outline-view-model 接入 | FE Lead | 3d | 104 | Outline 仅消费 VM |
| OUTLINE-106.1 兼容桥接旧 selectors | FE Engineer | 2d | 105 | 旧入口不破坏 |
| PERF-REL-01 关系计算分块与缓存 | FE Lead | 2d | 104/105 | 大图无明显卡顿 |
| QA-REL-02 性能与兼容回归 | QA | 3d | 105 | 性能报告达标 |

### Sprint 2 发布闸门（2026-03-13）

- 1k 节点 / 2k 连线首次打开大纲 < 300ms（目标）
- 结构模式与增强模式切换稳定
- `displayed_edges / total_edges >= 95%`（Beta 阶段阈值）

---

## 4.3 Sprint 3（W6-W8）：Phase 3 全景关系与 GA

| 工单 | 负责人 | 预计工时 | 依赖 | 完成定义 |
|---|---|---:|---|---|
| OUTLINE-106.2 异常检测（cycle/dangling/orphan） | FE Lead | 3d | Sprint2 | 异常可标识并可跳转 |
| OUTLINE-106.3 RelationOverviewPanel | FE Engineer | 3d | 106.2 | 全景关系列表可筛选 |
| OUTLINE-107.2 埋点完善 + 看板口径 | Data + FE | 2d | 106.3 | 指标可观测 |
| OUTLINE-108 全量回归与灰度发布 | QA + PM | 4d | 全部 | RC -> GA 发布通过 |
| OPS-REL-01 Feature Flag 发布策略 | FE Lead | 1d | 全部 | 支持一键回滚 |

### Sprint 3 发布闸门（2026-04-03）

- `displayed_edges / total_edges >= 99%`
- 任意节点 1-click 可达完整入/出关系
- GA 发布 24h 无 P0/P1 新增

---

## 5. 每周执行节奏（固定机制）

- **周一 10:00**：周计划会（冻结本周范围）
- **每天 10:30**：15 分钟站会（阻塞项必报）
- **周三 16:00**：中周风险审查（是否触发降级/降 scope）
- **周五 17:00**：里程碑演示 + 质量闸门评审

---

## 6. 关键依赖与关键路径

## 6.1 关键路径（Critical Path）

`OUTLINE-101 -> OUTLINE-103 -> OUTLINE-104 -> OUTLINE-105 -> OUTLINE-106.2 -> OUTLINE-108`

### 6.2 主要依赖风险

1. 设计稿延迟会直接影响 Sprint 1 收敛速度
2. RelationGraph 性能问题会影响 Sprint 2/3 全线
3. 埋点口径未统一会阻塞 GA 验收

---

## 7. 风险缓冲与降级策略

- **时间缓冲**：W7-W8 预留 20% 缓冲用于 bugfix 与灰度观察
- **功能降级顺序**：
  1. 先关闭“关系全景模式”
  2. 保留“关系抽屉”
  3. 必要时回退到纯结构模式（Feature Flag）
- **回滚原则**：出现 P0 立即回滚至上一个稳定 tag

---

## 8. 验收与发布清单

## 8.1 UAT 验收项

- 编辑页与 Share 页关系查看一致性
- todo/title 编辑不回归
- 画布定位跳转成功率 >= 99%
- 异常关系在 UI 可见且可解释

### 8.2 GA 发布前检查

- 埋点看板可用，指标口径确认
- 监控告警（JS Error、API Error、性能）开启
- 变更公告与操作说明同步到内部文档

---

## 9. 可直接复用的看板列（Jira/Linear）

- `Backlog`
- `Ready`
- `In Progress`
- `Code Review`
- `QA`
- `Ready for Release`
- `Done`

建议每个工单至少包含：

- 业务价值说明
- 交互截图或原型链接
- 验收标准（Given/When/Then）
- 风险与回滚说明

