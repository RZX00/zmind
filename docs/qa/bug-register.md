# Zmind Bug Register

> Master bug register for the full-feature audit program  
> Created: 2026-03-13

---

## 1. Register Rules

- One row per unique bug.
- Use stable IDs: `BUG-0001`, `BUG-0002`, ...
- Keep this file as the executive index.
- Detailed evidence can live in phase-specific audit docs, but the row here is mandatory.

---

## 2. Columns

| Bug ID | Surface | Audit ID | Severity | Status | Role Scope | Device Scope | Short Summary | Owner | Phase Target | Regression Target | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|

---

## 3. Active Bugs

| Bug ID | Surface | Audit ID | Severity | Status | Role Scope | Device Scope | Short Summary | Owner | Phase Target | Regression Target | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `BUG-0001` | Auth / Reset password | `ACC-01` | `P0` | `Fixed pending verification` | `Anonymous`, `Personal free`, `Personal paid` | `Web` | Reset-password completion depends on transient URL `code` state and does not validate recovery-session state explicitly, making the recovery path brittle. | `Auth surface owner` | `Phase 2` | `REG-01` | `docs/qa/audits/p0-auth-audit.md#bug-0001---reset-password-recovery-depends-on-transient-url-state-and-lacks-explicit-recovery-state-validation` |
| `BUG-0002` | Team billing / Subscription | `CORE-16` | `P0` | `Fixed pending verification` | `Team owner`, `Team member` | `Web` | Team members can reach backend billing mutations for the workspace because billing write endpoints validate membership but not owner role. | `Billing API owner` | `Phase 2` | `REG-01` | `docs/qa/audits/p0-billing-credits-audit.md#bug-0002---team-members-can-trigger-owner-level-billing-mutations-for-the-workspace` |
| `BUG-0003` | Phone verification / MFA gate | `ACC-03` | `P1` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | MFA enforcement runs only on a subset of authenticated routes, so locale and team routes can bypass the intended phone-verification redirect. | `Frontend platform owner` | `Phase 2` | `REG-01` | `docs/qa/audits/p0-auth-audit.md#bug-0003---mfa-enforcement-only-protects-a-subset-of-authenticated-routes` |
| `BUG-0004` | Canvas undo / redo durability | `CORE-04` | `P0` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | Undo and redo persist only title, nodes, and connections, so metadata-backed state and global style changes can revert after refresh. | `Canvas editor owner` | `Phase 3` | `REG-02` | `docs/qa/audits/canvas-deep-audit.md#bug-0004---canvas-undoredo-does-not-durably-persist-metadata-backed-state-or-global-styles` |
| `BUG-0005` | Doc autosave durability | `CORE-10` | `P1` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | Doc autosave clears its pending debounce on unmount without flushing, so recent edits may never reach the server when the user navigates away quickly. | `Doc editor owner` | `Phase 3` | `REG-02` | `docs/qa/audits/doc-deep-audit.md#bug-0005---doc-autosave-can-drop-pending-server-persistence-on-unmount-or-navigation` |
| `BUG-0006` | Thread optimistic reconciliation | `CORE-11` | `P1` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | Thread send can leave a stale `temp-*` user message when run start fails with agent-run-limit or project-limit errors after the real message was already persisted. | `Thread surface owner` | `Phase 3` | `REG-02` | `docs/qa/audits/thread-deep-audit.md#bug-0006---thread-optimistic-user-message-can-remain-stale-or-duplicate-when-run-start-is-rejected` |
| `BUG-0007` | Trigger route scope / deep link | `CORE-14` | `P1` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | Trigger detail open and close rewrite team and locale routes to hard-coded personal `/triggers` paths, dropping the current route scope during normal interaction. | `Frontend platform owner` | `Phase 4` | `REG-03` | `docs/qa/audits/triggers-audit.md#bug-0007---trigger-detail-panel-rewrites-team-and-locale-routes-to-personal-triggers-paths` |
| `BUG-0008` | Knowledge dashboard workspace scope | `CORE-13` | `P1` | `Fixed pending verification` | `Team owner`, `Team member`, `Multi-workspace user` | `Web` | Dashboard knowledge shortcuts ignore active workspace scope for both data queries and the "view all" destination route, so team dashboards can show mixed-account knowledge and jump to personal knowledge routes. | `Knowledge surface owner` | `Phase 4` | `REG-03` | `docs/qa/audits/knowledge-audit.md#bug-0008---knowledge-dashboard-shortcuts-ignore-active-workspace-scope-for-queries-and-destination-route` |
| `BUG-0009` | Trash global sort correctness | `CORE-15` | `P2` | `Fixed pending verification` | `Personal free`, `Personal paid`, `Team owner`, `Team member` | `Web` | Trash node-count sorting is only applied inside the current page because the backend still paginates by deleted time, so multi-page trash views are not globally sorted by nodes. | `Workspace / trash surface owner` | `Phase 4` | `REG-03` | `docs/qa/audits/trash-audit.md#bug-0009---trash-node-sort-is-only-correct-within-the-current-page` |
| `BUG-0010` | Team settings entry / shell truth | `BND-02` | `P1` | `Fixed pending verification` | `Team member` | `Web` | Team members are routed into `/team/[slug]/settings`, the page renders owner controls without owner gating, and owner-only directory RPC failures collapse into silent empty state. | `Frontend platform owner` | `Phase 5` | `REG-04` | `docs/qa/audits/team-settings-audit.md#bug-0010---team-settings-entry-sends-members-into-an-owner-only-shell` |
| `BUG-0011` | Team settings URL copy | `BND-02` | `P2` | `Fixed pending verification` | `Team owner`, `Team member` | `Web` | Team settings copies `https://zmind.so/{slug}` even though the real team routes live under `/team/[slug]/...`, so the built-in copied URL is not a valid team route. | `Team settings owner` | `Phase 5` | `REG-04` | `docs/qa/audits/team-settings-audit.md#bug-0011---team-url-copy-builds-a-non-existent-root-slug-link` |
| `BUG-0012` | Team invite post-create freshness | `BND-04` | `P2` | `Fixed pending verification` | `Team owner` | `Web` | Team invite creation returns a token but leaves pending counts and invite rows stale because the create action revalidates a non-existent route and never refreshes the active settings view. | `Team invitations owner` | `Phase 5` | `REG-04` | `docs/qa/audits/team-member-invite-audit.md#bug-0012---team-invite-creation-does-not-refresh-the-directory-after-success` |
| `BUG-0013` | Prompt Studio RBAC | `BND-11` | `P0` | `Fixed pending verification` | `Authenticated user`, `Admin`, `Super admin` | `Web` | Prompt Studio backend endpoints only require JWT authentication, so any logged-in user can read prompt files, preview prompt assembly, apply changes, inspect history, and roll back prompts. | `Backend platform owner` | `Phase 5` | `REG-04` | `docs/qa/audits/admin-audit-surface-audit.md#bug-0013---prompt-studio-backend-is-missing-admin-role-enforcement` |
| `BUG-0014` | Admin invites batch delete selection | `BND-10` | `P2` | `Fixed pending verification` | `Admin`, `Super admin` | `Web` | Admin invite delete-mode checkboxes do not toggle selection because checkbox clicks are isolated from the row handler and the checkbox handler itself is a no-op. | `Admin invites owner` | `Phase 5` | `REG-04` | `docs/qa/audits/admin-audit-surface-audit.md#bug-0014---admin-invite-delete-mode-checkbox-is-non-functional` |
| `BUG-0015` | Localized public mirrors / route truth | `PUB-01`, `PUB-06` | `P1` | `Fixed pending verification` | `Anonymous`, `Authenticated` | `Web` | Locale-prefixed public routes are incomplete and several localized exits fall back to root-language paths because public nav and docs wrappers still use root-route behavior. | `Frontend platform owner` | `Phase 6` | `REG-05` | `docs/qa/audits/locale-consistency-audit.md#bug-0015---localized-public-mirrors-are-incomplete-and-drop-users-onto-root-language-routes` |
| `BUG-0016` | Public docs / locale copy integrity | `PUB-06` | `P1` | `Fixed pending verification` | `Anonymous`, `Authenticated` | `Web` | Public docs content and locale copy assets contain mojibake and malformed text, making the docs and language UI visibly corrupted. | `Frontend platform owner` | `Phase 6` | `REG-05` | `docs/qa/audits/public-content-surface-audit.md#bug-0016---public-docs-and-locale-copy-assets-are-encoding-corrupted` |
| `BUG-0017` | Docs desktop TOC scroll behavior | `PUB-06` | `P2` | `Fixed pending verification` | `Anonymous`, `Authenticated` | `Web` | Docs TOC highlight and click-jump logic listen to `window` scroll even though the content scrolls inside a `ScrollArea` viewport. | `Docs surface owner` | `Phase 6` | `REG-05` | `docs/qa/audits/responsive-consistency-audit.md#bug-0017---docs-table-of-contents-listens-to-the-wrong-scroll-container` |
| `BUG-0018` | Tutorials support resource link | `PUB-04` | `P3` | `Fixed pending verification` | `Anonymous`, `Authenticated` | `Web` | Tutorials resource panel links to `/support`, but the repository exposes no matching public route. | `Public web owner` | `Phase 6` | `REG-05` | `docs/qa/audits/public-content-surface-audit.md#bug-0018---tutorials-resource-panel-links-to-a-non-existent-support-page` |
| `BUG-0019` | Mobile share publish flow | `MOB-06` | `P1` | `Fixed pending verification` | `Authenticated mobile user` | `Mobile` | Mobile share generates `/share/{projectId}` on a fake production hostname and never publishes the thread-level public state required by the real share surface. | `Mobile surface owner` | `Phase 6` | `REG-05` | `docs/qa/audits/mobile-panel-modal-audit.md#bug-0019---mobile-share-modal-generates-an-invalid-public-link-and-never-publishes-the-thread` |
| `BUG-0020` | Mobile share existing-public-state restore | `MOB-06` | `P2` | `Fixed pending verification` | `Authenticated mobile user` | `Mobile` | Mobile project list strips `is_public`, so reopening the share modal often hides the existing public state and link-management shell. | `Mobile surface owner` | `Phase 6` | `REG-05` | `docs/qa/audits/mobile-panel-modal-audit.md#bug-0020---mobile-share-modal-hides-existing-public-state-because-project-list-strips-is_public` |
| `BUG-0021` | Mobile stream recovery truth | `RES-01` | `P1` | `Fixed pending verification` | `Authenticated mobile user` | `Mobile` | Mobile stream close handling collapses disconnect, failed, and stopped states into `completed`, so live run truth and recovery actions become unreliable. | `Mobile thread owner` | `Phase 7` | `REG-06` | `docs/qa/audits/resilience-recovery-audit.md#bug-0021---mobile-stream-recovery-collapses-disconnect-failure-and-stop-states-into-completed` |
| `BUG-0022` | Mobile logging data exposure | `RES-03` | `P0` | `Fixed pending verification` | `Authenticated mobile user` | `Mobile` | Mobile production logging writes auth-token-bearing stream URLs plus private message, tool, and file data into device logs. | `Mobile platform owner` | `Phase 7` | `REG-06` | `docs/qa/audits/resilience-recovery-audit.md#bug-0022---mobile-production-logging-leaks-auth-tokens-and-private-conversation-data` |

