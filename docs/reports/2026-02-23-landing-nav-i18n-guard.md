# 2026-02-23 Landing Nav i18n Guard

## Problem
Landing nav used dynamic i18n keys (`landing.nav.${slug}`) and called `t(...)` directly.

When any key is missing, next-intl throws `MISSING_MESSAGE`, causing page render errors.

## Fix
Updated:
- `frontend/src/components/home/nav-menu.tsx`

Change:
- Added safe translation helper inside `resolveNavLabel`.
- If key lookup fails, fallback to `item.name` instead of throwing.

## Why
- Prevents single missing translation key from breaking `/tutorials` or homepage nav rendering.
- Keeps UX available while i18n keys are being added.

## Validation
| Check | Result |
|---|---|
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |
