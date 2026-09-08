from __future__ import annotations

import operator
from typing import Any, TypedDict

from typing_extensions import Annotated


class ResearchGraphState(TypedDict):
    messages: list[dict[str, Any]]
    clarified_task: str
    clarification_notes: str
    rewritten_task: str
    rewrite_notes: str
    search_query: Annotated[list[str], operator.add]
    web_research_result: Annotated[list[str], operator.add]
    sources_gathered: Annotated[list[dict[str, Any]], operator.add]
    claims: list[dict[str, Any]]
    claim_verdicts: list[dict[str, Any]]
    evidence_graph: list[dict[str, Any]]
    conflicts: list[dict[str, Any]]
    confidence_scores: list[dict[str, Any]]
    citation_issues: list[dict[str, Any]]
    citation_coverage: dict[str, Any]
    verification_summary: str
    follow_up_queries: list[str]
    query_rationale: str
    initial_search_query_count: int
    max_research_loops: int
    max_total_queries: int
    research_loop_count: int
    is_sufficient: bool
    knowledge_gap: str
    number_of_ran_queries: int
    tool_calls_used: int
    extracted_urls_count: int
    budget_exhausted_reason: str
    final_answer: str
    final_sources: list[dict[str, Any]]
    final_verification: dict[str, Any]
    publication: dict[str, Any]


class ClarificationState(TypedDict):
    clarified_task: str
    clarification_notes: str


class RewriteState(TypedDict):
    rewritten_task: str
    rewrite_notes: str


class ClaimExtractionState(TypedDict):
    claims: list[dict[str, Any]]


class ClaimVerificationState(TypedDict):
    claim_verdicts: list[dict[str, Any]]
    evidence_graph: list[dict[str, Any]]
    verification_summary: str


class ConflictDetectionState(TypedDict):
    conflicts: list[dict[str, Any]]
    verification_summary: str


class ConfidenceScoreState(TypedDict):
    confidence_scores: list[dict[str, Any]]
    verification_summary: str


class CitationValidationState(TypedDict):
    citation_issues: list[dict[str, Any]]
    citation_coverage: dict[str, Any]
    verification_summary: str


class QueryGenerationState(TypedDict):
    search_query: list[str]
    query_rationale: str


class WebSearchState(TypedDict):
    search_query: str
    query_index: int


class ReflectionState(TypedDict):
    is_sufficient: bool
    knowledge_gap: str
    follow_up_queries: list[str]
    research_loop_count: int
    number_of_ran_queries: int
