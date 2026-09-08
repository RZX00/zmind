# Zmind Open Risk Register

> This register tracks quality risks that are not yet confirmed bugs.  
> Created: 2026-03-13

---

## 1. What belongs here

Use this register for:

- environment instability
- test data gaps
- verification blind spots
- missing automation
- third-party dependency uncertainty
- role matrix gaps
- release-readiness unknowns

Do not use this register for confirmed product defects. Those belong in `bug-register.md`.

---

## 2. Columns

| Risk ID | Category | Surface / Domain | Description | Probability | Impact | Risk Level | Mitigation | Owner | Review By | Status |
|---|---|---|---|---|---|---|---|---|---|---|

Probability:
- `Low`
- `Medium`
- `High`

Impact:
- `Medium`
- `High`
- `Critical`

Risk Level:
- `R1`
- `R2`
- `R3`

---

## 3. Active Risks

| Risk ID | Category | Surface / Domain | Description | Probability | Impact | Risk Level | Mitigation | Owner | Review By | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `RISK-0001` | Verification gap | Frontend | No project-level app E2E framework is currently wired into the frontend. | Medium | High | R2 | Phase 1 froze Playwright as the standard. Phase 2 froze `REG-01` as the manual P0 pack. Risk remains open until the first runnable Playwright suite exists. | TBD | 2026-04-09 | Monitoring |
| `RISK-0002` | Verification gap | Mobile | No project-level mobile E2E framework is currently wired into the mobile app. | Medium | High | R2 | Phase 1 froze Maestro as the first framework and Detox as later hardening; risk remains open until first mobile smoke flows exist. | TBD | 2026-07-02 | Monitoring |
| `RISK-0003` | Fixture gap | Team / Share / Billing | Stable reusable test accounts and seeded role data are not yet frozen. | Medium | Critical | R2 | Phase 1 froze the identity and fixture contracts; Phase 2 confirmed that role-sensitive billing boundaries are already failing (`BUG-0002`). Risk remains open until scripted seed/reset execution exists. | TBD | 2026-04-09 | Monitoring |
| `RISK-0004` | Persistence blind spot | Canvas / Doc / Thread | Save/recover coverage is not yet represented by a durable regression suite. | Medium | Critical | R3 | Convert every save/recovery bug into mandatory regression cases during Phases 2-3. | TBD | 2026-04-30 | Open |
| `RISK-0005` | Scope complexity | Team mirrors / locale wrappers | Wrapper and scope-mirror behavior may diverge silently from source pages. | Medium | High | R2 | Phase 4 confirmed this risk is material, not theoretical, via `BUG-0007` and `BUG-0008`. Phase 5 extended it with `BUG-0010`, and Phase 6 extended it again with `BUG-0015`, where localized public mirrors still drop users onto root-language routes. Continue explicit mirror and route-entry consistency checks in Phases 6-8. | TBD | 2026-07-02 | Open |
| `RISK-0006` | Environment reproducibility gap | Supabase-backed fixtures | The repository does not currently expose a committed migration/seed/reset pack for deterministic QA fixture reconstruction. | High | High | R3 | Treat the Phase 1 data plan as the semantic source of truth and require scripted seed/reset implementation before automated packs become release-grade. Phases 2-3 remain manual-only because this is still unresolved. | TBD | 2026-04-30 | Open |
| `RISK-0007` | Boundary blind spot | Team invitation accept | Inactive invitation fallback redirects to `/team/[slug]` when `slug` exists, but this Phase 2 slice did not prove that membership is revalidated before protected content can render. | Medium | High | R2 | Validate inactive invitation and downstream team access end-to-end during Phase 5 team/share/admin audit. | TBD | 2026-06-11 | Open |
| `RISK-0008` | Verification gap | Core workspace surfaces | Dashboard and workspace had no confirmed code-level defects in Phase 3 static review, but `REG-02` is still manual-only, so daily-work entry flows are not yet backed by runnable regression evidence. | Medium | High | R2 | Implement Playwright coverage for `REG-02-01` and `REG-02-02` after seed/reset support exists, then rerun the phase gate against executable evidence rather than static reasoning only. | TBD | 2026-04-30 | Open |
| `RISK-0009` | Verification gap | Support surfaces | `REG-03` now exists, but knowledge, triggers, trash, skills, and integrations are still covered only by manual smoke specifications rather than runnable product tests. | Medium | High | R2 | Implement Playwright smoke coverage for `REG-03-01` through `REG-03-11` after fixture seed/reset exists, prioritizing `BUG-0007`, `BUG-0008`, and `BUG-0009`. | TBD | 2026-05-21 | Open |
| `RISK-0010` | Verification gap | Boundary surfaces | `REG-04` now exists, but team/share/admin coverage is still manual-only, so owner/member/admin/public boundary regressions are not yet executable in CI or local smoke. | Medium | Critical | R2 | Implement Playwright plus API coverage for `REG-04-01` through `REG-04-11`, prioritizing `BUG-0010`, `BUG-0012`, and `BUG-0013`. | TBD | 2026-06-11 | Open |
| `RISK-0011` | Public-share blind spot | Share canvas / share thread | Static review did not confirm a public-share defect in Phase 5, but anonymous load, post-unpublish behavior, live-run visibility, and attachment preview are still under-proven without runtime evidence. | Medium | High | R2 | Execute `REG-04-06` through `REG-04-09` with anonymous and cross-workspace authenticated accounts before treating share surfaces as release-grade. | TBD | 2026-06-11 | Open |
| `RISK-0012` | Verification gap | Public / mobile consistency surfaces | `REG-05` now exists, but locale navigation, docs parity, and mobile share flows are still covered only by manual review notes rather than executable web/mobile smoke. | Medium | High | R2 | Implement Playwright for `REG-05-01` through `REG-05-06` and Maestro for `REG-05-07` through `REG-05-09`, prioritizing `BUG-0015`, `BUG-0017`, `BUG-0019`, and `BUG-0020`. | TBD | 2026-07-09 | Open |
| `RISK-0013` | Content integrity gap | Public docs / locale assets | No UTF-8 or encoding-integrity validation gate currently protects locale JSON files or checked-in docs pages, so mojibake can ship unnoticed, as demonstrated by `BUG-0016`. | Medium | High | R2 | Add source-level UTF-8 validation and readable-content checks for locale JSON and docs assets before Phase 8 closure, and fail CI on newly corrupted files. | TBD | 2026-07-09 | Open |
| `RISK-0014` | Observability gap | Web + mobile runtime recovery | The repo has product analytics and a Sentry tunnel route, but it still lacks release-grade, redacted recovery breadcrumbs across web and mobile, so incident triage depends on partial evidence and unsafe console traces. | High | Critical | R3 | Add structured recovery instrumentation for `thread_id`, `agent_run_id`, terminal status, and route/screen context on both web and mobile. Replace unsafe console evidence collection, and treat `BUG-0022` remediation as a prerequisite. | TBD | 2026-07-16 | Open |
| `RISK-0015` | Regression gap | Resilience / recovery | No executable resilience regression pack currently covers disconnect, stop, retry, reload, long-thread, or long-tool-history behavior. | High | Critical | R3 | Create `REG-06` as the resilience/recovery pack, automate mobile stream disconnect truth plus web thread terminal reconciliation, and require it before release closure. | TBD | 2026-07-16 | Open |
| `RISK-0016` | Performance blind spot | Long thread / tool timeline / large content | No benchmark budget currently exists for long mobile thread histories, tool timelines, or large-content stress paths, so scaling regressions can ship without any measurable gate. | Medium | High | R2 | Use `docs/qa/performance/performance-risk-list.md` to define baseline measurements, then freeze concrete latency/memory/log-volume budgets before release. | TBD | 2026-07-16 | Open |

---

## 4. Review Rule

- Every phase-end report must reference this register.
- Any `R3` still open at phase gate must be discussed explicitly.
- If a risk turns into a confirmed defect:
  - keep the risk row
  - add linked bug ID in mitigation notes

## 5. Phase 8 Closure Note

- Final release gate result is `NO GO`.
- Highest active `R3` risks at closure are `RISK-0004`, `RISK-0006`, `RISK-0014`, and `RISK-0015`.
- No risk was downgraded to waiver-only status at program close.
