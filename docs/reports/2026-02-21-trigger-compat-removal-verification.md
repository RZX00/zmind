# 2026-02-21 Trigger Compatibility Removal Verification

## Scope
- Remove legacy trigger compatibility routes (`/api/triggers/*`) from backend automation module.
- Keep product path unified on automations API (`/api/automations*`).
- Ensure frontend trigger page relies on automations endpoints only.

## Code Change
- Commit: `03a03233a`
- File: `backend/core/automation/api.py`
- Change summary:
  - Deleted compatibility router and handlers under `/triggers`.
  - Deleted legacy conversion helpers only used by compatibility contracts.
  - Kept all automations endpoints and run lifecycle endpoints intact.

## Verification Matrix

| Check Item | Method | Result |
|---|---|---|
| Local backend module syntax | `python3 -m py_compile backend/core/automation/api.py` | Pass |
| Runtime route surface after rebuild | Introspect `app.routes` in container | `/api/triggers/*` absent |
| OpenAPI surface | Read `http://localhost:8013/openapi.json` | Only `/api/automations*` + `/api/composio/triggers*` |
| Legacy route behavior | `GET /api/triggers/all` | `404 Not Found` |
| Automations route behavior | `GET /api/automations` without auth | `401` (route exists, auth enforced) |
| Frontend static quality gate | `npm run lint` | No errors (warnings are unrelated pre-existing items) |

## Important Operational Finding
- Root cause of route mismatch during validation was **runtime image drift**, not code drift:
  - `docker-compose` backend/worker services do not mount source code.
  - Code changes in workspace do not apply to running containers until image rebuild/recreate.

### Current Compose Behavior (relevant)
- backend volumes: only `.env`, credentials json, `prompts`
- worker volumes: only `.env`, credentials json, `prompts`
- Source tree is not bind-mounted.

## Build/Deploy Note
In this sandbox, Docker BuildKit default path (`/home/rzx/.docker`) is not writable. Use:

```bash
DOCKER_CONFIG=/tmp/docker-config docker compose up -d backend worker --build
```

If compose context is blocked by unreadable temp dirs, build from a clean temp context containing only `backend/` and `prompts/`, then recreate services with `--no-build`.

## Product Contract (post-change)
- Unified trigger product contract:
  - Read/list/create/update/delete/toggle/run/runs all go through `/api/automations*`.
- Legacy contract intentionally removed:
  - `/api/triggers/*` is no longer part of the supported API surface.

## Next Recommended Hardening
1. Add a backend regression test that asserts no `/api/triggers/*` routes are registered.
2. Add an API contract test for `/api/automations*` and `/api/composio/triggers*` route presence.
3. Add release checklist item: route-surface diff before and after deploy.
