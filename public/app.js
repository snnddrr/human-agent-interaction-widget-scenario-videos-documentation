// Reactive agent video documentation
// The library comes from /api/library. Signed-in admins also get the
// review list ("New"), editing, delete with undo, and Recently deleted.

const $ = id => document.getElementById(id);
const menu = $("menu"), lamp = $("lamp"), player = $("player"), frame = $("frame"), view = $("view");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let LIB = { admin: false, categories: [], videos: [], retentionDays: 30 };
let buttons = {}, current = null, expanded = false, trashOpen = false, mode = "category";
const durations = {};

const fmt = s => isFinite(s) && s > 0 ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const hashOf = v => (v.code || v.id).toLowerCase();
const isDraft = v => v.status === "draft" && !v.deletedAt;
const isLive = v => v.status === "published" && !v.deletedAt;
const leadName = () => (LIB.categories.find(c => c.lead) || LIB.categories[0] || {}).name;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

// ---------- Data ----------

async function loadLibrary() {
  const res = await fetch("/api/library", { cache: "no-store" });
  if (res.status === 401) { location.reload(); return null; }
  if (!res.ok) throw new Error("Couldn’t load the videos.");
  return res.json();
}

async function adminAction(body) {
  const res = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That didn’t work. Try again.");
  return data;
}

function applyLibrary(lib) {
  LIB = lib;
  lib.videos.forEach(v => { if (v.duration) durations[v.id] = fmt(v.duration); });
  $("adminLine").hidden = !lib.admin;
  $("adminSignIn").hidden = lib.admin;
  if (current) current = lib.videos.find(v => v.id === current.id) || null;
}

// ---------- Menu ----------

function groupsFor(m) {
  const live = LIB.videos.filter(isLive);
  if (m === "date") {
    const days = [...new Set(live.map(v => v.date))].sort().reverse();
    return days.map(d => ({ name: longDate(d), lead: true, items: live.filter(v => v.date === d) }));
  }
  return LIB.categories
    .map(c => ({ name: c.name, lead: c.name === leadName(), items: live.filter(v => v.category === c.name) }))
    .filter(g => g.items.length);
}

