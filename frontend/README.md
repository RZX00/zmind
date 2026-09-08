# Zmind Frontend

## Quick Start

From repo root, initialize env files first:

```bash
python setup.py
```

Then run frontend locally:

```bash
cd frontend
npm install
npm run dev
```

Default URL: `http://localhost:3000`

## Environment

Frontend env file: `frontend/.env.local` (template: `frontend/.env.example`).

Key variables:

```sh
NEXT_PUBLIC_ENV_MODE=local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:8013/api
BACKEND_INTERNAL_URL=http://localhost:8013/api
NEXT_PUBLIC_CANVAS_REALTIME_URL=http://localhost:6020
NEXT_PUBLIC_URL=http://localhost:3000
```

Notes:

- `NEXT_PUBLIC_BACKEND_URL` is used by browser-side requests.
- `BACKEND_INTERNAL_URL` is used by server-side routes.
- Supabase URL/anon key must match backend project config.

## Docker (repo root)

```bash
docker compose up -d --build frontend backend worker redis canvas-realtime
```

## Quality Commands

```bash
cd frontend
npm run lint
npm run type-check
npm run build
```
