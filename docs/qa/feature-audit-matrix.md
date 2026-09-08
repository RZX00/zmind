# Zmind Feature Audit Matrix

> Phase 0 owner document  
> Last updated: 2026-03-13  
> Source baseline: `docs/reports/2026-03-12-feature-inventory-report.md`

---

## 1. Purpose

This matrix converts the feature inventory into audit-ready units.

Every row in this document must answer:

- What surface is being audited
- What must be checked
- What can go wrong
- How critical it is
- Whether it needs automation
- Whether it needs multi-role or multi-device coverage

If a surface is not in this matrix, it is out of audit scope by accident, not by design.

---

## 2. Audit Model

```text
Audit Unit
==========

Surface
  A real user-facing page, panel, modal, or flow owner

Audit unit
  The minimum review object for quality tracking:
  - entry
  - module
  - action
  - state
  - permission
  - recovery

Required checks
  1. Can user enter?
  2. Can user complete core action?
  3. Is result correct?
  4. Is failure handled?
  5. Is refresh/reopen state correct?
  6. Is scope/role correct?
  7. Is recovery possible?
```

## 3. Risk Tags

| Tag | Meaning |
|---|---|
| `SeverityPotential` | Highest plausible severity if broken |
| `BusinessCriticality` | How central the surface is to product value |
| `AutomationPriority` | How strongly the surface should receive automated regression |
| `RoleMatrix` | Whether owner/member/admin/public variance must be checked |
| `DeviceMatrix` | Whether desktop/mobile/responsive variance must be checked |
| `PersistenceRisk` | Whether save/reload/recovery/state durability must be checked |
| `AuditWave` | Planned review phase |

Legend:

- `SeverityPotential`: `P0` / `P1` / `P2` / `P3`
- `BusinessCriticality`: `Critical` / `High` / `Medium` / `Low`
- `AutomationPriority`: `Must` / `High` / `Medium` / `Low`
- `RoleMatrix`: `Y` / `N`
- `DeviceMatrix`: `Desktop`, `Mobile`, `Both`
- `PersistenceRisk`: `High` / `Medium` / `Low`

---

## 4. Surface Matrix

### 4.1 Public Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `PUB-01` | Home | CTA routing, template open, pricing switch, FAQ toggle | wrong route, broken CTA, misleading content | P1 | High | High | N | Both | Low | Phase 6 |
| `PUB-02` | Pricing | plan compare, billing period switch, checkout entry | broken conversion, wrong pricing display | P1 | High | High | N | Both | Low | Phase 6 |
| `PUB-03` | Changelog | entry render, external links, media render | broken external proof, content regression | P3 | Low | Low | N | Both | Low | Phase 6 |
| `PUB-04` | Tutorials | chapter nav, embed activation, fallback state | dead demo, blocked onboarding | P2 | Medium | Medium | N | Both | Low | Phase 6 |
| `PUB-05` | Legal | tab query sync, markdown load, locale variant | wrong legal content, broken query state | P2 | Medium | Medium | N | Both | Low | Phase 6 |
| `PUB-06` | Docs | redirect, navigation, content page render | broken docs entry, bad locale mirror | P3 | Low | Low | N | Both | Low | Phase 6 |
| `PUB-07` | Enterprise relay | soft redirect, manual fallback CTA | stale marketing path | P3 | Low | Low | N | Both | Low | Phase 6 |

### 4.2 Auth and Access Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `ACC-01` | Auth | sign in, sign up, Google OAuth, forgot password, returnUrl | lockout, auth loop, redirect break | P0 | Critical | Must | N | Both | Medium | Phase 2 |
| `ACC-02` | Reset password | token validate, new password, confirm, success return | lockout, reset failure | P0 | Critical | Must | N | Both | Low | Phase 2 |
| `ACC-03` | Phone verification | enroll, send OTP, resend, verify, unenroll | auth hard stop, second-factor break | P1 | High | High | N | Both | Low | Phase 2 |
| `ACC-04` | Invite / Activate Trial | auth redirect, code redeem, QR load, maintenance gate | lost conversion, wrong credit state | P0 | Critical | Must | N | Both | Medium | Phase 2 |
| `ACC-05` | Team invitation accept | token lookup, auto-accept, member redirect, invalid state | blocked team onboarding, wrong team access | P0 | Critical | Must | Y | Both | Medium | Phase 2 |

