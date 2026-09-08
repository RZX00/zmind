# `@zmind/sdk`

Shared ZMind SDK for:

- `apps/cli`
- `apps/openclaw-zmind`

## Scope

```text
SDK
- auth
- workspace
- canvas
- docs
- shared transport / session storage
```

## Runtime Model

```text
Config sources
1. explicit method options
2. stored session config
3. environment variables

Session storage
~/.zmind/session.json
```

## Supported Operations

- password login against Supabase auth
- workspace discovery and selection
- canvas list/get/create/apply/share
- docs list/get/create/apply
- automatic refresh-token retry on 401
