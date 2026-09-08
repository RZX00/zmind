# Stable Baseline Bug Audit Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute the selected stable-baseline full-feature bug audit program for Zmind from March 13, 2026 through July 16, 2026, and close with a release-grade quality decision.

**Architecture:** Use the existing feature inventory as the source of truth, turn it into an audit matrix, build verification foundations before large-scale review, then execute domain waves in strict order: critical business flows -> core workspace flows -> support flows -> boundary flows -> public/mobile consistency -> resilience -> final closure.

**Tech Stack:** Next.js App Router, React, Expo React Native, FastAPI, Supabase, Docker Compose, pytest, future Playwright, future Mobile E2E, Markdown documentation, Git.

---

## Decision Record

- Selected by user on: `2026-03-13`
- Program mode: `Stable Baseline`
- Program start: `2026-03-13`
- Target close: `2026-07-16`
- Total duration: `18 weeks`
- Non-negotiable quality rule:
  - No open `P0`
  - No untriaged `P1`
  - Core paths must have durable regression coverage before closure

## Program Map

```text
18-Week Stable Baseline Roadmap
===============================

Week 01  -> Phase 0  审查章程与风险地图
Week 02  -> Phase 1  验证地基建设
Week 03  -> Phase 2  P0 主链路审查（上）
Week 04  -> Phase 2  P0 主链路审查（下）
Week 05  -> Phase 3  核心工作链审查（Dashboard / Workspace）
Week 06  -> Phase 3  核心工作链审查（Canvas）
Week 07  -> Phase 3  核心工作链审查（Doc / Thread）
Week 08  -> Phase 4  支撑工作链审查（Knowledge / Triggers）
Week 09  -> Phase 4  支撑工作链审查（Trash / Skills）
Week 10  -> Phase 4  支撑工作链审查（Credentials / Integrations）
Week 11  -> Phase 5  Team / Share / Admin 审查（Team）
Week 12  -> Phase 5  Team / Share / Admin 审查（Share）
Week 13  -> Phase 5  Team / Share / Admin 审查（Admin）
Week 14  -> Phase 6  Public / Mobile / 一致性审查（Public）
Week 15  -> Phase 6  Public / Mobile / 一致性审查（Mobile）
Week 16  -> Phase 6  Public / Mobile / 一致性审查（Responsive / Locale）
Week 17  -> Phase 7  非功能性强化
Week 18  -> Phase 8  总回归与收口
```

## Weekly Cadence

```text
Cadence
=======

Every Monday-equivalent phase kickoff:
  - Freeze weekly scope
  - Freeze target regression pack
  - Freeze target bug bucket

Mid-week:
  - Audit findings review
  - Fix lane alignment
  - Regression evidence review

End of week:
  - Weekly report
  - Gate decision
  - Carry-over decision
  - Commit docs + evidence index
```

## Global Program Outputs

Every week must update or produce:

- `docs/qa/feature-audit-matrix.md`
- `docs/qa/bug-register.md`
- `docs/qa/open-risk-register.md`
- `docs/qa/regression-status.md`
- `docs/reports/YYYY-MM-DD-<weekly-audit-report>.md`

If one weekly cycle ends without these artifacts, the week is not considered complete.

## Task 1: Week 01 / Phase 0 - Audit Charter and Risk Map

**Date:** `2026-03-13` to `2026-03-19`

**Files:**
- Read: `docs/reports/2026-03-12-feature-inventory-report.md`
- Create: `docs/qa/feature-audit-matrix.md`
- Create: `docs/qa/bug-severity-rubric.md`
- Create: `docs/qa/bug-lifecycle.md`
- Create: `docs/qa/evidence-template.md`
- Create: `docs/qa/bug-register.md`
- Create: `docs/qa/open-risk-register.md`
- Create: `docs/qa/regression-status.md`
- Create: `docs/reports/2026-03-13-phase0-audit-charter-report.md`

**Step 1: Convert feature inventory into audit units**

Break every real feature surface into audit units:
- entry
- module
- action
- state
- permission
- recovery

**Step 2: Tag risk and audit type**

