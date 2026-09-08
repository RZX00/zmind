# Canvas as Code (CaC) Skill

This skill enables AI agents to create and edit canvas content using the Canvas as Code paradigm - treating canvas JSON like source code with Read/Write/Edit operations.

## Overview

Canvas as Code (CaC) is an industry best practice pattern for AI canvas editing, inspired by Claude Code's Read/Write/Edit file operations. Instead of 14+ fragmented tools, CaC provides 3 unified tools that handle all canvas operations.

## Core Philosophy

> "AI edits Canvas JSON like AI Coding edits source code"

- **Direct JSON editing** - AI writes canvas structure directly
- **Intelligent layout** - System calculates positions based on layout mode
- **Temporary ID system** - Use `$1`, `$2` for new nodes, system replaces with real IDs
- **CSS-style selectors** - Batch operations on multiple nodes

## The Three Tools

| Tool | Purpose | Analogy |
|------|---------|---------|
| `canvas_read` | Read canvas content | Claude Code's `Read` |
| `canvas_write` | Create new content | Claude Code's `Write` |
| `canvas_edit` | Modify/delete existing | Claude Code's `Edit` |

---

# canvas_read

Read canvas content with optional filtering.

## Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `scope` | No | string | `"all"` | What to read: `all`, `selection`, `viewport` |
| `where` | No | object | - | Filter conditions |
| `limit` | No | integer | - | Maximum nodes to return |

## Scope Values

| Value | Description |
|-------|-------------|
| `all` | Read entire canvas |
| `selection` | Read only user-selected nodes |
| `viewport` | Read only visible nodes in viewport |

## Where Conditions

Filter nodes by properties:

```json
{
  "where": {
    "type": "text",
    "content": { "$contains": "keyword" }
  }
}
```

### Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| (direct value) | Exact match | `"type": "text"` |
| `$contains` | String contains | `"content": { "$contains": "TODO" }` |
| `$startsWith` | String starts with | `"content": { "$startsWith": "# " }` |
| `$regex` | Regex match | `"content": { "$regex": "^Step \\d+" }` |
| (array) | Match any value | `"type": ["text", "todo"]` |

## Examples

### Read Entire Canvas

```json
{
  "tool": "canvas_read"
}
```

### Read Selection Only

```json
{
  "tool": "canvas_read",
  "args": {
    "scope": "selection"
  }
}
```

### Read Text Nodes Containing "TODO"

```json
{
  "tool": "canvas_read",
  "args": {
    "where": {
      "type": "text",
      "content": { "$contains": "TODO" }
    }
  }
}
```

### Read First 10 Nodes

```json
{
  "tool": "canvas_read",
  "args": {
    "limit": 10
  }
}
```

## Response

```json
{
  "canvas": {
    "id": "canvas-uuid",
    "title": "My Canvas",
    "nodes": [
      {
        "id": "node-1",
        "type": "text",
        "content": "Hello World",
        "x": 100,
        "y": 200,
        "width": 360,
        "height": 120
      }
    ],
    "connections": [
      {
        "id": "conn-1",
        "from": "node-1",
        "to": "node-2"
      }
    ]
  },
  "selection": ["node-1", "node-2"]
}
```

---

# canvas_write

Create new content on the canvas with intelligent layout.

## Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `layout` | No | string | `"stack"` | Layout mode |
| `anchor` | No | string/object | `"selection.right"` | Starting position |
| `spacing` | No | number | `20` | Space between nodes (px) |
| `columns` | No | integer | `3` | Columns for grid layout |
| `nodes` | No* | array | - | Nodes to create |
| `connections` | No | string/array | `"none"` | Connections to create |
| `tree` | No* | object | - | Tree structure for mindmap |

*Either `nodes` or `tree` is required.

## Layout Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `stack` | Vertical stack (top to bottom) | Lists, steps, notes |
| `row` | Horizontal row (left to right) | Comparisons, options |
| `grid` | Grid layout | Galleries, matrices |
| `mindmap` | Mind map from center | Brainstorming, hierarchies |
| `tree` | Tree structure (top-down) | Org charts, taxonomies |
| `freeform` | Manual x/y coordinates | Custom layouts |

## Anchor Points

