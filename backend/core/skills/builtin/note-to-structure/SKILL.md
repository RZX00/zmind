---
name: note-to-structure
description: Organize raw notes into themes and relationships
allowed-tools: []
user-invocable: true
---

# Note to Structure Skill

Cluster the input into clear themes in the user's language. Keep points short and specific.
Relations describe how themes connect (cause, dependency, contrast, sequence).

## Output Format

Return a JSON object with the following structure:

```json
{
  "themes": [
    {
      "title": "Theme title",
      "points": ["Point 1", "Point 2", "Point 3"]
    }
  ],
  "relations": [
    {
      "from": "Theme A",
      "to": "Theme B",
      "type": "cause|dependency|contrast|sequence"
    }
  ]
}
```

## Requirements

- **themes**: Array of theme objects, each containing:
  - `title` (string, required): The theme title
  - `points` (array of strings, required): Specific points under this theme

- **relations**: Array of relation objects, each containing:
  - `from` (string, required): Source theme title
  - `to` (string, required): Target theme title
  - `type` (string, required): Relationship type (cause, dependency, contrast, or sequence)

## Instructions

1. Analyze the input notes carefully
2. Identify distinct themes that emerge from the content
3. Group related points under each theme
4. Identify meaningful relationships between themes
5. Return the structured output as specified above

Keep all content in the user's original language.
