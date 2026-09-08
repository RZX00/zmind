# `zmind` CLI

Unified CLI for:

- local-first canvas operations
- remote ZMind auth / workspace / canvas / docs operations

## Command Model

```text
zmind auth ...
zmind workspace ...
zmind canvas ...
zmind docs ...

Local-first mode
`--vault` present -> local commands
no `--vault`      -> remote commands
```

## Remote Quick Start

```bash
docker compose up -d redis backend canvas-realtime

zmind auth login \
  --email you@example.com \
  --password 'your-password' \
  --backend-url https://api.zmind.so \
  --supabase-url https://your-project.supabase.co \
  --supabase-anon-key your-anon-key

zmind workspace list
zmind workspace use --id <workspace-id>
zmind canvas list
zmind docs list
```

## Runtime Dependency Map

```text
remote auth/docs read+write
CLI -> backend -> Supabase

remote canvas read
CLI -> backend -> storage/query services

remote canvas write (`canvas apply`)
CLI -> backend -> canvas-realtime -> persistence/broadcast
```

If `canvas-realtime` is unavailable, auth, workspace, docs, canvas create/get/list may still work, but `zmind canvas apply` can fail with a `502 Apply failed` response because the backend cannot complete realtime canvas writes.

## Remote Surface

```text
auth
- login
- status
- logout

workspace
- list
- use
- current

canvas
- list
- get
- create
- apply
- share-status
- share-update

docs
- list
- get
- create
- apply
```

## Local-first Compatibility

Existing local workflows remain valid as long as `--vault` is present:

```bash
zmind canvas create --vault ./vault --id c1 --title "Plan"
zmind node add --vault ./vault --canvas c1 --id n1 --x 120 --y 80 --text "task"
```
