from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional


Handler = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class CanvasAIDependencies:
    stream_canvas_selection_chat: Handler
    generate_selection_infographic: Handler
    generate_canvas_title: Handler
    resolve_external_video_metadata: Handler
    generate_canvas_media: Handler


@dataclass
class CanvasAIService:
    deps: CanvasAIDependencies

    async def stream_canvas_selection_chat(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Any,
    ) -> Any:
        return await self.deps.stream_canvas_selection_chat(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )

    async def generate_selection_infographic(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Any,
    ) -> Any:
        return await self.deps.generate_selection_infographic(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )

    async def generate_canvas_title(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Dict[str, Any],
    ) -> Any:
        return await self.deps.generate_canvas_title(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )

    async def resolve_external_video_metadata(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Any,
    ) -> Any:
        return await self.deps.resolve_external_video_metadata(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )

    async def generate_canvas_media(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Dict[str, Any],
    ) -> Any:
        return await self.deps.generate_canvas_media(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )
