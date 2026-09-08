# 2026-04-09 Phase 2 P0 Critical Flow Report

> Program calendar window: 2026-03-27 to 2026-04-09
> Documentation executed on: 2026-03-13

## Scope

Phase 2 of the stable-baseline bug audit program reviewed the product's highest-risk access and money paths:

- auth
- reset password
- phone verification
- invite redeem and activation
- team invitation accept
- subscription and credits
- owner/member permission boundaries

## Work Completed

Created:

- `docs/qa/audits/p0-auth-audit.md`
- `docs/qa/audits/p0-invite-activation-audit.md`
- `docs/qa/audits/p0-billing-credits-audit.md`
- `docs/qa/audits/p0-permission-boundary-audit.md`
- `docs/qa/regression/p0-critical-regression-pack.md`
- `docs/reports/2026-04-09-phase2-p0-critical-flow-report.md`

Updated:

- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`

## Findings Summary

| Severity | Count | IDs |
|---|---:|---|
| `P0` | 2 | `BUG-0001`, `BUG-0002` |
| `P1` | 1 | `BUG-0003` |
| Watchlist / risk only | 1 | `RISK-0007` |

## What Was Confirmed

### 1. Auth recovery is brittle at the exact point where locked-out users depend on it

The reset-password page is coupled to transient URL `code` state instead of explicit recovery-session state. With the current Supabase PKCE browser client behavior, that makes the reset flow version-sensitive and unreliable.

### 2. Team billing mutations are not protected by owner-only authorization

Billing write endpoints for purchase, checkout, portal, cancel, and reactivate all stop at workspace membership. A normal team member can reach team billing controls from the team subscription route and is not blocked server-side.

### 3. MFA policy enforcement is not applied consistently across authenticated routes

The phone-verification checker is mounted only on the dashboard page and only recognizes four path prefixes. Team, locale, doc, and canvas routes can render without the policy check firing.

## Product State After Phase 2

```text
Before Phase 2
==============
The audit knew the P0 surfaces, but not yet which backbone defects were real.

After Phase 2
=============
We now know:
- auth recovery is not robust
- team billing has a real owner/member authorization gap
- MFA policy enforcement is route-fragmented
- invite activation looks structurally stronger than the other P0 paths
```

## Regression Status

`REG-01` now exists as a frozen manual specification covering eight critical cases.

It is not yet runnable because:

- Playwright is approved but not yet implemented
- seeded fixture reset is still missing
- open P0 defects still block a green result

## Open Risks

Most important remaining risks after this phase:

- no runnable Web E2E suite yet exists for P0 flows
- deterministic seed/reset for Supabase fixtures is still missing
- inactive invitation fallback redirect still needs end-to-end validation in Phase 5

These remain tracked in `docs/qa/open-risk-register.md`.

## Gate Check

Phase 2 exit criteria required:

- no unreviewed P0 remains in auth / invite / billing / permission
- all P0 findings are triaged
- critical regression pack exists and is runnable

Result:

- `CONDITIONAL FAIL`

Reason:

- the audit requirement is satisfied
- the quality gate is not satisfied because open `P0` defects remain and `REG-01` is still manual-only

## Next Phase

Phase 3 moves into the main daily-work surfaces:

- dashboard
- workspace
- canvas
- doc
- thread

That phase will decide whether save/recover behavior is merely complex or actually unsafe.
