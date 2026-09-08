from __future__ import annotations

from functools import lru_cache

from core.application.services.infographic_service import InfographicService, InfographicServiceDependencies
from core.infrastructure.infographic.supabase_infographic_repository import SupabaseInfographicRepository


@lru_cache(maxsize=1)
def get_infographic_service() -> InfographicService:
    return InfographicService(
        deps=InfographicServiceDependencies(
            repository=SupabaseInfographicRepository(),
        )
    )
