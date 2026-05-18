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

function warn({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, input = null }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "warn" });
    const cancel = el("button", { class: "btn btn--ghost", type: "button" }, cancelLabel);
    const ok = el("button", { class: danger ? "btn btn--danger" : "btn", type: "button" }, confirmLabel);
    let inputEl = null;
    if (input) {
      inputEl = el("textarea", {
        class: "warn__input",
        rows: input.rows || 3,
        placeholder: input.placeholder || "",
        "aria-label": input.label || "Notes",
      });
    }
    function done(confirmed) {
      dlg.close();
      const value = inputEl ? inputEl.value.trim() : "";
      const result = input ? { ok: confirmed, value: confirmed ? value : "" } : confirmed;
      setTimeout(() => dlg.remove(), 0);
      resolve(result);
    }
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click",     () => done(true));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    const inner = el("div", { class: "warn__inner" },
      el("h2", {}, title),
      el("p",  {}, body),
    );
    if (inputEl) {
      inner.append(
        input.label ? el("label", { class: "warn__input-label" }, input.label) : null,
        inputEl,
      );
    }
    inner.append(el("div", { class: "warn__actions" }, cancel, ok));
    dlg.append(inner);
    document.body.append(dlg);
    dlg.showModal();
    if (inputEl) inputEl.focus();
  });
}