### 4.3 Core Workspace Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `CORE-01` | Dashboard | quick prompt, attachment handoff, invite success, embedded cards | broken entry into core workflow | P1 | Critical | Must | Y | Both | Medium | Phase 3 |
| `CORE-02` | Workspace | create/open/search/move/rename/delete, sidebar state | object loss, navigation dead-end | P0 | Critical | Must | Y | Both | High | Phase 3 |
| `CORE-03` | Canvas editor shell | hydration, load error, focus deep link, switch guard | editor unavailable, wrong object open | P0 | Critical | Must | Y | Both | High | Phase 3 |
| `CORE-04` | Canvas top bar | title edit, search, invite/share, playback, screenshot, panel toggle | wrong save state, broken sharing | P1 | High | High | Y | Both | Medium | Phase 3 |
| `CORE-05` | Canvas left toolbar | mode switch, create nodes, style controls | content creation failure | P1 | High | High | N | Desktop | Medium | Phase 3 |
| `CORE-06` | Canvas AI panel | thread create, send, queue, session history, stop, CTA replay | AI workflow dead, state desync | P0 | Critical | Must | Y | Both | High | Phase 3 |
| `CORE-07` | Canvas outline | jump, edit title, toggle todo, relation drawer | wrong navigation or hidden state corruption | P2 | Medium | Medium | N | Desktop | Medium | Phase 3 |
| `CORE-08` | Canvas playback and screenshot | play state, overlay hide, capture output | broken presentation/export | P2 | Medium | Medium | N | Both | Low | Phase 3 |
| `CORE-09` | Canvas draft recovery | restore, discard, post-reload state | data loss | P0 | Critical | Must | N | Both | High | Phase 3 |
| `CORE-10` | Doc editor | load, autosave, upload image, AI mutate, panel state | data loss, content corruption | P0 | Critical | Must | Y | Both | High | Phase 3 |
| `CORE-11` | Project thread | send, optimistic state, stream, retry, file preview, CTA replay | task execution unusable | P0 | Critical | Must | Y | Both | High | Phase 3 |
| `CORE-12` | Explore | listed canvases, pagination, open share page | broken discoverability | P2 | Medium | Medium | N | Both | Low | Phase 4 |
| `CORE-13` | Knowledge base | upload, folder ops, preview, summary edit, drag move | knowledge corruption, unusable retrieval | P1 | High | High | Y | Both | High | Phase 4 |
| `CORE-14` | Triggers | load, create, deep link, responsive detail panel | automation setup failure | P1 | High | High | Y | Both | Medium | Phase 4 |
| `CORE-15` | Trash | search, sort, restore, hard delete, batch action | accidental permanent loss | P1 | High | High | Y | Both | High | Phase 4 |
| `CORE-16` | Subscription | plan state, credits, purchase modal, transactions | wrong billing state | P0 | Critical | Must | Y | Both | Medium | Phase 2 |

### 4.4 Settings and Integration Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `SET-01` | Personal settings | load account, rename account | profile write failure | P2 | Medium | Low | Y | Both | Low | Phase 4 |
| `SET-02` | Local env manager | load secrets, add/delete draft row, save, duplicate check | local config corruption, secret visibility issue | P1 | Medium | Medium | N | Desktop | Medium | Phase 4 |
| `SET-03` | Teams list | load teams, role badge, manage link | wrong org navigation | P2 | Medium | Low | Y | Both | Low | Phase 4 |
| `SET-04` | Skills marketplace | search, install, import, filter installed, detail modal | skill install path dead | P1 | High | High | Y | Both | Medium | Phase 4 |
| `SET-05` | Credentials | refresh configs, refresh toolkits, list connection state | third-party auth blind spot | P1 | High | Medium | Y | Both | Low | Phase 4 |
| `SET-06` | Obsidian integration | import/export wizard, job progress, download zip | import/export dead or partial | P1 | High | Medium | Y | Both | Medium | Phase 4 |
| `SET-07` | OpenClaw integration | bridge toggle, role gate, capability permissions, rollback | security or bridge misconfig | P1 | High | High | Y | Both | Medium | Phase 4 |

