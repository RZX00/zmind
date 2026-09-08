# Feature Inventory Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Produce a complete page-by-page feature inventory report for Zmind, decomposed down to user-visible actions, page entry points, state transitions, and route wrappers.

**Architecture:** Audit the Next.js App Router and Expo mobile entry points first, distinguish real pages from wrapper and redirect routes, then inspect the source components behind each real surface. Consolidate the result into one report that uses ASCII structure diagrams plus Mermaid flow diagrams.

**Tech Stack:** Next.js App Router, React, Expo React Native, Supabase, React Query, Markdown documentation.

---

## Scope Rules

```text
Inventory granularity
--------------------
1. Page level
2. Page-internal module level
3. User action level
4. System reaction level
5. State / loading / empty / error level
6. Navigation / share / copy / open-page level
7. Wrapper / redirect route level

Not expanded as standalone pages
--------------------------------
- Pure backend infrastructure without a direct UI entry
- Internal helper functions without user-visible behavior
- Duplicate locale wrappers that only forward to the same source page
```

## Execution Flow

```text
[Route audit]
    |
    v
[Classify real / wrapper / redirect]
    |
    v
[Inspect source pages and high-complexity components]
    |
    v
[Normalize to one inventory template]
    |
    v
[Write report with ASCII + Mermaid]
```

### Task 1: Build the route inventory

**Files:**
- Inspect: `frontend/src/app/**/*page.tsx`
- Inspect: `apps/mobile/app/**/*`
- Output: `docs/reports/2026-03-12-feature-inventory-report.md`

**Step 1: Enumerate all route files**

Run a route scan for web and mobile entry points and classify each route file as:
- `real`
- `wrapper`
- `redirect`

**Step 2: Remove duplicate thinking early**

Normalize route coverage by mapping:
- locale wrappers -> source page
- team wrappers -> source page or scoped variant
- redirects -> target page

**Step 3: Freeze the coverage list**

Use the normalized list as the single source of truth for the report outline.

### Task 2: Inspect source pages behind each route group

**Files:**
- Inspect: `frontend/src/components/dashboard/dashboard-content.tsx`
- Inspect: `frontend/src/components/workspace/WorkspaceHomePage.tsx`
- Inspect: `frontend/src/canvas/components/core/CanvasEditor.tsx`
- Inspect: `frontend/src/components/docs/DocEditorShell.tsx`
- Inspect: `frontend/src/components/thread/ThreadComponent.tsx`
- Inspect: `frontend/src/components/knowledge-base/knowledge-base-manager.tsx`
- Inspect: `frontend/src/components/triggers/triggers-page.tsx`
- Inspect: `frontend/src/components/pricing/PricingPageClient.tsx`
- Inspect: `frontend/src/components/skills-marketplace/SkillsMarketplacePage.tsx`
- Inspect: `frontend/src/components/integrations/**/*`
- Inspect: `frontend/src/components/admin/**/*`
- Inspect: `apps/mobile/components/**/*`

**Step 1: Identify visible modules**

For each source page, record the visible modules and major modal/panel surfaces.

**Step 2: Break features into action-level units**

For each module, capture:
- open page
- create
- edit
- copy
- share
- delete
- restore
- search
- filter
- switch mode
- open modal
- open external link

**Step 3: Capture state behavior**

Record:
- loading
- empty
- error
- success
- restricted / permission-gated
- deep link / query param behavior

### Task 3: Write the report

**Files:**
- Create: `docs/reports/2026-03-12-feature-inventory-report.md`

**Step 1: Write the overview**

Include:
- scope
- counting method
- route statistics
- product surface map

**Step 2: Write the architecture visuals**

Include:
- one ASCII product topology
- one Mermaid route flow
- one Mermaid source-to-wrapper relationship diagram

**Step 3: Write the detailed page-by-page inventory**

For each page group, use a consistent structure:
- source route
- wrapper / alias route
- module tree
- functional breakdown
- state and exception handling
- navigation outputs
- key dependencies

**Step 4: Write appendices**

Append:
- redirect route list
- wrapper route list
- coverage notes and assumptions

### Task 4: Review and verify

**Files:**
- Verify: `docs/task-plans/2026-03-12-feature-inventory-report-plan.md`
- Verify: `docs/reports/2026-03-12-feature-inventory-report.md`

**Step 1: Review completeness**

Confirm every major route group is covered:
- public
- auth
- dashboard
- workspace
- canvas
- doc
- thread
- knowledge
- triggers
- billing
- settings
- team
- admin
- share
- mobile

**Step 2: Review route classification**

Confirm redirect and wrapper appendices match the scanned route list.

**Step 3: Review presentation**

Confirm the report includes both:
- ASCII diagrams
- Mermaid diagrams

**Step 4: Check workspace hygiene**

Ensure no temporary cache artifacts were created as part of this audit.

