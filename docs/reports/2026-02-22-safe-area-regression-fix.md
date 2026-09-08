# 2026-02-22 Safe-Area Regression Fix (Mobile / Notch Devices)

## Problem
Recent UI changes used these utility classes:
- `safe-area-x`
- `safe-area-bottom-spacious`

But their CSS definitions were missing in `frontend/src/app/globals.css`.

This produced a silent regression:
- classes rendered in DOM but no actual safe-area padding applied.

## Fix
Restored and expanded safe-area helpers in:
- `frontend/src/app/globals.css`

Added/updated:
- `.safe-area-top`
- `.safe-area-bottom`
- `.safe-area-left`
- `.safe-area-right`
- `.safe-area-x`
- `.safe-area-bottom-spacious`
- `.mobile-safe-area-top`
- `.mobile-safe-area-bottom`

Also included `constant(...)` fallback for older Safari behavior.

## Validation
| Check | Result |
|---|---|
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |

## Impact
- Mobile thread header/input and floating controls now correctly respect notch/home-indicator insets.