function makeItem(v, { inTrash = false } = {}) {
  const b = el("button", "item");
  b.append(el("span", "id", inTrash ? "" : (v.code || (isDraft(v) ? "New" : ""))), el("span", "t", v.title),
           el("span", "d", inTrash ? `${v.daysLeft}d left` : (durations[v.id] || "")));
  if (current) b.setAttribute("aria-current", current.id === v.id);
  b.onclick = () => {
    history.replaceState(null, "", "#" + hashOf(v));
    select(v, !inTrash);
    if (matchMedia("(max-width: 760px)").matches) frame.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  buttons[v.id] = b;
  const row = el("li"); row.appendChild(b);
  return row;
}

function makeGroup(g, gi, animateIn, extraClass = "") {
  const li = el("li", "group" + (extraClass ? " " + extraClass : "") + (animateIn ? " reveal" : ""));
  li.style.setProperty("--i", gi + 2);
  const h2 = el("h2", null, g.name);
  if (g.count) h2.append(el("span", "count", String(g.count)));
  const ol = el("ol");
  g.items.forEach(v => ol.appendChild(makeItem(v)));
  li.append(h2, ol);
  return li;
}

function render(animateIn) {
  menu.querySelectorAll(":scope > li:not(.lamp)").forEach(n => n.remove());
  buttons = {};
  let gi = 0;

  // Admin review list: new recordings waiting for a title and category.
  const drafts = LIB.admin ? LIB.videos.filter(isDraft).sort((a, b) => b.date.localeCompare(a.date)) : [];
  if (drafts.length) menu.appendChild(makeGroup({ name: "New", count: drafts.length, items: drafts }, gi++, animateIn, "inbox"));

  const groups = groupsFor(mode);
  const shown = mode === "date" ? groups : groups.filter(g => g.lead);
  const folded = mode === "date" ? [] : groups.filter(g => !g.lead);
  shown.forEach(g => menu.appendChild(makeGroup(g, gi++, animateIn)));

  if (folded.length) {
    const more = el("li", "more" + (expanded ? " open" : "") + (animateIn ? " reveal" : ""));
    more.style.setProperty("--i", gi + 2);
    more.innerHTML = `<button class="dots" aria-expanded="${expanded}" aria-controls="fold" aria-label="${expanded ? "Show fewer videos" : "Show more videos"}"><svg viewBox="0 0 16 4" fill="currentColor"><circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/><circle cx="14" cy="2" r="1.6"/></svg></button><div class="fold" id="fold"><ul></ul></div>`;
    const ul = more.querySelector("ul");
    let k = 0;
    folded.forEach(g => {
      const li = makeGroup(g, 0, false);
      li.querySelectorAll("h2, ol > li").forEach(n => { n.dataset.k = ""; n.style.setProperty("--k", k++); });
      ul.appendChild(li);
    });
    ul.inert = !expanded;
    more.querySelector(".dots").onclick = () => setExpanded(!expanded);
    more.querySelector(".fold").addEventListener("transitionend", e => { if (e.propertyName === "grid-template-rows" && current) placeLamp(current); });
    menu.appendChild(more);
  }

  // Admin: Recently deleted, folded by default.
  const trash = LIB.admin ? LIB.videos.filter(v => v.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) : [];
  if (trash.length) {
    const t = el("li", "trash" + (trashOpen ? " open" : "") + (animateIn ? " reveal" : ""));
    t.style.setProperty("--i", gi + 3);
    t.innerHTML = `<button aria-expanded="${trashOpen}"><svg viewBox="0 0 8 8" fill="currentColor"><path d="M2 1l4 3-4 3z"/></svg><span></span></button><div class="fold"><ul></ul></div>`;
    t.querySelector("span").textContent = `Recently deleted (${trash.length})`;
    const ul = t.querySelector("ul");
    trash.forEach(v => ul.appendChild(makeItem(v, { inTrash: true })));
    ul.inert = !trashOpen;
    t.querySelector("button").onclick = () => setTrashOpen(!trashOpen);
    t.querySelector(".fold").addEventListener("transitionend", e => { if (e.propertyName === "grid-template-rows" && current) placeLamp(current); });
    menu.appendChild(t);
  }

  if (current) placeLamp(current);
}

function setExpanded(open) {
  expanded = open;
  const more = menu.querySelector(".more");
  if (!more) return;
  more.classList.toggle("open", open);
  const b = more.querySelector(".dots");
  b.setAttribute("aria-expanded", open);
  b.setAttribute("aria-label", open ? "Show fewer videos" : "Show more videos");
  more.querySelector(".fold > ul").inert = !open;
  if (current) placeLamp(current);
}

function setTrashOpen(open) {
  trashOpen = open;
  const t = menu.querySelector(".trash");
  if (!t) return;
  t.classList.toggle("open", open);
  t.querySelector("button").setAttribute("aria-expanded", open);
  t.querySelector(".fold > ul").inert = !open;
  if (current) placeLamp(current);
}

function setMode(m, animate) {
  mode = m;
  view.dataset.mode = m;
  view.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
  try { localStorage.setItem("view", m); } catch (e) {}
  if (!animate) return render(true);
  menu.classList.add("switching");
  setTimeout(() => { render(false); requestAnimationFrame(() => menu.classList.remove("switching")); }, 180);
}
view.querySelectorAll("button").forEach(b => b.onclick = () => b.dataset.mode !== mode && setMode(b.dataset.mode, true));

function placeLamp(v) {
  const b = buttons[v.id];
  const more = menu.querySelector(".more");
  if (more) more.classList.toggle("holds-current", !!(b && b.closest(".more")));
  const hidden = !b || (!expanded && b.closest(".more")) || (!trashOpen && b.closest(".trash"));
  if (hidden) { lamp.classList.remove("on"); return; }
  const t = b.querySelector(".t");
  const lh = parseFloat(getComputedStyle(t).lineHeight) || t.offsetHeight;
  const y = t.getBoundingClientRect().top - menu.getBoundingClientRect().top + lh / 2;
  lamp.style.setProperty("--y", y + "px");
  lamp.classList.add("on");
}

// ---------- Player ----------

function showEmpty(title, text) {
  const e = $("empty");
  e.hidden = false; player.hidden = true;
  e.innerHTML = "";
  e.append(el("strong", null, title), document.createTextNode(text));
  frame.querySelector(".bigplay").hidden = true;
  ["capId", "capTitle", "capMeta"].forEach(id => $(id).textContent = "");
  $("edit").hidden = true;
}

function caption(v) {
  $("capId").textContent = v.code || (isDraft(v) ? "New" : "");
  $("capTitle").textContent = v.title;
  const where = v.deletedAt ? "Recently deleted" : (v.category || "Not categorised yet");
  $("capMeta").textContent = `${where}, ${longDate(v.date)}`;
  document.title = `${v.code ? v.code + " " : ""}${v.title} | Reactive agent`;
}

function select(v, play) {
  if (!v) return;
  $("empty").hidden = true; player.hidden = false; frame.querySelector(".bigplay").hidden = false;
  const b = buttons[v.id];
  if (b && !expanded && b.closest(".more")) setExpanded(true);
  if (b && !trashOpen && b.closest(".trash")) setTrashOpen(true);
  for (const k in buttons) buttons[k].setAttribute("aria-current", k === v.id);
  placeLamp(v);
  caption(v);
  renderEdit(v);
  if (current && current.id === v.id && player.dataset.id === v.id) {
    current = v;
    if (play) { player.currentTime = 0; player.play().catch(() => {}); }
    return;
  }
  current = v;
  const swap = () => {
    player.dataset.id = v.id;
    player.poster = v.poster || "";
    player.src = v.src;
    player.addEventListener("loadeddata", () => frame.classList.remove("swap"), { once: true });
    if (play) player.play().catch(() => {});
    else frame.classList.remove("swap");
  };
  if (player.getAttribute("src")) { frame.classList.add("swap"); setTimeout(swap, 220); } else swap();
}

player.addEventListener("loadedmetadata", () => {
  if (!current) return;
  durations[current.id] = fmt(player.duration);
  const d = buttons[current.id] && !buttons[current.id].closest(".trash") && buttons[current.id].querySelector(".d");
  if (d) d.textContent = durations[current.id];
  $("time").textContent = `0:00 / ${fmt(player.duration)}`;
});

const toggle = () => player.paused ? player.play().catch(() => {}) : player.pause();
frame.onclick = e => { if (!$("empty").hidden) return; toggle(); };
frame.addEventListener("contextmenu", e => e.preventDefault());
$("toggle").onclick = toggle;
$("full").onclick = () => (frame.requestFullscreen || frame.webkitRequestFullscreen || (() => player.webkitEnterFullscreen && player.webkitEnterFullscreen())).call(frame);
const PLAY = '<path d="M3 1.5v13l11-6.5z" fill="currentColor"/>';
const PAUSE = '<path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z" fill="currentColor"/>';
const sync = () => {
  const playing = !player.paused;
  frame.classList.toggle("playing", playing);
  $("toggleIcon").innerHTML = playing ? PAUSE : PLAY;
  $("toggle").setAttribute("aria-label", playing ? "Pause" : "Play");
};
["play", "pause", "ended"].forEach(e => player.addEventListener(e, sync));
player.addEventListener("timeupdate", () => {
  const p = player.duration ? player.currentTime / player.duration * 100 : 0;
  $("progress").style.width = p + "%";
  $("scrub").setAttribute("aria-valuenow", Math.round(p));
  $("time").textContent = `${fmt(player.currentTime)} / ${fmt(player.duration)}`;
});
const scrub = $("scrub");
const seek = e => { const r = scrub.getBoundingClientRect(); if (player.duration) player.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * player.duration; };
scrub.addEventListener("pointerdown", e => { scrub.setPointerCapture(e.pointerId); seek(e); scrub.onpointermove = seek; });
scrub.addEventListener("pointerup", () => scrub.onpointermove = null);
scrub.addEventListener("keydown", e => {
  if (e.key === "ArrowRight") player.currentTime += 5;
  if (e.key === "ArrowLeft") player.currentTime -= 5;
});
document.addEventListener("keydown", e => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement;
  if (e.code === "Space" && !typing && !$("confirm").open && !$("ask").open) { e.preventDefault(); toggle(); }
});

