// Weekly meal plan scheduler.
//
// Differences from facey/server/meal-planner/meal-planner-scheduler.mjs:
//   - No Facey chat-push or APNs notification (the web app surfaces new
//     plans via the unread badge)
//   - No ComfyUI hero image
//   - Sleep-resilient: instead of a single setTimeout, check wall clock
//     every minute. Laptop sleep no longer silently eats a scheduled run.
//   - Reads scheduler_enabled/day/hour from store config, so UI changes
//     apply on the next tick without restart
//   - Exposes generation state (running, last_run_ms, last_status, next_run_ms)
//     so the UI can show "Generating…" while a run is in flight

import {
  collectFeedbackItems,
  extractPreferencesFromFeedbackItems,
  formatMealPlanMarkdown,
  generateMealPlan,
} from "./generator.mjs";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TICK_MS = 60_000;

function nextOccurrence(dayOfWeek, hour, from = new Date()) {
  const target = new Date(from);
  target.setHours(hour, 0, 0, 0);
  let daysUntil = (dayOfWeek - from.getDay() + 7) % 7;
  if (daysUntil === 0 && target <= from) daysUntil = 7;
  target.setDate(target.getDate() + daysUntil);
  return target.getTime();
}

function readSchedule(store) {
  const enabled = String(store.getConfig("scheduler_enabled") || "false").toLowerCase() === "true";
  const day = Math.max(0, Math.min(6, Number.parseInt(store.getConfig("scheduler_day") || "6", 10) || 6));
  const hour = Math.max(0, Math.min(23, Number.parseInt(store.getConfig("scheduler_hour") || "23", 10) || 23));
  return { enabled, day, hour };
}

export function createScheduler({ store }) {
  const state = {
    running: false,
    last_run_ms: null,
    last_status: null,    // "ok" | "error" | "skipped"
    last_error: null,
    next_run_ms: null,
    next_fire_at_ms: null, // internal: the wall-clock instant we'll fire next
  };

  let tickHandle = null;
  let stopped = false;

  function recomputeNext() {
    const { enabled, day, hour } = readSchedule(store);
    if (!enabled) {
      state.next_fire_at_ms = null;
      state.next_run_ms = null;
      return;
    }
    state.next_fire_at_ms = nextOccurrence(day, hour);
    state.next_run_ms = state.next_fire_at_ms;
  }

  // Pull preferences out of the previous plan's per-meal feedback + regen
  // history. Shared by every generation path (scheduled and manual) so manual
  // runs no longer skip the learning step.
  async function autoExtractPrefs() {
    const previousPlan = store.getLatestPlan();
    const items = collectFeedbackItems({ store, plan: previousPlan });
    if (!items.length) return;
    const extracted = await extractPreferencesFromFeedbackItems({ items });
    for (const pref of extracted) {
      store.addPreference({ kind: pref.kind, value: pref.value });
      console.log(`[scheduler] auto-pref: ${pref.kind} — ${pref.value}`);
    }
  }

  async function runOnce() {
    if (state.running) return { skipped: true, reason: "already-running" };
    state.running = true;
    state.last_error = null;
    try {
      await autoExtractPrefs();
      const plan = await generateMealPlan({ store });
      const weekOf = new Date().toISOString().slice(0, 10);
      const md = formatMealPlanMarkdown(plan);

      const stored = store.createPlan({
        week_of: weekOf,
        summary: plan.summary,
        headline: plan.headline,
        card_summary: plan.cardSummary,
        bridge_ingredients: plan.bridge_ingredients,
        meals: plan.meals,
        grocery_list: plan.grocery_list,
        content: md,
      });

      state.last_status = "ok";
      state.last_run_ms = Date.now();
      console.log(`[scheduler] generated plan ${stored.id}: ${plan.summary}`);
      return { ok: true, plan_id: stored.id };
    } catch (err) {
      state.last_status = "error";
      state.last_error = String(err?.message || err);
      state.last_run_ms = Date.now();
      console.error(`[scheduler] generation failed: ${state.last_error}`);
      return { ok: false, error: state.last_error };
    } finally {
      state.running = false;
    }
  }

  function tick() {
    if (stopped) return;
    const { enabled } = readSchedule(store);
    if (!enabled) {
      state.next_fire_at_ms = null;
      state.next_run_ms = null;
      return;
    }
    if (state.next_fire_at_ms == null) recomputeNext();
    if (state.next_fire_at_ms != null && Date.now() >= state.next_fire_at_ms && !state.running) {
      // Fire (await is fine — interval is independent)
      runOnce().finally(() => {
        recomputeNext();
      });
    }
  }

  return {
    start() {
      if (tickHandle) return;
      stopped = false;
      recomputeNext();
      tickHandle = setInterval(tick, TICK_MS);
      const { enabled, day, hour } = readSchedule(store);
      console.log(`[scheduler] started (enabled=${enabled}, ${DAY_NAMES[day]} ${String(hour).padStart(2, "0")}:00)`);
    },
    stop() {
      stopped = true;
      if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    },
    reload() {
      recomputeNext();
      const { enabled, day, hour } = readSchedule(store);
      console.log(`[scheduler] reloaded (enabled=${enabled}, ${DAY_NAMES[day]} ${String(hour).padStart(2, "0")}:00)`);
    },
    runNow(opts = {}) {
      // Lets the routes layer pass mealCount/seedRecipeIds/styleNote for a
      // one-off run that bypasses the schedule.
      if (state.running) return Promise.resolve({ skipped: true, reason: "already-running" });
      state.running = true;
      state.last_error = null;
      return (async () => {
        try {
          await autoExtractPrefs();
          const plan = await generateMealPlan({ store, ...opts });
          const weekOf = new Date().toISOString().slice(0, 10);
          const md = formatMealPlanMarkdown(plan);
          const stored = store.createPlan({
            week_of: weekOf,
            summary: plan.summary,
            headline: plan.headline,
            card_summary: plan.cardSummary,
            bridge_ingredients: plan.bridge_ingredients,
            meals: plan.meals,
            grocery_list: plan.grocery_list,
            content: md,
          });
          state.last_status = "ok";
          state.last_run_ms = Date.now();
          return { ok: true, plan_id: stored.id };
        } catch (err) {
          state.last_status = "error";
          state.last_error = String(err?.message || err);
          state.last_run_ms = Date.now();
          return { ok: false, error: state.last_error };
        } finally {
          state.running = false;
        }
      })();
    },
    getState() {
      const { enabled, day, hour } = readSchedule(store);
      return {
        enabled,
        day,
        hour,
        day_name: DAY_NAMES[day],
        next_run_ms: state.next_run_ms,
        last_run_ms: state.last_run_ms,
        last_status: state.last_status,
        last_error: state.last_error,
        running: state.running,
      };
    },
  };
}
