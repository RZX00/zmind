# `@zmind/openclaw-plugin`

OpenClaw plugin for ZMind.

## Responsibilities

```text
Plugin
- registers ZMind tools
- exposes login/status CLI commands
- reuses shared session state
- returns result-first user-facing summaries
```

## Commands

```text
openclaw zmind login --email <email> --password <password>
openclaw zmind status
openclaw zmind workspace --id <workspace-id>
openclaw zmind logout
```

## Registered Tools

```text
Canvas
- zmind_canvas_list
- zmind_canvas_get
- zmind_canvas_create
- zmind_canvas_apply_ops

Docs
- zmind_doc_get
- zmind_doc_create
- zmind_doc_apply_ops
```

## Config

```text
baseUrl
supabaseUrl
supabaseAnonKey
```

The plugin reuses the same session store as the `zmind` CLI, so a successful CLI login can also satisfy plugin auth.

## Live Canvas Writes

```text
OpenClaw tool -> ZMind backend -> canvas-realtime -> canvas persisted
```

For local or self-hosted validation, keep `canvas-realtime` reachable alongside the backend. Without it, read flows can still pass while `zmind_canvas_apply_ops` fails during realtime canvas mutation.
