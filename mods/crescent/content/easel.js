"use strict";
// Easel editor: a free-form board of text, notes, shapes, drawings,
// images, links and captures of web pages.
const { CrescentStore } = ChromeUtils.importESModule("chrome://crescent/content/CrescentStore.sys.mjs");
const { Crescent } = ChromeUtils.importESModule("chrome://crescent/content/Crescent.sys.mjs");

const $ = id => document.getElementById(id);
const board = $("board");
const viewport = $("viewport");
const ink = $("ink");
const SVG_NS = "http://www.w3.org/2000/svg";
const NOTE_COLORS = ["#ffe58a", "#ffc4d6", "#b9f1d1", "#bfe2ff", "#e0d4ff", "#ffffff"];
const INK_COLORS = ["#1c1b20", "#6d5dfc", "#e5484d", "#2f9e6d", "#f08c00", "#8a87a0"];

let easel = null;
let tool = "select";
let selected = null;
let saveTimer = null;

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------
async function load() {
  const id = new URLSearchParams(location.search).get("id");
  try {
    easel = await CrescentStore.loadEasel(id);
  } catch {
    location.href = "chrome://crescent/content/easels.html";
    return;
  }
  easel.items ||= [];
  $("title").value = easel.title === "Untitled Easel" ? "" : easel.title;
  document.title = easel.title || "Easel";
  renderAll();
}

function save() {
  $("saved").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await CrescentStore.saveEasel(easel);
    $("saved").textContent = "Saved";
  }, 500);
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderAll() {
  for (const el of board.querySelectorAll(".item")) el.remove();
  for (const it of easel.items) board.append(renderItem(it));
  updateColors();
}

function place(el, it) {
  el.style.left = it.x + "px";
  el.style.top = it.y + "px";
  el.style.width = it.w + "px";
  if (it.type !== "text") el.style.height = it.h + "px";
}