For each audit unit, tag:
- severity potential
- business criticality
- requires automation
- requires multi-role testing
- requires multi-device testing
- requires data persistence testing

**Step 3: Define common bug language**

Write:
- severity rubric
- bug status lifecycle
- evidence template

**Step 4: Define weekly reporting format**

Create weekly report structure:
- scope
- findings summary
- open P0/P1
- blockers
- next-week carry-over

**Step 5: Exit gate**

Week 01 is done only when:
- all source pages are represented in the audit matrix
- every audit unit has a risk tag
- severity rubric is frozen
- evidence format is frozen

**What the product state looks like after Week 01**

- The audit is no longer vague.
- The team now has one source of truth for “what exactly must be checked.”
- Every future bug will be classified with the same language.

**Step 6: Commit**

```bash
git add docs/qa/feature-audit-matrix.md docs/qa/bug-severity-rubric.md docs/qa/bug-lifecycle.md docs/qa/evidence-template.md docs/qa/bug-register.md docs/qa/open-risk-register.md docs/qa/regression-status.md docs/reports/2026-03-13-phase0-audit-charter-report.md
git commit -m "docs(qa): complete phase0 audit charter"
```

## Task 2: Week 02 / Phase 1 - Verification Foundation

**Date:** `2026-03-20` to `2026-03-26`

**Files:**
- Read: `frontend/package.json`
- Read: `backend/pyproject.toml`
- Read: `apps/mobile/package.json`
- Create: `docs/qa/test-environment-matrix.md`
- Create: `docs/qa/test-data-plan.md`
- Create: `docs/qa/smoke-command-baseline.md`
- Create: `docs/qa/web-e2e-adoption-plan.md`
- Create: `docs/qa/mobile-e2e-adoption-plan.md`
- Create: `docs/reports/2026-03-26-phase1-verification-foundation-report.md`

**Step 1: Freeze standard environment**

Document exact startup and verification commands:

```bash
docker compose up -d --build
cd backend && uv run pytest -q
cd frontend && npm run lint
cd frontend && npm run type-check
cd apps/mobile && npm run lint
```

**Step 2: Define role and fixture matrix**

Freeze test identities:
- anonymous
- personal free
- personal paid
- team owner
- team member
- admin

Freeze fixture sets:
- canvas fixtures
- doc fixtures
- thread fixtures
- knowledge fixtures
- trigger fixtures
- invite/share fixtures

**Step 3: Define Web E2E adoption path**

Write:
- framework choice
- auth strategy
- seeded data strategy
- artifact capture strategy
- CI strategy

**Step 4: Define Mobile E2E adoption path**

Write:
- framework choice
- device matrix
- fixture strategy
- recording and trace standards

**Step 5: Exit gate**

Week 02 is done only when:
- environment matrix is frozen
- smoke baseline commands are frozen
- Web E2E adoption path is approved
- Mobile E2E adoption path is approved

**What the product state looks like after Week 02**

- The audit has a real execution substrate.
- Future findings can become permanent regression assets instead of one-time notes.

**Step 6: Commit**

```bash
git add docs/qa/test-environment-matrix.md docs/qa/test-data-plan.md docs/qa/smoke-command-baseline.md docs/qa/web-e2e-adoption-plan.md docs/qa/mobile-e2e-adoption-plan.md docs/reports/2026-03-26-phase1-verification-foundation-report.md
git commit -m "docs(qa): complete phase1 verification foundation"
```

## Task 3: Weeks 03-04 / Phase 2 - P0 Critical Flow Audit

**Date:** `2026-03-27` to `2026-04-09`

**Files:**
- Create: `docs/qa/audits/p0-auth-audit.md`
- Create: `docs/qa/audits/p0-invite-activation-audit.md`
- Create: `docs/qa/audits/p0-billing-credits-audit.md`
- Create: `docs/qa/audits/p0-permission-boundary-audit.md`
- Create: `docs/qa/regression/p0-critical-regression-pack.md`
- Create: `docs/reports/2026-04-09-phase2-p0-critical-flow-report.md`

**Step 1: Week 03 focus**

