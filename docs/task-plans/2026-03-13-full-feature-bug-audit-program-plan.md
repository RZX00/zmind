# Full Feature Bug Audit Program Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and execute a full-feature bug audit program for Zmind that covers every real user-facing feature, creates durable regression coverage, and closes with a release-grade quality gate.

**Architecture:** Start from the existing feature inventory report, convert it into an audit matrix, then build verification foundations before moving into domain-by-domain deep review. Use a phased quality pipeline: audit charter -> verification baseline -> critical-flow review -> core-surface review -> support-surface review -> boundary review -> resilience -> final closure.

**Tech Stack:** Next.js App Router, React, Expo React Native, FastAPI, Supabase, Docker Compose, pytest, lint/type-check baselines, future Web E2E, future Mobile E2E, Markdown documentation.

---

## Program Overview

```text
Execution Program
=================

Task 1  -> 审查对象矩阵化
Task 2  -> 验证基线建设
Task 3  -> P0 主链路审查
Task 4  -> 核心工作链审查
Task 5  -> 支撑能力审查
Task 6  -> Team/Share/Admin 审查
Task 7  -> Public/Mobile/终端一致性审查
Task 8  -> 非功能性强化
Task 9  -> 全域回归与收口
```

## Recommended Schedule

- Kickoff: `2026-03-13`
- Recommended closure target: `2026-07-16`
- Recommended duration: `18 weeks`

## Task 1: Build the audit charter and audit matrix

**Files:**
- Read: `docs/reports/2026-03-12-feature-inventory-report.md`
- Create: `docs/qa/feature-audit-matrix.md`
- Create: `docs/qa/bug-severity-rubric.md`
- Create: `docs/qa/bug-lifecycle.md`
- Create: `docs/qa/evidence-template.md`
- Create: `docs/reports/2026-03-13-audit-risk-map.md`

**Step 1: Convert the feature inventory into audit units**

Transform each real source page into audit units:
- entry
- module
- action
- state
- permission
- recovery

**Step 2: Add risk ranking**

For each audit unit, tag:
- `P0`
- `P1`
- `P2`
- `P3`

Also tag:
- requires automation
- requires multi-role validation
- requires multi-device validation
- requires data recovery validation

**Step 3: Define the bug rubric**

Document severity rules and examples:
- data loss
- permission leak
- broken billing
- broken share links
- editor corruption

**Step 4: Define evidence standards**

Every bug must require:
- reproduction steps
- expected result
- actual result
- environment
- version / commit
- screenshot or recording

**Step 5: Commit**

```bash
git add docs/qa/feature-audit-matrix.md docs/qa/bug-severity-rubric.md docs/qa/bug-lifecycle.md docs/qa/evidence-template.md docs/reports/2026-03-13-audit-risk-map.md
git commit -m "docs(qa): define audit charter and bug rubric"
```

## Task 2: Build the verification baseline

**Files:**
- Read: `frontend/package.json`
- Read: `backend/pyproject.toml`
- Read: `apps/mobile/package.json`
- Create: `docs/qa/test-environment-matrix.md`
- Create: `docs/qa/test-data-plan.md`
- Create: `docs/qa/smoke-command-baseline.md`
- Create: `docs/qa/web-e2e-adoption-plan.md`
- Create: `docs/qa/mobile-e2e-adoption-plan.md`

**Step 1: Freeze baseline commands**

Define standard commands:

```bash
docker compose up -d --build
cd backend && uv run pytest -q
cd frontend && npm run lint
cd frontend && npm run type-check
cd apps/mobile && npm run lint
```

**Step 2: Define role/data matrix**

Create a stable set of test accounts:
- personal user
- paid user
- owner
- member
- admin
- public anonymous

Create stable fixture data for:
- canvas
- doc
- thread
- knowledge files
- triggers
- invites
- share links

**Step 3: Plan Web E2E adoption**

Define:
- framework
- environment boot
- storage state/auth strategy
- artifact capture
- CI strategy

**Step 4: Plan Mobile E2E adoption**

Define:
- framework
- device matrix
- fixture strategy
- recording strategy

**Step 5: Commit**

