# 2026-02-21 Tutorials Entry Integration (Dashboard + User Menu)

## Goal
Integrate production-ready entry points for `/tutorials` from daily user workflows:
- Dashboard surface (lightweight banner)
- Avatar user menu entry
- Locale-safe labels

## Scope
1. Add a dismissible dashboard tutorials banner component.
2. Render banner in dashboard layout shell.
3. Add `Tutorials` item in avatar menu dropdown.
4. Add i18n keys for user menu + banner in `en` / `zh-CN`.

## Files Changed
- `frontend/src/components/announcements/tutorials-banner.tsx`
- `frontend/src/components/dashboard/layout-content.tsx`
- `frontend/src/components/sidebar/nav-user-with-teams.tsx`
- `frontend/src/messages/en.json`
- `frontend/src/messages/zh-CN.json`

## Behavior
- Banner only appears for authenticated users.
- Banner can be dismissed and persists dismissal via local storage key:
  - `zmind-tutorials-banner-dismissed`
- Banner CTA links directly to `/tutorials`.
- User menu now contains a dedicated `Tutorials` entry.

## i18n
Added:
- `userMenu.tutorials`
- `tutorialsBanner.dismiss`
- `tutorialsBanner.title`
- `tutorialsBanner.description`
- `tutorialsBanner.walkthroughs`
- `tutorialsBanner.cta`

## Validation
| Check | Result |
|---|---|
| `python3` JSON parse for `en.json` + `zh-CN.json` | pass |
| `cd frontend && npm run lint` | pass (existing warnings only) |
| `cd frontend && npm run type-check` | pass |

## Notes
- Existing lint warnings are pre-existing and unrelated to this integration.
- This change focuses on discoverability and onboarding entry points, not the tutorials page content itself.
