# Mealy

Household meal planner. A small Hono + SQLite web app that asks a local LLM (Ollama / LM Studio / llama-server) to generate a weekly dinner plan with a consolidated grocery list, and lets you swap individual meals, save recipes, and feed preferences back into future plans.

No cloud APIs. No accounts. Runs in Docker, points at whatever LLM endpoint you have hot on the LAN.

## Features

- **Weekly plan generation.** Configurable cron-style schedule (day + hour) or one-off "run now". The LLM is prompted with active preferences, a seasonal produce hint, recent meals to avoid repetition, and any optional nutrition targets.
- **Single-meal regen — swap or tune.** Don't like one of the dinners? Swap it (LLM produces a different cuisine/protein/style) or tune it (keeps the dish recognizable, applies your steering notes). Prior versions are preserved as a per-meal history.
- **Per-meal feedback.** Free-text feedback pinned to individual dishes, surfaced back to the next plan and parsed into structured `like` / `dislike` / `allergy` / `staple` / `note` preferences.
- **Saved recipes with auto-tags.** Star a meal to keep it. Tags (cuisine, protein, method) are applied by the LLM on save; the recipe library filters by tag.
- **A.D.A.M.** — *Adjustable Dinner Allowance Macros.* Optional per-serving targets (calories, protein, carbs, fat, fiber). Injected into the prompt with a soft ±15% guardrail; meal cards render chip readouts of the model's per-serving estimate vs your target.
- **Editable seasonal table.** Twelve-month produce defaults for Vancouver, BC. Override any month inline from Settings or the current-month hint on Generate — click, edit, blur to save.
- **Inline servings rescale.** Click "Serves N" on a meal card to change the serving count; ingredient quantities scale proportionately (handles integers, decimals, simple and mixed fractions, ranges; snaps to whole numbers and common fractions). Grocery list rebuilds.
- **Self-contained.** SQLite (single file in `./data`), vanilla-JS frontend, self-hosted woff2 fonts fetched at build time — no CDN at runtime.

## Stack

- Node 22+ (uses the built-in `node:sqlite` module — no native deps to compile)
- Hono (`/api/*`) + static vanilla-JS frontend from `./web`
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

Everything user-tunable lives in the `meal_planner_config` table and is editable from the Settings tab — no restart needed; the scheduler re-reads on each minute tick.

Settings sections (in order):

- **Preferences** — typed `like` / `dislike` / `allergy` / `staple` / `note` entries that feed every prompt.
- **Seasonal produce** — twelve-month table with per-month produce + notes. Overrides live in the `seasonal_overrides` config key and merge over the in-code defaults.
- **A.D.A.M.** — five optional per-serving macro targets (`adam_calories`, `adam_protein_g`, `adam_carbs_g`, `adam_fat_g`, `adam_fiber_g`). Blank = ignored.
- **Scheduler** — auto-generate toggle, meals per plan, day-of-week, hour. Toggle off hides the rest of the section.
- **System prompt** — the editable preamble that prefixes every LLM call. The JSON schema suffix is kept in code so the response shape stays valid.
- **System health** — LLM reachability + the raw `/api/llm/health` diagnostics.

## Layout

```
server/      Hono app, scheduler, LLM client, SQLite store
web/         Static frontend (index.html, app.js, styles.css)
scripts/     One-off utilities (e.g. import-from-facey.mjs)
data/        SQLite database (gitignored, bind-mounted in Docker)
```
