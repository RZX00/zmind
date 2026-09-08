# Public, Mobile, and Consistency Regression Pack

> Pack ID: `REG-05`
> Frozen on: 2026-03-13
> Source phase: Phase 6
> Execution mode today: manual

---

## 1. Purpose

This pack converts Phase 6 public/mobile/consistency findings into repeatable checks.

```text
REG-05 coverage
===============

Public web
  - locale-preserving public navigation
  - docs route truth
  - docs content readability
  - docs desktop TOC behavior
  - tutorials support link validity

Mobile
  - auth gate smoke
  - new chat and project-switch smoke
  - share create/reopen/remove truth
```

## 2. Cases

| Case ID | Surface | Goal | Current status | Linked bugs |
|---|---|---|---|---|
| `REG-05-01` | Locale public nav | `/zh` public navigation keeps locale on tutorials/docs/legal exits | Manual only | `BUG-0015` |
| `REG-05-02` | Locale docs wrappers | `/zh/docs`, `/zh/docs/architecture`, `/zh/docs/contributing`, `/zh/docs/self-hosting` resolve to truthful docs destinations | Manual only | `BUG-0015` |
| `REG-05-03` | Docs intro exits | docs breadcrumbs and CTA retain locale instead of hard-resetting to root | Manual only | `BUG-0015` |
| `REG-05-04` | Docs content integrity | `canvas-guide` and locale JSON content render readable UTF-8 copy | Manual only | `BUG-0016` |
| `REG-05-05` | Docs desktop TOC | active heading highlight and click-jump track the actual docs scroll container | Manual only | `BUG-0017` |
| `REG-05-06` | Tutorials resources | tutorials support/contact exits resolve to live destinations | Manual only | `BUG-0018` |
| `REG-05-07` | Mobile auth/chat core | loading -> auth overlay -> new chat -> send/cancel -> project switch remain intact | Manual only | none |
| `REG-05-08` | Mobile share create | mobile share creates a real `/share/{threadId}` link on the product host and publishes thread visibility | Manual only | `BUG-0019` |
| `REG-05-09` | Mobile share state restore | existing public mobile chats reopen in public state and allow revoke | Manual only | `BUG-0020` |

## 3. Execution Notes

- Web cases should become Playwright coverage once public/locale fixtures are deterministic.
- Mobile cases should become Maestro coverage first, then Detox if deeper runtime/state assertions are needed.
- Docs readability checks should include UTF-8 integrity assertions on committed assets, not only browser screenshots.

## 4. Blockers

- No committed Playwright public-locale smoke suite exists yet.
- No committed Maestro mobile smoke suite exists yet.
- Deterministic public-thread and locale fixture setup still needs automation.

## 5. Exit Rule

`REG-05` is not considered release-grade until:

- public locale navigation can be executed automatically
- docs TOC behavior is verified on desktop breakpoint
- mobile share create/reopen/remove behavior is executable on at least one iOS and one Android representative device class