// ---------- Admin: edit row ----------

const NEW_CATEGORY = "__new__";
function categorySelect(v) {
  const s = el("select", "field");
  s.setAttribute("aria-label", "Category");
  if (!v.category) { const o = el("option", null, "Choose a category"); o.value = ""; o.disabled = true; o.selected = true; s.append(o); }
  LIB.categories.forEach(c => { const o = el("option", null, c.name); o.value = c.name; o.selected = c.name === v.category; s.append(o); });
  const add = el("option", null, "New category\u2026"); add.value = NEW_CATEGORY; s.append(add);
  s.dataset.prev = s.value;
  return s;
}

// Lets "New category…" in a select create one, then selects it.
async function handleNewCategory(select) {
  if (select.value !== NEW_CATEGORY) { select.dataset.prev = select.value; return true; }
  const name = await askBox({ title: "New category", text: "Give it a short name. You can move any video into it.", ok: "Add category" });
  if (!name) { select.value = select.dataset.prev || ""; return false; }
  try {
    const lib = await adminAction({ action: "addCategory", name });
    LIB.categories = lib.categories;
    const o = el("option", null, lib.category); o.value = lib.category;
    select.insertBefore(o, select.querySelector(`option[value="${NEW_CATEGORY}"]`));
    select.value = lib.category; select.dataset.prev = lib.category;
    return true;
  } catch (e) { toast(e.message); select.value = select.dataset.prev || ""; return false; }
}