| Anchor | Description |
|--------|-------------|
| `selection` | At selection center |
| `selection.right` | Right of selection |
| `selection.left` | Left of selection |
| `selection.above` | Above selection |
| `selection.below` | Below selection |
| `viewport.center` | Center of visible area |
| `viewport.topLeft` | Top-left of visible area |
| `canvas.origin` | Canvas origin (0, 0) |
| `node:id` | At specific node |
| `node:id.right` | Right of specific node |
| `node:id.below` | Below specific node |
| `{ "x": 100, "y": 200 }` | Exact coordinates |

## Node Input

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `type` | Yes | string | Node type |
| `content` | No | string | Text content |
| `$id` | No | string | Temporary ID (`$1`, `$2`, etc.) |
| `title` | No | string | Title (for canvas-link only) |
| `width` | No | number/`"auto"` | Width in pixels |
| `height` | No | number/`"auto"` | Height in pixels |
| `codeType` | No | string | For code nodes: `mermaid`, `svg`, `html` |
| `style` | No | object | Style properties |

### Node Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| `text` | Plain text with Markdown | `content` |
| `todo` | Checkbox item | `content` |
| `table` | Data table | `data` |
| `code` | Code/diagram | `content`, `codeType` |
| `media` | Image/video | `url` or generated |
| `group` | Container for nodes | `children` |
| `column` | Vertical container | `children` |
| `canvas-link` | Link to another canvas | `title`, `targetCanvasId` |

## Connection Presets

| Preset | Description | Example |
|--------|-------------|---------|
| `none` | No connections | - |
| `chain` | Linear sequence | 1→2→3→4 |
| `star` | First to all others | 1→2, 1→3, 1→4 |
| `tree` | Parent to children | (for tree structure) |

## Connection Input

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `from` | Yes | string | Source node ID or `$id` |
| `to` | Yes | string | Target node ID or `$id` |
| `label` | No | string | Connection label |
| `style` | No | string | `line` or `arrow` |
| `dashed` | No | boolean | Dashed line |

## Examples

### Create Stacked Notes

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "stack",
    "anchor": "selection.right",
    "nodes": [
      { "type": "text", "content": "# Step 1\n\nGather requirements" },
      { "type": "text", "content": "# Step 2\n\nDesign solution" },
      { "type": "text", "content": "# Step 3\n\nImplement" }
    ]
  }
}
```

### Create Connected Flow

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "row",
    "anchor": "viewport.center",
    "nodes": [
      { "type": "text", "content": "Start", "$id": "$1" },
      { "type": "text", "content": "Process", "$id": "$2" },
      { "type": "text", "content": "End", "$id": "$3" }
    ],
    "connections": "chain"
  }
}
```

### Create Mind Map

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "mindmap",
    "anchor": "viewport.center",
    "tree": {
      "content": "Project Planning",
      "children": [
        {
          "content": "Research",
          "children": [
            { "content": "Market Analysis" },
            { "content": "Competitor Review" }
          ]
        },
        {
          "content": "Design",
          "children": [
            { "content": "Wireframes" },
            { "content": "Prototypes" }
          ]
        },
        {
          "content": "Development",
          "children": [
            { "content": "Frontend" },
            { "content": "Backend" },
            { "content": "Testing" }
          ]
        }
      ]
    }
  }
}
```

### Create Grid Gallery

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "grid",
    "columns": 3,
    "anchor": "selection.below",
    "nodes": [
      { "type": "text", "content": "Item 1" },
      { "type": "text", "content": "Item 2" },
      { "type": "text", "content": "Item 3" },
      { "type": "text", "content": "Item 4" },
      { "type": "text", "content": "Item 5" },
      { "type": "text", "content": "Item 6" }
    ]
  }
}
```

### Create Custom Connections

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "freeform",
    "nodes": [
      { "type": "text", "content": "A", "$id": "$1", "x": 0, "y": 0 },
      { "type": "text", "content": "B", "$id": "$2", "x": 400, "y": 0 },
      { "type": "text", "content": "C", "$id": "$3", "x": 200, "y": 200 }
    ],
    "connections": [
      { "from": "$1", "to": "$2", "label": "depends on" },
      { "from": "$1", "to": "$3", "style": "arrow" },
      { "from": "$2", "to": "$3", "dashed": true }
    ]
  }
}
```

### Create Mermaid Diagram

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "stack",
    "anchor": "selection.right",
    "nodes": [
      {
        "type": "code",
        "codeType": "mermaid",
        "content": "flowchart LR\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action 1]\n    B -->|No| D[Action 2]\n    C --> E[End]\n    D --> E"
      }
    ]
  }
}
```

