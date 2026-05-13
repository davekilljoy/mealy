// LLM-driven auto-tagger for saved recipes. Picks one value per dimension
// from the closed taxonomy. Speed bucket is computed deterministically from
// prep + cook time, so we don't waste a token on it.
//
// Failure policy: NEVER throw. A tagging failure must not block save. On any
// error or unparseable response, we log a warning and return whatever tags
// we already had (speed bucket if available, else empty).

import { complete } from "./llm.mjs";
import { extractJson } from "./generator.mjs";
import {
  RECIPE_TAG_TAXONOMY,
  LLM_TAG_DIMENSIONS,
  normalizeLLMTags,
} from "./taxonomy.mjs";

const TAGGER_SYSTEM = [
  "You categorize home dinner recipes. Pick exactly one value from each list.",
  'If nothing fits, pick "other". Use the exact lowercase value — no synonyms.',
  "",
  `cuisine: ${RECIPE_TAG_TAXONOMY.cuisine.join(", ")}`,
  `protein: ${RECIPE_TAG_TAXONOMY.protein.join(", ")}`,
  `method: ${RECIPE_TAG_TAXONOMY.method.join(", ")}`,
  "",
  "Respond with JSON only — no markdown, no commentary:",
  '{"cuisine":"...","protein":"...","method":"..."}',
].join("\n");

const MAX_INSTRUCTIONS_CHARS = 1200;

function buildUserPrompt(meal) {
  const lines = [];
  if (meal?.name) lines.push(`Name: ${meal.name}`);
  if (meal?.description) lines.push(`Description: ${meal.description}`);
  if (Array.isArray(meal?.ingredients) && meal.ingredients.length) {
    lines.push("Ingredients:");
    for (const ing of meal.ingredients) lines.push(`- ${ing}`);
  }
  if (Array.isArray(meal?.instructions) && meal.instructions.length) {
    const joined = meal.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const truncated = joined.length > MAX_INSTRUCTIONS_CHARS
      ? joined.slice(0, MAX_INSTRUCTIONS_CHARS) + "…"
      : joined;
    lines.push("Instructions:");
    lines.push(truncated);
  }
  return lines.join("\n");
}

export async function tagRecipe(meal) {
  let raw;
  try {
    raw = await complete({
      system: TAGGER_SYSTEM,
      user: buildUserPrompt(meal),
      temperature: 0.2,
      maxTokens: 200,
    });
  } catch (err) {
    console.warn(`[tagger] LLM call failed: ${err?.message || err}`);
    return [];
  }

  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") {
    console.warn(`[tagger] could not parse LLM response: ${String(raw).slice(0, 200)}`);
    return [];
  }

  const subset = {};
  for (const dim of LLM_TAG_DIMENSIONS) subset[dim] = parsed[dim];
  return normalizeLLMTags(subset);
}
