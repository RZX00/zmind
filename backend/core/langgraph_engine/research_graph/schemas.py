from __future__ import annotations

from typing import Any, List

from pydantic import BaseModel, Field
from typing_extensions import TypedDict


class SearchQueryList(BaseModel):
    rationale: str = Field(default="")
    query: List[str] = Field(default_factory=list)


class ClaimItem(BaseModel):
    claim_id: str = Field(default="")
    text: str = Field(default="")
    claim_type: str = Field(default="fact")
    importance: str = Field(default="medium")


class ClaimExtractionResult(BaseModel):
    claims: List[ClaimItem] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    evidence_id: str = Field(default="")
    claim_id: str = Field(default="")
    source_id: str = Field(default="")
    url: str = Field(default="")
    snippet: str = Field(default="")
    verdict: str = Field(default="neutral")
    rationale: str = Field(default="")


class ClaimVerdictItem(BaseModel):
    claim_id: str = Field(default="")
    status: str = Field(default="insufficient")
    confidence: str = Field(default="low")
    notes: str = Field(default="")


class ClaimVerificationResult(BaseModel):
    evidence: List[EvidenceItem] = Field(default_factory=list)
    claim_verdicts: List[ClaimVerdictItem] = Field(default_factory=list)


class ClarificationResult(BaseModel):
    clarified_task: str = Field(default="")
    needs_clarification: bool = Field(default=False)
    clarification_note: str = Field(default="")
    assumptions: List[str] = Field(default_factory=list)


class ResearchRewriteResult(BaseModel):
    rewritten_task: str = Field(default="")
    focus_areas: List[str] = Field(default_factory=list)


class ReflectionResult(BaseModel):
    is_sufficient: bool = Field(default=True)
    knowledge_gap: str = Field(default="")
    follow_up_queries: List[str] = Field(default_factory=list)


class ResearchPlanPayload(TypedDict, total=False):
    """Payload returned when plan_only mode generates a research plan."""

    status: str  # "plan_generated"
    clarified_task: str
    clarification_notes: str
    rewritten_task: str
    focus_areas: list[str]
    queries: list[str]
    query_rationale: str
    config_summary: dict[str, Any]  # { query_count, max_loops, phase2_enabled, ... }
