// SQLite persistence for plans, preferences, saved recipes, and config.
// Adapted from facey/server/meal-planner/meal-planner-store.mjs.
//
// New vs. the Facey version:
//  - read_at_ms column on meal_plans (unread tracking for the household UI)
//  - meal_count / scheduler_* config keys with defaults
//  - markPlanRead, getUnreadCount, listSavedRecipesByIds

import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function safeJsonParse(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value); } catch (_e) { return fallback; }
}

function encodeJson(value, fallback) {
  try { return JSON.stringify(value == null ? fallback : value); }
  catch (_e) { return JSON.stringify(fallback); }
}

const ALLOWED_PREF_KINDS = new Set(["like", "dislike", "allergy", "staple", "note"]);

function normalizePrefKind(value) {
  const v = String(value || "").trim().toLowerCase();
  return ALLOWED_PREF_KINDS.has(v) ? v : "note";
}

function mapPlanRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    created_at_ms: Number(row.created_at_ms || 0),
    week_of: String(row.week_of || ""),
    summary: row.summary == null ? null : String(row.summary),
    headline: row.headline == null ? null : String(row.headline),
    card_summary: row.card_summary == null ? null : String(row.card_summary),
    bridge_ingredients: safeJsonParse(row.bridge_ingredients_json, []),
    meals: safeJsonParse(row.meals_json, []),
    grocery_list: safeJsonParse(row.grocery_list_json, []),
    content: row.content == null ? null : String(row.content),
    feedback_text: row.feedback_text == null ? null : String(row.feedback_text),
    feedback_at_ms: row.feedback_at_ms == null ? null : Number(row.feedback_at_ms),
    read_at_ms: row.read_at_ms == null ? null : Number(row.read_at_ms),
  };
}

function mapPreferenceRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    created_at_ms: Number(row.created_at_ms || 0),
    kind: String(row.kind || "note"),
    value: String(row.value || ""),
    active: Number(row.active) === 1,
  };
}

function mapSavedRecipeRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    created_at_ms: Number(row.created_at_ms || 0),
    meal_id: String(row.meal_id || ""),
    source_plan_id: row.source_plan_id == null ? null : String(row.source_plan_id),
    name: String(row.name || ""),
    description: row.description == null ? null : String(row.description),
    servings: row.servings == null ? null : Number(row.servings),
    ingredients: safeJsonParse(row.ingredients_json, []),
    prep_time_min: row.prep_time_min == null ? null : Number(row.prep_time_min),
    cook_time_min: row.cook_time_min == null ? null : Number(row.cook_time_min),
    recipe: safeJsonParse(row.recipe_json, {}),
    notes: row.notes == null ? null : String(row.notes),
    notes_updated_at_ms: row.notes_updated_at_ms == null ? null : Number(row.notes_updated_at_ms),
    tags: safeJsonParse(row.tags_json, []),
  };
}

const DEFAULT_SYSTEM_PROMPT = `You are a household meal planner. Each week you plan dinners for the household.
Everyone eats the same meal — no separate kid meals or modifications.

Guidelines:
- Each recipe should be practical for a weeknight (under 45 min total)
- Vary protein sources across the meals
- Include at least 1 vegetable side per meal
- Generate a consolidated grocery list (combine duplicate ingredients)
- Each meal MUST be a different cuisine. Cast a wide net: Japanese, Mexican, Korean, Italian, Thai, Indian, French, American (steaks, burgers), Canadian, Middle Eastern, Chinese, Ethiopian, Greek, Peruvian, Vietnamese, etc. Don't default to tacos and stir-fries every week.
- Prioritise variety: avoid repeating proteins, cuisines, or cooking styles from recent weeks
- Every ingredient MUST include a quantity and unit (e.g. "1 lb chicken breast", "2 tbsp soy sauce", "1 cup rice") — never bare ingredient names
- Assume basic pantry staples: salt, pepper, olive oil, butter, garlic, common spices

Cross-utilisation — don't buy things for a single meal:
- BEFORE choosing recipes, pick 2-3 "bridge ingredients" that will appear in at least 2 of the meals. These should be non-staple items sold in quantities larger than one meal needs: vegetables (cabbage, spinach, bell peppers, etc.), fresh herbs (cilantro, basil), condiments (kewpie mayo, gochujang, hoisin, tahini), dairy (heavy cream, sour cream, yogurt), or specialty spices.
- Then design the meals so each bridge ingredient is used meaningfully in 2+ meals — not just as a garnish.
- The grocery list should reflect this: one purchase, split across meals.
- Meat and basic pantry staples are exempt — everything else should be used more than once when practical.
- If "Leftovers from last week" are listed in the user prompt, use at least one as a bridge ingredient.

Detailed cooking instructions:
- Every meal MUST include step-by-step instructions in the "instructions" field.
- For sauces, marinades, and spice blends: list exact ingredients, quantities, and how to combine them — never just say "make a teriyaki glaze" or "season with cajun spice".
- For specific techniques (e.g. velvet the chicken, deglaze, bloom spices): include a brief explanation of how to do it.
- Instructions should be clear enough that someone who has never made the dish can follow them without Googling.`;