### 4.5 Team, Share, and Admin Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `BND-01` | Team root relay | slug redirect correctness | dead org entry | P3 | Low | Low | Y | Both | Low | Phase 5 |
| `BND-02` | Team settings | rename, slug, copy URL, workspace open | org config corruption | P1 | High | High | Y | Both | Medium | Phase 5 |
| `BND-03` | Team members | role edit, primary owner transfer, remove member | privilege corruption | P0 | Critical | Must | Y | Both | Medium | Phase 5 |
| `BND-04` | Team invitations | create invite, copy invite URL, delete invite, accept state | unauthorized or blocked onboarding | P0 | Critical | Must | Y | Both | Medium | Phase 5 |
| `BND-05` | Team route mirrors | account scope mirroring for dashboard/workspace/etc. | scope bleed, wrong tenant data | P0 | Critical | Must | Y | Both | Medium | Phase 5 |
| `BND-06` | Share canvas | public read-only load, timeline, expired share state | data leak, broken public artifact | P0 | Critical | Must | Y | Both | Medium | Phase 5 |
| `BND-07` | Share thread | public message/tool/file visibility, controls | data leak, broken public review path | P0 | Critical | Must | Y | Both | Medium | Phase 5 |
| `BND-08` | Admin audit | filter, pagination, detail payload, copy IDs | blind governance, wrong audit trace | P1 | High | Medium | Y | Desktop | Low | Phase 5 |
| `BND-09` | Admin billing | user billing table, detail modal, refresh stats | wrong operator action or blind billing view | P1 | High | Medium | Y | Desktop | Low | Phase 5 |
| `BND-10` | Admin invites | QR upload, create codes, copy, batch delete, history | code issuance failure or misuse | P1 | High | Medium | Y | Desktop | Medium | Phase 5 |
| `BND-11` | Admin prompt studio | task/file view, prompt edit, preview, rollback | prompt regression, unsafe config push | P1 | High | High | Y | Desktop | Medium | Phase 5 |

### 4.6 Mobile Surfaces

| Audit ID | Surface | Core audit units | Primary risk themes | SeverityPotential | BusinessCriticality | AutomationPriority | RoleMatrix | DeviceMatrix | PersistenceRisk | AuditWave |
|---|---|---|---|---|---|---|---|---|---|---|
| `MOB-01` | Mobile home route | auth gate, loading gate, panel toggles | blocked app entry | P1 | High | High | Y | Mobile | Low | Phase 6 |
| `MOB-02` | Mobile chat container | send, cancel, mode switch, loading/empty state | chat unusable | P1 | High | High | Y | Mobile | Medium | Phase 6 |
| `MOB-03` | Mobile left panel | load projects, select project, long press actions | broken project navigation | P1 | High | Medium | Y | Mobile | Low | Phase 6 |
| `MOB-04` | Mobile right panel | tool timeline, jump latest, slider nav | blind task execution review | P2 | Medium | Medium | N | Mobile | Low | Phase 6 |
| `MOB-05` | Mobile settings drawer | open/close, sign out | account management dead end | P2 | Medium | Low | Y | Mobile | Low | Phase 6 |
| `MOB-06` | Mobile share modal | create/remove/copy/open share link | broken mobile sharing | P1 | High | Medium | Y | Mobile | Low | Phase 6 |
| `MOB-07` | Mobile chat action modal | share/delete action routing, dismiss behavior | destructive action misfire | P2 | Medium | Medium | N | Mobile | Low | Phase 6 |

---

## 5. Coverage Counters

| Counter | Value |
|---|---:|
| Total audit surfaces | 53 |
| P0-capable surfaces | 16 |
| Must-automate surfaces | 17 |
| High-priority automation surfaces | 31 |
| Multi-role surfaces | 34 |
| Both-device surfaces | 39 |
| High-persistence-risk surfaces | 8 |

These counters must be updated whenever the matrix changes.

---

## 6. Entry Checklist Per Surface

Use this checklist before starting any detailed surface audit:

```text
Per-surface readiness
=====================

[ ] Source route or owner component identified
[ ] Fixture account identified
[ ] Fixture data identified
[ ] Expected happy path defined
[ ] Error path defined
[ ] Permission path defined
[ ] Refresh/reopen behavior defined
[ ] Automation suitability decided
[ ] Evidence location decided
```

## 7. Change Rules

- Do not add wrapper-only routes as standalone audit surfaces unless they introduce unique behavior.
- Do not merge different role behaviors into one pass/fail note; they must be called out explicitly.
- Do not close a surface audit without linking:
  - evidence
  - bugs found
  - regression status
