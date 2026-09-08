# 2026-07-02 Phase 6 Public, Mobile, and Consistency Report

> Program calendar window: 2026-06-12 to 2026-07-02
> Documentation executed on: 2026-03-13

## Scope

Phase 6 audited the outward-facing consistency surfaces:

- public home, pricing, tutorials, changelog, docs, legal, and enterprise relay
- mobile home, chat, left/right panels, settings, share, and action modals
- responsive desktop/mobile parity on docs/public shells
- locale wrappers versus canonical source routes

## Work Completed

Created:

- `docs/qa/audits/public-home-pricing-audit.md`
- `docs/qa/audits/public-content-surface-audit.md`
- `docs/qa/audits/mobile-core-audit.md`
- `docs/qa/audits/mobile-panel-modal-audit.md`
- `docs/qa/audits/responsive-consistency-audit.md`
- `docs/qa/audits/locale-consistency-audit.md`
- `docs/qa/regression/public-mobile-consistency-regression-pack.md`
- `docs/reports/2026-07-02-phase6-public-mobile-consistency-report.md`

Updated:

- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`

## Findings Summary

| Severity | Count | IDs |
|---|---:|---|
| `P0` | 0 | none |
| `P1` | 3 | `BUG-0015`, `BUG-0016`, `BUG-0019` |
| `P2` | 2 | `BUG-0017`, `BUG-0020` |
| `P3` | 1 | `BUG-0018` |
| Watchlist / risk only | 2 | `RISK-0012`, `RISK-0013` |

## What Was Confirmed

### 1. Locale public wrappers are still not route-truthful

The locale-prefixed public layer is incomplete. Some routes are missing entirely, some locale wrappers simply re-export root implementations that hard-redirect to non-locale paths, and public nav still uses raw anchors for non-anchor routes.

### 2. Public content quality is visibly damaged by encoding corruption

The checked-in docs canvas guide and several locale-copy assets contain mojibake. This is not a translation nuance problem. It is source-integrity damage on user-facing content.

### 3. Docs desktop navigation is inconsistent with the actual scroll container

The documentation TOC reads and writes `window` scroll state while the content lives inside a `ScrollArea` viewport. That makes desktop documentation navigation structurally unreliable.

### 4. Tutorials has a dead support exit

The public tutorials page offers a `Support` link, but the repository exposes no matching `/support` route.

### 5. Mobile sharing is not the same product as web sharing

The mobile share modal is not just missing polish. It builds the wrong public link shape, uses a fake production hostname, and never applies the thread-level publish state that the real share surface depends on.

### 6. Mobile cannot reliably tell whether a chat is already public

The mobile list query strips `is_public`, so reopening the share modal often hides existing public state.

## What Was Not Confirmed

Static review did not justify a bug-register defect in:

- base non-locale home, pricing, and enterprise relay routes
- mobile auth gate, send/cancel loop, project switching core, or right-panel timeline shell
- base legal and changelog route logic

That does not mean those surfaces are release-proof. It means this phase did not find a confirmed defect at bug-register level from static evidence alone.

## Product State After Phase 6

```text
Before Phase 6
==============
Public and mobile quality still had a "looks fine in one happy-path shell" bias:
- locale truth was under-proven
- docs/public assets were assumed readable
- mobile sharing looked implemented but was not compared against web truth

After Phase 6
=============
We now know:
- outward-facing consistency is not just a styling problem; route truth and content integrity are failing
- docs is the most visible public consistency weakness
- mobile share is functionally divergent from the real web product contract
```

## Regression Status

`REG-05` now exists as a frozen manual specification covering nine public/mobile/consistency cases.

It is not yet runnable because:

- no Playwright public-locale suite exists
- no Maestro mobile smoke suite exists
- deterministic locale/public/mobile fixtures are still manual
- open `BUG-0015`, `BUG-0016`, `BUG-0017`, `BUG-0018`, `BUG-0019`, and `BUG-0020` remain unresolved

## Open Risks

Most important remaining risks after this phase:

- public/mobile consistency regression coverage is still manual-only
- locale asset encoding integrity is not guarded by any validation gate

These remain tracked in `docs/qa/open-risk-register.md`.

## Gate Check

Phase 6 exit criteria required:

- no open P0 remains in public/mobile surfaces
- responsive and locale critical paths are reviewed
- mobile core flows have explicit evidence

Result:

- `PASS`

Reason:

- no Phase 6 `P0` defect was confirmed
- responsive and locale paths are now explicitly reviewed
- mobile core flows have explicit evidence
- carry-over defects remain, but they are `P1`-`P3` and are now fully classified

## Program-Level Caveat

Even though the Phase 6 scope gate passes, the overall program is still globally blocked by earlier open `P0` bugs, especially `BUG-0013` in Prompt Studio RBAC.

## Next Phase

Phase 7 shifts from feature surfaces into resilience:

- failure and recovery behavior
- performance and scale risk
- observability and operational runbooks
