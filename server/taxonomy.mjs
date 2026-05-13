// Closed taxonomy for auto-tagging saved recipes. The LLM picks one value per
// LLM-driven dimension (cuisine / protein / method); speed is derived from
// prep + cook time. Frontend reads the same lists via GET /api/taxonomy so the
// filter bar stays in sync without a duplicate copy in JS.

export const RECIPE_TAG_TAXONOMY = {
  cuisine: [
    "italian", "mexican", "japanese", "korean", "thai", "indian", "chinese",
    "vietnamese", "french", "american", "mediterranean", "middle-eastern",
    "greek", "spanish", "caribbean", "latin-american", "ethiopian", "british",
    "german", "fusion", "other",
  ],
  protein: [
    "chicken", "beef", "pork", "lamb", "fish", "shrimp", "seafood", "tofu",
    "beans", "eggs", "turkey", "vegetarian", "other",
  ],
  method: [
    "sheet-pan", "skillet", "grill", "oven-roast", "braise", "stir-fry",
    "slow-cook", "pressure-cook", "soup", "salad", "pasta", "no-cook", "other",
  ],
  speed: ["quick", "weeknight", "weekend"],
};

export const LLM_TAG_DIMENSIONS = ["cuisine", "protein", "method"];

export function bucketSpeed(prepMin, cookMin) {
  const toNum = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const a = toNum(prepMin);
  const b = toNum(cookMin);
  if (a == null && b == null) return null;
  const total = (a || 0) + (b || 0);
  if (total <= 30) return "quick";
  if (total <= 60) return "weeknight";
  return "weekend";
}

export function isValidTagValue(dimension, value) {
  const list = RECIPE_TAG_TAXONOMY[dimension];
  if (!Array.isArray(list)) return false;
  return list.includes(String(value || "").toLowerCase());
}

function pickOrOther(dimension, raw) {
  const v = String(raw || "").trim().toLowerCase().replace(/\s+/g, "-");
  return isValidTagValue(dimension, v) ? v : "other";
}

// Validate an LLM response shaped like { cuisine, protein, method } and turn
// it into a flat namespaced-string array. Unknown / missing values fall back
// to "other" so we always emit one tag per dimension.
export function normalizeLLMTags(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  return LLM_TAG_DIMENSIONS.map((dim) => `${dim}:${pickOrOther(dim, src[dim])}`);
}