function askBox({ title, text, ok }) {
  const d = $("ask"), input = $("askInput");
  $("askTitle").textContent = title; $("askText").textContent = text; $("askOk").textContent = ok;
  input.value = "";
  return new Promise(resolve => {
    const done = val => { d.close(); resolve(val); };
    $("askForm").onsubmit = e => { e.preventDefault(); const v = input.value.trim(); if (v) done(v); else input.focus(); };
    $("askCancel").onclick = () => done(null);
    d.oncancel = e => { e.preventDefault(); done(null); };
    d.showModal(); input.focus();
  });
}

function renderEdit(v) {
  const box = $("edit");
  box.innerHTML = "";
  if (!LIB.admin) { box.hidden = true; return; }
  box.hidden = false;
  const note = el("span", "note");
  const say = (text, err = false) => { note.textContent = text; note.classList.toggle("err", err); };

  if (v.deletedAt) {
    say(`Deleted. You can restore it for ${v.daysLeft} more day${v.daysLeft === 1 ? "" : "s"}.`);
    const restore = el("button", "btn primary", "Restore");
    restore.onclick = () => run(restore, { action: "restore", id: v.id }, `Restored “${v.title}”`, say);
    const purge = el("button", "btn warn", "Delete forever");
    purge.onclick = async () => {
      const ok = await confirmBox({ title: `Delete “${v.title}” forever?`, text: "The video file is removed from storage. This can’t be undone.", ok: "Delete forever" });
      if (ok) run(purge, { action: "purge", id: v.id }, `Deleted “${v.title}” forever`, say, { selectNext: true });
    };
    box.append(note, el("span", "spacer"), restore, purge);
    return;
  }

  const title = el("input", "field");
  title.type = "text"; title.value = v.title; title.maxLength = 120; title.setAttribute("aria-label", "Title");
  const cat = categorySelect(v);
  const del = el("button", "btn warn", "Delete");
  del.onclick = async () => {
    const ok = await confirmBox({ title: `Delete “${v.title}”?`, text: `It moves to Recently deleted. You can restore it for ${LIB.retentionDays} days.`, ok: "Delete" });
    if (!ok) return;
    const id = v.id, name = v.title;
    await run(del, { action: "delete", id }, `Moved “${name}” to Recently deleted`, say, {
      selectNext: true,
      undo: async () => { applyLibrary(await adminAction({ action: "restore", id })); render(false); select(LIB.videos.find(x => x.id === id), false); toast(`Restored “${name}”`); },
    });
  };

  if (isDraft(v)) {
    const publish = el("button", "btn primary", "Publish");
    const check = () => { publish.disabled = !cat.value || cat.value === NEW_CATEGORY || !title.value.trim(); };
    title.oninput = check;
    cat.onchange = async () => { await handleNewCategory(cat); check(); };
    check();
    publish.onclick = () => run(publish, { action: "publish", id: v.id, title: title.value, category: cat.value }, null, say, { announcePublish: true });
    title.onkeydown = e => { if (e.key === "Enter" && !publish.disabled) publish.click(); };
    say("Waiting for review. Only you can see it.");
    box.append(title, cat, publish, del, el("span", "spacer"), note);
  } else {
    const saveTitle = () => {
      const t = title.value.trim();
      if (!t) { title.value = v.title; return; }
      if (t !== v.title) run(null, { action: "update", id: v.id, title: t }, null, say, { saved: true });
    };
    title.onblur = saveTitle;
    title.onkeydown = e => { if (e.key === "Enter") title.blur(); if (e.key === "Escape") { title.value = v.title; title.blur(); } };
    cat.onchange = async () => { if (await handleNewCategory(cat)) run(null, { action: "update", id: v.id, category: cat.value }, null, say, { saved: true }); };
    const back = el("button", "btn quiet", "Move to New");
    back.title = "Hide it from viewers again";
    back.onclick = () => run(back, { action: "unpublish", id: v.id }, `Moved “${v.title}” back to New`, say);
    box.append(title, cat, back, del, el("span", "spacer"), note);
  }
}