---

## 4. Summary Counters

| Counter | Value |
|---|---:|
| Open P0 | 5 |
| Open P1 | 10 |
| Open P2 | 6 |
| Open P3 | 1 |
| In Regression | 0 |
| Verified awaiting close | 0 |
| Waived | 0 |

Update counters at least once per week.

---

## 5. Phase Review Notes

### Phase 0

- Register initialized.
- No production bug entries logged yet.
- First real population target: Phase 2 critical-flow audit.

### Phase 1

- Verification foundation frozen.
- No production bug entries logged yet.
- Role, fixture, smoke, Web E2E, and Mobile E2E decisions are now fixed inputs for later bug evidence.

### Phase 2

- First real production bug wave completed.
- Two `P0` defects and one `P1` defect were confirmed in auth, billing, and route-policy boundaries.
- All current Phase 2 bugs map to `REG-01`.

### Phase 3

- Core daily-work audit completed.
- One additional `P0` defect and two `P1` defects were confirmed in canvas, doc, and thread save/reconciliation paths.
- All current Phase 3 bugs map to `REG-02`.

### Phase 4

- Support-surface audit completed.
- Two `P1` defects were confirmed in trigger route scope and knowledge workspace scope.
- One `P2` defect was confirmed in trash pagination/sort correctness.
- All current Phase 4 bugs map to `REG-03`.

