// mealy — vanilla JS frontend. Hash router, fetch-based, no framework.

const view = document.getElementById("view");
const toastEl = document.getElementById("toast");
const unreadBadge = document.getElementById("unread-badge");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------- helpers ----------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { /* not json */ }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function warn({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "warn" });
    const cancel = el("button", { class: "btn btn--ghost", type: "button" }, cancelLabel);
    const ok = el("button", { class: danger ? "btn btn--danger" : "btn", type: "button" }, confirmLabel);
    cancel.addEventListener("click", () => { dlg.close(); cleanup(false); });
    ok.addEventListener("click",     () => { dlg.close(); cleanup(true); });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); dlg.close(); cleanup(false); });
    function cleanup(result) {
      setTimeout(() => dlg.remove(), 0);
      resolve(result);
    }
    dlg.append(
      el("div", { class: "warn__inner" },
        el("h2", {}, title),
        el("p",  {}, body),
        el("div", { class: "warn__actions" }, cancel, ok),
      ),
    );
    document.body.append(dlg);
    dlg.showModal();
  });
}

function toast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  requestAnimationFrame(() => { toastEl.dataset.show = "true"; });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toastEl.dataset.show = "false";
    setTimeout(() => { toastEl.hidden = true; }, 220);
  }, ms);
}

function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function fmtWeekOf(weekOf, createdAtMs) {
  // Prefer ISO `week_of`, fall back to created_at.
  if (weekOf) {
    const d = new Date(`${weekOf}T00:00:00`);
    if (!isNaN(d.getTime())) {
      const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
      return `WEEK OF ${months[d.getMonth()]} ${d.getDate()}`;
    }
  }
  return `WEEK OF ${fmtDate(createdAtMs).toUpperCase()}`;
}

