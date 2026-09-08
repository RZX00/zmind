# Phase 4 Playbook: Unified Search and AI Knowledge Enhancement

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 阶段 | Phase 4 |
| 文档类型 | 执行文档（搜索与AI增强） |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 前置依赖 | Phase 3 |

## 1. 阶段目标

1. 打通 Doc/Canvas/Reference 三类内容的统一检索。
2. 建立 AI 可解释的关联推荐与回溯能力。
3. 完成迁移与索引层面的稳定性加固。
4. 提供面向生产的质量指标与回归防线。

## 2. 检索体系目标态

```text
Query
  -> lexical retrieval (docs + nodes + titles)
  -> structural retrieval (references/backlinks/graph distance)
  -> ranking merge
  -> permission filter
  -> unified result list
```

## 3. 搜索域模型

| 实体 | 索引粒度 | 主字段 |
|---|---|---|
| Doc | block-level | block text, heading, tags, frontmatter |
| Canvas | node-level | node content/type/meta |
| Reference | edge-level | source/target, mode, recency |

## 4. 任务分解（Work Packages）

| WP | 名称 | 优先级 | 说明 |
|---|---|---|---|
| WP-4-1 | 统一搜索 API | P0 | 单入口返回 doc/canvas/reference 混合结果 |
| WP-4-2 | 索引构建与增量更新 | P0 | doc/canvas 更新触发增量索引 |
| WP-4-3 | 排序融合 | P0 | lexical + graph aware ranking |
| WP-4-4 | AI 关联建议 | P1 | 给出可采纳的链接建议与理由 |
| WP-4-5 | 证据链输出 | P1 | AI 生成内容附来源引用 |
| WP-4-6 | 迁移校验与修复工具 | P0 | broken refs / orphan items 检测修复 |

## 5. API 与接口

| API | Method | 说明 |
|---|---|---|
| `/search/unified` | GET/POST | 统一搜索 |
| `/search/suggest-links` | POST | AI 建议链接 |
| `/search/reindex` | POST | 管理接口，触发索引重建 |
| `/search/index-status` | GET | 查看索引健康状态 |

返回体必须包含：

```json
{
  "results": [],
  "facets": {},
  "nextCursor": null,
  "debug": {
    "lexicalScore": 0,
    "graphScore": 0
  }
}
```

## 6. 排序策略（初版）

```text
final_score =
  0.50 * lexical_score
  + 0.20 * recency_score
  + 0.20 * graph_affinity_score
  + 0.10 * interaction_score
```

### 解释

1. lexical：关键词匹配质量。
2. recency：更新时间权重。
3. graph_affinity：与当前上下文内容的链接距离。
4. interaction：用户近期访问与编辑行为（可选，注意隐私边界）。

## 7. AI 增强规范

| 能力 | 输入 | 输出 |
|---|---|---|
| link suggestion | 当前文档块/节点 + workspace context | 推荐 target + reason + confidence |
| evidence chain | AI 生成请求 | 引用来源列表 |
| duplication hint | 内容片段 | 疑似重复项建议合并 |

### 安全要求

1. AI 返回结果必须经过权限过滤。
2. 不得展示用户无权访问内容的明文。

## 8. 文件级改造清单

### 8.1 后端

1. `backend/core/search/unified_api.py`（新增）
2. `backend/core/search/indexer.py`（新增）
3. `backend/core/search/ranker.py`（新增）
4. `backend/core/search/ai_suggestion_service.py`（新增）
5. `backend/core/references/service.py`（补检索聚合能力）

### 8.2 前端

1. `frontend/src/hooks/react-query/search/use-unified-search.ts`（新增）
2. `frontend/src/components/search/UnifiedSearchPanel.tsx`（新增）
3. `frontend/src/components/docs/BacklinkPanel.tsx`（增强）
4. `frontend/src/canvas/components/*`（搜索结果定位跳转能力）

## 9. 索引与迁移运维

## 9.1 索引构建

1. 全量首次构建。
2. 增量事件驱动更新（doc/canvas/reference mutation）。
3. 周期性一致性校验（抽样比对 DB 和 index）。

## 9.2 修复工具

1. orphan reference scanner。
2. broken anchor remapper。
3. missing item backfill runner。

## 10. 测试计划

## 10.1 功能测试

1. doc/canvas 混合检索返回正确。
2. 结果可直接跳转到 block/node。
3. AI link suggestions 可接受/拒绝并记录。

## 10.2 质量测试

1. 精确率/召回率离线评估集。
2. 大 workspace 压测。
3. 索引故障恢复演练。

## 11. 指标与告警

| 指标 | 目标 |
|---|---|
| unified search p95 | < 500ms |
| result click-through | 持续上升 |
| broken reference scan count | 持续下降 |
| AI suggestion acceptance rate | 达到产品设定阈值 |

告警：
1. 索引延迟超过阈值。
2. 索引与数据库差异率升高。
3. 统一搜索错误率升高。

## 12. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 检索结果相关性不足 | 高 | ranking 调参与离线评估闭环 |
| AI 建议噪声高 | 中 | confidence gate + 手动确认 |
| 索引成本上升 | 中 | 分层索引 + 增量更新 |
| 大规模查询压力 | 中 | 缓存 + 分页 + 限流 |

## 13. 里程碑

| Milestone | 产出 |
|---|---|
| M4-1 | unified search API 与基础索引 |
| M4-2 | 前端统一搜索面板上线 |
| M4-3 | AI 链接建议与证据链可用 |
| M4-4 | 迁移校验修复工具上线 |
| M4-5 | 性能与稳定性达标 |

## 14. Phase 4 完成判定

1. 用户可一处搜索同时命中文档块和画布节点。
2. AI 推荐链接可解释、可操作、可追踪。
3. 迁移后数据一致性有自动检测与修复手段。
4. 性能和稳定性指标达到上线阈值。

