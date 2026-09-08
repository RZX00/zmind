from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Listing:
    id: str
    workspace_id: str
    name: str
