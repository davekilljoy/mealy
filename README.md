# Mealy

Household meal planner. A small Hono + SQLite web app that asks a local LLM (Ollama / LM Studio / llama-server) to generate a weekly dinner plan with a consolidated grocery list, and lets you swap individual meals, save recipes, and feed preferences back into future plans.

No cloud APIs. No accounts. Runs in Docker, points at whatever LLM endpoint you have hot on the LAN.

## Features

- **Weekly plan generation.** Configurable cron-style schedule (day + hour) or one-off "run now". The LLM is prompted with active preferences and a light seasonal hint.
- **Single-meal regen.** Don't like one of the dinners? Hit the redo button — the LLM gets the rest of the plan as context and is told to avoid the replaced meal in cuisine, protein, and style. Grocery list rebuilds automatically.
- **Preference learning.** Free-text feedback on a plan is parsed into structured `like` / `dislike` / `avoid` / `prefer` entries on the next scheduled run.
- **Saved recipes.** Star a meal to keep it; the saved list seeds future plans.
- **Self-contained.** SQLite (single file in `./data`), vanilla-JS frontend, self-hosted woff2 fonts fetched at build time — no CDN at runtime.

## Stack

- Node 22+
- Hono (`/api/*`) + static frontend from `./web`
- `better-sqlite3` for storage
- An OpenAI-compatible local LLM endpoint (defaults assume Ollama at `host.docker.internal:11434` with `qwen3:14b`)

## Run with Docker

```bash
docker compose up -d --build
```

App listens on `http://localhost:5180`. Data persists in `./data/meal-planner.sqlite`.

Override the LLM via environment:

```bash
LLM_BASE_URL=http://192.168.1.50:1234 LLM_MODEL=llama-3.1-8b-instruct LLM_QWEN_MODE=false \
  docker compose up -d --build
```

## Run locally

```bash
npm install
npm run dev
```

Same env vars (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_QWEN_MODE`, `PORT`, `HOST`, `DB_PATH`) apply.

## Configuration

Schedule, system prompt, and meal count are stored in the `app_config` table and editable from the Settings tab in the UI — no restart needed; the scheduler re-reads on each minute tick.

## Layout

```
server/      Hono app, scheduler, LLM client, SQLite store
web/         Static frontend (index.html, app.js, styles.css)
scripts/     One-off utilities (e.g. import-from-facey.mjs)
data/        SQLite database (gitignored, bind-mounted in Docker)
```
