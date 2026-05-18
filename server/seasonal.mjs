// Month-by-month seasonal produce for Vancouver, BC. Used to bias the meal
// planner toward fresh local ingredients. Originally copied from Facey; users
// can now override per-month produce/notes via the settings page — those
// overrides live in the `seasonal_overrides` config key and are merged on top
// of these defaults at read time.

const SEASONAL_DEFAULTS = {
  1: {
    name: "January",
    produce: [
      "kale", "cabbage", "leeks", "parsnips", "carrots", "beets",
      "turnips", "celery root", "winter squash", "potatoes",
      "Brussels sprouts", "stored apples", "pears",
    ],
    notes: "Deep winter — root vegetables and brassicas dominate. Good for soups, stews, and roasts.",
  },
  2: {
    name: "February",
    produce: [
      "kale", "cabbage", "leeks", "parsnips", "carrots", "beets",
      "turnips", "celery root", "winter squash", "potatoes",
      "Brussels sprouts", "stored apples",
    ],
    notes: "Still winter storage season. Hearty, warming meals. Early greenhouse greens may appear.",
  },
  3: {
    name: "March",
    produce: [
      "kale", "cabbage", "leeks", "carrots", "beets", "potatoes",
      "overwintered spinach", "early radishes", "stored squash",
    ],
    notes: "Transition month — storage crops winding down, first spring greens emerging.",
  },
  4: {
    name: "April",
    produce: [
      "asparagus", "radishes", "spinach", "arugula", "green onions",
      "rhubarb", "lettuce", "early peas", "sorrel", "kale",
      "nettles", "fiddleheads",
    ],
    notes: "Spring arrives. Light, fresh flavours — asparagus and rhubarb are stars. Great for salads and light sautees.",
  },
  5: {
    name: "May",
    produce: [
      "asparagus", "radishes", "spinach", "arugula", "lettuce",
      "rhubarb", "peas", "green onions", "strawberries",
      "new potatoes", "bok choy", "spring onions", "herbs (chives, parsley, dill)",
    ],
    notes: "Spring peak. First strawberries, peas, and tender greens. Light grilling season starts.",
  },
  6: {
    name: "June",
    produce: [
      "strawberries", "peas", "lettuce", "spinach", "radishes",
      "green beans", "new potatoes", "zucchini", "beets",
      "cherries", "herbs (basil, cilantro, dill, mint)",
      "garlic scapes", "bok choy", "broccoli",
    ],
    notes: "Early summer bounty. Strawberries and cherries peak. Perfect for grilling and fresh salads.",
  },
  7: {
    name: "July",
    produce: [
      "cherries", "blueberries", "raspberries", "strawberries",
      "zucchini", "green beans", "cucumber", "tomatoes",
      "corn", "peppers", "beets", "carrots", "broccoli",
      "fresh herbs (basil, cilantro, dill)", "new potatoes",
    ],
    notes: "Peak summer. Berries exploding. Tomatoes and corn arriving. Best grilling and fresh eating season.",
  },
  8: {
    name: "August",
    produce: [
      "tomatoes", "corn", "peppers", "zucchini", "cucumber",
      "eggplant", "green beans", "blueberries", "blackberries",
      "peaches", "plums", "carrots", "beets", "onions",
      "garlic", "fresh herbs", "melons",
    ],
    notes: "Summer peak — everything is ripe. Tomatoes, stone fruit, and corn at their best. Abundance season.",
  },
  9: {
    name: "September",
    produce: [
      "tomatoes", "corn", "peppers", "eggplant", "zucchini",
      "apples", "pears", "plums", "grapes", "blackberries",
      "winter squash", "carrots", "beets", "onions", "garlic",
      "potatoes", "kale", "cauliflower", "broccoli",
    ],
    notes: "Harvest season. Summer and fall overlap — last tomatoes plus first squash and apples.",
  },
  10: {
    name: "October",
    produce: [
      "apples", "pears", "winter squash", "pumpkin", "kale",
      "Brussels sprouts", "cauliflower", "broccoli", "carrots",
      "beets", "potatoes", "onions", "leeks", "cabbage",
      "cranberries", "mushrooms (chanterelles, pine)",
    ],
    notes: "Fall harvest. Squash, apples, and wild mushrooms. Warm, roasted, and braised dishes.",
  },
  11: {
    name: "November",
    produce: [
      "kale", "cabbage", "Brussels sprouts", "winter squash",
      "carrots", "parsnips", "beets", "turnips", "potatoes",
      "leeks", "apples", "pears", "cranberries",
      "mushrooms (chanterelles)",
    ],
    notes: "Late fall into winter. Root vegetables and brassicas. Comfort food season — braises, soups, roasts.",
  },
  12: {
    name: "December",
    produce: [
      "kale", "cabbage", "Brussels sprouts", "winter squash",
      "carrots", "parsnips", "beets", "turnips", "potatoes",
      "leeks", "celery root", "stored apples", "pears",
    ],
    notes: "Winter storage season. Hearty root vegetables and brassicas. Holiday-friendly roasts and sides.",
  },
};

