# 2026-06-11 Phase 5 Boundary Surface Report

> Program calendar window: 2026-05-22 to 2026-06-11
> Documentation executed on: 2026-03-13

## Scope

Phase 5 audited the product's boundary-heavy surfaces:

- team settings
- team members and invitations
- share canvas
- share thread
- admin audit, billing, invites, and prompt studio

## Work Completed

Created:

- `docs/qa/audits/team-settings-audit.md`
- `docs/qa/audits/team-member-invite-audit.md`
- `docs/qa/audits/share-canvas-audit.md`
- `docs/qa/audits/share-thread-audit.md`
- `docs/qa/audits/admin-audit-surface-audit.md`
- `docs/qa/security/permission-boundary-matrix.md`
- `docs/qa/regression/boundary-surface-regression-pack.md`
- `docs/reports/2026-06-11-phase5-boundary-surface-report.md`

Updated:

- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`

## Findings Summary

| Severity | Count | IDs |
|---|---:|---|
| `P0` | 1 | `BUG-0013` |
| `P1` | 1 | `BUG-0010` |
| `P2` | 3 | `BUG-0011`, `BUG-0012`, `BUG-0014` |
| Watchlist / risk only | 2 | `RISK-0010`, `RISK-0011` |

## What Was Confirmed

### 1. Team members are routed into a false owner shell

The team picker opens `/team/[slug]/settings` for every team account. The page itself only checks account membership, not owner role, so members can enter the settings shell, see owner mutation controls, and get silent empty-state fallbacks where owner-only RPCs reject.

### 2. Team settings can copy a broken team URL

The settings page displays a root-domain slug URL and the copy button writes `https://zmind.so/{slug}`. Real team routes in this repo live under `/team/[slug]/...`, so the copied link is not route-truthful.

### 3. Team invite creation has a stale success shell

Invitation creation succeeds and returns a token, but the surrounding directory does not refresh because the server action revalidates a route that does not exist in the real team settings path structure.

### 4. Prompt Studio is the Phase 5 P0

Unlike the real admin APIs, Prompt Studio only checks that the caller is authenticated. Any logged-in user can read prompt files, preview prompt assembly, apply changes, inspect prompt history, and trigger rollbacks.

### 5. Admin invites batch-delete UI has a broken primary affordance

Delete-mode checkboxes do not toggle selection because the checkbox cell blocks row-click selection and the checkbox `onChange` handler is empty.

## What Was Not Confirmed

Static review did not find a bug-register-level defect in:

- share canvas public-read flow
- share thread public-read flow
- admin audit backend gating
- admin billing backend gating

That is not the same as release proof. It only means the code reviewed in Phase 5 did not justify a confirmed bug without runtime evidence.

## Product State After Phase 5

```text
Before Phase 5
==============
Team, share, and admin surfaces still looked "edge-case":
- lower volume than the core editor paths
- but much higher damage when wrong

After Phase 5
=============
We now know:
- the biggest org-facing failure is shell truth, not raw SQL privilege bypass
- the biggest admin failure is Prompt Studio RBAC, not audit or billing RBAC
- share surfaces are structurally safer than the team shell, but still under-proven without anonymous runtime smoke
```

## Regression Status

`REG-04` now exists as a frozen manual specification covering eleven boundary cases.

It is not yet runnable because:

- Playwright product coverage still does not exist
- deterministic owner/member/admin/public fixtures are still not scriptable end-to-end
- open `BUG-0010`, `BUG-0011`, `BUG-0012`, `BUG-0013`, and `BUG-0014` remain unresolved

## Open Risks

Most important remaining risks after this phase:

- team/share/admin regression coverage is still manual only
- anonymous public-share runtime states are still static-audit-only
- Prompt Studio's missing RBAC raises the urgency of executable admin boundary tests

These remain tracked in `docs/qa/open-risk-register.md`.

## Gate Check

Phase 5 exit criteria required:

- team/share/admin have no open P0
- public exposure boundaries are documented
- owner/member/admin/public matrices are reviewed

Result:

- `FAIL`

Reason:

- documentation and the boundary matrix are now complete
- public exposure boundaries are documented
- but Phase 5 still contains open `P0` `BUG-0013`, so the phase does not satisfy its own exit gate

## Next Phase

Phase 6 moves into outward-facing consistency work:

- public home, pricing, docs, and legal surfaces
- mobile core and panel/modal flows
- responsive and locale consistency