Audit:
- auth
- reset password
- phone verification
- invite redeem
- team invitation accept

**Step 2: Week 04 focus**

Audit:
- subscription
- credit balance
- purchase flow
- pending payment
- public/private permission boundaries
- owner/member boundaries

**Step 3: Build P0 regression pack**

Every confirmed P0 fix candidate must map to a regression case.

**Step 4: Exit gate**

Phase 2 is done only when:
- no unreviewed P0 remains in auth/invite/billing/permission
- all P0 findings are triaged
- critical regression pack exists and is runnable

**What the product state looks like after Phase 2**

- The product’s access, billing, and permission backbone becomes trustworthy.
- The system stops bleeding in the most business-critical places.

**Step 5: Commit**

```bash
git add docs/qa/audits/p0-auth-audit.md docs/qa/audits/p0-invite-activation-audit.md docs/qa/audits/p0-billing-credits-audit.md docs/qa/audits/p0-permission-boundary-audit.md docs/qa/regression/p0-critical-regression-pack.md docs/reports/2026-04-09-phase2-p0-critical-flow-report.md
git commit -m "docs(qa): complete phase2 p0 critical flow audit"
```

## Task 4: Weeks 05-07 / Phase 3 - Core Workspace Audit

**Date:** `2026-04-10` to `2026-04-30`

**Files:**
- Create: `docs/qa/audits/dashboard-audit.md`
- Create: `docs/qa/audits/workspace-audit.md`
- Create: `docs/qa/audits/canvas-deep-audit.md`
- Create: `docs/qa/audits/doc-deep-audit.md`
- Create: `docs/qa/audits/thread-deep-audit.md`
- Create: `docs/qa/regression/core-workspace-regression-pack.md`
- Create: `docs/reports/2026-04-30-phase3-core-workspace-report.md`

**Step 1: Week 05 focus**

Audit:
- dashboard
- workspace create/open/search/move/delete flows
- sidebar and scope switching

**Step 2: Week 06 focus**

Audit Canvas deeply:
- title editing
- node creation/editing
- connections/groups
- AI panel
- invite/share
- outline
- playback
- screenshot
- draft recovery
- switch guard

**Step 3: Week 07 focus**

Audit:
- doc autosave
- doc AI
- thread stream state
- optimistic state
- file preview/download
- CTA replay/retry/cancel

**Step 4: Exit gate**

Phase 3 is done only when:
- no open P0 remains on Dashboard/Workspace/Canvas/Doc/Thread
- core workspace regression pack exists
- all major save/recovery flows are explicitly verified

**What the product state looks like after Phase 3**

- The actual daily work surfaces become stable, not just accessible.
- The most complex stateful pages stop being opaque risk clusters.

**Step 5: Commit**

```bash
git add docs/qa/audits/dashboard-audit.md docs/qa/audits/workspace-audit.md docs/qa/audits/canvas-deep-audit.md docs/qa/audits/doc-deep-audit.md docs/qa/audits/thread-deep-audit.md docs/qa/regression/core-workspace-regression-pack.md docs/reports/2026-04-30-phase3-core-workspace-report.md
git commit -m "docs(qa): complete phase3 core workspace audit"
```

## Task 5: Weeks 08-10 / Phase 4 - Support Surface Audit

**Date:** `2026-05-01` to `2026-05-21`

**Files:**
- Create: `docs/qa/audits/knowledge-audit.md`
- Create: `docs/qa/audits/triggers-audit.md`
- Create: `docs/qa/audits/trash-audit.md`
- Create: `docs/qa/audits/skills-audit.md`
- Create: `docs/qa/audits/credentials-audit.md`
- Create: `docs/qa/audits/integrations-audit.md`
- Create: `docs/qa/regression/support-surface-regression-pack.md`
- Create: `docs/reports/2026-05-21-phase4-support-surface-report.md`

**Step 1: Week 08 focus**

Audit:
- knowledge base
- triggers

**Step 2: Week 09 focus**

Audit:
- trash
- skills marketplace

**Step 3: Week 10 focus**

Audit:
- credentials
- obsidian
- openclaw

**Step 4: Exit gate**