function openHistoryModal(meal) {
  const revisions = Array.isArray(meal?.revisions) ? meal.revisions : [];
  const dlg = el("dialog", { class: "history" });
  const close = el("button", { class: "btn btn--ghost", type: "button" }, "Close");
  close.addEventListener("click", () => dlg.close());
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); dlg.close(); });
  dlg.addEventListener("close", () => setTimeout(() => dlg.remove(), 0));

  const list = el("ol", { class: "history__list" });
  // Most recent revision first; the array from the API is oldest-first.
  for (const rev of [...revisions].reverse()) {
    const m = rev.meal || {};
    const times = [];
    if (m.prep_time_min) times.push(`Prep ${m.prep_time_min} min`);
    if (m.cook_time_min) times.push(`Cook ${m.cook_time_min} min`);
    if (m.servings)      times.push(`Serves ${m.servings}`);

    const item = el("li", { class: "history__item" },
      el("div", { class: "history__when" }, `Replaced ${relTime(rev.replaced_at_ms)}`),
      el("div", { class: "history__name" }, m.name || "Untitled"),
      m.description ? el("div", { class: "history__desc" }, m.description) : null,
      times.length ? el("div", { class: "history__times" }, times.join(" · ")) : null,
    );
    appendRecipeBody(item, m);
    if (rev.feedback_text) {
      item.append(el("div", { class: "history__note" }, `“${rev.feedback_text}”`));
    }
    list.append(item);
  }

  dlg.append(el("div", { class: "history__inner" },
    el("h2", {}, "Version history"),
    el("p", { class: "history__sub" }, `${revisions.length} prior version${revisions.length === 1 ? "" : "s"} of “${meal?.name || "this meal"}”.`),
    list,
    el("div", { class: "history__actions" }, close),
  ));
  document.body.append(dlg);
  dlg.showModal();
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

  async function handleRegen(oldMeal, oldNode, steerNote, { mode = "swap" } = {}) {
    const res = await api(`/plans/${plan.id}/meals/${encodeURIComponent(oldMeal.id)}/regen`, {
      method: "POST",
      body: JSON.stringify({ steer_note: steerNote || "", mode }),
    });
    const updatedPlan = res.plan;
    // Find the position of the old node and the new meal that took its place
    const oldIdx = (plan.meals || []).findIndex((m) => m.id === oldMeal.id);
    plan.meals = updatedPlan.meals;
    plan.grocery_list = updatedPlan.grocery_list;
    plan.summary = updatedPlan.summary;
    const newMeal = plan.meals[oldIdx];
    const newNode = mealBlock(newMeal, oldIdx + 1, plan.id, { onRegen: handleRegen });
    newNode.dataset.mealId = newMeal.id;
    oldNode.replaceWith(newNode);
    toast(mode === "tune" ? `Tuned: ${newMeal.name}` : `Replaced with ${newMeal.name}`);
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
      const result = await warn({
        title: "Replace this meal?",
        body: `“${meal.name}” will be swapped for a brand-new meal in the same slot. The grocery list will be rebuilt. This can take up to a minute.`,
        confirmLabel: "Regenerate",
        cancelLabel: "Keep this meal",
        input: {
          label: "Steer the swap (optional)",
          placeholder: "e.g. 'something lighter', 'use the leftover cabbage', 'no pasta'",
          rows: 3,
        },
      });
      if (!result.ok) return;
      redo.disabled = true;
      star.disabled = true;
      redo.classList.add("spin");
      try {
        await onRegen(meal, wrap, result.value);
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

  const revisionCount = Array.isArray(meal.revisions) ? meal.revisions.length : 0;
  let metaNode = null;
  if (times.length || revisionCount) {
    metaNode = el("div", { class: "meal__meta" }, times.join(" · "));
    if (revisionCount) {
      if (times.length) metaNode.append(document.createTextNode(" · "));
      const link = el("button", {
        class: "meal__tuned-link",
        type: "button",
        title: "View prior versions",
      }, `↶ Tuned · ${revisionCount} version${revisionCount === 1 ? "" : "s"}`);
      link.addEventListener("click", () => openHistoryModal(meal));
      metaNode.append(link);
    }
  }

  wrap.append(
    el("header", { class: "meal__head" },
      el("h3",  { class: "meal__name" }, meal.name || "Untitled"),
      redo || el("span"),
      star,
    ),
    meal.description ? el("p", { class: "meal__desc" }, meal.description) : null,
    metaNode,
  );

  appendRecipeBody(wrap, meal);

  // Per-meal feedback panel (collapsed by default). Only attached when the
  // meal lives inside a plan view (Recipe detail passes no planId).
  if (planId) appendFeedbackPanel(wrap, meal, planId, { onRegen });

  return wrap;
}

function appendRecipeBody(node, meal) {
  if (Array.isArray(meal?.ingredients) && meal.ingredients.length) {
    node.append(el("div", { class: "meal__subhead" }, "Ingredients"));
    const dl = el("dl", { class: "ingredients" });
    for (const ing of meal.ingredients) {
      const { qty, name } = splitIngredient(ing);
      dl.append(el("dt", {}, qty), el("dd", {}, name));
    }
    node.append(dl);
  }
  if (Array.isArray(meal?.instructions) && meal.instructions.length) {
    node.append(el("div", { class: "meal__subhead" }, "Method"));
    const ol = el("ol", { class: "method" });
    for (const step of meal.instructions) ol.append(el("li", {}, step));
    node.append(ol);
  }
}

function appendFeedbackPanel(wrap, meal, planId, { onRegen } = {}) {
  let savedText = meal.feedback || "";
  const hasNote = () => !!(savedText && savedText.trim());
  const toggleLabel = () => hasNote() ? "✎ Feedback saved — edit" : "✎ Add feedback";

  const toggle = el("button", {
    class: "meal__feedback-toggle" + (hasNote() ? " meal__feedback-toggle--has-note" : ""),
    type: "button",
    "aria-expanded": "false",
  }, toggleLabel());

  const panel = el("div", { class: "meal__feedback-panel", hidden: true });

  const ta = el("textarea", {
    class: "meal__feedback-input",
    rows: 3,
    placeholder: "What worked, what didn't, what to change next time…",
  });
  ta.value = savedText;

  const saveBtn = el("button", { class: "btn", type: "button" }, "Save");
  const tuneBtn = onRegen
    ? el("button", { class: "btn btn--ghost", type: "button" }, "Save & tune this meal")
    : null;

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    if (tuneBtn) tuneBtn.disabled = true;
    const prevLabel = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      const res = await api(`/plans/${planId}/meals/${encodeURIComponent(meal.id)}/feedback`, {
        method: "PATCH",
        body: JSON.stringify({ feedback: ta.value }),
      });
      const updated = (res.plan?.meals || []).find((m) => m.id === meal.id);
      savedText = updated?.feedback || "";
      meal.feedback = savedText;
      meal.feedback_at_ms = updated?.feedback_at_ms || null;
      toggle.textContent = toggleLabel();
      toggle.classList.toggle("meal__feedback-toggle--has-note", hasNote());
      toast(hasNote() ? "Feedback saved" : "Feedback cleared");
    } catch (err) {
      toast(`Save failed: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      if (tuneBtn) tuneBtn.disabled = false;
      saveBtn.textContent = prevLabel;
    }
  });

  if (tuneBtn) {
    tuneBtn.addEventListener("click", async () => {
      const note = ta.value.trim();
      if (!note) { toast("Add some feedback first."); ta.focus(); return; }
      tuneBtn.disabled = true;
      saveBtn.disabled = true;
      const prevLabel = tuneBtn.textContent;
      tuneBtn.textContent = "Tuning…";
      tuneBtn.classList.add("is-loading");
      try {
        await onRegen(meal, wrap, note, { mode: "tune" });
      } catch (err) {
        toast(`Tune failed: ${err.message}`);
      } finally {
        tuneBtn.disabled = false;
        saveBtn.disabled = false;
        tuneBtn.textContent = prevLabel;
        tuneBtn.classList.remove("is-loading");
      }
    });
  }

  const actions = el("div", { class: "meal__feedback-actions" }, saveBtn);
  if (tuneBtn) actions.append(tuneBtn);
  panel.append(ta, actions);

  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) ta.focus();
  });

  wrap.append(toggle, panel);
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
  pantry: "",
};

const RUNNING_MESSAGES = [
  "Loading the model…",
  "Composing meals…",
  "Balancing the week…",
  "Tightening the grocery list…",
  "Polishing your plan…",
];

async function viewGenerate() {
  const [{ recipes }, { config }, sched, seasonal] = await Promise.all([
    api("/recipes"),
    api("/config"),
    api("/scheduler"),
    api("/seasonal"),
  ]);
  if (generateState.mealCount == null) {
    const stored = Number.parseInt(localStorage.getItem("mealy.generate.mealCount") || "", 10);
    generateState.mealCount = Number.isFinite(stored) && stored >= 1 && stored <= 14
      ? stored
      : (Number.parseInt(config.meal_count || "3", 10) || 3);
  }

  clear(view);
  view.append(
    el("h1", { class: "page-title" }, "Generate"),
    el("p",  { class: "page-sub" }, "Plan a new week."),
  );

  // Current month's seasonal influence (click any line to edit, blur to save)
  const currentMonth = (seasonal.months || []).find((m) => m.month === seasonal.current_month);
  if (currentMonth) {
    const produceEl = el("div", {
      class: "seasonal-hint__produce seasonal-hint__editable",
      contenteditable: "plaintext-only",
      spellcheck: "false",
      title: "Click to edit — saves on blur",
    }, currentMonth.produce.join(", "));

    const notesEl = el("div", {
      class: "seasonal-hint__notes seasonal-hint__editable",
      contenteditable: "plaintext-only",
      spellcheck: "false",
      title: "Click to edit — saves on blur",
    }, currentMonth.notes || "");

    let lastProduce = produceEl.textContent;
    let lastNotes   = notesEl.textContent;

    async function saveSeasonal(patch, fieldEl, fieldName) {
      fieldEl.dataset.saving = "true";
      try {
        await api(`/seasonal/${currentMonth.month}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        toast(`${currentMonth.name} ${fieldName} saved`);
      } catch (err) {
        toast(`Save failed: ${err.message}`);
      } finally {
        delete fieldEl.dataset.saving;
      }
    }

    produceEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); produceEl.blur(); }
    });
    produceEl.addEventListener("blur", () => {
      const next = produceEl.textContent.trim();
      if (next === lastProduce.trim()) return;
      const produce = next.split(",").map((s) => s.trim()).filter(Boolean);
      produceEl.textContent = produce.join(", ");
      lastProduce = produceEl.textContent;
      saveSeasonal({ produce }, produceEl, "produce");
    });

    notesEl.addEventListener("blur", () => {
      const next = notesEl.textContent.trim();
      if (next === lastNotes.trim()) return;
      lastNotes = next;
      saveSeasonal({ notes: next }, notesEl, "notes");
    });

    view.append(
      el("div", { class: "seasonal-hint" },
        el("div", { class: "seasonal-hint__eyebrow" }, `In season · ${currentMonth.name}`),
        produceEl,
        notesEl,
      ),
    );
  }

  view.append(el("hr", { class: "rule" }));

  // Meal count stepper
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Number of meals"),
      stepperEl({
        value: generateState.mealCount,
        min: 1, max: 14,
        onChange: (v) => {
          generateState.mealCount = v;
          try { localStorage.setItem("mealy.generate.mealCount", String(v)); } catch {}
        },
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
    const existing = anchorWrap.parentNode?.querySelector(":scope > .anchor-picker");
    if (existing) { existing.remove(); return; }
    const remaining = allRecipes.filter((r) => !generateState.anchors.some((a) => a.id === r.id));
    if (!remaining.length) { toast("No more saved recipes to pick"); return; }
    // Lightweight inline picker — list of buttons
    const picker = el("div", { class: "diag anchor-picker" });
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
  );

  // Pantry — ingredients we already have, soft hint to the LLM
  const pantryTa = el("textarea", { rows: 2, placeholder: "Optional — e.g. 'kewpie mayo, sour cream, half a cabbage'" });
  pantryTa.value = generateState.pantry;
  pantryTa.addEventListener("input", () => { generateState.pantry = pantryTa.value; });
  view.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "On hand (optional)"),
      el("div", { class: "row__value", style: "margin-bottom:8px;" }, "Ingredients to work in where natural — comma-separated or free text."),
      pantryTa,
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
          pantry: generateState.pantry,
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

