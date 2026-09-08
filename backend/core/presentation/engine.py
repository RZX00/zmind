"""Presentation template rendering engine.

Converts structured PresentationData into self-contained HTML using Jinja2
templates and style configurations.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from core.presentation.schemas import PresentationData, SlideData
from core.tools.presentation_styles_config import get_style_config, PRESENTATION_STYLES

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env: Environment | None = None


def _get_env() -> Environment:
    global _env
    if _env is None:
        _env = Environment(
            loader=FileSystemLoader(str(_TEMPLATES_DIR)),
            autoescape=select_autoescape(["html"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )
    return _env


def _resolve_style(style_name: str) -> dict:
    """Resolve a style name to its full configuration dict.

    Falls back to 'default' if the requested style is not found.
    """
    config = get_style_config(style_name)
    if config is None:
        config = get_style_config("default")
    if config is None:
        config = list(PRESENTATION_STYLES.values())[0]
    return config


def _resolve_image_urls(slides_dicts: list[dict], canvas_id: str | None) -> None:
    """Convert image_storage_path to signed image_url in-place.

    If a slide has ``image_storage_path`` set but no ``image_url``,
    generates a signed media URL so the sandboxed iframe can load
    the image without JWT authentication.
    """
    if not canvas_id:
        return

    from core.media.signature_utils import build_signed_media_url

    for d in slides_dicts:
        storage_path = d.get("image_storage_path")
        if storage_path and not d.get("image_url"):
            d["image_url"] = build_signed_media_url(storage_path, canvas_id)


def render_presentation(
    data: PresentationData,
    *,
    canvas_id: str | None = None,
) -> str:
    """Render a PresentationData object into a complete self-contained HTML string.

    Args:
        data: Structured slide content.
        canvas_id: If provided, ``image_storage_path`` fields on slides are
            automatically converted to signed media URLs.
    """
    env = _get_env()
    template = env.get_template("base.html")

    style = _resolve_style(data.style)

    slides_dicts = []
    for slide in data.slides:
        d = slide.model_dump(exclude_none=True)
        d["layout_template"] = f"layouts/{slide.layout}.html"
        slides_dicts.append(d)

    _resolve_image_urls(slides_dicts, canvas_id)

    html = template.render(
        title=data.title,
        lang=data.lang,
        style=style,
        slides=slides_dicts,
        slide_count=len(data.slides),
    )
    return html


def render_single_slide(slide: SlideData, style_name: str = "default") -> str:
    """Render a single slide fragment (without the full page wrapper)."""
    env = _get_env()
    layout_template = env.get_template(f"layouts/{slide.layout}.html")
    style = _resolve_style(style_name)
    return layout_template.render(
        slide=slide.model_dump(exclude_none=True),
        style=style,
    )


def get_available_layouts() -> list[str]:
    """Return the list of available layout template names."""
    layouts_dir = _TEMPLATES_DIR / "layouts"
    return sorted(p.stem for p in layouts_dir.glob("*.html"))
