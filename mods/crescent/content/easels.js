"use strict";
const { CrescentStore } = ChromeUtils.importESModule("chrome://crescent/content/CrescentStore.sys.mjs");

const grid = document.getElementById("grid");
const COLORS = { text: "#8a87a0", link: "#9a8dff", image: "#7cc0ff", drawing: "#6f6c78" };

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "Edited just now";
  if (m < 60) return `Edited ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Edited ${h} hr ago`;
  return "Edited " + new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function preview(id, box) {
  try {
    const easel = await CrescentStore.loadEasel(id);
    const items = easel.items || [];
    if (!items.length) return;
    const maxX = Math.max(...items.map(i => i.x + i.w)) + 40;
    const maxY = Math.max(...items.map(i => i.y + i.h)) + 40;
    const scale = Math.min(box.clientWidth / maxX, box.clientHeight / maxY, 0.4);
    for (const it of items) {
      const el = document.createElement("i");
      el.style.left = it.x * scale + 8 + "px";
      el.style.top = it.y * scale + 8 + "px";
      el.style.width = Math.max(4, it.w * scale) + "px";
      el.style.height = Math.max(3, it.h * scale) + "px";
      el.style.background = it.color || COLORS[it.type] || "#c9c6d4";
      if (it.type === "image" && it.src) {
        el.style.background = `center / cover url("${it.src}")`;
      }
      if (it.shape === "ellipse") el.style.borderRadius = "50%";
      if (it.type === "text") el.style.height = "3px";
      box.append(el);
    }
  } catch {}
}

async function render() {
  const list = await CrescentStore.listEasels();
  grid.textContent = "";
  const add = document.createElement("div");
  add.className = "card new";
  add.innerHTML = "<b>+</b><span>New Easel</span>";
  add.addEventListener("click", create);
  grid.append(add);
  for (const e of list) {
    const card = document.createElement("div");
    card.className = "card";
    const box = document.createElement("div");
    box.className = "preview";
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = e.title || "Untitled Easel";
    const when = document.createElement("div");
    when.className = "when";
    when.textContent = ago(e.updated);
    info.append(name, when);
    card.append(box, info);
    card.addEventListener("click", () => (location.href = "chrome://crescent/content/easel.html?id=" + e.id));
    grid.append(card);
    preview(e.id, box);
  }
}

async function create() {
  const easel = await CrescentStore.createEasel();
  location.href = "chrome://crescent/content/easel.html?id=" + easel.id;
}

document.getElementById("new").addEventListener("click", create);
const observer = { observe: () => render() };
Services.obs.addObserver(observer, "crescent-easels-changed");
window.addEventListener("unload", () => Services.obs.removeObserver(observer, "crescent-easels-changed"));
render();
