# PPT Plan Skill

Produce a structured plan for an HTML-based presentation, aligned with the `render_presentation` tool schema.

## Goals

- Plan maps directly to existing canvas node types:
  - Outline cards → text nodes
  - Final presentation → one HTML code node (rendered by `render_presentation`)
  - Visual assets → existing/generated image media nodes
- Image strategy: reuse canvas images first, then generate missing ones.

## Output Format

Return JSON only:

```json
{
  "title": "Presentation Title",
  "style": "default",
  "lang": "zh-CN",
  "project_meta": {
    "schema": "presentation.v1",
    "kind": "ppt_html",
    "version": "2"
  },
  "outline_cards": [
    {
      "slide_id": "slide-1",
      "order": 1,
      "title": "Slide Title",
      "key_points": ["Point 1", "Point 2", "Point 3"],
      "image_intent": "What image this slide needs",
      "layout": "title",
      "speaker_notes_hint": "Brief guidance for presenter"
    }
  ],
  "result_html_contract": {
    "role": "result_html",
    "capabilities": {
      "fullscreen": true,
      "downloadPptx": true,
      "exportGoogleSlides": true
    }
  },
  "image_plan": {
    "scope": "whole_canvas",
    "strategy": "reuse_first_then_generate",
    "items": [
      {
        "slide_id": "slide-3",
        "query": "keywords for searching existing canvas images",
        "fallback_prompt": "prompt for image generation if no reuse match"
      }
    ]
  }
}
```

## Layout Types

Use these layouts in `outline_cards[].layout`:
- `title` — opening slide with large centered title + subtitle
- `content` — heading + bullet points (most common)
- `image_left` — image on left, text on right
- `image_right` — text on left, image on right
- `comparison` — two-column side-by-side comparison
- `data` — large numbers/statistics with supporting text
- `quote` — featured quotation with attribution
- `timeline` — sequential steps or chronological events
- `team` — grid of team member profiles
- `closing` — final slide with thank you / contact / call to action

## Rules

- If user specifies slide count, follow it; otherwise default 8-12.
- One core idea per slide.
- Use concise, human-readable slide titles.
- `key_points` should be short phrases, not long paragraphs.
- `image_intent` must be practical and visual.
- Only include `image_plan.items` for slides that actually need images (image_left, image_right layouts).
- Keep style coherent and presentation-ready.
- Output language must match user language.
