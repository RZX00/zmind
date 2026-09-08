---
name: use-zmind-tools
description: >
  Use this skill when the user wants to read or modify ZMind canvases or docs from
  OpenClaw. Prefer the connected ZMind tools instead of guessing or asking the user
  to manually copy content between systems.
---

# Use ZMind Tools

When the user asks to work with ZMind content:

1. Check whether the relevant ZMind tool exists.
2. Use the connected tool rather than describing hypothetical manual steps.
3. Prefer result-first responses:
   - good: "I created the canvas and added 6 grouped nodes."
   - bad: "I sent a POST request to the canvas endpoint."

## Preferred tools

```text
Canvas
├─ zmind_canvas_list
├─ zmind_canvas_get
├─ zmind_canvas_create
└─ zmind_canvas_apply_ops

Docs
├─ zmind_doc_get
├─ zmind_doc_create
└─ zmind_doc_apply_ops
```

## Behavior rules

- If auth is missing, tell the user they need to run the ZMind login command first.
- If a write conflicts with a newer version, reload and retry with the latest state.
- Avoid exposing raw database fields unless the user explicitly asks.