function relTime(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

// ---------------- router ----------------

const routes = [
  { match: /^#\/plans\/([^\/]+)$/, view: viewPlanDetail, tab: "plans" },
  { match: /^#\/plans$/,           view: viewPlans,      tab: "plans" },
  { match: /^#\/generate$/,        view: viewGenerate,   tab: "generate" },
  { match: /^#\/recipes\/([^\/]+)$/, view: viewRecipeDetail, tab: "recipes" },
  { match: /^#\/recipes$/,         view: viewRecipes,    tab: "recipes" },
  { match: /^#\/settings$/,        view: viewSettings,   tab: "settings" },
];

async function route() {
  const hash = window.location.hash || "#/plans";
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      setActiveTab(r.tab);
      view.scrollTop = 0;
      try {
        clear(view);
        view.append(loadingEl("Loading…"));
        await r.view(...m.slice(1));
      } catch (err) {
        clear(view);
        view.append(errorEl(err.message || String(err)));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
  }
  window.location.hash = "#/plans";
}
window.addEventListener("hashchange", route);

function setActiveTab(tab) {
  for (const a of document.querySelectorAll("[data-tab]")) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function loadingEl(msg) {
  return el("div", { class: "loading" }, msg);
}
function errorEl(msg) {
  return el("div", { class: "empty" },
    el("div", { class: "empty__title" }, "Something went wrong"),
    el("div", {}, msg));
}
function emptyEl(title, body) {
  return el("div", { class: "empty" },
    el("div", { class: "empty__title" }, title),
    body ? el("div", {}, body) : null);
}

// ---------------- unread badge ----------------

async function refreshUnread() {
  try {
    const { unread_count } = await api("/plans?limit=1");
    if (unread_count > 0) {
      unreadBadge.textContent = String(unread_count);
      unreadBadge.hidden = false;
    } else {
      unreadBadge.hidden = true;
    }
  } catch (_e) { /* don't blow up UI on a transient failure */ }
}

// ---------------- views ----------------

async function viewPlans() {
  const { plans } = await api("/plans?limit=50");
  clear(view);
  view.append(
    el("h1", { class: "page-title" }, "Plans"),
    el("p",  { class: "page-sub" },
      plans.length
        ? `${plans.length} week${plans.length === 1 ? "" : "s"}`
        : "No plans yet — generate your first."),
  );

  if (!plans.length) {
    view.append(emptyEl("Nothing here yet", el("a", { href: "#/generate" }, "Generate your first plan")));
    return;
  }

  const list = el("ol", { class: "editorial-list" });
  for (const p of plans) {
    const row = el("a", { class: "editorial-row", href: `#/plans/${p.id}` },
      el("div", { class: "editorial-row__eyebrow" },
        el("span", { class: "eyebrow" }, fmtWeekOf(p.week_of, p.created_at_ms)),
        p.unread ? el("span", { class: "editorial-row__dot", "aria-label": "unread" }) : null,
      ),
      el("h2", { class: "editorial-row__headline" }, p.headline || "Untitled"),
      el("p",  { class: "editorial-row__summary"  }, p.card_summary || p.summary || ""),
      el("div", { class: "editorial-row__meta" }, `${p.meal_count} meals · ${relTime(p.created_at_ms)}`),
    );
    list.append(row);
  }
  view.append(list);
}

async function viewPlanDetail(id) {
  const [{ plan }] = await Promise.all([api(`/plans/${id}`)]);
  // Fire-and-forget the read marker
  api(`/plans/${id}/read`, { method: "POST" }).then(refreshUnread).catch(() => {});

  clear(view);
  view.append(
    el("a", { class: "back-link", href: "#/plans" }, "Plans"),
    el("div", { class: "plan-hero" },
      el("div", { class: "eyebrow" }, fmtWeekOf(plan.week_of, plan.created_at_ms)),
      el("h1",  { class: "page-title" }, plan.headline || plan.summary || "Untitled"),
      plan.card_summary ? el("p", { class: "italic-lede" }, plan.card_summary) : null,
      Array.isArray(plan.bridge_ingredients) && plan.bridge_ingredients.length
        ? el("div", { class: "bridge" }, "Bridge ingredients: ", plan.bridge_ingredients.join(", "))
        : null,
    ),
  );

  async function handleRegen(oldMeal, oldNode) {
    const res = await api(`/plans/${plan.id}/meals/${encodeURIComponent(oldMeal.id)}/regen`, {
      method: "POST",
    });
    const updatedPlan = res.plan;
    const idx = (updatedPlan.meals || []).findIndex((m) => m.id !== oldMeal.id && !document.querySelector(`[data-meal-id="${m.id}"]`));
    // Find the position of the old node and the new meal that took its place
    const oldIdx = (plan.meals || []).findIndex((m) => m.id === oldMeal.id);
    plan.meals = updatedPlan.meals;
    plan.grocery_list = updatedPlan.grocery_list;
    plan.summary = updatedPlan.summary;
    const newMeal = plan.meals[oldIdx];
    const newNode = mealBlock(newMeal, oldIdx + 1, plan.id, { onRegen: handleRegen });
    newNode.dataset.mealId = newMeal.id;
    oldNode.replaceWith(newNode);
    toast(`Replaced with ${newMeal.name}`);
    // Refresh the grocery list section too
    refreshGroceryList(plan);
  }

  (plan.meals || []).forEach((meal, i) => {
    const node = mealBlock(meal, i + 1, plan.id, { onRegen: handleRegen });
    node.dataset.mealId = meal.id;
    view.append(node);
  });

  // Grocery list
  if (Array.isArray(plan.grocery_list) && plan.grocery_list.length) {
    view.append(el("h2", { class: "section-head" }, "Grocery list"));
    const ul = el("ul", { class: "grocery" });
    for (const item of plan.grocery_list) ul.append(el("li", {}, item));
    view.append(ul);
  }

  // Feedback
  const ta = el("textarea", {
    rows: 4,
    placeholder: "How did this week go? Likes, dislikes, anything to remember…",
  });
  ta.value = plan.feedback_text || "";
  const saveBtn = el("button", { class: "btn", type: "button" }, "Save feedback");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      await api(`/plans/${id}/feedback`, {
        method: "PATCH",
        body: JSON.stringify({ feedback_text: ta.value }),
      });
      toast("Feedback saved");
    } catch (err) {
      toast(`Save failed: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save feedback";
    }
  });

  view.append(
    el("h2", { class: "section-head" }, "Feedback"),
    el("label", { class: "field" },
      el("span", { class: "label" }, "Notes from this week"),
      ta),
    saveBtn,
  );

  // Danger zone — delete plan
  const delBtn = el("button", { class: "btn btn--danger", type: "button" }, "Delete plan");
  delBtn.addEventListener("click", async () => {
    const ok = await warn({
      title: "Delete this plan?",
      body: `“${plan.headline || plan.summary || "Untitled"}” will be removed permanently. Saved recipes are not affected.`,
      confirmLabel: "Delete plan",
      cancelLabel: "Keep plan",
      danger: true,
    });
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = "Deleting…";
    try {
      await api(`/plans/${plan.id}`, { method: "DELETE" });
      toast("Plan deleted");
      await refreshUnread();
      window.location.hash = "#/plans";
    } catch (err) {
      toast(`Delete failed: ${err.message}`);
      delBtn.disabled = false;
      delBtn.textContent = "Delete plan";
    }
  });
  view.append(
    el("div", { class: "danger-zone" },
      el("div", { class: "eyebrow" }, "Danger zone"),
      el("p", { class: "page-sub", style: "margin-top:12px;" }, "Deleting this plan removes it from history. Saved recipes survive."),
      delBtn,
    ),
  );
}

function refreshGroceryList(plan) {
  // Find the existing grocery list and replace it in place
  const groceryHeading = [...document.querySelectorAll(".section-head")].find((n) => n.textContent.trim() === "Grocery list");
  if (!groceryHeading) return;
  const next = groceryHeading.nextElementSibling;
  if (!next || !next.classList?.contains("grocery")) return;
  const ul = el("ul", { class: "grocery" });
  for (const item of plan.grocery_list || []) ul.append(el("li", {}, item));
  next.replaceWith(ul);
}

function mealBlock(meal, num, planId, { onRegen } = {}) {
  const wrap = el("article", { class: "meal" });

  const star = el("button", {
    class: "meal__star",
    type: "button",
    "aria-label": meal.saved ? "Unsave recipe" : "Save recipe",
    "aria-pressed": meal.saved ? "true" : "false",
  }, meal.saved ? "★" : "☆");
  star.addEventListener("click", async () => {
    const wasSaved = star.getAttribute("aria-pressed") === "true";
    try {
      if (wasSaved) {
        await api(`/recipes/${encodeURIComponent(meal.id)}`, { method: "DELETE" });
        star.setAttribute("aria-pressed", "false");
        star.textContent = "☆";
        star.setAttribute("aria-label", "Save recipe");
        toast("Removed from recipes");
      } else {
        await api("/recipes", {
          method: "POST",
          body: JSON.stringify({ meal_id: meal.id, source_plan_id: planId, meal }),
        });
        star.setAttribute("aria-pressed", "true");
        star.textContent = "★";
        star.setAttribute("aria-label", "Unsave recipe");
        star.classList.remove("pop");
        void star.offsetWidth;
        star.classList.add("pop");
        toast("Saved to recipes");
      }
    } catch (err) {
      toast(`Failed: ${err.message}`);
    }
  });

  // Regen button — only shown when a planId and onRegen handler exist
  // (i.e. not on the standalone Recipe detail view).
  let redo = null;
  if (planId && onRegen) {
    redo = el("button", {
      class: "meal__redo",
      type: "button",
      title: "Regenerate this meal",
      "aria-label": "Regenerate this meal",
    }, "↻");
    redo.addEventListener("click", async () => {
      const ok = await warn({
        title: "Replace this meal?",
        body: `“${meal.name}” will be swapped for a brand-new meal in the same slot. The grocery list will be rebuilt. This can take up to a minute.`,
        confirmLabel: "Regenerate",
        cancelLabel: "Keep this meal",
      });
      if (!ok) return;
      redo.disabled = true;
      star.disabled = true;
      redo.classList.add("spin");
      try {
        await onRegen(meal, wrap);
      } catch (err) {
        toast(`Regen failed: ${err.message}`);
      } finally {
        redo.disabled = false;
        star.disabled = false;
        redo.classList.remove("spin");
      }
    });
  }

  const times = [];
  if (meal.prep_time_min) times.push(`Prep ${meal.prep_time_min} min`);
  if (meal.cook_time_min) times.push(`Cook ${meal.cook_time_min} min`);
  if (meal.servings)      times.push(`Serves ${meal.servings}`);

  wrap.append(
    el("header", { class: "meal__head" },
      el("h3",  { class: "meal__name" }, meal.name || "Untitled"),
      redo || el("span"),
      star,
    ),
    meal.description ? el("p", { class: "meal__desc" }, meal.description) : null,
    times.length ? el("div", { class: "meal__meta" }, times.join(" · ")) : null,
  );

  // Ingredients
  if (Array.isArray(meal.ingredients) && meal.ingredients.length) {
    wrap.append(el("div", { class: "meal__subhead" }, "Ingredients"));
    const dl = el("dl", { class: "ingredients" });
    for (const ing of meal.ingredients) {
      const { qty, name } = splitIngredient(ing);
      dl.append(el("dt", {}, qty), el("dd", {}, name));
    }
    wrap.append(dl);
  }

  // Method
  if (Array.isArray(meal.instructions) && meal.instructions.length) {
    wrap.append(el("div", { class: "meal__subhead" }, "Method"));
    const ol = el("ol", { class: "method" });
    for (const step of meal.instructions) ol.append(el("li", {}, step));
    wrap.append(ol);
  }

  return wrap;
}

function splitIngredient(ing) {
  // "1 lb chicken breast" → { qty: "1 lb", name: "chicken breast" }
  const m = String(ing || "").match(/^([\d./\s]+(?:oz|lb|lbs|cup|cups|tbsp|tsp|can|cans|bunch|head|bag|cloves?|stalks?|sprigs?|pinch|dash)?\b\.?)\s+(.+)$/i);
  if (m) return { qty: m[1].trim(), name: m[2].trim() };
  return { qty: "", name: String(ing || "") };
}

// --------- Generate ----------

let generateState = {
  mealCount: null,
  anchors: [], // array of { id, name }
  styleNote: "",
};

const RUNNING_MESSAGES = [
  "Loading the model…",
  "Composing meals…",
  "Balancing the week…",
  "Tightening the grocery list…",
  "Polishing your plan…",
];

async function viewGenerate() {
  const [{ recipes }, { config }, sched] = await Promise.all([
    api("/recipes"),
    api("/config"),
    api("/scheduler"),
  ]);
  if (generateState.mealCount == null) {
    generateState.mealCount = Number.parseInt(config.meal_count || "3", 10) || 3;
  }

  clear(view);
  view.append(
    el("h1", { class: "page-title" }, "Generate"),
    el("p",  { class: "page-sub" }, "Plan a new week."),
    el("hr", { class: "rule" }),
  );

  // Meal count stepper
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Number of meals"),
      stepperEl({
        value: generateState.mealCount,
        min: 1, max: 14,
        onChange: (v) => { generateState.mealCount = v; },
      }),
    ),
  );

  // Anchor chips
  const anchorWrap = el("div", { class: "chips" });
  function renderAnchors() {
    clear(anchorWrap);
    for (const a of generateState.anchors) {
      const x = el("button", { class: "chip__remove", type: "button", "aria-label": `Remove ${a.name}` }, "×");
      x.addEventListener("click", () => {
        generateState.anchors = generateState.anchors.filter((r) => r.id !== a.id);
        renderAnchors();
      });
      anchorWrap.append(el("span", { class: "chip chip--selected" }, a.name, x));
    }
    // Picker
    const addBtn = el("button", { class: "chip chip--ghost", type: "button" }, "+ add anchor");
    addBtn.addEventListener("click", () => openAnchorPicker(recipes));
    anchorWrap.append(addBtn);
  }
  function openAnchorPicker(allRecipes) {
    const remaining = allRecipes.filter((r) => !generateState.anchors.some((a) => a.id === r.id));
    if (!remaining.length) { toast("No more saved recipes to pick"); return; }
    // Lightweight inline picker — list of buttons
    const picker = el("div", { class: "diag" });
    picker.style.maxHeight = "200px";
    picker.style.overflowY = "auto";
    for (const r of remaining) {
      const b = el("button", { class: "btn btn--ghost", type: "button" }, r.name);
      b.style.margin = "4px 4px 4px 0";
      b.style.minHeight = "40px";
      b.addEventListener("click", () => {
        generateState.anchors.push({ id: r.id, name: r.name });
        renderAnchors();
        picker.remove();
      });
      picker.append(b);
    }
    anchorWrap.after(picker);
  }
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Style anchors"),
      el("div", { class: "row__value", style: "margin-bottom:8px;" }, "Pick saved recipes to echo in cuisine and technique."),
      anchorWrap,
    ),
  );
  renderAnchors();

  // Style note
  const noteTa = el("textarea", { rows: 2, placeholder: "Optional — e.g. 'lean weeknight bistro' or 'more grilling'" });
  noteTa.value = generateState.styleNote;
  noteTa.addEventListener("input", () => { generateState.styleNote = noteTa.value; });
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Style note (optional)"),
      noteTa,
    ),
    el("hr", { class: "rule" }),
  );

  // Generate button + running state
  const runWrap = el("div", {});
  const genBtn = el("button", { class: "btn btn--block", type: "button" }, "Generate plan");
  runWrap.append(genBtn);

  const meta = el("div", { class: "editorial-row__meta", style: "margin-top:12px;" });
  function paintLastRun(s) {
    if (s.running) { meta.textContent = "Running…"; return; }
    if (s.last_run_ms) {
      const status = s.last_status === "error" ? `failed (${s.last_error || "unknown"})` : s.last_status || "ok";
      meta.textContent = `Last run: ${relTime(s.last_run_ms)} · ${status}`;
    } else {
      meta.textContent = "No previous runs.";
    }
  }
  paintLastRun(sched);
  runWrap.append(meta);
  view.append(runWrap);

  genBtn.addEventListener("click", async () => {
    genBtn.disabled = true;
    const statusEl = el("div", { class: "running-status" }, RUNNING_MESSAGES[0]);
    genBtn.replaceWith(statusEl);

    let msgIdx = 0;
    const cycler = setInterval(() => {
      msgIdx = (msgIdx + 1) % RUNNING_MESSAGES.length;
      statusEl.style.opacity = "0";
      setTimeout(() => {
        statusEl.textContent = RUNNING_MESSAGES[msgIdx];
        statusEl.style.opacity = "1";
      }, 200);
    }, 7000);

    try {
      await api("/plans/run", {
        method: "POST",
        body: JSON.stringify({
          meal_count: generateState.mealCount,
          seed_recipe_ids: generateState.anchors.map((a) => a.id),
          style_note: generateState.styleNote,
        }),
      });
      // Poll for completion
      const startMs = Date.now();
      let lastId = (await api("/plans?limit=1")).plans?.[0]?.id || null;
      const poll = setInterval(async () => {
        try {
          const s = await api("/scheduler");
          if (!s.running) {
            const { plans } = await api("/plans?limit=1");
            const top = plans?.[0];
            if (top && (!lastId || top.id !== lastId) && top.created_at_ms >= startMs - 5000) {
              clearInterval(poll);
              clearInterval(cycler);
              await refreshUnread();
              window.location.hash = `#/plans/${top.id}`;
              return;
            }
            if (s.last_status === "error") {
              clearInterval(poll);
              clearInterval(cycler);
              toast(`Failed: ${s.last_error || "unknown"}`);
              route(); // refresh the page
              return;
            }
          }
        } catch (_e) { /* keep polling */ }
      }, 4000);
    } catch (err) {
      clearInterval(cycler);
      toast(`Failed: ${err.message}`);
      route();
    }
  });
}

function stepperEl({ value, min = 1, max = 14, onChange }) {
  const valEl = el("span", { class: "stepper__value" }, String(value));
  let v = value;
  function set(nv) {
    v = Math.max(min, Math.min(max, nv));
    valEl.textContent = String(v);
    onChange?.(v);
  }
  const dec = el("button", { type: "button", "aria-label": "Decrease" }, "−");
  const inc = el("button", { type: "button", "aria-label": "Increase" }, "+");
  dec.addEventListener("click", () => set(v - 1));
  inc.addEventListener("click", () => set(v + 1));
  return el("div", { class: "stepper" }, dec, valEl, inc);
}

// --------- Recipes ----------

async function viewRecipes() {
  const { recipes } = await api("/recipes?limit=100");
  clear(view);
  view.append(
    el("h1", { class: "page-title" }, "Recipes"),
    el("p",  { class: "page-sub" }, recipes.length ? `${recipes.length} saved` : "No saved recipes yet."),
  );

  if (!recipes.length) {
    view.append(emptyEl("Nothing saved yet", "Open a plan and tap ☆ to save meals as recipes."));
    return;
  }

  const list = el("ol", { class: "editorial-list" });
  for (const r of recipes) {
    list.append(
      el("a", { class: "editorial-row", href: `#/recipes/${r.id}` },
        el("div", { class: "editorial-row__eyebrow" },
          el("span", { class: "eyebrow" }, fmtDate(r.created_at_ms).toUpperCase()),
          el("span", { class: "editorial-row__star" }, "★"),
        ),
        el("h2", { class: "editorial-row__headline" }, r.name),
        r.description ? el("p", { class: "editorial-row__summary" }, r.description) : null,
        el("div", { class: "editorial-row__meta" }, recipeMeta(r)),
      ),
    );
  }
  view.append(list);
}

function recipeMeta(r) {
  const parts = [];
  if (r.prep_time_min) parts.push(`Prep ${r.prep_time_min}`);
  if (r.cook_time_min) parts.push(`Cook ${r.cook_time_min}`);
  if (r.servings)      parts.push(`Serves ${r.servings}`);
  return parts.join(" · ");
}

async function viewRecipeDetail(id) {
  const { recipe } = await api(`/recipes/${id}`);
  // The full meal object is in recipe.recipe
  const meal = recipe.recipe || {
    id: recipe.meal_id,
    name: recipe.name,
    description: recipe.description,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    instructions: recipe.recipe?.instructions || [],
    prep_time_min: recipe.prep_time_min,
    cook_time_min: recipe.cook_time_min,
  };
  meal.id = meal.id || recipe.meal_id;
  meal.saved = true;

  clear(view);
  view.append(
    el("a", { class: "back-link", href: "#/recipes" }, "Recipes"),
    el("div", { class: "plan-hero" },
      el("div", { class: "eyebrow" }, "SAVED RECIPE"),
      el("h1",  { class: "page-title" }, meal.name || "Untitled"),
      meal.description ? el("p", { class: "italic-lede" }, meal.description) : null,
    ),
    el("hr", { class: "rule-thick" }),
    mealBlock(meal, 1, recipe.source_plan_id || ""),
  );
}

// --------- Settings ----------

async function viewSettings() {
  const [{ config }, { preferences }, sched, llmH] = await Promise.all([
    api("/config"),
    api("/preferences"),
    api("/scheduler"),
    api("/llm/health"),
  ]);

  clear(view);
  view.append(el("h1", { class: "page-title" }, "Settings"));

  // ----- System prompt -----
  view.append(el("h2", { class: "section-head" }, "System prompt"));
  const promptTa = el("textarea", { rows: 18, "aria-label": "System prompt" });
  promptTa.value = config.system_prompt || "";
  const promptSave = el("button", { class: "btn", type: "button" }, "Save prompt");
  promptSave.addEventListener("click", async () => {
    promptSave.disabled = true;
    promptSave.textContent = "Saving…";
    try {
      await api("/config", { method: "PATCH", body: JSON.stringify({ key: "system_prompt", value: promptTa.value }) });
      toast("Prompt saved");
    } catch (err) {
      toast(`Save failed: ${err.message}`);
    } finally {
      promptSave.disabled = false;
      promptSave.textContent = "Save prompt";
    }
  });
  view.append(promptTa, el("div", { style: "margin-top:12px;" }, promptSave));

  // ----- Defaults -----
  view.append(el("h2", { class: "section-head" }, "Defaults"));
  let curCount = Number.parseInt(config.meal_count || "3", 10) || 3;
  const countStep = stepperEl({
    value: curCount, min: 1, max: 14,
    onChange: async (v) => {
      curCount = v;
      try {
        await api("/config", { method: "PATCH", body: JSON.stringify({ key: "meal_count", value: String(v) }) });
      } catch (err) {
        toast(`Save failed: ${err.message}`);
      }
    },
  });
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Default meal count"),
      countStep,
    ),
  );

  // ----- Preferences -----
  view.append(el("h2", { class: "section-head" }, "Preferences"));
  const prefList = el("div", {});
  function renderPrefs(items) {
    clear(prefList);
    if (!items.length) {
      prefList.append(el("div", { class: "row__value" }, "No preferences yet."));
      return;
    }
    for (const p of items) {
      const x = el("button", { class: "x", type: "button", "aria-label": `Remove ${p.value}` }, "×");
      x.addEventListener("click", async () => {
        try {
          await api(`/preferences/${p.id}`, { method: "DELETE" });
          const refreshed = (await api("/preferences")).preferences;
          renderPrefs(refreshed);
        } catch (err) { toast(`Delete failed: ${err.message}`); }
      });
      prefList.append(
        el("div", { class: "pref-row" },
          el("span", { class: "chip", dataset: { kind: p.kind } }, p.kind),
          el("span", {}, p.value),
          x,
        ),
      );
    }
  }
  renderPrefs(preferences);
  view.append(prefList);

  const kindSelect = el("select", {},
    ...["like", "dislike", "allergy", "staple", "note"].map((k) => el("option", { value: k }, k)));
  const valueInput = el("input", { type: "text", placeholder: "e.g. no shellfish" });
  const addBtn = el("button", { class: "btn", type: "button" }, "Add");
  addBtn.addEventListener("click", async () => {
    const value = valueInput.value.trim();
    if (!value) { valueInput.focus(); return; }
    addBtn.disabled = true;
    try {
      await api("/preferences", {
        method: "POST",
        body: JSON.stringify({ kind: kindSelect.value, value }),
      });
      valueInput.value = "";
      const refreshed = (await api("/preferences")).preferences;
      renderPrefs(refreshed);
    } catch (err) {
      toast(`Add failed: ${err.message}`);
    } finally {
      addBtn.disabled = false;
    }
  });
  view.append(el("div", { class: "add-form" }, kindSelect, valueInput, addBtn));

  // ----- Scheduler -----
  view.append(el("h2", { class: "section-head" }, "Scheduler"));

  const enabledBtn = el("button", {
    class: "toggle", type: "button",
    "aria-pressed": String(sched.enabled),
  },
    el("span", { class: "toggle__switch" }),
    el("span", {}, "Auto-generate weekly"),
  );
  enabledBtn.addEventListener("click", async () => {
    const next = enabledBtn.getAttribute("aria-pressed") !== "true";
    enabledBtn.setAttribute("aria-pressed", String(next));
    try {
      await api("/config", { method: "PATCH", body: JSON.stringify({ key: "scheduler_enabled", value: String(next) }) });
    } catch (err) { toast(`Save failed: ${err.message}`); }
  });
  view.append(el("div", { style: "margin: 16px 0;" }, enabledBtn));

  // Day pills
  const dayPills = el("div", { class: "day-pills" });
  let curDay = Number(sched.day);
  for (let i = 0; i < 7; i++) {
    const b = el("button", { type: "button", "aria-pressed": String(i === curDay) }, DAY_NAMES[i]);
    b.addEventListener("click", async () => {
      curDay = i;
      for (const child of dayPills.children) {
        child.setAttribute("aria-pressed", String(child === b));
      }
      try {
        await api("/config", { method: "PATCH", body: JSON.stringify({ key: "scheduler_day", value: String(i) }) });
      } catch (err) { toast(`Save failed: ${err.message}`); }
    });
    dayPills.append(b);
  }
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Day"),
      dayPills,
    ),
  );

  // Hour stepper
  let curHour = Number(sched.hour);
  const hourValEl = el("span", { class: "stepper__value" }, `${String(curHour).padStart(2, "0")}:00`);
  function setHour(v) {
    curHour = (v + 24) % 24;
    hourValEl.textContent = `${String(curHour).padStart(2, "0")}:00`;
    api("/config", { method: "PATCH", body: JSON.stringify({ key: "scheduler_hour", value: String(curHour) }) })
      .catch((err) => toast(`Save failed: ${err.message}`));
  }
  const hourDec = el("button", { type: "button", "aria-label": "Earlier" }, "−");
  const hourInc = el("button", { type: "button", "aria-label": "Later" }, "+");
  hourDec.addEventListener("click", () => setHour(curHour - 1));
  hourInc.addEventListener("click", () => setHour(curHour + 1));
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Hour (24h)"),
      el("div", { class: "stepper" }, hourDec, hourValEl, hourInc),
    ),
  );

  if (sched.next_run_ms) {
    view.append(
      el("div", { class: "row" },
        el("span", { class: "row__label" }, "Next run"),
        el("span", { class: "row__value" }, new Date(sched.next_run_ms).toLocaleString()),
      ),
    );
  }

  // ----- LLM health -----
  view.append(el("h2", { class: "section-head" }, "System health"));
  view.append(
    el("div", { class: "status-line" },
      el("span", { class: `status-dot ${llmH.ok ? "status-dot--ok" : "status-dot--err"}` }),
      el("span", {}, llmH.ok
        ? `LLM reachable — ${llmH.model || "unknown"}`
        : `LLM unreachable — check LLM_BASE_URL (${llmH.base_url})`),
    ),
    el("details", { class: "diag" },
      el("summary", {}, "diagnostics"),
      el("pre", {}, JSON.stringify(llmH, null, 2)),
    ),
  );

  // ----- Manual run -----
  view.append(el("h2", { class: "section-head" }, "Manual run"));
  const runBtn = el("button", { class: "btn btn--block", type: "button" }, "Run scheduler now");
  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    try {
      await api("/scheduler/run-now", { method: "POST" });
      toast("Started — check Plans in a minute.");
    } catch (err) {
      toast(`Failed: ${err.message}`);
    } finally {
      setTimeout(() => {
        runBtn.disabled = false;
        runBtn.textContent = "Run scheduler now";
      }, 1500);
    }
  });
  view.append(runBtn);
}

// ---------------- boot ----------------

refreshUnread();
setInterval(refreshUnread, 30_000);
route();
