# Canvas 企业级清债 Kickoff Checklist（前 10 天）

状态：`in-progress`  
关联文档：  
- `docs/canvas-enterprise-refactor-program.md`  
- `docs/canvas-enterprise-weekly-playbook.md`

---

## A. 第 1-2 天：建立事实基线

- [ ] 统计四条关键链路现状：
  - `openCanvas`
  - `applyOps`
  - `importSnapshot`
  - `getSnapshot`
- [ ] 输出初始指标（success rate / p95 / conflict rate / retry success rate）
- [ ] 形成第 0 版基线报告

### 输出物

- `docs/reports/canvas-baseline-week1.md`

---

## B. 第 3-4 天：协议边界冻结

- [x] 梳理三端 ops 语义差异（backend/realtime/frontend）
- [x] 决定 canonical contract source（单一来源）
- [x] 明确兼容策略（保留字段、弃用字段、映射规则）

### 输出物

- `docs/reports/canvas-ops-diff-matrix.md`
- `docs/reports/canvas-contract-deprecation-plan.md`

---

## C. 第 5-7 天：测试门禁接入

- [x] 建立 contract test case 列表（最小集 + 边界集）
- [x] backend 接入第一批 contract tests
- [x] realtime 接入第一批 contract tests
- [x] frontend 接入第一批 contract tests

### 输出物

- `docs/reports/canvas-contract-test-plan.md`
- `docs/reports/canvas-contract-test-result-week1.md`

---

## D. 第 8-10 天：首轮灰度准备

- [x] 拆出第一批“低风险高收益”迁移点（路由层薄化）
- [x] 设计 feature flag 灰度路径
- [x] 准备回滚 runbook 与演练记录模板

### 输出物

- `docs/reports/canvas-migration-wave1-scope.md`
- `docs/reports/canvas-rollback-runbook.md`

---

## E. 统一验收门槛（第 10 天结束）

- [ ] 指标与基线可对比
- [x] 协议差异清单完整
- [x] contract tests 已在 CI 可执行
- [x] wave1 迁移范围、灰度方案、回滚路径明确

若以上任一项未完成，禁止进入下一阶段开发。