Phase 4 is done only when:
- support surfaces have no open P0
- high-frequency support flows have smoke coverage
- integration role gates are reviewed

**What the product state looks like after Phase 4**

- Deep usage becomes meaningfully safer.
- Peripheral workflows stop degrading trust in the product.

**Step 5: Commit**

```bash
git add docs/qa/audits/knowledge-audit.md docs/qa/audits/triggers-audit.md docs/qa/audits/trash-audit.md docs/qa/audits/skills-audit.md docs/qa/audits/credentials-audit.md docs/qa/audits/integrations-audit.md docs/qa/regression/support-surface-regression-pack.md docs/reports/2026-05-21-phase4-support-surface-report.md
git commit -m "docs(qa): complete phase4 support surface audit"
```

## Task 6: Weeks 11-13 / Phase 5 - Team, Share, and Admin Audit

**Date:** `2026-05-22` to `2026-06-11`

**Files:**
- Create: `docs/qa/audits/team-settings-audit.md`
- Create: `docs/qa/audits/team-member-invite-audit.md`
- Create: `docs/qa/audits/share-canvas-audit.md`
- Create: `docs/qa/audits/share-thread-audit.md`
- Create: `docs/qa/audits/admin-audit-surface-audit.md`
- Create: `docs/qa/security/permission-boundary-matrix.md`
- Create: `docs/reports/2026-06-11-phase5-boundary-surface-report.md`

**Step 1: Week 11 focus**

Audit:
- team settings
- team members
- team invitations
- role transfer / owner boundaries

**Step 2: Week 12 focus**

Audit:
- share canvas
- share thread
- invalid and expired share states
- public exposure boundaries

**Step 3: Week 13 focus**

Audit:
- admin audit
- admin billing
- admin invites
- prompt studio

**Step 4: Exit gate**

Phase 5 is done only when:
- team/share/admin have no open P0
- public exposure boundaries are documented
- owner/member/admin/public matrices are reviewed

**What the product state looks like after Phase 5**

- Low-frequency but high-damage bugs are no longer hiding in org and public surfaces.
- Permission confidence increases sharply.

**Step 5: Commit**

```bash
git add docs/qa/audits/team-settings-audit.md docs/qa/audits/team-member-invite-audit.md docs/qa/audits/share-canvas-audit.md docs/qa/audits/share-thread-audit.md docs/qa/audits/admin-audit-surface-audit.md docs/qa/security/permission-boundary-matrix.md docs/reports/2026-06-11-phase5-boundary-surface-report.md
git commit -m "docs(qa): complete phase5 boundary audit"
```

## Task 7: Weeks 14-16 / Phase 6 - Public, Mobile, and Consistency Audit

**Date:** `2026-06-12` to `2026-07-02`

**Files:**
- Create: `docs/qa/audits/public-home-pricing-audit.md`
- Create: `docs/qa/audits/public-content-surface-audit.md`
- Create: `docs/qa/audits/mobile-core-audit.md`
- Create: `docs/qa/audits/mobile-panel-modal-audit.md`
- Create: `docs/qa/audits/responsive-consistency-audit.md`
- Create: `docs/qa/audits/locale-consistency-audit.md`
- Create: `docs/reports/2026-07-02-phase6-public-mobile-consistency-report.md`

**Step 1: Week 14 focus**

Audit:
- home
- pricing
- tutorials
- changelog
- legal
- docs

**Step 2: Week 15 focus**

Audit mobile:
- auth gate
- project switching
- message send/cancel
- tool timeline
- settings/share/delete actions

**Step 3: Week 16 focus**

Audit:
- responsive breakpoints
- locale wrappers vs source pages
- desktop/mobile parity on key flows

**Step 4: Exit gate**

Phase 6 is done only when:
- no open P0 remains in public/mobile surfaces
- responsive and locale critical paths are reviewed
- mobile core flows have explicit evidence

**What the product state looks like after Phase 6**

- Outward-facing quality becomes consistent.
- The product no longer looks stable only on one screen class.

**Step 5: Commit**

