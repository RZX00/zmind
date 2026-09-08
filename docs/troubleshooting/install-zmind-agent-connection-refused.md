# install-zmind-agent `ECONNREFUSED` Root Cause and Fix Guide

## Symptom

Frontend server route fails during sign-in:

- `POST /api/admin/install-zmind-agent` returns `500`
- stack shows `TypeError: fetch failed`
- cause contains `ECONNREFUSED`

## Why This Error Is Easy to Misread

`GET /api/edge-flags` can still return `200`, but that endpoint does not call backend API.  
So it does **not** prove backend reachability.

## End-to-End Call Path

```text
Supabase SIGNED_IN
  -> AuthProvider
    -> checkAndInstallZmindAgent()
      -> POST /api/admin/install-zmind-agent   (Next server route)
        -> POST {BACKEND_INTERNAL_URL}/admin/zmind-agents/install-user/{user.id}
          -> backend /api/admin/zmind-agents/install-user/{account_id}
```

## Root Causes (Layered)

### L1. Runtime connectivity issue (primary cause of `ECONNREFUSED`)

At failure time, backend process/container existed but host-level access to `localhost:8013` was not valid.  
This produces direct socket refusal in Node fetch from the Next API route.

Typical causes:

- backend container not recreated after compose config drift
- port publishing state mismatch (`8013:8013` not effectively active)
- wrong network namespace target (`localhost` in containerized frontend)

### L2. Error-handling gap in frontend server route (amplifier)

Before fix, route did single-target `fetch()` without network fallback/timeout/error shaping.  
Any refusal surfaced as unhandled `TypeError: fetch failed` and a noisy 500.

### L3. Data-model bug that appears after network is fixed (secondary)

Migration created a global unique index for `is_zmind_default`:

- `idx_agents_zmind_default_unique ON agents((metadata->>'is_zmind_default')) WHERE ...='true'`

This allows only one such row globally, not one per account.  
Result: install can fail with duplicate key (`23505`) for other users even when backend is reachable.

## Code Changes Applied

### 1) Harden install route networking and diagnostics

File: `frontend/src/app/api/admin/install-zmind-agent/route.ts`

- resolve multiple backend candidates (`BACKEND_INTERNAL_URL`, `NEXT_PUBLIC_BACKEND_URL`)
- normalize `/api` suffix consistently
- add request timeout (`AbortSignal.timeout(10_000)`)
- catch network failures and extract low-level error code
- return structured `503` with `BACKEND_UNREACHABLE` instead of uncaught `TypeError`

### 2) Make client trigger best-effort and non-spammy

File: `frontend/src/lib/utils/install-zmind-agent.ts`

- add per-user success marker in localStorage
- add failure cooldown (15 minutes)
- add in-flight deduplication to avoid concurrent duplicate requests
- downgrade noisy hard errors to warnings

### 3) Prevent sign-in flow from being blocked

File: `frontend/src/components/AuthProvider.tsx`

- `await checkAndInstall...` -> `void checkAndInstall...` on `SIGNED_IN`

### 4) Fix schema uniqueness scope for default agent

File: `backend/supabase/migrations/20260220113500_fix_zmind_default_unique_index_scope.sql`

- drop global unique index `idx_agents_zmind_default_unique`
- create per-account unique index `idx_agents_zmind_default_unique_account` on `account_id`

### 5) Improve backend install idempotency under concurrency

File: `backend/core/utils/zmind_default_agent_service.py`

- factor `find existing default agent` lookup
- detect unique-violation race and return existing agent for same account

## Verification Checklist

Run these in order:

```bash
docker compose ps
docker port zmind-backend-1
curl -i http://127.0.0.1:8013/api/health
```

Expected:

- backend shows `0.0.0.0:8013->8013/tcp` (or equivalent)
- health endpoint returns `200`

If frontend runs in Docker:

- use `BACKEND_INTERNAL_URL=http://backend:8013/api`

If frontend runs on host:

- use `BACKEND_INTERNAL_URL=http://127.0.0.1:8013/api` (prefer `127.0.0.1` over `localhost`)

## Ops Guidance

- Apply migrations before validating agent install behavior.
- Keep frontend install as best-effort; do not make auth success depend on it.
- Treat `edge-flags 200` and backend health as separate probes.
