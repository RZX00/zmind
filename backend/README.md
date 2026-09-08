# Zmind Backend

## Quick Start

From repo root, generate env files first:

```bash
python setup.py
```

Then run backend + worker + redis with Docker (repo root):

```bash
docker compose up -d --build redis backend worker
```

Health check:

- API: `http://localhost:8013/api/health`

## Run from `backend/` Directory

`backend/docker-compose.yml` is backend-only and defines `api`, `worker`, `redis`.

```bash
cd backend
docker compose up -d --build
```

Useful subsets:

```bash
docker compose up -d redis
docker compose up -d api worker
```

## Local Development (recommended split)

1) Start Redis (Docker):

```bash
cd backend
docker compose up -d redis
```

2) Run API locally:

```bash
cd backend
uv run uvicorn api:app --host 0.0.0.0 --port 8013 --reload
```

3) Run worker locally:

```bash
cd backend
uv run dramatiq --processes 4 --threads 4 run_agent_background
```

## Environment Notes

- Backend env file: `backend/.env` (template: `backend/.env.example`).
- At least one LLM provider key is required for agent execution.
- Open-source default recommendation: configure `LEAFLOW_API_KEY` first.
- Default model route is preconfigured to Leaflow-compatible model ids:
  - `leaflow/gemini-3-flash-preview` (free default)
  - `leaflow/claude-sonnet-4-6` (premium default)
- When API runs locally and Redis runs in Docker, use `REDIS_HOST=localhost`.
- When both API and Redis run inside Docker, use `REDIS_HOST=redis`.

## Common Commands

```bash
cd backend
uv run pytest -q
uv run python run_tests.py --help
```