```bash
git add docs/qa/test-environment-matrix.md docs/qa/test-data-plan.md docs/qa/smoke-command-baseline.md docs/qa/web-e2e-adoption-plan.md docs/qa/mobile-e2e-adoption-plan.md
git commit -m "docs(qa): define verification baseline"
```

## Task 3: Audit P0 critical business flows

**Files:**
- Create: `docs/qa/audits/p0-auth-billing-permission.md`
- Create: `docs/qa/bugs/p0-critical-bug-register.md`
- Create: `docs/qa/regression/p0-critical-regression-pack.md`

**Step 1: Audit Auth and invitation flows**

Review:
- auth
- reset password
- phone verification
- invite redeem
- team invitation accept

**Step 2: Audit billing and credits**

Review:
- subscription state
- credit balance
- purchase flow
- pending payment
- redeem flow

**Step 3: Audit permission boundaries**

Review:
- owner vs member
- authenticated vs anonymous
- personal vs team scope
- public share exposure

**Step 4: Build P0 regression cases**

Convert every fixed P0 into regression coverage.

**Step 5: Commit**

```bash
git add docs/qa/audits/p0-auth-billing-permission.md docs/qa/bugs/p0-critical-bug-register.md docs/qa/regression/p0-critical-regression-pack.md
git commit -m "docs(qa): complete p0 critical flow audit"
```

## Task 4: Audit the core workspace chain

**Files:**
- Create: `docs/qa/audits/dashboard-workspace-audit.md`
- Create: `docs/qa/audits/canvas-deep-audit.md`
- Create: `docs/qa/audits/doc-deep-audit.md`
- Create: `docs/qa/audits/thread-deep-audit.md`
- Create: `docs/qa/bugs/core-workspace-bug-register.md`

**Step 1: Audit Dashboard**

Review:
- quick input
- prompt injection
- entry-to-canvas
- invite success state

**Step 2: Audit Workspace**

Review:
- create/open/rename/delete/move/search
- folder behavior
- sidebar behavior
- scope switching

**Step 3: Audit Canvas deeply**

Review:
- title editing
- node creation/editing
- connections/groups
- AI panel
- share/invite
- playback
- screenshot
- outline
- draft recovery
- switch guard

**Step 4: Audit Doc and Thread deeply**

Review:
- autosave
- upload
- inline AI
- stream state
- optimistic state
- CTA actions
- file preview/download

**Step 5: Commit**

```bash
git add docs/qa/audits/dashboard-workspace-audit.md docs/qa/audits/canvas-deep-audit.md docs/qa/audits/doc-deep-audit.md docs/qa/audits/thread-deep-audit.md docs/qa/bugs/core-workspace-bug-register.md
git commit -m "docs(qa): complete core workspace audit"
```

## Task 5: Audit support surfaces

**Files:**
- Create: `docs/qa/audits/knowledge-audit.md`
- Create: `docs/qa/audits/triggers-audit.md`
- Create: `docs/qa/audits/trash-audit.md`
- Create: `docs/qa/audits/skills-audit.md`
- Create: `docs/qa/audits/integrations-audit.md`
- Create: `docs/qa/bugs/support-surface-bug-register.md`

**Step 1: Audit Knowledge Base**

Review:
- upload
- preview
- summary edit
- folder operations
- drag/drop move

**Step 2: Audit Triggers and Trash**

Review:
- trigger creation and detail routing
- trash restore/delete/batch actions

**Step 3: Audit Skills and integrations**

Review:
- marketplace install
- installed filter
- credentials refresh
- obsidian/export jobs
- openclaw permissions

**Step 4: Commit**

```bash
git add docs/qa/audits/knowledge-audit.md docs/qa/audits/triggers-audit.md docs/qa/audits/trash-audit.md docs/qa/audits/skills-audit.md docs/qa/audits/integrations-audit.md docs/qa/bugs/support-surface-bug-register.md
git commit -m "docs(qa): complete support surface audit"
```

## Task 6: Audit Team, Share, and Admin boundaries

