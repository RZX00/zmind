---
name: ppt-plan
description: Turn a topic into a slide outline with per-slide content plan, layout choices, and image strategy
allowed-tools: []
user-invocable: true
---

# PPT Plan Skill

Produce a structured HTML-based PPT plan in the user's language.

## Guidelines

- If slide count is specified in the input, match it; otherwise use 8-12 slides
- Keep each slide focused and avoid repeating points
- Use short, human-friendly titles
- Points should be concise phrases (no markdown formatting)
- Plan must map to existing canvas node types:
  - outline cards -> text nodes
  - final PPT -> one HTML code node (rendered by `render_presentation`)
  - visuals -> existing/generated image media nodes
- Image strategy must be: reuse existing canvas images first, then generate missing ones

## Layout Types

Choose the best layout for each slide from:
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

## Output Format

Return a JSON object with the following structure:

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
      "image_intent": "Description of image or diagram to use",
      "layout": "title",
      "speaker_notes_hint": "Brief presentation guidance for this slide"
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
        "query": "keywords for matching existing canvas images",
        "fallback_prompt": "prompt for image generation if no match"
      }
    ]
  }
}
```

## Output Schema

- **title** (string, optional): Overall presentation title
- **style** (string): Visual style (default `"default"`)
- **lang** (string): Language code (e.g. `"zh-CN"`, `"en"`)
- **project_meta** (object): Must include `schema`, `kind`, `version`
- **outline_cards** (array, required): One card per slide
  - `slide_id` (string, required): Stable slide identifier
  - `order` (integer, required): Slide order
  - `title` (string, required): Slide title
  - `key_points` (array of strings, optional): Key points for the slide
  - `image_intent` (string, optional): Visual intent for this slide
  - `layout` (string, required): One of the 10 layout types
  - `speaker_notes_hint` (string, optional): Brief presentation guidance
- **result_html_contract** (object, required): Metadata contract for result HTML node
- **image_plan** (object, required): Reuse-first image strategy

## Instructions

1. Analyze the topic and determine the best narrative flow
2. Create outline cards that can be directly rendered as text nodes on canvas
3. Design each slide with a clear focus and concise points
4. Choose the most appropriate layout for each slide's content type
5. Plan image sourcing with reuse-first strategy and generation fallback
6. Keep content concise and presentation-ready

All content should be in the user's original language.
