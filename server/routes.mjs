// HTTP routes. Mounted under /api by index.mjs.

import { Hono } from "hono";
import { llmHealth } from "./llm.mjs";
import { formatMealPlanMarkdown, regenerateMeal } from "./generator.mjs";

export function createRoutes({ store, scheduler }) {
  const api = new Hono();

  // ------ plans ------
  api.get("/plans", (c) => {
    const limit = Number(c.req.query("limit") || 20);
    const plans = store.listPlans(limit);
    return c.json({
      plans: plans.map(summariseForList),
      unread_count: store.getUnreadCount(),
    });
  });

  api.get("/plans/:id", (c) => {
    const plan = store.getPlan(c.req.param("id"));
    if (!plan) return c.json({ error: "not_found" }, 404);
    return c.json({ plan: withSavedFlags(plan, store) });
  });

  api.post("/plans/:id/read", (c) => {
    const plan = store.markPlanRead(c.req.param("id"));
    if (!plan) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, unread_count: store.getUnreadCount() });
  });

  api.patch("/plans/:id/feedback", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = body?.feedback_text == null ? "" : String(body.feedback_text);
    const plan = store.setPlanFeedback(c.req.param("id"), text);
    if (!plan) return c.json({ error: "not_found" }, 404);
    return c.json({ plan });
  });

  api.delete("/plans/:id", (c) => {
    const ok = store.deletePlan(c.req.param("id"));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, unread_count: store.getUnreadCount() });
  });

  api.post("/plans/:planId/meals/:mealId/regen", async (c) => {
    if (scheduler.getState().running) {
      return c.json({ ok: false, status: "already-running" }, 409);
    }
    const plan = store.getPlan(c.req.param("planId"));
    if (!plan) return c.json({ error: "plan_not_found" }, 404);
    const mealId = c.req.param("mealId");
    const idx = (plan.meals || []).findIndex((m) => m.id === mealId);
    if (idx < 0) return c.json({ error: "meal_not_found" }, 404);

    try {
      const newMeal = await regenerateMeal({ store, plan, replaceMealId: mealId });
      const meals = [...plan.meals];
      meals[idx] = { ...newMeal };

      // Rebuild grocery list and content from the new meal set
      const grocery = consolidateGrocery(meals);
      const summary = meals.map((m) => m.name || "Untitled").join(", ");
      const md = formatMealPlanMarkdown({ meals, grocery_list: grocery, summary });

      const updated = store.updatePlanMeals(plan.id, {
        meals,
        grocery_list: grocery,
        summary,
        content: md,
      });
      return c.json({ plan: withSavedFlags(updated, store), meal: newMeal });
    } catch (err) {
      return c.json({ error: String(err?.message || err) }, 500);
    }
  });

  api.post("/plans/run", async (c) => {
    if (scheduler.getState().running) {
      return c.json({ ok: false, status: "already-running" }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const opts = {
      mealCount: body?.meal_count,
      seedRecipeIds: Array.isArray(body?.seed_recipe_ids) ? body.seed_recipe_ids : [],
      styleNote: body?.style_note ? String(body.style_note) : "",
    };
    // Fire-and-forget — the UI polls for completion
    scheduler.runNow(opts).catch((err) => console.error("[routes] runNow:", err));
    return c.json({ ok: true, status: "running" }, 202);
  });

  // ------ recipes ------
  api.get("/recipes", (c) => {
    const limit = Number(c.req.query("limit") || 50);
    return c.json({ recipes: store.listSavedRecipes(limit) });
  });

  api.get("/recipes/:id", (c) => {
    const recipe = store.getSavedRecipe(c.req.param("id"));
    if (!recipe) return c.json({ error: "not_found" }, 404);
    return c.json({ recipe });
  });

  api.post("/recipes", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const meal_id = String(body?.meal_id || "");
    const source_plan_id = body?.source_plan_id ? String(body.source_plan_id) : null;
    const meal = body?.meal;
    if (!meal_id || !meal || typeof meal !== "object") {
      return c.json({ error: "meal_id and meal required" }, 400);
    }
    const saved = store.saveRecipe({ meal_id, source_plan_id, meal });
    return c.json({ recipe: saved }, 201);
  });

  api.delete("/recipes/:mealId", (c) => {
    store.unsaveRecipe(c.req.param("mealId"));
    return c.json({ ok: true });
  });

  // ------ preferences ------
  api.get("/preferences", (c) => c.json({ preferences: store.listPreferences() }));

  api.post("/preferences", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const kind = String(body?.kind || "note");
    const value = String(body?.value || "").trim();
    if (!value) return c.json({ error: "value required" }, 400);
    return c.json({ preference: store.addPreference({ kind, value }) }, 201);
  });

  api.delete("/preferences/:id", (c) => {
    store.removePreference(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ------ config ------
  api.get("/config", (c) => c.json({ config: store.getAllConfig() }));

  api.patch("/config", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const key = String(body?.key || "");
    const value = body?.value == null ? "" : String(body.value);
    if (!key) return c.json({ error: "key required" }, 400);
    store.setConfig(key, value);
    if (key.startsWith("scheduler_")) scheduler.reload();
    return c.json({ ok: true, config: store.getAllConfig() });
  });

  // ------ scheduler ------
  api.get("/scheduler", (c) => c.json(scheduler.getState()));

  api.post("/scheduler/run-now", (c) => {
    if (scheduler.getState().running) {
      return c.json({ ok: false, status: "already-running" }, 409);
    }
    scheduler.runNow().catch((err) => console.error("[routes] scheduler run-now:", err));
    return c.json({ ok: true, status: "running" }, 202);
  });

  // ------ llm health ------
  api.get("/llm/health", async (c) => c.json(await llmHealth()));

  return api;
}

function summariseForList(plan) {
  return {
    id: plan.id,
    created_at_ms: plan.created_at_ms,
    week_of: plan.week_of,
    headline: plan.headline || (plan.summary || "Untitled").split(",")[0],
    card_summary: plan.card_summary || plan.summary,
    summary: plan.summary,
    meal_count: Array.isArray(plan.meals) ? plan.meals.length : 0,
    unread: plan.read_at_ms == null,
    read_at_ms: plan.read_at_ms,
  };
}

function withSavedFlags(plan, store) {
  if (!plan?.meals) return plan;
  return {
    ...plan,
    meals: plan.meals.map((m) => ({ ...m, saved: m.id ? store.isRecipeSaved(m.id) : false })),
  };
}

// Naive grocery consolidation — dedupes identical strings. The LLM produces
// detailed lines like "1 lb chicken breast" so exact-string matching catches
// the common case; anything finer requires the LLM and we'd rather avoid the
// round trip on a single-meal swap.
function consolidateGrocery(meals) {
  const seen = new Set();
  const out = [];
  for (const meal of meals) {
    for (const ing of meal.ingredients || []) {
      const key = String(ing).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(String(ing).trim());
    }
  }
  return out;
}
