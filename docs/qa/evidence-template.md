# Zmind QA Evidence Template

> Phase 0 frozen on: 2026-03-13

---

## 1. Bug Evidence Template

Use this template for every bug worth tracking.

```md
## BUG-XXXX - <short title>

- Surface:
- Audit ID:
- Severity:
- Status:
- Owner:
- Phase target:
- Environment:
  - app version / commit:
  - role:
  - device:
  - browser / platform:
  - locale:

### Reproduction Steps
1.
2.
3.

### Expected Result

### Actual Result

### User Harm

### Workaround

### Evidence
- Screenshot:
- Recording:
- Console / network / log:
- Related trace:

### Regression Target
- Must automate?: yes / no
- Candidate regression pack:
```

## 2. Surface Audit Evidence Template

Use this when reviewing a whole page or surface.

```md
# <Surface Name> Audit Evidence

- Surface:
- Audit ID:
- Auditor:
- Date:
- Roles tested:
- Devices tested:
- Data fixtures used:

## Checklist
- [ ] Entry works
- [ ] Happy path works
- [ ] Error path works
- [ ] Refresh/reopen state works
- [ ] Permission boundaries checked
- [ ] Persistence/recovery checked

## Findings

### Finding 1
- Severity:
- Summary:
- Evidence:
- Repro:

### Finding 2
- Severity:
- Summary:
- Evidence:
- Repro:

## Verdict
- Pass / Pass with issues / Fail
- Open bug IDs:
- Regression follow-up:
```

## 3. Weekly Phase Report Template

```md
# <Phase / Week> Audit Report

- Date range:
- Scope:
- Commit range:

## Summary
- Surfaces reviewed:
- Bugs opened:
- P0:
- P1:
- P2:
- P3:

## Major Findings
- ...

## Verification Progress
- Automated:
- Manual:
- Blocked:

## Open Risks
- ...

## Gate Decision
- Pass / Conditional Pass / Fail

## Next Week Carry-over
- ...
```

## 4. Artifact Storage Rule

```text
Evidence rule
=============

Bug without evidence
  != validated bug

Verified bug without regression pointer
  != stable closure
```

Required evidence preference:

1. short recording
2. screenshot + exact steps
3. log/trace if stateful or permission-related

