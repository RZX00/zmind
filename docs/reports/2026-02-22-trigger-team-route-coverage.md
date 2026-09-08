# 2026-02-22 Trigger Team Route Coverage Fix

## Problem
Avatar menu uses team-scoped trigger link:
- `/team/{accountSlug}/triggers`

But route files existed only for:
- `/triggers`
- `/{locale}/triggers`

Result:
- Team workspace users could click `Triggers` and hit 404.

## Fix
Added team-account route entries that re-export the canonical triggers page:
- `frontend/src/app/(dashboard)/(teamAccount)/team/[accountSlug]/triggers/page.tsx`
- `frontend/src/app/[locale]/(dashboard)/(teamAccount)/team/[accountSlug]/triggers/page.tsx`

Both re-export:
- `default`
- `dynamic`
- `revalidate`
- `runtime`

From:
- `frontend/src/app/(dashboard)/triggers/page.tsx`

## Why This Shape
- Avoids duplicate page logic.
- Keeps personal/team behavior aligned.
- Preserves existing data loading/runtime settings.

## Validation
| Check | Result |
|---|---|
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |

## Impact
- Trigger entry in avatar menu is now reachable for both personal and team contexts.
