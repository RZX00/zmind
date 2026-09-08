# 2026-02-22 Tutorials Nav i18n Fix

## Issue
`/tutorials` page compile/render triggered:
- `MISSING_MESSAGE: landing.nav.tutorials`

Source:
- `frontend/src/components/home/nav-menu.tsx`
- Translation lookup key: `landing.nav.${slug}` with `slug = tutorials`.

## Root Cause
`landing.nav.tutorials` was missing in locale message files.

## Fix
Added key to both locales:
- `frontend/src/messages/en.json`
- `frontend/src/messages/zh-CN.json`

Values:
- `en`: `Tutorials`
- `zh-CN`: `教程`

## Validation
| Check | Result |
|---|---|
| JSON parse (`en.json`, `zh-CN.json`) | pass |
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |

## Impact
- `/en/tutorials` and localized landing nav render without missing-message errors.
