from datetime import datetime, timezone

from core.prompts.prompt_files import read_prompt_file_or_fallback, safe_format


def get_current_date() -> str:
    return datetime.now(timezone.utc).strftime("%B %d, %Y")


CLARIFY_PROMPT = """You refine a user request into an explicit research task for an automated deep research workflow.

Instructions:
- Preserve user intent; do not narrow scope unless the request is ambiguous.
- Identify missing constraints and assumptions explicitly.
- Return JSON with exactly these keys:
  - "clarified_task" (string)
  - "needs_clarification" (boolean)
  - "clarification_note" (string)
  - "assumptions" (array of short strings)

Current date: {current_date}
User request:
{research_topic}
"""


REWRITE_PROMPT = """You rewrite a clarified user request into a high-signal research brief for multi-query web investigation.

Instructions:
- Keep the rewritten task concise and search-oriented.
- Include explicit target dimensions (latest updates, metrics, alternatives, implementation implications).
- Return JSON with exactly these keys:
  - "rewritten_task" (string)
  - "focus_areas" (array of short strings)

Current date: {current_date}
Clarified task:
{clarified_task}

Clarification notes:
{clarification_notes}
"""


QUERY_WRITER_PROMPT = """You generate diverse, high-signal web search queries for an automated research tool.

Instructions:
- Prefer 3-5 queries when the topic is broad; use fewer only if the question is narrow.
- Each query should cover a distinct angle (definitions, latest updates, data/metrics, opposing views, implementation).
- Avoid overlapping or near-duplicate queries.
- Include time context if recency matters. Today's date is {current_date}.
- Return JSON with exactly two keys: "rationale" and "query".
- "query" must be a list of strings; no extra keys.

Topic:
{research_topic}

Max queries: {number_queries}

Example JSON:
{{
  "rationale": "Explain coverage across definition, metrics, and recent developments.",
  "query": [
    "topic definition and core concepts",
    "latest 2024 developments on topic",
    "topic key metrics statistics 2023 2024"
  ]
}}
"""


EXTRACT_CLAIMS_PROMPT = """You identify concrete, checkable claims from research summaries.

Instructions:
- Extract only claims that are relevant to the user's question.
- Prefer objective, verifiable claims over vague opinions.
- Keep each claim concise and atomic.
- Return JSON with exactly this key:
  - "claims": array of objects with keys:
    - "text" (string)
    - "claim_type" (one of: fact, trend, opinion, forecast, definition, comparison)
    - "importance" (one of: high, medium, low)

User question:
{research_topic}

Current date:
{current_date}

Summaries:
{summaries}
"""


VERIFY_CLAIMS_PROMPT = """You verify extracted claims against provided sources and snippets.

Instructions:
- For each claim, map supporting or contradicting evidence from sources.
- Use only provided sources/snippets. Do not invent URLs or source IDs.
- Prefer diverse sources and short evidence snippets.
- Return JSON with exactly two keys:
  - "evidence": array of objects with keys:
    - "claim_id" (string)
    - "source_id" (string)
    - "url" (string, optional if source_id present)
    - "snippet" (string)
    - "verdict" (one of: support, contradict, neutral, insufficient)
    - "rationale" (string)
  - "claim_verdicts": array of objects with keys:
    - "claim_id" (string)
    - "status" (one of: supported, contradicted, mixed, insufficient)
    - "confidence" (one of: high, medium, low)
    - "notes" (string)

User question:
{research_topic}

Current date:
{current_date}

Claims (JSON):
{claims_json}

Sources (JSON):
{sources_json}

Summaries:
{summaries}
"""


REFLECTION_PROMPT = """You evaluate research summaries for completeness and gaps.

Instructions:
- Decide if the summaries are sufficient to answer the user's question.
- If insufficient, propose 1-3 follow-up queries that fill specific gaps.
- Focus on missing data, unclear claims, unresolved conflicts, weak evidence confidence, or citation consistency gaps.
- Return JSON with exactly these keys: "is_sufficient", "knowledge_gap", "follow_up_queries".

User question:
{research_topic}

Current date:
{current_date}

Summaries:
{summaries}

Verification summary:
{verification_summary}
"""


ANSWER_PROMPT = """Answer the user's question using only the provided summaries, sources, and verification data.

Instructions:
- The current date is {current_date}.
- Respond in the user's language.
- Use inline citations with source IDs from Sources JSON, e.g. [S1], [S2].
- After drafting, replace [S#] with markdown links using the matching source title and URL.
- Do not invent facts not supported by the summaries or sources.
- If evidence is conflicting, explicitly state the conflict and cite both sides.
- If evidence is insufficient, say so clearly.

User question:
{research_topic}

Summaries:
{summaries}

Sources (JSON list with source_id/title/url/snippet):
{sources_json}

Verification data (JSON with claims/evidence/conflicts/confidence):
{verification_json}
"""


def get_clarify_prompt(*, current_date: str, research_topic: str) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/clarify.prompt.md",
        CLARIFY_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
    )


def get_rewrite_prompt(*, current_date: str, clarified_task: str, clarification_notes: str) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/rewrite.prompt.md",
        REWRITE_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        clarified_task=clarified_task,
        clarification_notes=clarification_notes,
    )


def get_query_writer_prompt(*, current_date: str, research_topic: str, number_queries: int) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/query_writer.prompt.md",
        QUERY_WRITER_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
        number_queries=number_queries,
    )


def get_extract_claims_prompt(*, current_date: str, research_topic: str, summaries: str) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/extract_claims.prompt.md",
        EXTRACT_CLAIMS_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
        summaries=summaries,
    )


def get_verify_claims_prompt(
    *,
    current_date: str,
    research_topic: str,
    claims_json: str,
    sources_json: str,
    summaries: str,
) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/verify_claims.prompt.md",
        VERIFY_CLAIMS_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
        claims_json=claims_json,
        sources_json=sources_json,
        summaries=summaries,
    )


def get_reflection_prompt(
    *,
    current_date: str,
    research_topic: str,
    summaries: str,
    verification_summary: str,
) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/reflection.prompt.md",
        REFLECTION_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
        summaries=summaries,
        verification_summary=verification_summary,
    )


def get_answer_prompt(
    *,
    current_date: str,
    research_topic: str,
    summaries: str,
    sources_json: str,
    verification_json: str,
) -> str:
    template = read_prompt_file_or_fallback(
        "research_graph/answer.prompt.md",
        ANSWER_PROMPT,
    )
    return safe_format(
        template,
        current_date=current_date,
        research_topic=research_topic,
        summaries=summaries,
        sources_json=sources_json,
        verification_json=verification_json,
    )
