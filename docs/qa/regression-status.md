# Zmind Regression Status

> Weekly regression control board  
> Created: 2026-03-13

---

## 1. Purpose

This file tracks which regression packs exist and whether they are runnable, green, blocked, or missing.

---

## 2. Regression Packs

| Pack ID | Pack Name | Scope | Owner | Exists | Runnable | Status | Last Run | Notes |
|---|---|---|---|---|---|---|---|---|
| `REG-00` | Baseline integrity pack | backend pytest + frontend lint/type-check + mobile lint | TBD | Yes | Yes | Frozen baseline | TBD | Phase 1 froze the exact command set and artifact policy. This is still insufficient for product confidence by itself. |
| `REG-01` | P0 critical flow pack | auth, invite, billing, permission | QA / TBD | Yes | No | Defined, manual only | N/A | Phase 2 froze `docs/qa/regression/p0-critical-regression-pack.md` with eight cases. Still blocked on Playwright setup, seed/reset automation, and open `P0` bugs. |
| `REG-02` | Core workspace pack | dashboard, workspace, canvas, doc, thread | QA / TBD | Yes | No | Defined, manual only | N/A | Phase 3 froze `docs/qa/regression/core-workspace-regression-pack.md` with twelve cases. Still blocked on Playwright setup, fixture reset automation, and open `BUG-0004`, `BUG-0005`, `BUG-0006`. |
| `REG-03` | Support surface pack | knowledge, triggers, trash, skills, integrations | QA / TBD | Yes | No | Defined, manual only | N/A | Phase 4 froze `docs/qa/regression/support-surface-regression-pack.md` with eleven cases. Still blocked on Playwright setup, fixture reset automation, and open `BUG-0007`, `BUG-0008`, `BUG-0009`. |
| `REG-04` | Boundary pack | team, share, admin | QA / TBD | Yes | No | Defined, manual only | N/A | Phase 5 froze `docs/qa/regression/boundary-surface-regression-pack.md` with eleven cases. Still blocked on Playwright setup, fixture reset automation, anonymous/public share smoke, and open `BUG-0010`, `BUG-0011`, `BUG-0012`, `BUG-0013`, `BUG-0014`. |
| `REG-05` | Public/mobile consistency pack | public pages, mobile flows, locale/responsive | QA / TBD | Yes | No | Defined, manual only | N/A | Phase 6 froze `docs/qa/regression/public-mobile-consistency-regression-pack.md` with nine cases. Still blocked on Playwright and Maestro setup, locale/public/mobile fixture automation, and open `BUG-0015`, `BUG-0016`, `BUG-0017`, `BUG-0018`, `BUG-0019`, and `BUG-0020`. |
| `REG-06` | Resilience and recovery pack | disconnect/reconnect, retry/stop, long-thread/tool performance, incident recovery | QA / TBD | No | No | Missing | N/A | Phase 7 documented the required audit, performance list, and runbook, but no executable resilience pack exists yet. This gap now blocks safe closure because of `BUG-0021` and `BUG-0022`. |

---

## 3. Current Assessment

```text
Current state
=============

Backend regression substrate
  Present

Frontend product regression substrate
  P0 manual pack defined
  Core workspace manual pack defined
  Support surface manual pack defined
  Boundary manual pack defined
  Public/mobile manual pack defined
  Runnable suite still missing

Mobile product regression substrate
  Framework approved, implementation missing

Resilience and recovery regression substrate
  Missing
  No executable disconnect/recovery/performance pack exists yet

Release gate
  NO GO
  Open P0 defects and manual/missing product packs block closure
```

This file must be updated at every weekly gate.
