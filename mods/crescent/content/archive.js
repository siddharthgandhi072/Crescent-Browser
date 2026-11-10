"use strict";
const { CrescentStore } = ChromeUtils.importESModule("chrome://crescent/content/CrescentStore.sys.mjs");
const { Crescent } = ChromeUtils.importESModule("chrome://crescent/content/Crescent.sys.mjs");

const $ = id => document.getElementById(id);
let entries = [];

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function host(url) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const shown = q
    ? entries.filter(e => (e.title + " " + e.url + " " + (e.spaceName || "")).toLowerCase().includes(q))
    : entries;
  const list = $("list");
  list.textContent = "";
  const hours = Services.prefs.getIntPref("crescent.archive.after-hours", 12);
  $("summary").textContent =
    `${entries.length} archived tab${entries.length === 1 ? "" : "s"}. ` +
    (hours > 0 ? `Unpinned tabs are archived after ${hours >= 24 ? hours / 24 + " day" + (hours > 24 ? "s" : "") : hours + " hours"} of not being used.`
               : "Auto-archiving is off.");
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = `<div class="big">🗂️</div>`;
    empty.append(q ? "No archived tabs match your search." : "Tabs you close show up here.");
    list.append(empty);
    return;
  }
  let lastDay = null, group = null;
  for (const e of shown.slice(0, 600)) {
    const day = dayLabel(e.closedAt);
    if (day !== lastDay) {
      const h = document.createElement("div");
      h.className = "day";
      h.textContent = day;
      group = document.createElement("div");
      group.className = "group";
      list.append(h, group);
      lastDay = day;
    }
    const row = document.createElement("div");
    row.className = "item";
    row.title = e.url;
    const img = document.createElement("img");
    img.src = e.icon || "chrome://global/skin/icons/defaultFavicon.svg";
    img.onerror = () => { img.src = "chrome://global/skin/icons/defaultFavicon.svg"; };
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = e.title || e.url;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = host(e.url) + " · " + new Date(e.closedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (e.spaceName) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = e.spaceName;
      meta.append(chip);
    }
    if (e.auto) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "auto-archived";
      meta.append(chip);
    }
    text.append(title, meta);
    const x = document.createElement("button");
    x.className = "ghost x";
    x.textContent = "Remove";
    x.addEventListener("click", ev => { ev.stopPropagation(); CrescentStore.removeArchive(e.id); });
    row.append(img, text, x);
    row.addEventListener("click", () => Crescent.restoreArchived(e.id));
    group.append(row);
  }
}

async function reload() {
  entries = await CrescentStore.getArchive();
  render();
}

const observer = { observe: () => reload() };
Services.obs.addObserver(observer, "crescent-archive-changed");
window.addEventListener("unload", () => Services.obs.removeObserver(observer, "crescent-archive-changed"));
$("search").addEventListener("input", render);
$("clear").addEventListener("click", () => {
  if (Services.prompt.confirm(window, "Clear Archive", "Remove every tab from the Archive? This can't be undone.")) {
    CrescentStore.clearArchive();
  }
});
reload();
