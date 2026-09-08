# Agent 理解 + 操作画布的能力评估（重构后）

> 2026-06-26 · 6-opus 评估 workflow（4 接地维度 + 综合 + 对抗批判，run wx174jwme）+ 真实栈实测（3 任务）
> 问题：重构成 thin canvas loop 后,agent 到底能多深地理解画布、多完整地操作画布,天花板在哪。

## 一句话结论

**理解 = 强(对"显式结构"近乎完整);操作 = 中等且脆(单次顺利通过可以,一旦出错就死,无自愈)。** 对一个**边界清晰、画布不大、不歧义**的任务,理解和操作都接近 FULL;但它**还做不到**:出错后自我恢复、稳健的多步重构、感知空间/视觉意图、验证结构判断(环/孤立)。**大部分缺口是"循环接线 + 投影管道",不是缺核心能力。**

## 理解矩阵（能感知什么）

| 能力 | 程度 | 说明 |
|---|---|---|
| 显式边拓扑(连通+方向+relation/directed) | FULL | 整图投影,跨界边保留 |
| 容器/分组(双向 parentGroupId↔children) | FULL | + children_of 递归子树 |
| 思维导图树 | FULL | 紧凑边列表 {root,tree:[[p,c,order]]} |
| 节点类型+内容+标记 | FULL | type/content/title/codeType/todo/ai/locked |
| provenance(谁建/改/state) | FULL | 可 where:{actor} 查 |
| 逐节点几何 x/y/w/h | FULL | positioned 感知(区分"未知"和"原点") |
| 切片/查询(scope/where/find/children_of/camera) | FULL | 谓词+别名+边查询 |
| 大画布整图理解 | PARTIAL | >~120 节点超 8KB 预算,尾部节点被丢 |
| 表格单元/网格 | PARTIAL | data.rows 默认读不到,需 detail=full(上限 50) |
| 样式/颜色等价 | **NONE** | structure 层不投样式 → 无法按颜色分组 |
| media 目标 url | **NONE** | 只投 mediaType 标记 |
| relationData 回读 | **NONE** | 写得进、读不回(往返不保真) |
| 派生空间关系(proximity/对齐/包围/行列带) | **NONE** | 不计算,模型只能对原始坐标硬算 |
| z-order/重叠 | **NONE** | 不投 zIndex |
| 结构判断(环/孤立/MECE) | **NONE** | 诊断引擎**已建但未接进 agent**,模型靠自己重推(LLM 易错) |
| 图形态分类(树/流程/2x2/聚类) | **NONE** | 无形态摘要 |

## 操作矩阵（能做什么）

| 能力 | 程度 | 说明 |
|---|---|---|
| 8 类节点 CRUD | FULL | 删除级联边 |
| 连线(含 typed + 自由端点)写入 | FULL | relation/directed/relationData 持久化 |
| 移动带子树(MV1) | FULL | 移组/列带整棵走,防环 |
| 分组/取消/折叠 | FULL | 自动 bbox、单父 reparent |
| 表格单元/行/列编辑 | FULL | 保持矩形+列宽 |
| 创建时布局(stack/row/grid/mindmap/tree) | FULL | + relayout_mindmap |
| 单次 canvas_edit 批量多 op | FULL | 一次调用可建+连+组(批进一个 operations) |
| 一个请求内多步链 | PARTIAL | **`_detect_tool_loop` 同名工具连 3 次就杀 run** → 实际多步上限 ~2 |
| 样式 apply_style | PARTIAL | 写得了,但 structure 层读不回 |
| 组作连线端点 | PARTIAL | 三方分歧:realtime 收 / canvas_write 丢 / 旧 Python 拒 |
| 往返保真 | PARTIAL | 数据持久但读回丢样式/表格/url/relationData |
| 编辑后验证 | PARTIAL | canvas_edit 只回 {applied,warnings},无强制重读 |
| 对**既有**节点布局智能(对齐/分布/整理) | **NONE** | 无此 op → 手发一堆 move_node(还触发 loop-kill) |
| **失败自愈** | **NONE** | 自愈信封是摆设:任何失败 → 下轮禁用工具+"别重试" → run 结束 |
| 空/残参完整性 | **NONE** | 空参 canvas_edit 被静默丢 / 畸形 shape 硬验证失败 → 触发终止 |
| 二进制上传 / SVG 子元素 / 边瞄准边 | **NONE** | 未建 |

## 最大限制器（#1，对抗批判 + 实测共同指认）

**控制平面只给一次"顺利通过"的机会——既不能探索去理解,也不能迭代去操作。** `call_model.py`:① 任何工具失败 → 下一轮 `tools_schema=None`+"别重试" → run 结束(自愈信封从不触发);② `_detect_tool_loop` 只按**工具名**判,同名连 3 次就杀。致命之处:抗截断的补救("自切片"= 连发 canvas_read)和任何顺序多步编辑(edit,edit,edit)都正好撞这两条 → 有效只剩 ~2 步、零恢复。其余(读回丢失、无派生感知、诊断未接)都是管道/接线问题,**这条是架构天花板**。

## 实测验证（真实栈,3 任务)

- **T1 建 5 步流程 → 失败**:canvas_write 撞 ValidationError(节点 ID 重复,因画布已有节点、模型复用了 ID)→ **终止路径触发,无自愈,什么都没建**,只回一句道歉。**实证确认 #1 限制器。**
- **T2 在中间插节点 → 理解正确**:读了真实画布,**如实报告"没有'设计'/'开发'节点"**(因 T1 没建成),没有幻觉。**理解强。**
- **T3 读结构 → 理解正确**:读到 6 节点 4 边(两条独立链),产出结构化分析。**结构理解从显式拓扑可行。**
- 旁证:T2/T3 仍偶发畸形 `'tool'` 占位调用(流式工具解析瑕疵)。

## 抬升天花板的优先级（大多是接线,非新建）

1. **修失败路径**:retryable 错误时重新给工具 + 注入 self_heal(reload/remap_ids/split_batch)而非禁用工具。← 解锁自愈,#1。
2. **修 `_detect_tool_loop`**:按 (工具名+参数签名) 判,而非仅工具名 → 多步编辑/自切片不再被误杀。
3. **接已建的 `run_diagnostics`** 到 read 的 meta(环/孤立/MECE/形态)→ 把易错的 LLM 重推换成确定性 ground truth。~10 行,能力已存在。
4. **空/残参修复或报错**:别静默丢 → 不再"假完成"。
5. **structure 层补投** style/table.data/media url/relationData(预算化)→ 往返保真。
6. **大读自动升级**:nodesOmitted>0 时自动转 outline + 切片,别让模型自己背。
7. **加派生空间读取器**(proximity/对齐/包围/颜色)→ 空间意图可答。
8. **加对既有节点的布局 op**(对齐/分布/整理)→ 不再手发 move_node。
9. canvas 执行可关 thinking 降延迟;歧义时允许追问。

## 备注（环境)

机器睡眠后 WinNAT 又把端口圈走(这次 8013)→ backend 容器绑不上。已临时把 backend 宿主端口改 `8013→18013`(容器内仍 8013,内部 DNS/我的内测不受影响;**浏览器访问 backend 需走 18013,或管理员 `net stop/start winnat` 一次性释放**)。这是环境问题,非代码。