function renderItem(it) {
  const el = document.createElement("div");
  el.className = `item ${it.type}` + (it.shape ? " " + it.shape : "");
  el.dataset.id = it.id;
  place(el, it);
  const body = document.createElement("div");
  body.className = "body";
  if (it.type === "text") {
    body.textContent = it.text || "";
    body.style.fontSize = (it.size || 20) + "px";
    body.style.fontWeight = it.bold ? 700 : 500;
    body.style.color = it.color || "";
    el.append(body);
  } else if (it.type === "note") {
    body.textContent = it.text || "";
    body.style.background = it.color || NOTE_COLORS[0];
    el.append(body);
  } else if (it.type === "shape") {
    body.style.background = it.color || "#c9b6ff";
    el.append(body);
  } else if (it.type === "image") {
    const img = document.createElement("img");
    img.src = it.src;
    el.append(img);
    if (it.url) {
      const s = document.createElement("div");
      s.className = "source";
      s.textContent = hostOf(it.url);
      s.title = "Double-click to open " + it.url;
      el.append(s);
    }
  } else if (it.type === "link") {
    const img = document.createElement("img");
    img.src = "page-icon:" + it.url;
    img.onerror = () => (img.src = "chrome://global/skin/icons/defaultFavicon.svg");
    const text = document.createElement("div");
    text.style.minWidth = "0";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = it.title || hostOf(it.url);
    const u = document.createElement("div");
    u.className = "u";
    u.textContent = it.url;
    text.append(t, u);
    body.append(img, text);
    el.append(body);
  } else if (it.type === "drawing") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${it.w} ${it.h}`);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", it.d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", it.color || INK_COLORS[0]);
    p.setAttribute("stroke-width", it.width || 3);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.append(p);
    el.append(svg);
  }
  const handle = document.createElement("div");
  handle.className = "handle";
  el.append(handle);
  if (selected === it.id) el.classList.add("selected");
  return el;
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const itemById = id => easel.items.find(i => i.id === id);
const elById = id => board.querySelector(`.item[data-id="${id}"]`);

function select(id) {
  selected = id;
  for (const el of board.querySelectorAll(".item.selected")) el.classList.remove("selected");
  if (id) elById(id)?.classList.add("selected");
  updateColors();
}

function rerender(it) {
  const old = elById(it.id);
  const fresh = renderItem(it);
  old ? old.replaceWith(fresh) : board.append(fresh);
}

function addItem(it, { edit = false } = {}) {
  it.id ||= uid();
  easel.items.push(it);
  board.append(renderItem(it));
  select(it.id);
  setTool("select");
  save();
  if (edit) startEditing(it.id);
  return it;
}

function removeSelected() {
  if (!selected) return;
  easel.items = easel.items.filter(i => i.id !== selected);
  elById(selected)?.remove();
  select(null);
  save();
}

// ---------------------------------------------------------------------------
// Colors for the selected item (or the pen)
// ---------------------------------------------------------------------------
function updateColors() {
  const it = selected && itemById(selected);
  const box = $("colors");
  box.textContent = "";
  let colors = null;
  if (it && (it.type === "note" || it.type === "shape")) colors = NOTE_COLORS.concat(["#c9b6ff", "#7cc0ff"]);
  else if (it && (it.type === "text" || it.type === "drawing")) colors = INK_COLORS;
  else if (tool === "draw") colors = INK_COLORS;
  $("colorsep").hidden = !colors;
  for (const c of colors || []) {
    const dot = document.createElement("i");
    dot.style.background = c;
    dot.addEventListener("click", () => {
      if (it) {
        it.color = c;
        rerender(it);
        save();
      } else {
        penColor = c;
      }
    });
    box.append(dot);
  }
}
let penColor = INK_COLORS[0];

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
function setTool(t) {
  tool = t;
  document.body.dataset.tool = t;
  for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === t);
  updateColors();
}

function boardPoint(e) {
  const r = board.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startEditing(id) {
  const el = elById(id);
  const body = el?.querySelector(".body");
  const it = itemById(id);
  if (!body || !it || !(it.type === "text" || it.type === "note")) return;
  body.contentEditable = "true";
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.addEventListener(
    "blur",
    () => {
      body.contentEditable = "false";
      it.text = body.innerText.replace(/\n$/, "");
      if (it.type === "text" && !it.text.trim()) {
        easel.items = easel.items.filter(i => i !== it);
        el.remove();
        select(null);
      } else if (it.type === "text") {
        it.h = el.offsetHeight;
      }
      save();
    },
    { once: true }
  );
}

let drag = null;

board.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  const target = e.target.closest(".item");
  const p = boardPoint(e);

  if (tool === "select") {
    if (!target) {
      select(null);
      return;
    }
    if (target.querySelector('[contenteditable="true"]')) return;
    const it = itemById(target.dataset.id);
    select(it.id);
    const resizing = e.target.classList.contains("handle");
    drag = { mode: resizing ? "resize" : "move", it, el: target, start: p, orig: { ...it } };
    board.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  e.preventDefault();
  if (tool === "text") {
    addItem({ type: "text", x: p.x, y: p.y - 14, w: 320, h: 40, text: "", size: 22 }, { edit: true });
  } else if (tool === "note") {
    addItem({ type: "note", x: p.x - 100, y: p.y - 80, w: 210, h: 170, text: "", color: NOTE_COLORS[0] }, { edit: true });
  } else if (tool === "rect" || tool === "ellipse") {
    const it = { id: uid(), type: "shape", shape: tool, x: p.x, y: p.y, w: 1, h: 1, color: "#c9b6ff" };
    easel.items.push(it);
    board.append(renderItem(it));
    drag = { mode: "create", it, el: elById(it.id), start: p };
    board.setPointerCapture(e.pointerId);
  } else if (tool === "draw") {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", penColor);
    path.setAttribute("stroke-width", 3);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    ink.append(path);
    drag = { mode: "draw", points: [p], path };
    board.setPointerCapture(e.pointerId);
  }
});

board.addEventListener("pointermove", e => {
  if (!drag) return;
  const p = boardPoint(e);
  const dx = p.x - drag.start?.x;
  const dy = p.y - drag.start?.y;
  if (drag.mode === "move") {
    drag.it.x = Math.round(drag.orig.x + dx);
    drag.it.y = Math.round(drag.orig.y + dy);
    place(drag.el, drag.it);
  } else if (drag.mode === "resize") {
    drag.it.w = Math.max(30, Math.round(drag.orig.w + dx));
    drag.it.h = Math.max(20, Math.round(drag.orig.h + dy));
    place(drag.el, drag.it);
  } else if (drag.mode === "create") {
    drag.it.x = Math.min(p.x, drag.start.x);
    drag.it.y = Math.min(p.y, drag.start.y);
    drag.it.w = Math.abs(dx);
    drag.it.h = Math.abs(dy);
    place(drag.el, drag.it);
  } else if (drag.mode === "draw") {
    drag.points.push(p);
    drag.path.setAttribute("d", "M" + drag.points.map(q => `${q.x} ${q.y}`).join(" L"));
  }
});

board.addEventListener("pointerup", () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === "create") {
    if (d.it.w < 8 || d.it.h < 8) {
      Object.assign(d.it, { w: 180, h: 120 });
      place(d.el, d.it);
    }
    select(d.it.id);
    setTool("select");
    save();
  } else if (d.mode === "draw") {
    d.path.remove();
    if (d.points.length > 1) {
      const xs = d.points.map(q => q.x);
      const ys = d.points.map(q => q.y);
      const x = Math.min(...xs) - 4;
      const y = Math.min(...ys) - 4;
      const w = Math.max(...xs) - x + 4;
      const h = Math.max(...ys) - y + 4;
      const dPath = "M" + d.points.map(q => `${Math.round(q.x - x)} ${Math.round(q.y - y)}`).join(" L");
      const it = { id: uid(), type: "drawing", x, y, w, h, d: dPath, color: penColor, width: 3 };
      easel.items.push(it);
      board.append(renderItem(it));
      save();
    }
  } else {
    save();
  }
});

board.addEventListener("dblclick", e => {
  const target = e.target.closest(".item");
  if (!target) return;
  const it = itemById(target.dataset.id);
  if (it.type === "text" || it.type === "note") {
    startEditing(it.id);
  } else if ((it.type === "link" || it.type === "image") && /^https?:/.test(it.url || "")) {
    Crescent.openURL(it.url);
  }
});

// ---------------------------------------------------------------------------
// Adding images, links and captures
// ---------------------------------------------------------------------------
function viewCenter() {
  return { x: viewport.scrollLeft + viewport.clientWidth / 2, y: viewport.scrollTop + viewport.clientHeight / 2 };
}

function addImage(src, { url = "", title = "", at = null, width, height } = {}) {
  const img = new Image();
  img.onload = () => {
    const max = 520;
    const ratio = Math.min(1, max / img.naturalWidth);
    const w = Math.round((width || img.naturalWidth) * ratio);
    const h = Math.round((height || img.naturalHeight) * ratio);
    const c = at || viewCenter();
    addItem({ type: "image", x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, src, url, title });
  };
  img.src = src;
}

function addLink(url, at = null) {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const c = at || viewCenter();
  addItem({ type: "link", x: Math.round(c.x - 150), y: Math.round(c.y - 35), w: 300, h: 70, url, title: hostOf(url) });
}

function readFile(file, at) {
  if (!file?.type?.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => addImage(reader.result, { at });
  reader.readAsDataURL(file);
}

$("image").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  readFile($("file").files[0]);
  $("file").value = "";
});
$("link").addEventListener("click", askLink);

function askLink() {
  const out = { value: "https://" };
  if (Services.prompt.prompt(window, "Add link", "Paste a web address:", out, null, {}) && out.value.trim()) {
    addLink(out.value.trim());
  }
}

board.addEventListener("dragover", e => e.preventDefault());
board.addEventListener("drop", e => {
  e.preventDefault();
  const at = boardPoint(e);
  const dt = e.dataTransfer;
  if (dt.files?.length) {
    for (const f of dt.files) readFile(f, at);
    return;
  }
  const url = (dt.getData("text/x-moz-url") || dt.getData("text/uri-list") || "").split("\n")[0].trim();
  if (/^https?:/.test(url)) {
    addLink(url, at);
    return;
  }
  const text = dt.getData("text/plain");
  if (text) addItem({ type: "note", x: at.x - 100, y: at.y - 80, w: 220, h: 170, text, color: NOTE_COLORS[0] });
});

document.addEventListener("paste", e => {
  if (document.activeElement?.isContentEditable || document.activeElement?.tagName === "INPUT") return;
  const items = [...(e.clipboardData?.items || [])];
  const imgItem = items.find(i => i.type.startsWith("image/"));
  if (imgItem) {
    readFile(imgItem.getAsFile());
    e.preventDefault();
    return;
  }
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (!text) return;
  e.preventDefault();
  if (/^https?:\/\/\S+$/.test(text)) addLink(text);
  else {
    const c = viewCenter();
    addItem({ type: "note", x: c.x - 110, y: c.y - 85, w: 220, h: 170, text, color: NOTE_COLORS[0] });
  }
});

// Capture: pick a tab, then drag to choose the part to keep.
function closeModal() {
  $("modal").hidden = true;
  $("modal-body").textContent = "";
}
$("modal-close").addEventListener("click", closeModal);
$("modal").addEventListener("click", e => e.target === $("modal") && closeModal());
$("capture").addEventListener("click", openCapture);

function openCapture() {
  const body = $("modal-body");
  body.textContent = "";
  $("modal-title").textContent = "Capture from a tab";
  const tabs = Crescent.listCaptureTabs();
  const list = document.createElement("div");
  list.className = "tablist";
  if (!tabs.length) {
    list.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Open a web page in a tab first, then capture it here." }));
  }
  for (const t of tabs) {
    const b = document.createElement("button");
    const img = document.createElement("img");
    img.src = t.icon || "chrome://global/skin/icons/defaultFavicon.svg";
    const name = document.createElement("span");
    name.textContent = t.title;
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = hostOf(t.url);
    b.append(img, name, u);
    b.addEventListener("click", () => cropFrom(t.key));
    list.append(b);
  }
  body.append(list);
  $("modal").hidden = false;
}

async function cropFrom(key) {
  let shot;
  try {
    shot = await Crescent.captureTab(key);
  } catch (e) {
    Services.prompt.alert(window, "Capture", "That tab couldn't be captured. Make sure it has finished loading.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = shot.bitmap.width;
  canvas.height = shot.bitmap.height;
  canvas.getContext("2d").drawImage(shot.bitmap, 0, 0);
  const full = canvas.toDataURL("image/png");

  $("modal-title").textContent = "Drag to choose what to capture";
  const body = $("modal-body");
  body.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "crop";
  const img = document.createElement("img");
  img.src = full;
  const sel = document.createElement("div");
  sel.className = "sel";
  sel.hidden = true;
  wrap.append(img, sel);
  const row = document.createElement("div");
  row.className = "row hint";
  const hint = Object.assign(document.createElement("span"), { className: "muted", textContent: "Or add the whole visible page." });
  const whole = Object.assign(document.createElement("button"), { textContent: "Add whole page" });
  const add = Object.assign(document.createElement("button"), { className: "primary", textContent: "Add to Easel", disabled: true });
  row.append(hint, Object.assign(document.createElement("span"), { className: "spacer" }), whole, add);
  body.append(wrap, row);

  let rect = null;
  let start = null;
  wrap.addEventListener("pointerdown", e => {
    const r = img.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    wrap.setPointerCapture(e.pointerId);
    sel.hidden = false;
  });
  wrap.addEventListener("pointermove", e => {
    if (!start) return;
    const r = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
    rect = { x: Math.min(x, start.x), y: Math.min(y, start.y), w: Math.abs(x - start.x), h: Math.abs(y - start.y) };
    Object.assign(sel.style, { left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.h + "px" });
    add.disabled = rect.w < 10 || rect.h < 10;
  });
  wrap.addEventListener("pointerup", () => (start = null));

  const finish = crop => {
    const scale = canvas.width / img.getBoundingClientRect().width;
    const sx = crop ? crop.x * scale : 0;
    const sy = crop ? crop.y * scale : 0;
    const sw = crop ? crop.w * scale : canvas.width;
    const sh = crop ? crop.h * scale : canvas.height;
    const out = document.createElement("canvas");
    const shrink = Math.min(1, 1400 / sw);
    out.width = Math.round(sw * shrink);
    out.height = Math.round(sh * shrink);
    out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    closeModal();
    addImage(out.toDataURL("image/jpeg", 0.9), { url: shot.url, title: shot.title });
  };
  add.addEventListener("click", () => rect && finish(rect));
  whole.addEventListener("click", () => finish(null));
}

// ---------------------------------------------------------------------------
// Keyboard, toolbar, title
// ---------------------------------------------------------------------------
for (const b of document.querySelectorAll("[data-tool]")) {
  b.addEventListener("click", () => setTool(b.dataset.tool));
}

document.addEventListener("keydown", e => {
  if (document.activeElement?.isContentEditable || document.activeElement?.tagName === "INPUT") {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const keys = { v: "select", t: "text", n: "note", p: "draw", r: "rect", o: "ellipse" };
  if (keys[e.key]) setTool(keys[e.key]);
  else if (e.key === "l") askLink();
  else if (e.key === "c") openCapture();
  else if (e.key === "Backspace" || e.key === "Delete") removeSelected();
  else if (e.key === "Escape") {
    select(null);
    setTool("select");
    closeModal();
  }
});

$("title").addEventListener("input", () => {
  easel.title = $("title").value.trim() || "Untitled Easel";
  document.title = easel.title;
  save();
});
$("back").addEventListener("click", () => (location.href = "chrome://crescent/content/easels.html"));
$("delete").addEventListener("click", async () => {
  if (Services.prompt.confirm(window, "Delete Easel", `Delete “${easel.title}”? This can't be undone.`)) {
    await CrescentStore.deleteEasel(easel.id);
    location.href = "chrome://crescent/content/easels.html";
  }
});
window.addEventListener("beforeunload", () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    CrescentStore.saveEasel(easel);
  }
});

setTool("select");
load();
