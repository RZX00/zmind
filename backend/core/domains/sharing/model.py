from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class CanvasShare:
    canvas_id: str
    workspace_id: str
    is_public: bool
    is_listed: bool
    timeline_enabled: bool
    public_shows_timeline: bool
    listed_at: Optional[str]
    author_display_name: Optional[str]
    author_avatar_url: Optional[str]