**Files:**
- Create: `docs/qa/audits/team-boundary-audit.md`
- Create: `docs/qa/audits/share-boundary-audit.md`
- Create: `docs/qa/audits/admin-boundary-audit.md`
- Create: `docs/qa/security/public-exposure-checklist.md`
- Create: `docs/qa/bugs/boundary-bug-register.md`

**Step 1: Audit Team scope**

Review:
- team settings
- members
- invitations
- role transitions
- scope segregation

**Step 2: Audit public share**

Review:
- share canvas
- share thread
- read-only boundaries
- invalid link behavior

**Step 3: Audit admin**

Review:
- audit tables
- billing admin
- invites admin
- prompt studio

**Step 4: Commit**

```bash
git add docs/qa/audits/team-boundary-audit.md docs/qa/audits/share-boundary-audit.md docs/qa/audits/admin-boundary-audit.md docs/qa/security/public-exposure-checklist.md docs/qa/bugs/boundary-bug-register.md
git commit -m "docs(qa): complete team share admin audit"
```

## Task 7: Audit Public, Mobile, and consistency layers

**Files:**
- Create: `docs/qa/audits/public-surface-audit.md`
- Create: `docs/qa/audits/mobile-surface-audit.md`
- Create: `docs/qa/audits/responsive-locale-audit.md`
- Create: `docs/qa/bugs/public-mobile-bug-register.md`

**Step 1: Audit public pages**

Review:
- home
- pricing
- tutorials
- changelog
- legal
- docs

**Step 2: Audit mobile**

Review:
- auth gate
- panel switching
- chat send/cancel
- tool timeline
- share/delete/settings

**Step 3: Audit consistency**

Review:
- locale wrappers
- responsive layouts
- desktop/mobile parity on key behaviors

**Step 4: Commit**

```bash
git add docs/qa/audits/public-surface-audit.md docs/qa/audits/mobile-surface-audit.md docs/qa/audits/responsive-locale-audit.md docs/qa/bugs/public-mobile-bug-register.md
git commit -m "docs(qa): complete public mobile consistency audit"
```

## Task 8: Run resilience and recovery review

**Files:**
- Create: `docs/qa/audits/resilience-recovery-audit.md`
- Create: `docs/qa/performance/performance-risk-list.md`
- Create: `docs/qa/operations/recovery-runbook.md`

**Step 1: Review large-object and long-session behavior**

Target:
- canvas
- doc
- thread

**Step 2: Review failure and recovery**

Target:
- offline/reconnect
- reload
- autosave recovery
- retry behaviors

**Step 3: Review observability**

Define:
- critical logs
- failure breadcrumbs
- error triage path

**Step 4: Commit**

```bash
git add docs/qa/audits/resilience-recovery-audit.md docs/qa/performance/performance-risk-list.md docs/qa/operations/recovery-runbook.md
git commit -m "docs(qa): complete resilience and recovery review"
```

## Task 9: Close the program with full regression and release gate

**Files:**
- Create: `docs/reports/2026-07-16-final-full-feature-audit-report.md`
- Create: `docs/qa/release/final-release-gate.md`
- Create: `docs/qa/release/known-risk-register.md`
- Create: `docs/qa/release/next-cycle-quality-backlog.md`

**Step 1: Run full regression**

Execute:
- backend regression
- frontend integrity checks
- web e2e critical pack
- mobile e2e critical pack
- manual spot checks on waived areas

**Step 2: Triage remaining bugs**

Classify:
- must fix now
- acceptable waiver
- move to next cycle

**Step 3: Decide release gate**

Allowed outcomes:
- `GO`
- `CONDITIONAL GO`
- `NO GO`

**Step 4: Commit**

```bash
git add docs/reports/2026-07-16-final-full-feature-audit-report.md docs/qa/release/final-release-gate.md docs/qa/release/known-risk-register.md docs/qa/release/next-cycle-quality-backlog.md
git commit -m "docs(qa): close full feature audit program"
```

## Program Exit Criteria

```text
Program is done only when:
1. All audit units have status
2. No open P0 remains
3. No untriaged P1 remains
4. Core paths have repeatable regression coverage
5. Permission/share/admin boundaries are verified
6. Mobile/public/locale consistency has been reviewed
7. Recovery runbook exists
8. Final release gate is signed off
```

