// One-shot importer: copies meal_plans and saved_recipes from Facey's
// meal-planner SQLite into mealy's. Idempotent — `INSERT OR IGNORE` so
// re-running is safe.
//
// Stop the mealy container before running this, then restart it after.
//   docker compose stop
//   node scripts/import-from-facey.mjs
//   docker compose start

import path from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SRC = process.env.SRC_DB || "c:/Users/davek/facey/tmp/meal-planner/meal-planner.sqlite";
const DST = process.env.DST_DB || path.resolve("data", "meal-planner.sqlite");

if (!existsSync(SRC)) {
  console.error(`source db not found: ${SRC}`);
  process.exit(1);
}
if (!existsSync(DST)) {
  console.error(`target db not found: ${DST} — start mealy once so it creates the file`);
  process.exit(1);
}

console.log(`source: ${SRC}`);
console.log(`target: ${DST}`);

const src = new DatabaseSync(SRC, { readOnly: true });
const dst = new DatabaseSync(DST);
dst.exec("PRAGMA foreign_keys = ON;");

// --- plans ---
// Mealy's table has extra columns (headline, card_summary, bridge_ingredients_json,
// read_at_ms). We leave the first three null — the UI falls back to `summary`
// for display — and mark every imported plan as already read so the unread badge
// doesn't light up with the entire backlog.
const planInsert = dst.prepare(
  `INSERT OR IGNORE INTO meal_plans
    (id, created_at_ms, week_of, summary, headline, card_summary,
     bridge_ingredients_json, meals_json, grocery_list_json,
     content, feedback_text, feedback_at_ms, read_at_ms)
   VALUES (?, ?, ?, ?, NULL, NULL, '[]', ?, ?, ?, ?, ?, ?)`
);

const plans = src.prepare("SELECT * FROM meal_plans ORDER BY created_at_ms ASC").all();
const now = Date.now();
let plansImported = 0, plansSkipped = 0;
for (const r of plans) {
  const result = planInsert.run(
    String(r.id),
    Number(r.created_at_ms || 0),
    String(r.week_of || ""),
    r.summary == null ? null : String(r.summary),
    String(r.meals_json || "[]"),
    String(r.grocery_list_json || "[]"),
    r.content == null ? null : String(r.content),
    r.feedback_text == null ? null : String(r.feedback_text),
    r.feedback_at_ms == null ? null : Number(r.feedback_at_ms),
    now, // mark as already read
  );
  if (result.changes > 0) plansImported++; else plansSkipped++;
}
console.log(`plans: imported ${plansImported}, skipped ${plansSkipped} (already present)`);

// --- saved recipes ---
const recipeInsert = dst.prepare(
  `INSERT OR IGNORE INTO saved_recipes
    (id, created_at_ms, meal_id, source_plan_id, name, description,
     servings, ingredients_json, prep_time_min, cook_time_min, recipe_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const recipes = src.prepare("SELECT * FROM saved_recipes ORDER BY created_at_ms ASC").all();
let recipesImported = 0, recipesSkipped = 0;
for (const r of recipes) {
  const result = recipeInsert.run(
    String(r.id),
    Number(r.created_at_ms || 0),
    String(r.meal_id),
    r.source_plan_id == null ? null : String(r.source_plan_id),
    String(r.name || ""),
    r.description == null ? null : String(r.description),
    r.servings == null ? null : Number(r.servings),
    String(r.ingredients_json || "[]"),
    r.prep_time_min == null ? null : Number(r.prep_time_min),
    r.cook_time_min == null ? null : Number(r.cook_time_min),
    String(r.recipe_json || "{}"),
  );
  if (result.changes > 0) recipesImported++; else recipesSkipped++;
}
console.log(`recipes: imported ${recipesImported}, skipped ${recipesSkipped} (already present)`);

src.close();
dst.close();
console.log("done.");