```bash
git add docs/qa/audits/public-home-pricing-audit.md docs/qa/audits/public-content-surface-audit.md docs/qa/audits/mobile-core-audit.md docs/qa/audits/mobile-panel-modal-audit.md docs/qa/audits/responsive-consistency-audit.md docs/qa/audits/locale-consistency-audit.md docs/reports/2026-07-02-phase6-public-mobile-consistency-report.md
git commit -m "docs(qa): complete phase6 public mobile consistency audit"
```

## Task 8: Week 17 / Phase 7 - Resilience and Recovery Hardening

**Date:** `2026-07-03` to `2026-07-09`

**Files:**
- Create: `docs/qa/audits/resilience-recovery-audit.md`
- Create: `docs/qa/performance/performance-risk-list.md`
- Create: `docs/qa/operations/recovery-runbook.md`
- Create: `docs/reports/2026-07-09-phase7-resilience-report.md`

**Step 1: Review performance and scale stress**

Target:
- large canvas
- long doc
- long thread

**Step 2: Review failure and recovery**

Target:
- offline/reconnect
- reload
- retry
- autosave recovery
- switch interruption

**Step 3: Review observability**

Define:
- critical logs
- breadcrumbs
- runbook paths

**Step 4: Exit gate**

Week 17 is done only when:
- recovery flows are documented
- major resilience risks are enumerated
- critical non-functional gaps have an owner

**What the product state looks like after Week 17**

- Failures become manageable instead of mysterious.
- Release confidence is based on operational reality, not just happy-path testing.

**Step 5: Commit**

```bash
git add docs/qa/audits/resilience-recovery-audit.md docs/qa/performance/performance-risk-list.md docs/qa/operations/recovery-runbook.md docs/reports/2026-07-09-phase7-resilience-report.md
git commit -m "docs(qa): complete phase7 resilience review"
```

## Task 9: Week 18 / Phase 8 - Full Regression and Program Closure

**Date:** `2026-07-10` to `2026-07-16`

**Files:**
- Create: `docs/qa/release/final-release-gate.md`
- Create: `docs/qa/release/known-risk-register.md`
- Create: `docs/qa/release/next-cycle-quality-backlog.md`
- Create: `docs/reports/2026-07-16-final-full-feature-audit-report.md`

**Step 1: Run the full regression pack**

Run:
- backend regression
- frontend integrity checks
- web critical regression
- mobile critical regression
- manual spot checks on all waived items

**Step 2: Triage remaining findings**

Classify:
- must fix now
- acceptable waiver
- next-cycle backlog

**Step 3: Decide release gate**

Allowed outputs:
- `GO`
- `CONDITIONAL GO`
- `NO GO`

**Step 4: Exit gate**

The program closes only when:
- no open P0 remains
- no untriaged P1 remains
- final release gate exists
- known risks are explicit
- next-cycle backlog is explicit

**What the product state looks like after Week 18**

- The product has a release-grade, evidence-backed quality conclusion.
- Future versions can run incremental audits instead of restarting from zero.

**Step 5: Commit**

```bash
git add docs/qa/release/final-release-gate.md docs/qa/release/known-risk-register.md docs/qa/release/next-cycle-quality-backlog.md docs/reports/2026-07-16-final-full-feature-audit-report.md
git commit -m "docs(qa): close stable baseline bug audit program"
```

## Program Governance Rules

```text
Governance
==========

Rule 1
  No phase closes without a written gate decision.

Rule 2
  No P0 fix is considered real until regression evidence exists.

Rule 3
  No bug can move to verified without exact repro evidence.

Rule 4
  Every phase must end with a commit containing only that phase's artifacts.

Rule 5
  Carry-over scope must be explicit; silent spillover is not allowed.
```

## Stable Baseline Success Criteria

- By `2026-04-09`, business-critical access and billing flows are controlled.
- By `2026-04-30`, workspace/core editor surfaces are controlled.
- By `2026-05-21`, support surfaces are controlled.
- By `2026-06-11`, permission and public boundary surfaces are controlled.
- By `2026-07-02`, public/mobile/consistency blind spots are removed.
- By `2026-07-16`, the full product has a release-grade quality closure decision.
