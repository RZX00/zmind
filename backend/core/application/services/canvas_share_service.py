from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional


Handler = Callable[..., Awaitable[Any]]


@dataclass(frozen=True)
class CanvasShareDependencies:
    create_canvas_invite: Handler
    list_canvas_invites: Handler
    revoke_canvas_invite: Handler
    verify_canvas_invite: Handler
    get_canvas_share_health: Handler
    get_canvas_share_status: Handler
    update_canvas_share: Handler
    get_public_canvas_snapshot: Handler
    list_public_canvas_versions: Handler
    list_public_canvas_timeline: Handler


@dataclass
class CanvasShareService:
    deps: CanvasShareDependencies

    async def create_canvas_invite(
        self,
        *,
        canvas_id: str,
        payload: Any,
        request: Any,
        token: Optional[str],
    ) -> Any:
        return await self.deps.create_canvas_invite(
            canvas_id=canvas_id,
            payload=payload,
            request=request,
            token=token,
        )

    async def list_canvas_invites(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
    ) -> Any:
        return await self.deps.list_canvas_invites(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )

    async def revoke_canvas_invite(
        self,
        *,
        canvas_id: str,
        invite_id: str,
        request: Any,
        token: Optional[str],
    ) -> Any:
        return await self.deps.revoke_canvas_invite(
            canvas_id=canvas_id,
            invite_id=invite_id,
            request=request,
            token=token,
        )

    async def verify_canvas_invite(
        self,
        *,
        canvas_id: str,
        payload: Any,
        request: Any,
    ) -> Any:
        return await self.deps.verify_canvas_invite(
            canvas_id=canvas_id,
            payload=payload,
            request=request,
        )

    async def get_canvas_share_health(
        self,
        *,
        request: Any,
        token: Optional[str],
    ) -> Any:
        return await self.deps.get_canvas_share_health(
            request=request,
            token=token,
        )

    async def get_canvas_share_status(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
    ) -> Any:
        return await self.deps.get_canvas_share_status(
            canvas_id=canvas_id,
            request=request,
            token=token,
        )

    async def update_canvas_share(
        self,
        *,
        canvas_id: str,
        request: Any,
        token: Optional[str],
        payload: Any,
    ) -> Any:
        return await self.deps.update_canvas_share(
            canvas_id=canvas_id,
            request=request,
            token=token,
            payload=payload,
        )

    async def get_public_canvas_snapshot(
        self,
        *,
        canvas_id: str,
    ) -> Any:
        return await self.deps.get_public_canvas_snapshot(
            canvas_id=canvas_id,
        )

    async def list_public_canvas_versions(
        self,
        *,
        canvas_id: str,
        order_direction: Optional[str],
        limit: Optional[int],
    ) -> Any:
        return await self.deps.list_public_canvas_versions(
            canvas_id=canvas_id,
            order_direction=order_direction,
            limit=limit,
        )

    async def list_public_canvas_timeline(
        self,
        *,
        canvas_id: str,
        order_direction: Optional[str],
        limit: Optional[int],
    ) -> Any:
        return await self.deps.list_public_canvas_timeline(
            canvas_id=canvas_id,
            order_direction=order_direction,
            limit=limit,
        )
