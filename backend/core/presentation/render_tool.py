"""render_presentation tool — converts structured slide JSON into self-contained HTML."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

from pydantic import ValidationError

from core.presentation.engine import render_presentation, get_available_layouts
from core.presentation.schemas import PresentationData
from core.tools.base import ToolResult
from core.tools.presentation_styles_config import get_style_names
from core.utils.logger import logger


@dataclass
class RenderPresentationTool:
    """Stateless tool that renders PresentationData JSON into HTML."""

    async def render(
        self,
        *,
        slides_json: str,
        canvas_id: str | None = None,
    ) -> ToolResult:
        """Parse *slides_json* and render a full presentation HTML.

        Args:
            slides_json: A JSON string matching the PresentationData schema.
            canvas_id: If provided, ``image_storage_path`` fields on slides
                are automatically converted to HMAC-signed media URLs so
                images can load inside sandboxed iframes.

        Returns:
            ToolResult with the rendered HTML in ``output`` and metadata
            containing ``slide_count``, ``style``, and ``layouts_used``.
        """
        try:
            raw = json.loads(slides_json)
        except (json.JSONDecodeError, TypeError) as exc:
            return ToolResult(
                success=False,
                output=f"Invalid JSON: {exc}",
            )

        try:
            data = PresentationData(**raw)
        except ValidationError as exc:
            errors = exc.errors()
            summary = "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}"
                for e in errors[:5]
            )
            return ToolResult(
                success=False,
                output=f"Schema validation failed: {summary}",
            )

        if not data.slides:
            return ToolResult(
                success=False,
                output="No slides provided. Include at least one slide.",
            )

        available = get_available_layouts()
        for slide in data.slides:
            if slide.layout not in available:
                return ToolResult(
                    success=False,
                    output=(
                        f"Unknown layout '{slide.layout}' on slide {slide.order}. "
                        f"Available layouts: {', '.join(available)}"
                    ),
                )

        style_names = get_style_names()
        if data.style not in style_names:
            logger.warning(
                "Unknown presentation style '%s', falling back to 'default'",
                data.style,
            )
            data.style = "default"

        try:
            html = render_presentation(data, canvas_id=canvas_id)
        except Exception as exc:
            logger.exception("render_presentation failed")
            return ToolResult(
                success=False,
                output=f"Rendering error: {exc}",
            )

        layouts_used = sorted({s.layout for s in data.slides})
        return ToolResult(
            success=True,
            output=html,
            metadata={
                "slide_count": len(data.slides),
                "style": data.style,
                "layouts_used": layouts_used,
                "slides_json": raw,
            },
        )