async function run(button, body, message, say, opts = {}) {
  if (button) button.disabled = true;
  const before = LIB.videos.map(v => v.id);
  const orderedVisible = [...menu.querySelectorAll(".item")].map(b => Object.keys(buttons).find(k => buttons[k] === b));
  try {
    const lib = await adminAction(body);
    applyLibrary(lib);
    let next = LIB.videos.find(v => v.id === body.id);
    if (opts.selectNext) {
      const i = orderedVisible.indexOf(body.id);
      const candidates = [...orderedVisible.slice(i + 1), ...orderedVisible.slice(0, i).reverse()];
      const pick = candidates.map(id => LIB.videos.find(v => v.id === id)).find(v => v && !v.deletedAt);
      next = pick || LIB.videos.find(v => !v.deletedAt) || null;
    }
    render(false);
    if (next) select(next, false); else { current = null; showEmpty("Nothing here yet", "New recordings show up in New after they upload."); }
    if (opts.saved) { const n = $("edit").querySelector(".note"); if (n) { n.textContent = "Saved"; setTimeout(() => n.textContent === "Saved" && (n.textContent = ""), 1600); } }
    if (opts.announcePublish && next) toast(`Published “${next.title}” as ${next.code}`);
    else if (message) toast(message, opts.undo);
    return true;
  } catch (e) {
    say(e.message, true);
    if (button) button.disabled = false;
    return false;
  }
}

// ---------- Confirm and toast ----------

function confirmBox({ title, text, ok }) {
  const d = $("confirm");
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmOk").textContent = ok;
  return new Promise(resolve => {
    const done = val => { d.close(); resolve(val); };
    $("confirmOk").onclick = () => done(true);
    $("confirmCancel").onclick = () => done(false);
    d.oncancel = e => { e.preventDefault(); done(false); };
    d.onclick = e => { if (e.target === d) done(false); };
    d.showModal();
    $("confirmCancel").focus();
  });
}

let toastTimer;
function toast(text, undo) {
  const t = $("toast"), u = $("toastUndo");
  $("toastText").textContent = text;
  u.hidden = !undo;
  u.onclick = async () => { u.hidden = true; t.classList.remove("show"); try { await undo(); } catch (e) { toast(e.message); } };
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), undo ? 8000 : 3500);
}

// ---------- Start ----------

const fromHash = () => {
  const h = location.hash.slice(1).toLowerCase();
  return h && LIB.videos.find(v => hashOf(v) === h || v.id === h);
};

window.addEventListener("hashchange", () => { const v = fromHash(); if (v) select(v, true); });
window.addEventListener("resize", () => current && placeLamp(current));
document.fonts.ready.then(() => current && placeLamp(current));

function firstVideo() {
  const live = LIB.videos.filter(isLive);
  return live.find(v => v.category === leadName()) || live[0] || LIB.videos.find(isDraft) || null;
}

// Admins see new uploads arrive without reloading.
async function refresh() {
  if (document.hidden || $("confirm").open || $("ask").open || document.activeElement?.classList.contains("field")) return;
  try {
    const lib = await loadLibrary();
    if (!lib) return;
    const known = new Set(LIB.videos.map(v => v.id));
    const fresh = lib.videos.filter(v => !known.has(v.id));
    applyLibrary(lib);
    if (fresh.length) {
      render(false);
      if (current) { placeLamp(current); for (const k in buttons) buttons[k].setAttribute("aria-current", k === current.id); }
      else select(fresh[0], false);
      toast(fresh.length === 1 ? `New recording: “${fresh[0].title}”` : `${fresh.length} new recordings`);
    }
  } catch (e) {}
}

(async function start() {
  try { if (localStorage.getItem("view") === "date") mode = "date"; } catch (e) {}
  try {
    const lib = await loadLibrary();
    if (!lib) return;
    applyLibrary(lib);
  } catch (e) {
    showEmpty("The videos didn’t load", "Check your connection and reload the page.");
    return;
  }
  setMode(mode, false);
  const v = fromHash() || firstVideo();
  if (v) select(v, false);
  else showEmpty("No videos yet", LIB.admin ? "Save a screen recording to your Thesis Recordings folder and it appears in New." : "Check back soon.");
  if (LIB.admin) setInterval(refresh, 20000);
})();
