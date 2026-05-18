// Meal plan generator. Adapted from facey/server/meal-planner/meal-planner-generator.mjs.
//
// Differences from Facey:
//   - Meal count is dynamic (per-run override → store config → default 3)
//   - Style anchors: optional list of saved-recipe IDs the new plan should
//     echo in cuisine / technique (without duplicating dishes)
//   - Style note: optional free-text guidance from the user
//   - No VRAM manager — hits the LLM directly (gridiron-style)

import { randomUUID } from "node:crypto";
import { complete } from "./llm.mjs";
import { getSeasonalContext } from "./seasonal.mjs";

const PERISHABLE_PATTERNS = [
  /cabbage/i, /lettuce/i, /spinach/i, /kale/i, /arugula/i, /chard/i,
  /bell pepper/i, /zucchini/i, /squash/i, /broccoli/i, /cauliflower/i,
  /carrot/i, /celery/i, /bok choy/i, /napa/i, /cucumber/i, /radish/i,
  /green onion/i, /scallion/i, /leek/i, /fennel/i, /asparagus/i,
  /eggplant/i, /mushroom/i, /snap pea/i, /snow pea/i, /corn/i,
  /cilantro/i, /parsley/i, /basil/i, /mint/i, /dill/i, /chives/i,
  /rosemary/i, /thyme/i, /oregano.*fresh/i, /sage/i, /tarragon/i,
  /ginger/i, /jalapeño/i, /serrano/i, /lemongrass/i, /shallot/i,
  /coconut milk/i, /curry paste/i, /hoisin/i, /tahini/i, /pesto/i,
  /miso/i, /sriracha/i, /sambal/i, /fish sauce/i, /oyster sauce/i,
  /gochujang/i, /doenjang/i, /harissa/i, /chipotle/i, /adobo/i,
  /teriyaki/i, /ponzu/i, /mirin/i, /rice vinegar/i, /rice wine/i,
  /worcestershire/i, /dijon/i, /whole.?grain mustard/i,
  /mayo/i, /kewpie/i, /aioli/i,
  /heavy cream/i, /sour cream/i, /crème/i, /yogurt/i, /buttermilk/i,
  /cream cheese/i, /ricotta/i, /mascarpone/i,
  /smoked paprika/i, /za'?atar/i, /sumac/i, /cumin/i, /turmeric/i,
  /curry powder/i, /garam masala/i, /chinese five.?spice/i,
  /chili flake/i, /red pepper flake/i, /cayenne/i,
  /cinnamon/i, /cardamom/i, /coriander/i, /fennel seed/i,
  /sesame oil/i, /toasted sesame/i, /sesame seed/i,
];

const QTY_RE = /^[\d./\s]+(oz|lb|lbs|cup|cups|tbsp|tsp|can|bunch|head|bag|cloves?|stalks?|sprigs?)\b[.\s()]*/i;

function ingredientBase(ing) {
  return String(ing || "").replace(QTY_RE, "").trim().toLowerCase();
}

// Parse the leading quantity from an ingredient string. Handles:
//   - integer / decimal: "2", "1.5"
//   - simple fraction:   "1/2"
//   - mixed fraction:    "1 1/2"
//   - range:             "2-3", "2 to 3"
// Returns { value, rest } or { range:[a,b], rest } or null when unparseable.
function parseLeadingQty(s) {
  const str = String(s || "").trim();
  let m;
  // Range: "2-3 cloves" or "2 to 3 cloves"
  m = str.match(/^(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s+(.+)$/i);
  if (m) return { range: [Number(m[1]), Number(m[2])], rest: m[3] };
  // Mixed fraction: "1 1/2 cups flour"
  m = str.match(/^(\d+)\s+(\d+)\/(\d+)\s+(.+)$/);
  if (m) return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: m[4] };
  // Simple fraction: "1/2 cup rice"
  m = str.match(/^(\d+)\/(\d+)\s+(.+)$/);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: m[3] };
  // Integer or decimal: "1.5 lbs chicken"
  m = str.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) return { value: Number(m[1]), rest: m[2] };
  return null;
}

const COMMON_FRACTIONS = [
  { v: 1 / 8, s: "1/8" },
  { v: 1 / 4, s: "1/4" },
  { v: 1 / 3, s: "1/3" },
  { v: 1 / 2, s: "1/2" },
  { v: 2 / 3, s: "2/3" },
  { v: 3 / 4, s: "3/4" },
];

