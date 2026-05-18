// HTTP routes. Mounted under /api by index.mjs.

import { Hono } from "hono";
import { llmHealth } from "./llm.mjs";
import { formatMealPlanMarkdown, regenerateMeal, scaleIngredients } from "./generator.mjs";
import { tagRecipe } from "./tagger.mjs";
import { RECIPE_TAG_TAXONOMY, LLM_TAG_DIMENSIONS } from "./taxonomy.mjs";
import { getSeasonalTable, setSeasonalOverride, resetSeasonalMonth } from "./seasonal.mjs";

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
    return c.json({ plan: augmentMeals(plan, store) });
  });

  api.post("/plans/:id/read", (c) => {
    const plan = store.markPlanRead(c.req.param("id"));
    if (!plan) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, unread_count: store.getUnreadCount() });
  });

  api.patch("/plans/:planId/meals/:mealId/feedback", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = body?.feedback == null ? "" : String(body.feedback);
    const plan = store.setMealFeedback(
      c.req.param("planId"),
      c.req.param("mealId"),
      text,
    );
    if (!plan) return c.json({ error: "not_found" }, 404);
    return c.json({ plan: augmentMeals(plan, store) });
  });

  api.delete("/plans/:id", (c) => {
    const ok = store.deletePlan(c.req.param("id"));
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, unread_count: store.getUnreadCount() });
  });

  // Rescale a single meal's servings — multiplies ingredient quantities by
  // the new/old ratio, rebuilds the grocery list. Per-serving nutrition is
  // unchanged (it's per serving).
  api.patch("/plans/:planId/meals/:mealId/servings", async (c) => {
    const plan = store.getPlan(c.req.param("planId"));
    if (!plan) return c.json({ error: "plan_not_found" }, 404);
    const mealId = c.req.param("mealId");
    const idx = (plan.meals || []).findIndex((m) => m && m.id === mealId);
    if (idx < 0) return c.json({ error: "meal_not_found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const next = Number(body?.servings);
    if (!Number.isInteger(next) || next < 1 || next > 20) {
      return c.json({ error: "servings must be an integer 1-20" }, 400);
    }
    const prev = Number(plan.meals[idx].servings) || 0;
    if (prev <= 0) return c.json({ error: "meal has no prior servings to scale from" }, 400);

    const ratio = next / prev;
    const scaled = scaleIngredients(plan.meals[idx].ingredients || [], ratio);
    const meals = [...plan.meals];
    meals[idx] = { ...meals[idx], servings: next, ingredients: scaled };

    const grocery = consolidateGrocery(meals);
    const summary = meals.map((m) => m.name || "Untitled").join(", ");
    const md = formatMealPlanMarkdown({ meals, grocery_list: grocery, summary });
    const updated = store.updatePlanMeals(plan.id, {
      meals, grocery_list: grocery, summary, content: md,
    });
    return c.json({ plan: augmentMeals(updated, store), meal: meals[idx] });
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

    const body = await c.req.json().catch(() => ({}));
    const steerNote = body?.steer_note ? String(body.steer_note) : "";
    const mode = body?.mode === "tune" ? "tune" : "swap";

    try {
      const oldMeal = plan.meals[idx];
      const newMeal = await regenerateMeal({ store, plan, replaceMealId: mealId, steerNote, mode });
      const meals = [...plan.meals];
      meals[idx] = { ...newMeal };

      // Snapshot the meal we're replacing so we can show history and feed
      // the preference extractor. Prefer the explicit steer note as the
      // "why" — fall back to any feedback already saved on the meal.
      const revisionReason = (steerNote && steerNote.trim())
        ? steerNote.trim()
        : (oldMeal?.feedback || null);
      store.addMealRevision({
        plan_id: plan.id,
        slot_index: idx,
        replaced_meal_id: mealId,
        meal: oldMeal,
        feedback_text: revisionReason,
      });

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
      return c.json({ plan: augmentMeals(updated, store), meal: newMeal });
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
      servings: body?.servings,
      seedRecipeIds: Array.isArray(body?.seed_recipe_ids) ? body.seed_recipe_ids : [],
      styleNote: body?.style_note ? String(body.style_note) : "",
      pantry: body?.pantry ? String(body.pantry) : "",
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
    // Skip the LLM round-trip if the recipe is already saved — saveRecipe
    // short-circuits, so we'd be tagging for nothing.
    let tags = [];
    if (!store.getSavedRecipeByMealId(meal_id)) {
      tags = await tagRecipe(meal);
    }
    const saved = store.saveRecipe({ meal_id, source_plan_id, meal, tags });
    return c.json({ recipe: saved }, 201);
  });

  api.delete("/recipes/:mealId", (c) => {
    store.unsaveRecipe(c.req.param("mealId"));
    return c.json({ ok: true });
  });

  api.patch("/recipes/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const notes = body?.notes == null ? "" : String(body.notes);
    const updated = store.setRecipeNotes(c.req.param("id"), notes);
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ recipe: updated });
  });

  api.post("/recipes/:id/retag", async (c) => {
    const id = c.req.param("id");
    const recipe = store.getSavedRecipe(id);
    if (!recipe) return c.json({ error: "not_found" }, 404);
    const tags = await tagRecipe(recipe.recipe || recipe);
    const updated = store.setRecipeTags(id, tags);
    return c.json({ recipe: updated });
  });

  // Bulk backfill: tag every saved recipe missing at least one LLM-driven
  // dimension. Runs sequentially so we don't slam the local LLM.
  api.post("/recipes/retag-untagged", async (c) => {
    const all = store.listSavedRecipes(500);
    const untagged = all.filter((r) => {
      const present = new Set((r.tags || [])
        .map((t) => String(t).split(":")[0])
        .filter(Boolean));
      return LLM_TAG_DIMENSIONS.some((dim) => !present.has(dim));
    });
    let updated = 0;
    let failed = 0;
    for (const r of untagged) {
      try {
        const tags = await tagRecipe(r.recipe || r);
        store.setRecipeTags(r.id, tags);
        if (tags.length) updated += 1;
        else failed += 1;
      } catch (err) {
        console.warn(`[retag-untagged] ${r.id} failed: ${err?.message || err}`);
        failed += 1;
      }
    }
    return c.json({ ok: true, scanned: untagged.length, updated, failed });
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

  // ------ taxonomy ------
  api.get("/taxonomy", (c) => c.json({ taxonomy: RECIPE_TAG_TAXONOMY }));

  // ------ seasonal table ------
  api.get("/seasonal", (c) => c.json(getSeasonalTable(store)));

  api.patch("/seasonal/:month", async (c) => {
    const month = Number(c.req.param("month"));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: "month must be 1-12" }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const patch = {};
    if (Array.isArray(body?.produce)) patch.produce = body.produce;
    if (typeof body?.notes === "string") patch.notes = body.notes;
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "produce or notes required" }, 400);
    }
    try {
      const table = setSeasonalOverride(store, month, patch);
      return c.json(table);
    } catch (err) {
      return c.json({ error: String(err?.message || err) }, 400);
    }
  });

  api.delete("/seasonal/:month", (c) => {
    const month = Number(c.req.param("month"));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: "month must be 1-12" }, 400);
    }
    return c.json(resetSeasonalMonth(store, month));
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

function augmentMeals(plan, store) {
  if (!plan?.meals) return plan;
  const revisions = store.listMealRevisionsForPlan(plan.id);
  const bySlot = {};
  for (const r of revisions) {
    if (!bySlot[r.slot_index]) bySlot[r.slot_index] = [];
    bySlot[r.slot_index].push(r);
  }
  return {
    ...plan,
    meals: plan.meals.map((m, idx) => ({
      ...m,
      saved: m.id ? store.isRecipeSaved(m.id) : false,
      revisions: bySlot[idx] || [],
    })),
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
