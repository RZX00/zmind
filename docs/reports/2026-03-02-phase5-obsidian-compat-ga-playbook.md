# Phase 5 Playbook: Obsidian Compatibility and GA Rollout

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 阶段 | Phase 5 |
| 文档类型 | 执行文档（Obsidian兼容 + GA） |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 前置依赖 | Phase 4 |

## 1. 阶段目标

1. 实现 Obsidian 生态可迁移能力（导入/导出）。
2. 支持用户一次性导入“整库 markdown 笔记”。
3. 建立兼容报告、错误恢复和回滚机制。
4. 满足 GA（全量上线）质量门禁。

## 2. 兼容范围定义

## 2.1 导入（Import）

支持方式：
1. `zip` 导入整个 vault。
2. 目录批量导入（web 端文件夹选择）。

支持内容：
1. `.md` 文档。
2. 相对路径图片和附件。
3. `[[wikilink]]`、`![[embed]]`、`#heading`、`^block`（支持子集）。
4. 文件夹层级映射。

不完全支持项（首版）：
1. 插件私有语法（保留原文，不保证行为一致）。
2. 复杂 Dataview 查询执行（可保留文本）。

## 2.2 导出（Export）

1. 导出为 Obsidian 可读取的 markdown 文件树。
2. 维持 wikilink 语义与附件关系。
3. 支持按 workspace 或子目录范围导出。

## 3. 导入架构（两遍解析）

```text
Import Job Created
  -> ingest files (zip/folder)
  -> pass1: create items/docs/assets (record path map)
  -> pass2: resolve wikilinks/embeds/headings/blocks
  -> rewrite asset refs to managed path
  -> build references/backlinks
  -> output deterministic report
```

## 4. 导入作业模型

```text
import_job
  id
  workspace_id
  status: pending|running|completed|failed|partially_completed
  source_type: zip|directory
  progress: 0..100
  stats:
    total_files
    imported_docs
    imported_assets
    unresolved_links
    failed_files
  report_url
```

## 5. API 设计

| API | Method | 说明 |
|---|---|---|
| `/imports/obsidian/jobs` | POST | 创建导入任务 |
| `/imports/obsidian/jobs/{id}/upload` | POST | 上传 zip 或批次文件 |
| `/imports/obsidian/jobs/{id}/commit` | POST | 开始解析与入库 |
| `/imports/obsidian/jobs/{id}` | GET | 查询进度与统计 |
| `/imports/obsidian/jobs/{id}/report` | GET | 获取详细报告 |
| `/exports/obsidian/jobs` | POST | 创建导出任务 |
| `/exports/obsidian/jobs/{id}` | GET | 查询导出状态 |
| `/exports/obsidian/jobs/{id}/download` | GET | 下载导出包 |

## 6. 映射规则

| Obsidian 概念 | ZMind 映射 |
|---|---|
| Markdown file | item(type=doc) + docs row |
| Folder path | folder + parent structure |
| `[[Note]]` | reference edge to target doc item |
| `[[Note#Heading]]` | reference edge + target anchor |
| `[[Note^block]]` | reference edge + block anchor |
| `![[image.png]]` | asset node or markdown image with proxy URL |

## 7. 关键实现细节

## 7.1 路径解析

1. 先建立 `path -> item_id` 映射。
2. 链接解析优先绝对/标准化路径，再尝试同目录候选。
3. 无法解析时写入 unresolved report，不静默忽略。

## 7.2 附件处理

1. 附件统一上传到受控存储。
2. 文档链接改写为权限安全代理 URL。
3. 原始文件名与扩展名保留用于导出回写。

## 7.3 幂等与恢复

1. 同一 import job 可重试，不重复创建已成功项。
2. 失败文件单独记录，可增量重跑。
3. 作业中断支持 checkpoint 恢复。

## 8. 前后端任务分解

| WP | 名称 | 优先级 | 说明 |
|---|---|---|---|
| WP-5-1 | import/export job API | P0 | 作业生命周期管理 |
| WP-5-2 | zip/目录 ingest pipeline | P0 | 文件接入 |
| WP-5-3 | 两遍解析引擎 | P0 | 创建实体 + 解析链接 |
| WP-5-4 | 资产映射与回写 | P0 | 上传与链接改写 |
| WP-5-5 | 报告系统 | P0 | 成功失败与未解析明细 |
| WP-5-6 | UI 向导与进度页面 | P1 | 用户导入体验 |
| WP-5-7 | 导出兼容包 | P1 | 回到 Obsidian 生态 |

## 9. 文件级改造清单

### 9.1 后端

1. `backend/core/integrations/obsidian/import_api.py`
2. `backend/core/integrations/obsidian/import_service.py`
3. `backend/core/integrations/obsidian/parser.py`
4. `backend/core/integrations/obsidian/link_resolver.py`
5. `backend/core/integrations/obsidian/export_api.py`
6. `backend/core/integrations/obsidian/export_service.py`

### 9.2 前端

1. `frontend/src/components/integrations/obsidian/ImportWizard.tsx`
2. `frontend/src/components/integrations/obsidian/ImportJobStatus.tsx`
3. `frontend/src/components/integrations/obsidian/ImportReport.tsx`
4. `frontend/src/hooks/react-query/integrations/use-obsidian-import.ts`

## 10. 验收标准

## 10.1 导入验收

1. 可一次导入包含大量 `.md` 的 vault。
2. 导入后文档层级、基础链接和附件大体保持可用。
3. 生成详细报告：成功/失败/未解析链接/附件问题。

## 10.2 导出验收

1. 导出包在 Obsidian 可直接打开。
2. 文档链接与附件路径可解析。
3. 结构与标题可读性达标。

## 10.3 稳定性验收

1. 大库导入可恢复、可重试。
2. 导入失败不影响现有 workspace 数据。

## 11. 测试计划

## 11.1 功能测试

1. zip 导入小库/大库。
2. 目录导入（多层文件夹）。
3. link/embed/heading/block 引用解析。
4. 导出并在 Obsidian 打开验证。

## 11.2 兼容性测试集

1. 常见中文/英文文件名。
2. 特殊字符路径与空格。
3. 重名文件与跨目录引用。
4. 不完整链接与损坏附件。

## 11.3 负载测试

1. 大量文件并发导入。
2. 超大图片附件导入。
3. 长时间作业恢复。

## 12. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 链接解析不完整 | 高 | 两遍解析 + unresolved 报告 |
| 资产路径错乱 | 高 | 统一路径映射表 + 回归样本库 |
| 大库导入超时 | 中 | 分片处理 + checkpoint |
| 用户预期偏差 | 中 | 清晰兼容范围说明和报告 |

## 13. GA 发布门禁

| Gate | 标准 |
|---|---|
| G5-1 | 导入成功率达到目标阈值 |
| G5-2 | 导出回 Obsidian 样本验证通过 |
| G5-3 | 数据安全与权限审计通过 |
| G5-4 | 关键性能与稳定性指标达标 |
| G5-5 | 回滚和应急预案演练通过 |

## 14. Phase 5 完成判定

1. 用户能批量导入 Obsidian vault（zip/目录）。
2. 导入结果可追踪、可解释、可重试。
3. 用户能导出回 Obsidian 并保持核心语义。
4. 达成 GA 门禁并可全量发布。