### Create Todo List

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "stack",
    "spacing": 10,
    "nodes": [
      { "type": "text", "content": "# Sprint Tasks" },
      { "type": "todo", "content": "Review PR #123" },
      { "type": "todo", "content": "Fix bug in login flow" },
      { "type": "todo", "content": "Update documentation" },
      { "type": "todo", "content": "Deploy to staging" }
    ]
  }
}
```

## Response

```json
{
  "success": true,
  "idMap": {
    "$1": "node-abc123",
    "$2": "node-def456",
    "$3": "node-ghi789"
  },
  "applied": {
    "nodesAdded": 3,
    "connectionsAdded": 2
  }
}
```

---

# canvas_edit

Edit or delete existing canvas content.

## Parameters

The payload is flexible and supports multiple operation types:

### Direct Node Updates

Use node IDs as keys with patch objects:

```json
{
  "node-id-1": { "content": "Updated content" },
  "node-id-2": { "x": 300, "y": 200 }
}
```

### Special Operations

| Key | Type | Description |
|-----|------|-------------|
| `$delete` | array | Node IDs to delete |
| `$select` | string | CSS-style selector |
| `$set` | object | Properties to set (with `$select`) |
| `$transform` | object | Transform properties (with `$select`) |
| `$connections` | object | Connection modifications |
| `$canvas` | object | Canvas property updates |
| `$operations` | array | Batch operations |

## CSS-Style Selectors

| Selector | Description | Example |
|----------|-------------|---------|
| `#id` | Match by ID | `#node-123` |
| `.type` | Match by node type | `.text`, `.todo`, `.code` |
| `[attr=value]` | Exact attribute match | `[type=text]` |
| `[attr*=value]` | Attribute contains | `[content*=TODO]` |
| `[attr^=value]` | Attribute starts with | `[content^=Step]` |
| `*` | Match all nodes | `*` |

### Combined Selectors

```
.text[content*=TODO]     - Text nodes containing "TODO"
.code[codeType=mermaid]  - Mermaid code nodes
.todo[content*=urgent]   - Todo items containing "urgent"
```

## Examples

### Update Single Node

```json
{
  "tool": "canvas_edit",
  "args": {
    "node-abc123": {
      "content": "Updated content here"
    }
  }
}
```

### Update Multiple Nodes

```json
{
  "tool": "canvas_edit",
  "args": {
    "node-1": { "content": "New content 1" },
    "node-2": { "content": "New content 2" },
    "node-3": { "x": 500, "y": 300 }
  }
}
```

### Delete Nodes

```json
{
  "tool": "canvas_edit",
  "args": {
    "$delete": ["node-1", "node-2", "node-3"]
  }
}
```

### Batch Update with Selector

Convert all text nodes containing "TODO" to todo type:

```json
{
  "tool": "canvas_edit",
  "args": {
    "$select": ".text[content*=TODO]",
    "$set": { "type": "todo" }
  }
}
```

### Update Canvas Properties

```json
{
  "tool": "canvas_edit",
  "args": {
    "$canvas": {
      "title": "New Canvas Title",
      "backgroundColor": "#f5f5f5"
    }
  }
}
```

### Update Connections

```json
{
  "tool": "canvas_edit",
  "args": {
    "$connections": {
      "conn-1": { "label": "New Label" },
      "$delete": ["conn-2", "conn-3"]
    }
  }
}
```

### Complex Batch Operations

```json
{
  "tool": "canvas_edit",
  "args": {
    "$operations": [
      {
        "$select": ".todo[content*=done]",
        "$delete": true
      },
      {
        "$select": ".text",
        "$set": { "width": 400 }
      }
    ]
  }
}
```

### Move Nodes

