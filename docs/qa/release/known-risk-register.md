# Known Risk Register

> Phase window: 2026-07-10 to 2026-07-16
> Documentation executed on: 2026-03-13
> Source of truth remains `docs/qa/bug-register.md` and `docs/qa/open-risk-register.md`

---

## 1. Release Blockers

| ID | Type | Surface | Current state | Release impact | Containment |
|---|---|---|---|---|---|
| `BUG-0001` | Bug / `P0` | Auth recovery | reset-password completion depends on fragile transient state | account recovery can fail at a critical entry path | must fix before release |
| `BUG-0002` | Bug / `P0` | Billing / permissions | member can reach owner-level billing mutations | billing integrity and role boundary failure | must fix before release |
| `BUG-0004` | Bug / `P0` | Canvas durability | undo/redo is not durably truthful after refresh | core editor trust failure | must fix before release |
| `BUG-0013` | Bug / `P0` | Admin / Prompt Studio | backend lacks admin-role enforcement | unauthorized admin-surface access | must fix before release |
| `BUG-0022` | Bug / `P0` | Mobile observability | token-bearing URLs and private payloads are logged | credential and content exposure | must fix before release |
| `RISK-0015` | Risk / `R3` | Resilience regression | no executable `REG-06` pack exists | recovery regressions can ship unseen | create pack before release |

## 2. High Known Risks

| ID | Type | Surface | Current state | Why it still matters |
|---|---|---|---|---|
| `BUG-0021` | Bug / `P1` | Mobile stream recovery | disconnect/fail/stop can look completed | mobile thread truth is unreliable during incidents |
| `BUG-0015` | Bug / `P1` | Locale public routes | locale users can fall back to root-language routes | outward-facing route truth remains inconsistent |
| `BUG-0016` | Bug / `P1` | Docs / locale assets | mojibake remains visible in public docs and copy | public trust and content quality are damaged |
| `BUG-0019` | Bug / `P1` | Mobile share | mobile share still diverges from web truth | public-share contract is inconsistent across platforms |
| `RISK-0014` | Risk / `R3` | Observability | no structured redacted breadcrumbs across web/mobile | incident triage still depends on partial evidence |
| `RISK-0016` | Risk / `R2` | Performance | no benchmark budgets for long thread/tool/content | scaling regressions remain invisible until users hit them |
| `RISK-0013` | Risk / `R2` | Content integrity | no UTF-8/content guard exists | docs and locale corruption can recur silently |

## 3. Waiver Candidates Only After Blockers Are Closed

| ID group | Current class | Potential future posture |
|---|---|---|
| selected `P2` usability issues | open but triaged | can be bundled into a timed next-cycle wave if release blockers are closed and no trust/safety boundary is involved |
| `BUG-0018` tutorials support link | `P3` | waivable only if public docs/support IA is explicitly accepted |
| remaining manual-only low-frequency flows | risk | waivable only with documented owner, review date, and rollback plan |

## 4. Current Read

```text
Known-risk posture
==================

Safe to waive now
  None at release-blocking level

Potentially waivable later
  Some P2/P3 issues
  Only after all P0 blockers and regression gaps are closed

Not waivable now
  Auth, billing, save durability, admin RBAC, mobile log leak,
  resilience pack absence, and mobile recovery truth
```
