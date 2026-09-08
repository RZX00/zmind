# 2026-02-21 Phase B: Sandbox Residual Cleanup + Runtime File Layer

## Goal
- Do not restore Daytona.
- Remove hard dependency on `/sandboxes/*` routes.
- Provide cloud runtime file capability with project-scoped auth and storage.

## What Was Delivered

### 1) Backend runtime file capability routes
Added `backend/core/runtime/files_api.py` and mounted in `backend/core/api.py`.

New routes:
- `GET /api/runtime/{runtime_ref}/files`
- `GET /api/runtime/{runtime_ref}/files/content`
- `POST /api/runtime/{runtime_ref}/files` (multipart)
- `POST /api/runtime/{runtime_ref}/files/json`
- `DELETE /api/runtime/{runtime_ref}/files`

### 2) Access model
- Read: `verify_sandbox_access_optional(...)` compatibility alias -> runtime access.
- Write: explicit runtime write check with workspace membership enforcement.
- Runtime identity: `runtime_ref == project_id`.

### 3) Storage model
- R2 object key namespace:
  - `{account_id}/runtime/{project_id}/{relative_path}`
- Workspace path semantic kept for UI compatibility:
  - `/workspace/...`
- Best-effort metadata upsert in `file_uploads` (`source=runtime-files`).

### 4) Frontend migration off `/sandboxes/*`
- All direct calls switched from `/sandboxes/{id}/...` to `/runtime/{runtimeRef}/...`.
- Added runtime ref resolver:
  - `frontend/src/lib/runtime-ref.ts`
- Thread/share runtime id resolution now prefers `project.runtime.runtime_ref` and falls back safely.
- Project mapping cleaned to avoid relying on removed `projects.sandbox` field as data source.

## Architecture Snapshot

```text
UI
  |
  | runtime_ref
  v
/api/runtime/{runtime_ref}/files*
  |
  | auth + membership
  v
Runtime Access Layer (project-scoped)
  |
  | namespaced key
  v
R2 Object Storage + file_uploads metadata
```

## Compatibility Decisions
- Kept legacy frontend variable naming (`sandboxId`) in some components to minimize risky refactor breadth.
- Semantics now point to runtime reference, not Daytona sandbox instance.

## Validation

| Check | Result |
|---|---|
| `python3 -m py_compile backend/core/runtime/files_api.py backend/core/api.py` | pass |
| Runtime tests (`test_runtime_access.py` + `test_runtime_files_api.py`) | 11 passed |
| Automation regression subset (`domain` + `repo` + `background_jobs`) | 16 passed |
| Frontend lint | pass (existing warnings only) |
| Frontend type-check | pass |
| Route surface introspection | runtime file routes present |

## Notes
- A single combined pytest invocation showed dramatiq async middleware coupling flake; running affected suites sequentially passed consistently.
- Presentation conversion paths still carry historical `sandbox_url` naming in parts of UI/service integration. This is now non-blocking for runtime file layer, but should be normalized in next cleanup iteration.

## Next Step (recommended)
1. Rename remaining UI/internal identifiers from `sandboxId` to `runtimeRef` (pure refactor, no behavior change).
2. Align presentation integration contract to `source_url`/runtime terminology end-to-end.
3. Add contract tests for runtime file API behavior (list-as-dir vs direct file download).