const DEFAULT_CONFIG = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  meal_count: "3",
  scheduler_enabled: "false",
  scheduler_day: "6",   // Saturday
  scheduler_hour: "23", // 11pm
};

export class MealPlannerStore {
  constructor(config = {}) {
    this.dbPath = path.resolve(
      String(config.dbPath || path.resolve("data", "meal-planner.sqlite"))
    );

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initSchema();
    this.runMigrations();
    this.prepareStmts();
    this.seedDefaults();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meal_plans (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        week_of TEXT NOT NULL,
        summary TEXT,
        headline TEXT,
        card_summary TEXT,
        bridge_ingredients_json TEXT NOT NULL DEFAULT '[]',
        meals_json TEXT NOT NULL,
        grocery_list_json TEXT NOT NULL,
        content TEXT,
        feedback_text TEXT,
        feedback_at_ms INTEGER,
        read_at_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_meal_plans_created
        ON meal_plans(created_at_ms DESC);

      CREATE TABLE IF NOT EXISTS meal_preferences (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'note',
        value TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS meal_planner_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_recipes (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        meal_id TEXT NOT NULL,
        source_plan_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        servings INTEGER,
        ingredients_json TEXT NOT NULL DEFAULT '[]',
        prep_time_min INTEGER,
        cook_time_min INTEGER,
        recipe_json TEXT NOT NULL,
        FOREIGN KEY (source_plan_id) REFERENCES meal_plans(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_recipes_meal_id
        ON saved_recipes(meal_id);
      CREATE INDEX IF NOT EXISTS idx_saved_recipes_created
        ON saved_recipes(created_at_ms DESC);
    `);
  }

  runMigrations() {
    // Idempotent ALTERs for tables seeded by older code. node:sqlite throws on
    // duplicate column — swallow that specific case.
    const safeAdd = (sql) => {
      try { this.db.exec(sql); }
      catch (err) {
        if (!String(err.message || "").toLowerCase().includes("duplicate column")) throw err;
      }
    };
    safeAdd("ALTER TABLE meal_plans ADD COLUMN read_at_ms INTEGER");
    safeAdd("ALTER TABLE meal_plans ADD COLUMN headline TEXT");
    safeAdd("ALTER TABLE meal_plans ADD COLUMN card_summary TEXT");
    safeAdd("ALTER TABLE meal_plans ADD COLUMN bridge_ingredients_json TEXT NOT NULL DEFAULT '[]'");
    safeAdd("ALTER TABLE saved_recipes ADD COLUMN notes TEXT");
    safeAdd("ALTER TABLE saved_recipes ADD COLUMN notes_updated_at_ms INTEGER");
    safeAdd("ALTER TABLE saved_recipes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
  }

  prepareStmts() {
    this.insertPlanStmt = this.db.prepare(
      `INSERT INTO meal_plans
        (id, created_at_ms, week_of, summary, headline, card_summary,
         bridge_ingredients_json, meals_json, grocery_list_json,
         content, feedback_text, feedback_at_ms, read_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.selectPlanByIdStmt   = this.db.prepare("SELECT * FROM meal_plans WHERE id = ? LIMIT 1");
    this.selectLatestPlanStmt = this.db.prepare("SELECT * FROM meal_plans ORDER BY created_at_ms DESC LIMIT 1");
    this.selectPlansStmt      = this.db.prepare("SELECT * FROM meal_plans ORDER BY created_at_ms DESC LIMIT ?");
    this.updatePlanFeedbackStmt = this.db.prepare("UPDATE meal_plans SET feedback_text = ?, feedback_at_ms = ? WHERE id = ?");
    this.markPlanReadStmt     = this.db.prepare("UPDATE meal_plans SET read_at_ms = ? WHERE id = ? AND read_at_ms IS NULL");
    this.countUnreadStmt      = this.db.prepare("SELECT COUNT(*) AS c FROM meal_plans WHERE read_at_ms IS NULL");
    this.deletePlanStmt       = this.db.prepare("DELETE FROM meal_plans WHERE id = ?");
    this.updatePlanMealsStmt  = this.db.prepare("UPDATE meal_plans SET meals_json = ?, grocery_list_json = ?, summary = ?, content = ? WHERE id = ?");

    this.insertPreferenceStmt = this.db.prepare(
      `INSERT INTO meal_preferences (id, created_at_ms, kind, value, active) VALUES (?, ?, ?, ?, 1)`
    );
    this.selectActivePreferencesStmt = this.db.prepare(
      "SELECT * FROM meal_preferences WHERE active = 1 ORDER BY created_at_ms ASC"
    );
    this.softDeletePreferenceStmt = this.db.prepare(
      "UPDATE meal_preferences SET active = 0 WHERE id = ?"
    );

    this.selectConfigStmt    = this.db.prepare("SELECT value FROM meal_planner_config WHERE key = ? LIMIT 1");
    this.upsertConfigStmt    = this.db.prepare(
      "INSERT OR REPLACE INTO meal_planner_config (key, value, updated_at_ms) VALUES (?, ?, ?)"
    );
    this.selectAllConfigStmt = this.db.prepare("SELECT key, value FROM meal_planner_config ORDER BY key");
    this.insertIfMissingConfigStmt = this.db.prepare(
      "INSERT OR IGNORE INTO meal_planner_config (key, value, updated_at_ms) VALUES (?, ?, ?)"
    );

    this.insertSavedRecipeStmt = this.db.prepare(
      `INSERT INTO saved_recipes
        (id, created_at_ms, meal_id, source_plan_id, name, description,
         servings, ingredients_json, prep_time_min, cook_time_min, recipe_json, tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.selectSavedRecipeByIdStmt = this.db.prepare("SELECT * FROM saved_recipes WHERE id = ? LIMIT 1");
    this.selectSavedRecipeByMealIdStmt = this.db.prepare("SELECT * FROM saved_recipes WHERE meal_id = ? LIMIT 1");
    this.selectSavedRecipesStmt    = this.db.prepare("SELECT * FROM saved_recipes ORDER BY created_at_ms DESC LIMIT ?");
    this.selectUntaggedRecipesStmt = this.db.prepare(
      "SELECT * FROM saved_recipes WHERE tags_json IS NULL OR tags_json = '[]' OR tags_json = '' ORDER BY created_at_ms ASC LIMIT ?"
    );
    this.deleteSavedRecipeByMealIdStmt = this.db.prepare("DELETE FROM saved_recipes WHERE meal_id = ?");
    this.updateSavedRecipeNotesStmt = this.db.prepare(
      "UPDATE saved_recipes SET notes = ?, notes_updated_at_ms = ? WHERE id = ?"
    );
    this.updateSavedRecipeTagsStmt = this.db.prepare(
      "UPDATE saved_recipes SET tags_json = ? WHERE id = ?"
    );
  }

  seedDefaults() {
    const now = Date.now();
    for (const [key, val] of Object.entries(DEFAULT_CONFIG)) {
      this.insertIfMissingConfigStmt.run(key, val, now);
    }
  }

  // ---------------- Plans ----------------

  createPlan({ week_of, summary, headline, card_summary, bridge_ingredients, meals, grocery_list, content }) {
    const id = randomUUID();
    const now = Date.now();
    this.insertPlanStmt.run(
      id,
      now,
      String(week_of || ""),
      summary == null ? null : String(summary),
      headline == null ? null : String(headline),
      card_summary == null ? null : String(card_summary),
      encodeJson(bridge_ingredients, []),
      encodeJson(meals, []),
      encodeJson(grocery_list, []),
      content == null ? null : String(content),
      null,
      null,
      null,
    );
    return this.getPlan(id);
  }

  getPlan(id) { return mapPlanRow(this.selectPlanByIdStmt.get(String(id))); }
  getLatestPlan() { return mapPlanRow(this.selectLatestPlanStmt.get()); }

  listPlans(limit = 20) {
    const capped = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.selectPlansStmt.all(capped).map(mapPlanRow).filter(Boolean);
  }

  setPlanFeedback(id, feedbackText) {
    const plan = this.getPlan(id);
    if (!plan) return null;
    const text = feedbackText == null ? null : String(feedbackText).trim();
    this.updatePlanFeedbackStmt.run(text, Date.now(), String(id));
    return this.getPlan(id);
  }

  markPlanRead(id) {
    this.markPlanReadStmt.run(Date.now(), String(id));
    return this.getPlan(id);
  }

  getUnreadCount() {
    const row = this.countUnreadStmt.get();
    return Number(row?.c || 0);
  }

  deletePlan(id) {
    const result = this.deletePlanStmt.run(String(id));
    return Number(result?.changes || 0) > 0;
  }

  updatePlanMeals(id, { meals, grocery_list, summary, content }) {
    this.updatePlanMealsStmt.run(
      encodeJson(meals, []),
      encodeJson(grocery_list, []),
      summary == null ? null : String(summary),
      content == null ? null : String(content),
      String(id),
    );
    return this.getPlan(id);
  }

  // ---------------- Preferences ----------------

  addPreference({ kind, value }) {
    const id = randomUUID();
    const now = Date.now();
    this.insertPreferenceStmt.run(id, now, normalizePrefKind(kind), String(value || "").trim());
    const rows = this.selectActivePreferencesStmt.all();
    return mapPreferenceRow(rows.find((r) => r.id === id) || null);
  }

  listPreferences() {
    return this.selectActivePreferencesStmt.all().map(mapPreferenceRow).filter(Boolean);
  }

  removePreference(id) {
    this.softDeletePreferenceStmt.run(String(id));
  }

  // ---------------- Config ----------------

  getConfig(key) {
    const row = this.selectConfigStmt.get(String(key));
    return row ? String(row.value) : null;
  }

  setConfig(key, value) {
    this.upsertConfigStmt.run(String(key), String(value), Date.now());
  }

  getAllConfig() {
    const rows = this.selectAllConfigStmt.all();
    const out = {};
    for (const r of rows) out[String(r.key)] = String(r.value);
    return out;
  }

  // ---------------- Saved recipes ----------------

  saveRecipe({ meal_id, source_plan_id, meal, tags }) {
    const existing = this.getSavedRecipeByMealId(meal_id);
    if (existing) return existing;
    const id = randomUUID();
    const now = Date.now();
    this.insertSavedRecipeStmt.run(
      id, now,
      String(meal_id),
      source_plan_id == null ? null : String(source_plan_id),
      String(meal.name || ""),
      meal.description == null ? null : String(meal.description),
      meal.servings == null ? null : Number(meal.servings),
      encodeJson(meal.ingredients, []),
      meal.prep_time_min == null ? null : Number(meal.prep_time_min),
      meal.cook_time_min == null ? null : Number(meal.cook_time_min),
      encodeJson(meal, {}),
      encodeJson(Array.isArray(tags) ? tags : [], []),
    );
    return this.getSavedRecipe(id);
  }

  getSavedRecipe(id) { return mapSavedRecipeRow(this.selectSavedRecipeByIdStmt.get(String(id))); }
  getSavedRecipeByMealId(mealId) { return mapSavedRecipeRow(this.selectSavedRecipeByMealIdStmt.get(String(mealId))); }

  listSavedRecipes(limit = 50) {
    const capped = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.selectSavedRecipesStmt.all(capped).map(mapSavedRecipeRow).filter(Boolean);
  }

  listSavedRecipesByIds(ids) {
    const list = (Array.isArray(ids) ? ids : []).map((x) => String(x || "")).filter(Boolean);
    if (!list.length) return [];
    return list
      .map((id) => mapSavedRecipeRow(this.selectSavedRecipeByIdStmt.get(id)))
      .filter(Boolean);
  }

  unsaveRecipe(mealId) {
    this.deleteSavedRecipeByMealIdStmt.run(String(mealId));
  }

  setRecipeNotes(id, notes) {
    const recipe = this.getSavedRecipe(id);
    if (!recipe) return null;
    const text = notes == null ? null : String(notes).trim();
    this.updateSavedRecipeNotesStmt.run(text || null, Date.now(), String(id));
    return this.getSavedRecipe(id);
  }

  setRecipeTags(id, tags) {
    const recipe = this.getSavedRecipe(id);
    if (!recipe) return null;
    this.updateSavedRecipeTagsStmt.run(
      encodeJson(Array.isArray(tags) ? tags : [], []),
      String(id),
    );
    return this.getSavedRecipe(id);
  }

  listUntaggedSavedRecipes(limit = 200) {
    const capped = Math.max(1, Math.min(500, Number(limit) || 200));
    return this.selectUntaggedRecipesStmt.all(capped).map(mapSavedRecipeRow).filter(Boolean);
  }

  isRecipeSaved(mealId) {
    return this.selectSavedRecipeByMealIdStmt.get(String(mealId)) != null;
  }
}

export function createMealPlannerStore(config = {}) {
  return new MealPlannerStore(config);
}
