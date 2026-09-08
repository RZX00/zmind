# Deep Research Agent：第一阶段前后差异（Mermaid）

本文档用于展示 Deep Research Agent 在第一阶段改造前后的关键差异，重点覆盖：
- 主流程编排差异
- 预算守卫触发时机
- 状态模型扩展
- Prompt 架构演进

---

## 1) 主流程差异

```mermaid
flowchart TD
  subgraph Before["改造前"]
    A1["用户请求"] --> B1["generate_query"]
    B1 --> C1["web_research"]
    C1 --> D1["reflection"]
    D1 -- "不足" --> C1
    D1 -- "充分" --> E1["finalize_answer"]
  end

  subgraph After["第一阶段后"]
    A2["用户请求"] --> K2["clarify_intent"]
    K2 --> L2["rewrite_task"]
    L2 --> B2["generate_query"]

    B2 --> G2{"预算检查"}
    G2 -- "通过" --> C2["web_research"]
    G2 -- "触发上限" --> E2["finalize_answer + Limitations"]

    C2 --> D2["reflection"]
    D2 --> H2{"is_sufficient?"}
    H2 -- "否" --> I2{"query/runtime 预算可继续?"}
    I2 -- "可继续" --> C2
    I2 -- "不可继续" --> E2
    H2 -- "是" --> E2
  end
```

---

## 2) 执行时序差异（预算守卫）

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant RG as ResearchGraph
  participant L as LLM
  participant T as Search/Extract Tools
  participant B as BudgetGuard

  U->>RG: research task
  RG->>L: clarify
  RG->>L: rewrite

  loop 每轮研究
    RG->>B: check(runtime/tool_calls/query_count/url_budget)
    alt 预算可用
      RG->>T: intelligent_web_search / extract_web_content
      T-->>RG: results
    else 预算耗尽
      B-->>RG: exhausted(reason)
      RG-->>RG: set budget_exhausted_reason
      Note over RG: 停止扩展研究并进入收尾
    end
  end

  RG->>L: finalize answer
  RG-->>U: answer + Sources (+Limitations if exhausted)
```

---

## 3) 状态模型差异

```mermaid
classDiagram
  class BeforeState {
    messages
    search_query
    web_research_result
    sources_gathered
    follow_up_queries
    query_rationale
    research_loop_count
    final_answer
  }

  class AfterState {
    messages
    clarified_task
    clarification_notes
    rewritten_task
    rewrite_notes
    search_query
    web_research_result
    sources_gathered
    follow_up_queries
    max_total_queries
    tool_calls_used
    extracted_urls_count
    budget_exhausted_reason
    final_answer
  }

  BeforeState --> AfterState : 扩展
```

---

## 4) Prompt 架构差异

```mermaid
flowchart LR
  subgraph Before["改造前"]
    R1["runner.py"] --> P1["prompts.py 常量"]
  end

  subgraph After["第一阶段后"]
    R2["runner.py"] --> API["get_*_prompt() API"]
    API --> PF["prompt_files 读取器"]
    PF --> MD["prompts/research_graph/*.prompt.md"]
    API --> FB["prompts.py fallback 常量"]
  end
```

---

## 5) 再加后的差异图（Phase 2 预案）

> 说明：以下图对比的是“当前第一阶段”与“继续加上第二阶段（Claim-Evidence/冲突检测/置信度）”后的变化。

### 5.1 第一阶段主流程

```mermaid
flowchart TD
  A1["User Request"] --> B1["clarify_intent"]
  B1 --> C1["rewrite_task"]
  C1 --> D1["generate_query"]
  D1 --> E1["web_research"]
  E1 --> F1["reflection"]
  F1 --> G1{"sufficient?"}
  G1 -- "no" --> E1
  G1 -- "yes / budget stop" --> H1["finalize_answer"]
```

### 5.2 第二阶段主流程

```mermaid
flowchart TD
  A2["User Request"] --> B2["clarify_intent"]
  B2 --> C2["rewrite_task"]
  C2 --> D2["generate_query"]
  D2 --> E2["web_research"]
  E2 --> F2["extract_claims"]
  F2 --> G2["verify_claims (multi-source)"]
  G2 --> H2["detect_conflicts"]
  H2 --> I2["score_confidence"]
  I2 --> J2["reflection"]
  J2 --> K2{"sufficient + verified?"}
  K2 -- "no" --> E2
  K2 -- "yes / budget stop" --> L2["finalize_answer_with_evidence"]
```

### 5.3 数据结构差异（扁平 sources -> 证据图）

```mermaid
classDiagram
  class BeforeState {
    search_query
    web_research_result
    sources_gathered
    final_answer
  }

  class Claim {
    claim_id
    text
    type
  }

  class Evidence {
    evidence_id
    url
    snippet
    supports_claim
  }

  class Conflict {
    conflict_id
    claim_a
    claim_b
    reason
  }

  class AfterState {
    claims
    evidence_graph
    conflicts
    confidence_scores
    citation_map
    final_answer
  }

  BeforeState --> AfterState : evolve
  Claim --> Evidence : supported_by
  Claim --> Conflict : may_conflict
```

### 5.4 执行时序差异（新增验证闭环）

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant RG as ResearchGraph
  participant L as LLM
  participant W as Web Tools
  participant V as Verifier

  U->>RG: ask question
  RG->>L: clarify + rewrite
  RG->>W: search + extract
  W-->>RG: raw results

  RG->>L: extract claims
  L-->>RG: claim list

  loop each claim
    RG->>V: retrieve evidence from multiple sources
    V-->>RG: support / contradiction / missing
  end

  RG->>L: synthesize with evidence + conflicts
  L-->>RG: cited final answer
  RG-->>U: answer + confidence + limitations
```

### 5.5 输出差异（用户可见层）

```mermaid
flowchart LR
  subgraph Before["当前输出"]
    B1["Summary + Sources list"]
  end

  subgraph After["再加后输出"]
    A1["Executive Summary"]
    A2["Key Claims (each cited)"]
    A3["Conflict Panel (if any)"]
    A4["Confidence by claim"]
    A5["Limitations / Missing evidence"]
    A6["Source Trace (claim -> snippet -> URL)"]
  end
```