// Tracks whether we've already kicked off the legacy-recipe backfill this
// session so navigating back to /#/recipes doesn't re-fire it.
let backfillKicked = false;

const TAG_DIMENSION_ORDER = ["cuisine", "protein", "method"];
const TAG_DIMENSION_LABELS = {
  cuisine: "Cuisine",
  protein: "Protein",
  method: "Method",
};

function parseTag(tag) {
  const idx = String(tag || "").indexOf(":");
  if (idx < 0) return { dim: "", value: String(tag || "") };
  return { dim: tag.slice(0, idx), value: tag.slice(idx + 1) };
}

function visibleTags(tags) {
  return (tags || []).filter((t) => TAG_DIMENSION_ORDER.includes(parseTag(t).dim));
}

function tagChipEl(label, { active = false, onClick, title } = {}) {
  const props = {
    class: `chip chip--tag${active ? " chip--active" : ""}`,
    type: "button",
  };
  if (title) props.title = title;
  if (onClick) props.onClick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); };
  return el("button", props, label);
}

async function viewRecipes() {
  const [{ recipes }, { taxonomy }] = await Promise.all([
    api("/recipes?limit=100"),
    api("/taxonomy"),
  ]);
  clear(view);

  // Active filter: one value per dimension. Clicking the active chip clears it.
  const active = new Map();

  // Only show dimensions that have at least one tag present in the loaded set.
  // Avoid building a 50-chip filter wall when most recipes are untagged.
  const presentByDim = {};
  for (const dim of TAG_DIMENSION_ORDER) presentByDim[dim] = new Set();
  let untaggedCount = 0;
  for (const r of recipes) {
    if (visibleTags(r.tags).length === 0) untaggedCount += 1;
    for (const t of r.tags || []) {
      const { dim, value } = parseTag(t);
      if (presentByDim[dim]) presentByDim[dim].add(value);
    }
  }
  const hasAnyFilterDim = TAG_DIMENSION_ORDER.some((dim) => presentByDim[dim].size > 0);

  // Header: title block on the left, filter toggle button on the right.
  const subEl = el("p", { class: "page-sub" },
    recipes.length ? `${recipes.length} saved` : "No saved recipes yet.");
  const filterToggle = el("button", {
    class: "filter-toggle",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "recipe-filter-panel",
  });
  const filterToggleCount = el("span", { class: "filter-toggle__count", hidden: true });
  filterToggle.append(el("span", {}, "Filter"), filterToggleCount);
  if (!hasAnyFilterDim) filterToggle.hidden = true;

  view.append(
    el("div", { class: "page-head" },
      el("div", { class: "page-head__title" },
        el("h1", { class: "page-title" }, "Recipes"),
        subEl,
      ),
      filterToggle,
    ),
  );

  if (!recipes.length) {
    view.append(emptyEl("Nothing saved yet", "Open a plan and tap ☆ to save meals as recipes."));
    return;
  }

  const filterPanel = el("div", { class: "recipe-filters", id: "recipe-filter-panel", hidden: true });

  function matchesFilter(r) {
    if (!active.size) return true;
    const tagSet = new Set(r.tags || []);
    for (const [dim, val] of active.entries()) {
      if (!tagSet.has(`${dim}:${val}`)) return false;
    }
    return true;
  }

  function renderFilterPanel() {
    clear(filterPanel);
    for (const dim of TAG_DIMENSION_ORDER) {
      const present = presentByDim[dim];
      if (!present.size) continue;
      // Preserve taxonomy order so "quick → weeknight → weekend" reads right.
      const ordered = (taxonomy?.[dim] || [...present]).filter((v) => present.has(v));
      const group = el("div", { class: "chip-group" },
        el("div", { class: "chip-group__label" }, TAG_DIMENSION_LABELS[dim] || dim),
      );
      for (const value of ordered) {
        const isActive = active.get(dim) === value;
        group.append(tagChipEl(value, {
          active: isActive,
          onClick: () => {
            if (active.get(dim) === value) active.delete(dim);
            else active.set(dim, value);
            renderFilterPanel();
            updateFilterToggle();
            renderList();
          },
        }));
      }
      filterPanel.append(group);
    }
    if (active.size) {
      const clearBtn = el("button", {
        class: "btn btn--text recipe-filters__clear",
        type: "button",
      }, "Clear filters");
      clearBtn.addEventListener("click", () => {
        active.clear();
        renderFilterPanel();
        updateFilterToggle();
        renderList();
      });
      filterPanel.append(clearBtn);
    }
  }

  function updateFilterToggle() {
    if (active.size) {
      filterToggleCount.hidden = false;
      filterToggleCount.textContent = String(active.size);
      filterToggle.classList.add("filter-toggle--has-active");
    } else {
      filterToggleCount.hidden = true;
      filterToggleCount.textContent = "";
      filterToggle.classList.remove("filter-toggle--has-active");
    }
  }

  filterToggle.addEventListener("click", () => {
    const open = filterPanel.hidden;
    filterPanel.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
    filterToggle.classList.toggle("filter-toggle--open", open);
  });

  const listWrap = el("ol", { class: "editorial-list" });
  function renderList() {
    clear(listWrap);
    const filtered = recipes.filter(matchesFilter);
    subEl.textContent = active.size
      ? `Showing ${filtered.length} of ${recipes.length}`
      : `${recipes.length} saved`;
    for (const r of filtered) {
      const shownTags = visibleTags(r.tags);
      const tagsRow = shownTags.length
        ? el("div", { class: "editorial-row__tags" },
            ...shownTags.map((t) => {
              const { value } = parseTag(t);
              return tagChipEl(value);
            }),
          )
        : null;
      listWrap.append(
        el("a", { class: "editorial-row", href: `#/recipes/${r.id}` },
          el("div", { class: "editorial-row__eyebrow" },
            el("span", { class: "eyebrow" }, fmtDate(r.created_at_ms).toUpperCase()),
            el("span", { class: "editorial-row__star" }, "★"),
          ),
          el("h2", { class: "editorial-row__headline" }, r.name),
          r.description ? el("p", { class: "editorial-row__summary" }, r.description) : null,
          el("div", { class: "editorial-row__meta" },
            recipeMeta(r),
            r.notes ? el("span", { class: "recipe-row__notes", title: "Has notes" }, " · ✎ noted") : null,
          ),
          tagsRow,
        ),
      );
    }
    if (!filtered.length) {
      listWrap.append(el("li", { class: "editorial-row__meta", style: "padding:24px 0;" },
        "No recipes match these filters."));
    }
  }

  // Auto-backfill: when legacy recipes are missing tags, fire the bulk
  // tagger once per session in the background. No button, just toasts.
  if (untaggedCount > 0 && !backfillKicked) {
    backfillKicked = true;
    toast(`Tagging ${untaggedCount} recipe${untaggedCount === 1 ? "" : "s"}…`, 3200);
    api("/recipes/retag-untagged", { method: "POST" })
      .then((res) => {
        if (res?.updated) toast(`Tagged ${res.updated} recipe${res.updated === 1 ? "" : "s"}`);
        if (window.location.hash.startsWith("#/recipes")) route();
      })
      .catch((err) => {
        backfillKicked = false; // allow retry next time they visit
        toast(`Auto-tag failed: ${err.message}`);
      });
  }

  view.append(filterPanel, listWrap);
  renderFilterPanel();
  updateFilterToggle();
  renderList();
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
  const tagsRow = el("div", { class: "recipe-detail__tags" });
  function renderTags(tags) {
    clear(tagsRow);
    const shown = visibleTags(tags);
    for (const t of shown) {
      const { value } = parseTag(t);
      tagsRow.append(tagChipEl(value));
    }
    const retag = el("button", {
      class: "btn btn--text recipe-detail__retag",
      type: "button",
    }, shown.length ? "Re-tag" : "Auto-tag");
    retag.addEventListener("click", async () => {
      retag.disabled = true;
      retag.textContent = "Tagging…";
      try {
        const res = await api(`/recipes/${id}/retag`, { method: "POST" });
        renderTags(res.recipe?.tags || []);
        toast("Tags refreshed");
      } catch (err) {
        toast(`Retag failed: ${err.message}`);
        retag.disabled = false;
        retag.textContent = "Re-tag";
      }
    });
    tagsRow.append(retag);
  }
  renderTags(recipe.tags || []);

  view.append(
    el("a", { class: "back-link", href: "#/recipes" }, "Recipes"),
    el("div", { class: "plan-hero" },
      el("div", { class: "eyebrow" }, "SAVED RECIPE"),
      el("h1",  { class: "page-title" }, meal.name || "Untitled"),
      meal.description ? el("p", { class: "italic-lede" }, meal.description) : null,
    ),
    tagsRow,
    mealBlock(meal, 1, recipe.source_plan_id || ""),
  );

  // Notes
  const notesTa = el("textarea", {
    rows: 4,
    placeholder: "What worked, what to tweak, swaps you'd remember next time…",
  });
  notesTa.value = recipe.notes || "";
  const notesSave = el("button", { class: "btn", type: "button" }, "Save notes");
  const notesMeta = el("div", { class: "editorial-row__meta", style: "margin-top:8px;" },
    recipe.notes_updated_at_ms ? `Last saved ${relTime(recipe.notes_updated_at_ms)}` : "",
  );
  notesSave.addEventListener("click", async () => {
    notesSave.disabled = true;
    notesSave.textContent = "Saving…";
    try {
      const res = await api(`/recipes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: notesTa.value }),
      });
      notesMeta.textContent = res.recipe?.notes_updated_at_ms
        ? `Last saved ${relTime(res.recipe.notes_updated_at_ms)}`
        : "";
      toast("Notes saved");
    } catch (err) {
      toast(`Save failed: ${err.message}`);
    } finally {
      notesSave.disabled = false;
      notesSave.textContent = "Save notes";
    }
  });

  view.append(
    el("h2", { class: "section-head" }, "Notes"),
    el("label", { class: "field" },
      el("span", { class: "label" }, "Personal notes on this recipe"),
      notesTa),
    notesSave,
    notesMeta,
  );
}

// --------- Settings ----------

async function viewSettings() {
  const [{ config }, { preferences }, sched, llmH, seasonal] = await Promise.all([
    api("/config"),
    api("/preferences"),
    api("/scheduler"),
    api("/llm/health"),
    api("/seasonal"),
  ]);

  clear(view);
  view.append(el("h1", { class: "page-title" }, "Settings"));

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

  // ----- A.D.A.M. (Adjustable Dinner Allowance Macros) -----
  view.append(
    el("h2", { class: "section-head" }, "A.D.A.M."),
    el("p", { class: "section-sub" },
      "Adjustable Dinner Allowance Macros. Optional targets the planner can lean on — values are per serving (one person's plate). The planner scales them by the meal's serving count, so 45 g protein on a 3-serving dinner is ~135 g across the dish. Leave blank to ignore."),
  );

  const ADAM_FIELDS = [
    { key: "adam_calories",  label: "Calories",  unit: "kcal", placeholder: "e.g. 700" },
    { key: "adam_protein_g", label: "Protein",   unit: "g",    placeholder: "e.g. 45" },
    { key: "adam_carbs_g",   label: "Carbs",     unit: "g",    placeholder: "e.g. 70" },
    { key: "adam_fat_g",     label: "Fat",       unit: "g",    placeholder: "e.g. 25" },
    { key: "adam_fiber_g",   label: "Fiber",     unit: "g",    placeholder: "e.g. 10" },
  ];

  const adamGrid = el("div", { class: "adam-grid" });
  for (const f of ADAM_FIELDS) {
    const input = el("input", {
      type: "number", min: 0, step: 1,
      inputmode: "numeric",
      placeholder: f.placeholder,
      "aria-label": `${f.label} (${f.unit})`,
    });
    input.value = config[f.key] || "";
    let saveT = null;
    input.addEventListener("input", () => {
      clearTimeout(saveT);
      saveT = setTimeout(async () => {
        try {
          await api("/config", {
            method: "PATCH",
            body: JSON.stringify({ key: f.key, value: input.value.trim() }),
          });
        } catch (err) { toast(`Save failed: ${err.message}`); }
      }, 500);
    });
    adamGrid.append(
      el("label", { class: "adam-field" },
        el("span", { class: "adam-field__label" }, f.label),
        el("div", { class: "adam-field__input" },
          input,
          el("span", { class: "adam-field__unit" }, f.unit),
        ),
      ),
    );
  }
  view.append(adamGrid);

  // ----- Seasonal produce -----
  view.append(
    el("h2", { class: "section-head" }, "Seasonal produce"),
    el("p", { class: "section-sub" },
      `What's in season around ${seasonal.region}. The planner leans toward the current month's list. Edit any month to suit your region or pantry — reset to restore the default.`),
  );

  const seasonalList = el("ol", { class: "seasonal" });
  function renderSeasonal(table) {
    clear(seasonalList);
    for (const m of table.months) {
      seasonalList.append(renderSeasonalRow(m, table.current_month));
    }
  }

  async function replaceSeasonalRow(month, oldRow) {
    const updated = await api("/seasonal");
    seasonal.months = updated.months;
    const m = updated.months.find((x) => x.month === month);
    if (!m) return;
    const fresh = renderSeasonalRow(m, updated.current_month);
    oldRow.replaceWith(fresh);
  }

  function renderSeasonalRow(m, currentMonth) {
    const isCurrent = m.month === currentMonth;
    const row = el("li", {
      class: `seasonal__row${isCurrent ? " seasonal__row--current" : ""}${m.is_modified ? " seasonal__row--modified" : ""}`,
    });

    const resetBtn = m.is_modified
      ? el("button", { class: "btn btn--text seasonal__reset", type: "button" }, "Reset")
      : null;

    const head = el("div", { class: "seasonal__head" },
      el("span", { class: "seasonal__month" }, m.name),
      isCurrent ? el("span", { class: "seasonal__badge" }, "Now") : null,
      m.is_modified ? el("span", { class: "seasonal__badge seasonal__badge--modified" }, "Modified") : null,
      resetBtn,
    );

    const produceEl = el("div", {
      class: "seasonal__produce seasonal__editable",
      contenteditable: "plaintext-only",
      spellcheck: "false",
      title: "Click to edit — saves on blur",
    }, m.produce.join(", "));

    const notesEl = el("div", {
      class: "seasonal__notes seasonal__editable",
      contenteditable: "plaintext-only",
      spellcheck: "false",
      title: "Click to edit — saves on blur",
    }, m.notes || "");

    row.append(head, produceEl, notesEl);

    let lastProduce = produceEl.textContent;
    let lastNotes   = notesEl.textContent;

    async function saveField(patch, fieldEl, fieldName) {
      fieldEl.dataset.saving = "true";
      try {
        await api(`/seasonal/${m.month}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        toast(`${m.name} ${fieldName} saved`);
        await replaceSeasonalRow(m.month, row);
      } catch (err) {
        toast(`Save failed: ${err.message}`);
        delete fieldEl.dataset.saving;
      }
    }

    produceEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); produceEl.blur(); }
    });
    produceEl.addEventListener("blur", () => {
      const next = produceEl.textContent.trim();
      if (next === lastProduce.trim()) return;
      const produce = next.split(",").map((s) => s.trim()).filter(Boolean);
      produceEl.textContent = produce.join(", ");
      lastProduce = produceEl.textContent;
      saveField({ produce }, produceEl, "produce");
    });

    notesEl.addEventListener("blur", () => {
      const next = notesEl.textContent.trim();
      if (next === lastNotes.trim()) return;
      lastNotes = next;
      saveField({ notes: next }, notesEl, "notes");
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        resetBtn.disabled = true;
        try {
          await api(`/seasonal/${m.month}`, { method: "DELETE" });
          toast(`${m.name} reset to default`);
          await replaceSeasonalRow(m.month, row);
        } catch (err) {
          toast(`Reset failed: ${err.message}`);
          resetBtn.disabled = false;
        }
      });
    }

    return row;
  }

  renderSeasonal(seasonal);
  view.append(seasonalList);

  // ----- Scheduler -----
  const enabledBtn = el("button", {
    class: "toggle", type: "button",
    "aria-pressed": String(sched.enabled),
    "aria-label": "Auto-generate weekly",
  },
    el("span", { class: "toggle__switch" }),
  );
  view.append(
    el("div", { class: "section-head section-head--with-toggle" },
      el("h2", { class: "section-head__title" }, "Scheduler"),
      enabledBtn,
    ),
  );

  const schedBody = el("div", { class: "sched-body", hidden: !sched.enabled });
  view.append(schedBody);

  enabledBtn.addEventListener("click", async () => {
    const next = enabledBtn.getAttribute("aria-pressed") !== "true";
    enabledBtn.setAttribute("aria-pressed", String(next));
    schedBody.hidden = !next;
    try {
      await api("/config", { method: "PATCH", body: JSON.stringify({ key: "scheduler_enabled", value: String(next) }) });
    } catch (err) { toast(`Save failed: ${err.message}`); }
  });

  // Meal count (formerly in Defaults)
  let curCount = Number.parseInt(config.meal_count || "3", 10) || 3;
  schedBody.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Meals per plan"),
      stepperEl({
        value: curCount, min: 1, max: 14,
        onChange: async (v) => {
          curCount = v;
          try {
            await api("/config", { method: "PATCH", body: JSON.stringify({ key: "meal_count", value: String(v) }) });
          } catch (err) { toast(`Save failed: ${err.message}`); }
        },
      }),
    ),
  );

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
  schedBody.append(
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
  schedBody.append(
    el("label", { class: "field" },
      el("span", { class: "label" }, "Hour (24h)"),
      el("div", { class: "stepper" }, hourDec, hourValEl, hourInc),
    ),
  );

  if (sched.next_run_ms) {
    schedBody.append(
      el("div", { class: "row" },
        el("span", { class: "row__label" }, "Next run"),
        el("span", { class: "row__value" }, new Date(sched.next_run_ms).toLocaleString()),
      ),
    );
  }

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

  // ----- System health -----
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
}

// ---------------- boot ----------------

refreshUnread();
setInterval(refreshUnread, 30_000);
route();
