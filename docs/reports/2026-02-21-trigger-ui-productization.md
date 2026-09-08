# 2026-02-21 Trigger UI Productization (Human-Centric Refactor)

## Goal
Refactor Trigger UX from engineering-centric forms into a user-first automation setup flow, while keeping backend contract unchanged.

## Scope
- Keep existing automations APIs and payload fields.
- Reduce jargon in list/create flows.
- Make common setup one-screen, advanced options collapsed.

## File Changed
- `frontend/src/components/triggers/triggers-page.tsx`

## Key UX Changes
1. Naming and copy
- `Trigger` primary wording shifted to `Automation` in user-facing actions.
- Search/filter/list labels rewritten to plain language.
- Validation and toast messages rewritten to task-oriented language.

2. Create flow simplification
- Added schedule templates:
  - Every day 9:00
  - Every day 18:00
  - Weekdays 9:00
  - Every hour
  - Custom schedule
- Cron input is only shown for `Custom schedule`.
- Event mode hides provider internals; source is auto-managed (`composio`).

3. Complexity hiding (advanced settings)
- Added collapsible `Advanced settings` section.
- Moved low-frequency fields under advanced:
  - extra run instruction
  - max retry attempts
  - event binding key
  - advanced JSON config

4. List readability improvements
- Schedule details show user-readable summaries.
- Column labels updated:
  - `Trigger` -> `Starts when`
  - `Target` -> `Runs with`

## Contract Compatibility
- Payload shape remains unchanged (`CreateAutomationPayload`).
- Event provider fallback remains `composio` when unset.
- No backend endpoint changes.

## Validation
| Check | Result |
|---|---|
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |

## Notes
- This refactor targets setup clarity and one-pass completion rate.
- No migration or data backfill required.
