# Canvas Error Contract (v1)

This document defines the structured error payload used by canvas write paths
(realtime apply/import endpoints and CanvasEditTool responses).

## Error Payload Shape
All write errors return a consistent JSON shape:

```json
{
  "error": {
    "code": "version_conflict",
    "message": "Version conflict",
    "field": "expected_version",
    "hint": "Reload the canvas and retry."
  },
  "code": "version_conflict",
  "message": "Version conflict",
  "serverVersion": 123
}
```

Notes:
- `error.code` is the stable machine-readable identifier.
- `message` is a human-readable summary.
- `field` and `hint` are optional.
- Additional context may be included (e.g., `serverVersion` on conflicts).

## Common Codes
- `invalid_json` — request body cannot be parsed.
- `missing_canvas_id` — missing `canvasId`.
- `missing_workspace_id` — missing `workspaceId`.
- `workspace_id_mismatch` — token workspace does not match request.
- `canvas_id_mismatch` — token canvas does not match request.
- `invalid_operations` — missing or empty operations array.
- `invalid_expected_version` — `If-Match` is not a numeric serverVersion.
- `version_conflict` — optimistic concurrency check failed.
- `validation_error` — ops failed schema or rule validation.
- `canvas_not_found` — target canvas does not exist or is inaccessible.
- `apply_failed` / `import_failed` — realtime write failed unexpectedly.

These codes are stable across write paths to improve client-side handling.