function loadOverrides(store) {
  if (!store) return {};
  const raw = store.getConfig("seasonal_overrides");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function resolveMonth(month, overrides) {
  const def = SEASONAL_DEFAULTS[month];
  if (!def) return null;
  const ov = overrides?.[String(month)];
  const produce = Array.isArray(ov?.produce) ? ov.produce : def.produce;
  const notes   = typeof ov?.notes === "string" ? ov.notes : def.notes;
  const isModified = !!ov && (Array.isArray(ov.produce) || typeof ov.notes === "string");
  return {
    month,
    name: def.name,
    produce,
    notes,
    is_modified: isModified,
    default_produce: def.produce,
    default_notes: def.notes,
  };
}

export function getSeasonalContext(store, date = new Date()) {
  const month = date.getMonth() + 1;
  const resolved = resolveMonth(month, loadOverrides(store));
  if (!resolved) return "";

  const lines = [
    `It's ${resolved.name} in Vancouver, BC. The following local produce is in season:`,
    resolved.produce.join(", "),
    "",
    resolved.notes,
    "",
    "Lean into seasonal ingredients where they fit naturally — don't force it, but prefer what's fresh and local over out-of-season imports.",
  ];
  return lines.join("\n");
}

export function getSeasonalTable(store, date = new Date()) {
  const currentMonth = date.getMonth() + 1;
  const overrides = loadOverrides(store);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const resolved = resolveMonth(m, overrides);
    if (resolved) months.push(resolved);
  }
  return { region: "Vancouver, BC", current_month: currentMonth, months };
}

// Persist an override for a single month. `patch` may contain `produce`
// (array of non-empty strings) and/or `notes` (string). Pass `null` for a
// field to drop that override and fall back to the default. Returns the
// updated table.
export function setSeasonalOverride(store, month, patch) {
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error("month must be an integer 1-12");
  }
  const overrides = loadOverrides(store);
  const key = String(m);
  const next = { ...(overrides[key] || {}) };

  if (patch && "produce" in patch) {
    if (patch.produce === null) {
      delete next.produce;
    } else if (Array.isArray(patch.produce)) {
      next.produce = patch.produce
        .map((p) => String(p).trim())
        .filter(Boolean);
    }
  }
  if (patch && "notes" in patch) {
    if (patch.notes === null) {
      delete next.notes;
    } else {
      next.notes = String(patch.notes);
    }
  }

  if (Object.keys(next).length === 0) {
    delete overrides[key];
  } else {
    overrides[key] = next;
  }
  store.setConfig("seasonal_overrides", JSON.stringify(overrides));
  return getSeasonalTable(store);
}

export function resetSeasonalMonth(store, month) {
  return setSeasonalOverride(store, month, { produce: null, notes: null });
}