function formatQty(value) {
  if (!Number.isFinite(value) || value <= 0) return String(value);
  const whole = Math.round(value);
  // Snap to whole when within 5% (or 0.05 for small values)
  if (Math.abs(value - whole) < Math.max(0.05, whole * 0.05)) return String(whole);
  const intPart = Math.floor(value);
  const frac = value - intPart;
  for (const f of COMMON_FRACTIONS) {
    if (Math.abs(frac - f.v) < 0.04) {
      return intPart > 0 ? `${intPart} ${f.s}` : f.s;
    }
  }
  // Fall back to one decimal place, trim trailing .0
  return value.toFixed(1).replace(/\.0$/, "");
}

export function scaleIngredient(str, ratio) {
  const parsed = parseLeadingQty(str);
  if (!parsed) return str;
  if (parsed.range) {
    const [a, b] = parsed.range;
    return `${formatQty(a * ratio)}-${formatQty(b * ratio)} ${parsed.rest}`;
  }
  return `${formatQty(parsed.value * ratio)} ${parsed.rest}`;
}

export function scaleIngredients(ingredients, ratio) {
  if (!Array.isArray(ingredients) || !Number.isFinite(ratio) || ratio === 1) {
    return ingredients;
  }
  return ingredients.map((ing) => scaleIngredient(String(ing), ratio));
}

const ADAM_FIELDS = [
  { key: "adam_calories",  label: "Calories", unit: "kcal" },
  { key: "adam_protein_g", label: "Protein",  unit: "g"    },
  { key: "adam_carbs_g",   label: "Carbs",    unit: "g"    },
  { key: "adam_fat_g",     label: "Fat",      unit: "g"    },
  { key: "adam_fiber_g",   label: "Fiber",    unit: "g"    },
];

// Build the per-serving macros block for the user prompt. Returns "" when
// the user hasn't set any targets, so we don't push noise into the LLM.
// Pass `servings` when the meal's serving count is already known (single-
// meal regen) — we pre-compute the totals to make the math obvious.
function buildAdamTargets(store, { servings } = {}) {
  const lines = [];
  for (const f of ADAM_FIELDS) {
    const raw = (store.getConfig(f.key) || "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) continue;
    const tail = servings && servings > 0
      ? ` per serving (≈${Math.round(n * servings)} ${f.unit} across ${servings} servings)`
      : " per serving";
    lines.push(`- ${f.label}: ${n} ${f.unit}${tail}`);
  }
  if (!lines.length) return "";

  const intro = servings && servings > 0
    ? `Per-serving nutrition targets — design this ${servings}-serving dinner so each serving lands near these numbers:`
    : "Per-serving nutrition targets — for each dinner, choose a serving count appropriate for the household and design ingredient quantities so each serving lands near these numbers:";
  const guard = "Treat these as soft targets — aim within ~15%, not exact. Choose proteins, sides, and portions that naturally hit them; don't strip vegetables or pile on lean protein just to chase a number.";
  const reportRule = "Populate each meal's `nutrition` field with realistic per-serving estimates (calories_per_serving, protein_g, carbs_g, fat_g, fiber_g) computed from the ingredient quantities you chose. These are the user's check that the plan actually hit the targets.";
  return [intro, ...lines, "", guard, "", reportRule].join("\n");
}

export function extractJson(text) {
  try { return JSON.parse(text); } catch (_e) {}
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_e) {}
  }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) {
    try { return JSON.parse(brace[0]); } catch (_e) {}
  }
  return null;
}

