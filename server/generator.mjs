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

function extractJson(text) {
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
  seedRecipeIds,
  styleNote,
  pantry,
}) {
  // Editable system prompt + structural JSON-only suffix.
  const editablePrompt = store.getConfig("system_prompt") || "";
  const systemPrompt = `${editablePrompt}

Respond in JSON only. No markdown, no explanation.
Use this exact structure:
{"headline": "Fun, punchy card title — 5 words MAX. E.g. 'Pork Gets Spicy'", "summary": "One sentence describing this week's meals and vibe", "bridge_ingredients": ["spinach (meals 1 & 3)", "hoisin sauce (meals 2 & 3)"], "meals": [{"name": "...", "description": "...", "servings": 3, "ingredients": ["1 lb chicken breast", "2 tbsp soy sauce", "..."], "instructions": ["Step 1...", "Step 2..."], "prep_time_min": 0, "cook_time_min": 0}], "grocery_list": ["1 lb chicken breast", "2 tbsp soy sauce", "..."]}`;

  // Resolve meal count.
  const configured = Number.parseInt(store.getConfig("meal_count") || "3", 10);
  const count = Math.max(1, Math.min(14,
    Number.isFinite(mealCount) ? Number(mealCount)
    : Number.isFinite(configured) ? configured
    : 3
  ));

  // ---------- user prompt ----------
  const preferences = store.listPreferences();
  const recentPlans = store.listPlans(4);
  const seedRecipes = seedRecipeIds?.length ? store.listSavedRecipesByIds(seedRecipeIds) : [];

  const userParts = [`Plan ${count} dinners for next week.`];

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

  const seasonal = getSeasonalContext();
  if (seasonal) userParts.push("", seasonal);

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
      "Already on hand (work these into the meals where natural — don't force them, don't restrict the menu to only these):",
      pantry.trim(),
    );
  }

  if (lastPlan?.feedback_text) {
    userParts.push("", `Feedback on last plan: "${lastPlan.feedback_text}"`);
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

// Regenerate a single meal inside an existing plan. The new meal must be
// different from the meal it's replacing AND different from the other meals
// in the plan. Preferences and seasonal context still apply.
export async function regenerateMeal({ store, plan, replaceMealId, steerNote }) {
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const target = meals.find((m) => m.id === replaceMealId);
  if (!target) throw new Error(`meal ${replaceMealId} not found in plan ${plan.id}`);

  const others = meals.filter((m) => m.id !== replaceMealId);
  const preferences = store.listPreferences();

  const editablePrompt = store.getConfig("system_prompt") || "";
  const system = `${editablePrompt}

You are replacing ONE dinner in an existing weekly plan. Generate exactly one new dinner that:
- Is different in cuisine, protein, and cooking style from the meal being replaced
- Does NOT duplicate or closely resemble the other meals in the plan
- Still follows all the guidelines above

Respond in JSON only — a single meal object. No markdown, no explanation.
Use this exact structure:
{"name": "...", "description": "...", "servings": 3, "ingredients": ["1 lb chicken breast", "2 tbsp soy sauce", "..."], "instructions": ["Step 1...", "Step 2..."], "prep_time_min": 0, "cook_time_min": 0}`;

  const userParts = [`Replace this meal in the plan: "${target.name}"${target.description ? ` — ${target.description}` : ""}.`];

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

  const seasonal = getSeasonalContext();
  if (seasonal) userParts.push("", seasonal);

  if (steerNote && steerNote.trim()) {
    userParts.push("", `User guidance for the replacement (follow this closely): ${steerNote.trim()}`);
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

export async function extractPreferencesFromFeedback({ feedbackText }) {
  if (!feedbackText || !feedbackText.trim()) return [];
  const system = `You extract food preferences from meal feedback. Given free-text feedback about meals, extract structured preferences.

Return a JSON array of objects with:
- "kind": one of "like", "dislike", "allergy", "staple", "note"
- "value": short description of the preference

Only extract clear, reusable preferences. Skip vague comments.
Respond with JSON array only. No explanation.`;
  const user = `Feedback: "${feedbackText}"`;

  try {
    const raw = await complete({ system, user, temperature: 0.3, maxTokens: 500 });
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && p.kind && p.value);
  } catch (err) {
    console.error(`[meal-planner] Preference extraction failed: ${err.message}`);
    return [];
  }
}