### Phase 5

- Boundary-surface audit completed.
- One `P0` defect was confirmed in Prompt Studio RBAC.
- One `P1` defect was confirmed in team settings entry and owner-shell truth.
- Three `P2` defects were confirmed in team URL copy, invite post-create freshness, and admin-invite batch-delete interaction.
- All current Phase 5 bugs map to `REG-04`.

### Phase 6

- Public/mobile/consistency audit completed.
- Three `P1` defects were confirmed in locale route truth, public docs/locale copy integrity, and mobile share publishing.
- Two `P2` defects were confirmed in docs TOC scroll-container wiring and mobile share existing-state restore.
- One `P3` defect was confirmed in the tutorials support resource link.
- All current Phase 6 bugs map to `REG-05`.

### Phase 7

- Resilience/recovery audit completed.
- One `P1` defect was confirmed in mobile stream terminal-state recovery truth.
- One `P0` defect was confirmed in mobile production logging, where auth tokens and private content can enter device logs.
- Current Phase 7 bugs map to `REG-06`, which is still missing and therefore remains a release-gap, not a runnable protection layer.

### Phase 8

- Final release closure completed.
- Final release gate result is `NO GO`.
- Blockers are not only the five open `P0` defects; the program is also blocked by manual-only regression packs and the missing `REG-06` resilience pack.