```json
{
  "tool": "canvas_edit",
  "args": {
    "node-1": { "x": 100, "y": 200 },
    "node-2": { "x": 500, "y": 200 }
  }
}
```

### Update Styles

```json
{
  "tool": "canvas_edit",
  "args": {
    "node-1": {
      "style": {
        "backgroundColor": "#ffeb3b",
        "borderColor": "#f57c00"
      }
    }
  }
}
```

## Response

```json
{
  "success": true,
  "applied": {
    "nodesUpdated": 3,
    "nodesDeleted": 2,
    "connectionsUpdated": 1,
    "connectionsDeleted": 0
  }
}
```

---

# Complete Workflow Examples

## Example 1: Create a Project Board

```json
// Step 1: Read current canvas
{ "tool": "canvas_read" }

// Step 2: Create board structure
{
  "tool": "canvas_write",
  "args": {
    "layout": "row",
    "anchor": "viewport.center",
    "spacing": 40,
    "nodes": [
      { "type": "group", "content": "To Do", "$id": "$1" },
      { "type": "group", "content": "In Progress", "$id": "$2" },
      { "type": "group", "content": "Done", "$id": "$3" }
    ]
  }
}

// Step 3: Add tasks to columns
{
  "tool": "canvas_write",
  "args": {
    "layout": "stack",
    "anchor": "node:$1.below",
    "spacing": 10,
    "nodes": [
      { "type": "todo", "content": "Design homepage" },
      { "type": "todo", "content": "Set up database" },
      { "type": "todo", "content": "Write API docs" }
    ]
  }
}
```

## Example 2: Create a Decision Tree

```json
{
  "tool": "canvas_write",
  "args": {
    "layout": "tree",
    "anchor": "viewport.center",
    "tree": {
      "content": "Should we build this feature?",
      "children": [
        {
          "content": "Yes - High Impact",
          "children": [
            { "content": "Prioritize for Q1" },
            { "content": "Assign to Team A" }
          ]
        },
        {
          "content": "No - Low Impact",
          "children": [
            { "content": "Add to backlog" },
            { "content": "Revisit next quarter" }
          ]
        }
      ]
    }
  }
}
```

## Example 3: Research Notes with References

```json
// Create main research topic
{
  "tool": "canvas_write",
  "args": {
    "layout": "stack",
    "anchor": "viewport.center",
    "nodes": [
      {
        "type": "text",
        "$id": "$main",
        "content": "# Research: AI Canvas Editing\n\n## Key Questions\n\n- How to balance AI control vs user control?\n- What's the optimal number of tools?\n- How to handle real-time collaboration?"
      }
    ]
  }
}

// Add supporting evidence
{
  "tool": "canvas_write",
  "args": {
    "layout": "row",
    "anchor": "node:$main.below",
    "spacing": 20,
    "nodes": [
      { "type": "text", "content": "## Source 1\n\nClaude Code pattern:\nRead/Write/Edit", "$id": "$s1" },
      { "type": "text", "content": "## Source 2\n\nObsidian JSON Canvas\nspec", "$id": "$s2" },
      { "type": "text", "content": "## Source 3\n\nYjs CRDT for\ncollaboration", "$id": "$s3" }
    ],
    "connections": [
      { "from": "$s1", "to": "$main", "label": "inspires" },
      { "from": "$s2", "to": "$main", "label": "references" },
      { "from": "$s3", "to": "$main", "label": "enables" }
    ]
  }
}
```

## Example 4: Convert TODOs to Done

```json
// Find and update completed items
{
  "tool": "canvas_edit",
  "args": {
    "$select": ".todo[content*=DONE]",
    "$set": {
      "style": {
        "backgroundColor": "#c8e6c9",
        "textColor": "#2e7d32"
      }
    }
  }
}
```

---

# Layout Guidelines

## Recommended Node Sizes

| Node Type | Min Width | Min Height | Recommended |
|-----------|-----------|------------|-------------|
| Text (short) | 200 | 80 | 360 x 120 |
| Text (medium) | 300 | 120 | 400 x 180 |
| Text (long) | 360 | 180 | 480 x 240 |
| Todo | 200 | 60 | 320 x 80 |
| Code (Mermaid) | 420 | 260 | 500 x 400 |
| Code (SVG) | 300 | 200 | 400 x 300 |
| Table | 300 | 150 | 500 x 300 |
| Group | varies | varies | content + 40px padding |

