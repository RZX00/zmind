"""Pydantic models for structured presentation data.

The presentation agent outputs data matching these schemas.
The template engine consumes them to produce self-contained HTML.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


LayoutType = Literal[
    "title",
    "content",
    "image_left",
    "image_right",
    "comparison",
    "data",
    "quote",
    "timeline",
    "team",
    "closing",
]


class ComparisonColumn(BaseModel):
    heading: str = ""
    points: list[str] = Field(default_factory=list)


class TimelineItem(BaseModel):
    label: str = ""
    description: str = ""


class TeamMember(BaseModel):
    name: str = ""
    role: str = ""
    description: str = ""


class DataPoint(BaseModel):
    value: str = ""
    label: str = ""
    description: str = ""


class SlideData(BaseModel):
    order: int
    layout: LayoutType = "content"
    title: str = ""
    subtitle: str | None = None
    points: list[str] | None = None
    content: str | None = None
    image_url: str | None = None
    image_alt: str | None = None
    image_storage_path: str | None = None
    left_column: ComparisonColumn | None = None
    right_column: ComparisonColumn | None = None
    quote_text: str | None = None
    quote_author: str | None = None
    data_points: list[DataPoint] | None = None
    timeline_items: list[TimelineItem] | None = None
    team_members: list[TeamMember] | None = None
    speaker_notes: str | None = None
    extra: dict[str, Any] | None = None


class PresentationData(BaseModel):
    title: str
    style: str = "default"
    lang: str = "en"
    slides: list[SlideData] = Field(default_factory=list)