export function formatMealPlanMarkdown({ meals, grocery_list, summary }) {
  const lines = [];
  if (summary) lines.push(summary, "");
  const mealList = Array.isArray(meals) ? meals : [];
  for (const meal of mealList) {
    lines.push(`## ${meal.name || "Untitled"}`);
    if (meal.description) lines.push(meal.description);
    const times = [];
    if (meal.prep_time_min) times.push(`Prep ${meal.prep_time_min} min`);
    if (meal.cook_time_min) times.push(`Cook ${meal.cook_time_min} min`);
    if (times.length) lines.push(`*${times.join(" · ")}*`);
    if (Array.isArray(meal.ingredients) && meal.ingredients.length) {
      lines.push("");
      for (const ing of meal.ingredients) lines.push(`- ${ing}`);
    }
    if (Array.isArray(meal.instructions) && meal.instructions.length) {
      lines.push("", "### Instructions");
      meal.instructions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    lines.push("");
  }
  const groceries = Array.isArray(grocery_list) ? grocery_list : [];
  if (groceries.length) {
    lines.push("## Grocery List", "");
    for (const item of groceries) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

export async function generateMealPlan({
  store,
  mealCount,
  servings,
  seedRecipeIds,
  styleNote,
  pantry,
}) {
  // Editable system prompt + structural JSON-only suffix.
  const editablePrompt = store.getConfig("system_prompt") || "";
  const systemPrompt = `${editablePrompt}

Respond in JSON only. No markdown, no explanation.
Use this exact structure:
{"headline": "Fun, punchy card title — 5 words MAX. E.g. 'Pork Gets Spicy'", "summary": "One sentence describing this week's meals and vibe", "bridge_ingredients": ["spinach (meals 1 & 3)", "hoisin sauce (meals 2 & 3)"], "meals": [{"name": "...", "description": "...", "servings": 3, "ingredients": ["1 lb chicken breast", "2 tbsp soy sauce", "..."], "instructions": ["Step 1...", "Step 2..."], "prep_time_min": 0, "cook_time_min": 0, "nutrition": {"calories_per_serving": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0}}], "grocery_list": ["1 lb chicken breast", "2 tbsp soy sauce", "..."]}`;

  // Resolve meal count.
  const configured = Number.parseInt(store.getConfig("meal_count") || "3", 10);
  const count = Math.max(1, Math.min(14,
    Number.isFinite(mealCount) ? Number(mealCount)
    : Number.isFinite(configured) ? configured
    : 3
  ));

  // Resolve serving size for each meal.
  const servingsNum = Number(servings);
  const perMealServings = Number.isInteger(servingsNum) && servingsNum >= 1 && servingsNum <= 20
    ? servingsNum
    : null;

  // ---------- user prompt ----------
  const preferences = store.listPreferences();
  const recentPlans = store.listPlans(4);
  const seedRecipes = seedRecipeIds?.length ? store.listSavedRecipesByIds(seedRecipeIds) : [];

  const intro = perMealServings
    ? `Plan ${count} dinners for next week. Each meal MUST be sized for ${perMealServings} servings — set "servings": ${perMealServings} on every meal and scale ingredient quantities to feed ${perMealServings} adults.`
    : `Plan ${count} dinners for next week.`;
  const userParts = [intro];

  if (preferences.length) {
    const grouped = {};
    for (const p of preferences) {
      if (!grouped[p.kind]) grouped[p.kind] = [];
      grouped[p.kind].push(p.value);
    }
    userParts.push("", "Family preferences:");
    for (const [kind, values] of Object.entries(grouped)) {
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      userParts.push(`- ${label}: ${values.join(", ")}`);
    }
  }

  const seasonal = getSeasonalContext(store);
  if (seasonal) userParts.push("", seasonal);

  const adam = buildAdamTargets(store, { servings: perMealServings });
  if (adam) userParts.push("", adam);

  // Leftover detection from last plan
  const lastPlan = recentPlans[0];
  if (lastPlan && Array.isArray(lastPlan.meals) && lastPlan.meals.length) {
    const seen = {};
    for (const meal of lastPlan.meals) {
      const bases = new Set();
      for (const ing of meal.ingredients || []) {
        const base = ingredientBase(ing);
        if (base) bases.add(base);
      }
      for (const b of bases) seen[b] = (seen[b] || 0) + 1;
    }
    const allIngredients = lastPlan.meals.flatMap((m) => m.ingredients || []);
    const leftovers = allIngredients.filter((ing) => {
      const base = ingredientBase(ing);
      return PERISHABLE_PATTERNS.some((p) => p.test(base)) && (seen[base] || 0) <= 1;
    });
    if (leftovers.length) {
      const unique = [...new Map(leftovers.map((l) => [l.toLowerCase(), l])).values()];
      userParts.push("", "Leftovers from last week (likely still in the fridge/pantry — use at least one):");
      for (const item of unique) userParts.push(`- ${item}`);
    }
  }

  // Recent meal history dedupe
  const plansWithMeals = recentPlans.filter((p) => Array.isArray(p.meals) && p.meals.length);
  if (plansWithMeals.length) {
    userParts.push("", "Recent meals (do NOT repeat or closely resemble these):");
    for (const plan of plansWithMeals) {
      const label = plan.week_of || new Date(plan.created_at_ms).toISOString().slice(0, 10);
      const desc = plan.meals
        .map((m) => m.description ? `${m.name || "unknown"} (${m.description})` : (m.name || "unknown"))
        .join("; ");
      userParts.push(`- ${label}: ${desc}`);
    }
    userParts.push("", "Vary the proteins, cuisines, and cooking methods — don't just rename similar dishes.");
  }

  // Saved favourites (soft hint, not a directive)
  const savedRecipes = store.listSavedRecipes(20);
  if (savedRecipes.length) {
    userParts.push("", "Saved family favorites (feel free to bring one back occasionally):");
    for (const r of savedRecipes) userParts.push(`- ${r.name}`);
  }

  // Style anchors — much stronger guidance than favorites
  if (seedRecipes.length) {
    userParts.push(
      "",
      "Style anchors — make new meals in the SAME STYLE as these (similar cuisine, flavor profile, and technique), but NOT the same dishes:",
    );
    for (const r of seedRecipes) {
      const line = r.description ? `${r.name} — ${r.description}` : r.name;
      userParts.push(`- ${line}`);
    }
  }

  if (styleNote && styleNote.trim()) {
    userParts.push("", `Additional guidance for this week: ${styleNote.trim()}`);
  }

  if (pantry && pantry.trim()) {
    userParts.push(
      "",
      "Already on hand — the user explicitly listed these because they want them used up. Every item below MUST appear as an ingredient in at least one meal this week. Design the meals around them. You can still add other ingredients and dishes to round out the plan, but do not skip any of these:",
      pantry.trim(),
    );
  }

  const feedbackItems = collectFeedbackItems({ store, plan: lastPlan });
  if (feedbackItems.length) {
    userParts.push("", "Feedback from last week (use this to inform this week's plan):");
    for (const item of feedbackItems) {
      const tag = item.kind === "revision" ? " (replaced last time)" : "";
      const desc = item.meal.description ? ` — ${item.meal.description}` : "";
      userParts.push(`- ${item.meal.name}${desc}${tag}: "${item.feedback}"`);
    }
  }

  const userPrompt = userParts.join("\n");

  // ---------- LLM ----------
  const raw = await complete({
    system: systemPrompt,
    user: userPrompt,
    temperature: 0.5,
    maxTokens: 5000,
  });

  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.meals)) {
    throw new Error(`Failed to parse meal plan JSON from LLM response: ${raw.slice(0, 300)}`);
  }

  // Stamp each meal with a stable ID for saving / referencing
  for (const meal of parsed.meals) meal.id = randomUUID();

  const mealNameSummary = parsed.meals.map((m) => m.name || "Untitled").join(", ");

  return {
    meals: parsed.meals,
    grocery_list: Array.isArray(parsed.grocery_list) ? parsed.grocery_list : [],
    bridge_ingredients: Array.isArray(parsed.bridge_ingredients) ? parsed.bridge_ingredients : [],
    summary: mealNameSummary,
    headline: parsed.headline || mealNameSummary.split(/\s+/).slice(0, 5).join(" "),
    cardSummary: parsed.summary || mealNameSummary,
  };
}

// Regenerate a single meal inside an existing plan. Two modes:
//   - "swap": new meal must differ in cuisine/protein/style (the ↻ button)
//   - "tune": keep the dish recognizable, apply the user's notes to refine it
// Preferences and seasonal context still apply in both modes.
export async function regenerateMeal({ store, plan, replaceMealId, steerNote, mode = "swap" }) {
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const target = meals.find((m) => m.id === replaceMealId);
  if (!target) throw new Error(`meal ${replaceMealId} not found in plan ${plan.id}`);

  const others = meals.filter((m) => m.id !== replaceMealId);
  const preferences = store.listPreferences();

  const editablePrompt = store.getConfig("system_prompt") || "";
  const constraint = mode === "tune"
    ? `You are TUNING one dinner in an existing weekly plan based on user feedback. Generate a refined version of the SAME dish that:
- Keeps the core dish recognizable: same protein, same cuisine, same overall concept
- Applies the user's feedback to adjust flavor, technique, ingredients, or timing
- Does NOT duplicate or closely resemble the other meals in the plan
- Still follows all the guidelines above`
    : `You are replacing ONE dinner in an existing weekly plan. Generate exactly one new dinner that:
- Is different in cuisine, protein, and cooking style from the meal being replaced
- Does NOT duplicate or closely resemble the other meals in the plan
- Still follows all the guidelines above`;

  const system = `${editablePrompt}

${constraint}

Respond in JSON only — a single meal object. No markdown, no explanation.
Use this exact structure:
{"name": "...", "description": "...", "servings": 3, "ingredients": ["1 lb chicken breast", "2 tbsp soy sauce", "..."], "instructions": ["Step 1...", "Step 2..."], "prep_time_min": 0, "cook_time_min": 0, "nutrition": {"calories_per_serving": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0}}`;

  const verb = mode === "tune" ? "Tune" : "Replace";
  const userParts = [`${verb} this meal in the plan: "${target.name}"${target.description ? ` — ${target.description}` : ""}.`];

  if (mode === "tune" && Array.isArray(target.ingredients) && target.ingredients.length) {
    userParts.push("", "Current ingredients (adjust where the feedback calls for it; keep the dish recognizable):");
    for (const ing of target.ingredients) userParts.push(`- ${ing}`);
  }

  if (others.length) {
    userParts.push("", "The other meals in the plan (do NOT match these in cuisine, protein, or style):");
    for (const m of others) {
      userParts.push(`- ${m.name}${m.description ? ` (${m.description})` : ""}`);
    }
  }

  if (preferences.length) {
    const grouped = {};
    for (const p of preferences) {
      if (!grouped[p.kind]) grouped[p.kind] = [];
      grouped[p.kind].push(p.value);
    }
    userParts.push("", "Family preferences:");
    for (const [kind, values] of Object.entries(grouped)) {
      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      userParts.push(`- ${label}: ${values.join(", ")}`);
    }
  }

  const seasonal = getSeasonalContext(store);
  if (seasonal) userParts.push("", seasonal);

  const adam = buildAdamTargets(store, { servings: target.servings });
  if (adam) userParts.push("", adam);

  if (steerNote && steerNote.trim()) {
    const label = mode === "tune"
      ? "User feedback to apply (this is the reason for the tune — follow it closely):"
      : "User guidance for the replacement (follow this closely):";
    userParts.push("", `${label} ${steerNote.trim()}`);
  }

  userParts.push(
    "",
    "Output a single meal object only — not an array, not an object with a 'meals' key.",
  );

  const raw = await complete({
    system,
    user: userParts.join("\n"),
    temperature: 0.6,
    maxTokens: 2500,
  });

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse meal JSON from LLM response: ${raw.slice(0, 300)}`);
  }
  // Unwrap if the model put it inside { meal: ... } or returned a single-element { meals: [...] }
  const mealObj = parsed.meal || (Array.isArray(parsed.meals) && parsed.meals[0]) || parsed;
  if (!mealObj?.name) {
    throw new Error(`LLM response missing meal name: ${raw.slice(0, 300)}`);
  }

  mealObj.id = randomUUID();
  return mealObj;
}

// Gather per-meal feedback from a plan, including notes attached directly to
// meals (Mode A) and steer notes that triggered regens (Mode B, via the
// meal_revisions table). Each item carries the meal context so the extractor
// can interpret "too sweet" against the dish it was about.
export function collectFeedbackItems({ store, plan }) {
  if (!plan?.id) return [];
  const items = [];
  for (const meal of plan.meals || []) {
    if (meal?.feedback && String(meal.feedback).trim()) {
      items.push({ kind: "meal", meal, feedback: String(meal.feedback).trim() });
    }
  }
  const revisions = store.listMealRevisionsForPlan(plan.id) || [];
  for (const rev of revisions) {
    if (rev.feedback_text && rev.feedback_text.trim()) {
      items.push({ kind: "revision", meal: rev.meal || {}, feedback: rev.feedback_text.trim() });
    }
  }
  return items;
}

// Pull structured, reusable preferences from per-meal feedback. Each item is
// { meal, feedback, kind }: pure notes on a meal, or a steer note that drove a
// regen. Meal context lets the LLM ground "too sweet" in the actual dish.
export async function extractPreferencesFromFeedbackItems({ items }) {
  if (!Array.isArray(items) || !items.length) return [];
  const system = `You extract durable household food preferences from meal feedback. Each input line is one meal we made (or planned) along with the household's note about it.

Return a JSON array of objects with:
- "kind": one of "like", "dislike", "allergy", "staple", "note"
- "value": a short, reusable preference (e.g. "less sweet glazes on fish", "loves Korean rice bowls", "no liver")

Only extract preferences that are clear and reusable across future weeks. Skip vague comments and one-off complaints. Tie each preference to the underlying pattern, not the single dish — "salmon teriyaki too sweet" is better captured as "dislike: heavy sweet glazes on fish" than "dislike: salmon teriyaki".

Respond with JSON array only. No explanation.`;

  const lines = items.map((it, i) => {
    const tag = it.kind === "revision" ? " (replaced via regen)" : "";
    const desc = it.meal?.description ? ` — ${it.meal.description}` : "";
    return `${i + 1}. ${it.meal?.name || "Unknown meal"}${desc}${tag}: "${it.feedback}"`;
  });
  const user = `Meals and household feedback:\n${lines.join("\n")}`;

  try {
    const raw = await complete({ system, user, temperature: 0.3, maxTokens: 600 });
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && p.kind && p.value);
  } catch (err) {
    console.error(`[meal-planner] Preference extraction failed: ${err.message}`);
    return [];
  }
}