## Spacing Recommendations

| Context | Spacing |
|---------|---------|
| Stack layout | 20px |
| Row layout | 30px |
| Grid layout | 20px |
| Inside groups | 20-40px padding |
| Between sections | 60-100px |

## Layout Selection Guide

| Content Type | Recommended Layout |
|--------------|-------------------|
| Sequential steps | `stack` with `chain` connections |
| Comparisons | `row` |
| Brainstorming | `mindmap` |
| Hierarchies | `tree` |
| Galleries/matrices | `grid` |
| Complex diagrams | `freeform` |

## Alignment Tips

- Use consistent widths for nodes in the same row
- Align nodes to multiples of 20px for cleaner layouts
- Keep mindmaps centered on the main topic
- Leave enough space between groups (60-100px)

---

# Mermaid Guidelines

## Supported Diagram Types

| Type | First Line |
|------|------------|
| Flowchart | `flowchart LR` or `flowchart TD` |
| Sequence | `sequenceDiagram` |
| Class | `classDiagram` |
| State | `stateDiagram-v2` |
| ER | `erDiagram` |
| Gantt | `gantt` |
| Pie | `pie` |
| Journey | `journey` |
| Mindmap | `mindmap` |
| Timeline | `timeline` |

## Rules

1. **No Markdown fences** - Content is pure Mermaid syntax
2. **No styling** - No `classDef`, `style`, `init`, or CSS
3. **ASCII IDs only** - Use letters, digits, underscore for node IDs
4. **Labels in quotes** - Put Chinese/special chars in `["label"]` or `("label")`

## Example

```json
{
  "tool": "canvas_write",
  "args": {
    "nodes": [
      {
        "type": "code",
        "codeType": "mermaid",
        "content": "flowchart TD\n    A[Start] --> B{Check}\n    B -->|Yes| C[Process]\n    B -->|No| D[Skip]\n    C --> E[End]\n    D --> E"
      }
    ]
  }
}
```

---

# Best Practices

## Do

- **Read first** - Always `canvas_read` before editing to understand current state
- **Use layouts** - Let the system calculate positions when possible
- **Use temp IDs** - Reference new nodes with `$1`, `$2` in connections
- **Batch operations** - Group related changes in one `canvas_edit` call
- **Use selectors** - For batch updates, use `$select` instead of listing IDs

## Don't

- **Don't guess IDs** - Read first or use selectors
- **Don't mix approaches** - Either use `nodes` or `tree`, not both
- **Don't over-specify** - Let layout handle positions unless `freeform`
- **Don't forget codeType** - Code nodes require `codeType` field

## Error Recovery

| Error | Solution |
|-------|----------|
| Node not found | Re-read canvas with `canvas_read` |
| Invalid selector | Check selector syntax |
| Layout overflow | Reduce node count or use grid |
| Connection failed | Verify source/target IDs exist |

---

# Canvas Tool Summary

| Tool | Purpose |
|------|---------|
| `canvas_read` | Read canvas content (scope/where/limit) |
| `canvas_write` | Create new content (nodes/connections/anchor/layout/spacing) |
| `canvas_edit` | Modify/delete/batch ($set/$delete/$connections/$operations/$transform) |
| `canvas_generate_image` | Generate image and write media nodes |

## Quick Examples

```json
{ "tool": "canvas_read", "args": { "scope": "selection" } }

{ "tool": "canvas_write", "args": {
    "nodes": [
      { "type": "text", "content": "Hello", "$id": "$1" },
      { "type": "text", "content": "World", "$id": "$2" }
    ],
    "connections": [{ "from": "$1", "to": "$2" }]
  }
}

{ "tool": "canvas_edit", "args": {
    "$select": "[content*='Hello']",
    "$set": { "style": { "backgroundColor": "#fef3c7" } }
  }
}
```

# References

- [Canvas as Code Spec](../design/canvas-as-code-spec.md)
- [Canvas as Code Types](../design/canvas-as-code.types.ts)
- [JSON Canvas Spec 1.0](https://jsoncanvas.org/spec/1.0/)
