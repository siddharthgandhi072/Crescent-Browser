"use strict";
const { Crescent } = ChromeUtils.importESModule("chrome://crescent/content/Crescent.sys.mjs");
const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");

const $ = id => document.getElementById(id);
const P = Services.prefs;

// ---------- Tabs ----------
for (const b of document.querySelectorAll("#tabs button")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll("#tabs button")) x.classList.toggle("on", x === b);
    for (const p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.id === b.dataset.pane);
    if (b.dataset.pane === "profiles") renderProfiles();
  });
}

// ---------- Controls bound to prefs ----------
function bindPrefs() {
  for (const el of document.querySelectorAll("[data-pref]")) {
    const pref = el.dataset.pref;
    const invert = el.dataset.invert === "true";
    if (el.type === "checkbox") {
      el.checked = P.getBoolPref(pref, false) !== invert;
      el.addEventListener("change", () => P.setBoolPref(pref, el.checked !== invert));
    } else if (el.tagName === "SELECT") {
      const type = el.dataset.type;
      el.value = String(type === "int" ? P.getIntPref(pref, 0) : P.getStringPref(pref, ""));
      el.addEventListener("change", () =>
        type === "int" ? P.setIntPref(pref, parseInt(el.value, 10)) : P.setStringPref(pref, el.value)
      );
    }
  }
}

// ---------- General ----------
function renderDefault() {
  const isDefault = Crescent.isDefaultBrowser();
  $("default-status").textContent = isDefault ? "Crescent is your default browser." : "Crescent isn't your default browser.";
  $("make-default").hidden = isDefault;
}
$("make-default").addEventListener("click", () => {
  Crescent.setDefaultBrowser();
  setTimeout(renderDefault, 1500);
});

const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
async function renderEngines() {
  await SearchService.init();
  const engines = await SearchService.getVisibleEngines();
  const current = await SearchService.getDefault();
  const sel = $("engine");
  sel.textContent = "";
  for (const e of engines) {
    const o = document.createElement("option");
    o.value = e.name;
    o.textContent = e.name;
    o.selected = e.name === current?.name;
    sel.append(o);
  }
  sel.addEventListener("change", async () => {
    const engine = SearchService.getEngineByName(sel.value);
    if (engine) await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER);
  });
}
$("open-archive").addEventListener("click", () => Crescent.openPage("archive.html"));

// ---------- Profiles & Spaces ----------
function spaceIcon(icon) {
  const box = document.createElement("span");
  box.className = "space-icon";
  if (icon && /^(chrome|moz|data|resource):/.test(icon)) {
    const img = document.createElement("img");
    img.src = icon;
    box.append(img);
  } else {
    box.textContent = icon || "•";
  }
  return box;
}

function renderProfiles() {
  const profiles = Crescent.getProfiles();
  const spaces = Crescent.getSpaces();

  const sl = $("space-list");
  sl.textContent = "";
  if (!spaces.length) {
    sl.innerHTML = `<div class="set"><span class="muted">Open a browser window to manage Spaces.</span></div>`;
  }
  for (const s of spaces) {
    const row = document.createElement("div");
    row.className = "set";
    const name = document.createElement("div");
    name.className = "row";
    const label = document.createElement("b");
    label.textContent = s.name;
    name.append(spaceIcon(s.icon), label);
    const sel = document.createElement("select");
    for (const p of profiles) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      o.selected = p.id === s.containerTabId;
      sel.append(o);
    }
    sel.addEventListener("change", () => Crescent.setSpaceProfile(s.uuid, parseInt(sel.value, 10)));
    row.append(name, sel);
    sl.append(row);
  }

  const pl = $("profile-list");
  pl.textContent = "";
  for (const p of profiles) {
    const row = document.createElement("div");
    row.className = "set";
    const name = document.createElement("div");
    name.className = "row";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = p.color ? `var(--identity-${p.color}, ${p.color})` : "var(--muted)";
    const label = document.createElement("b");
    label.textContent = p.name;
    const used = spaces.filter(s => s.containerTabId === p.id).map(s => s.name);
    const sub = document.createElement("span");
    sub.className = "muted";
    sub.textContent = used.length ? "· " + used.join(", ") : "· not used";
    name.append(dot, label, sub);
    row.append(name);
    if (!p.builtIn) {
      const rename = Object.assign(document.createElement("button"), { className: "ghost", textContent: "Rename" });
      rename.addEventListener("click", () => {
        const out = { value: p.name };
        if (Services.prompt.prompt(window, "Rename Profile", "Profile name:", out, null, {}) && out.value.trim()) {
          Crescent.renameProfile(p.id, out.value.trim());
          renderProfiles();
        }
      });
      const del = Object.assign(document.createElement("button"), { className: "ghost danger", textContent: "Delete" });
      del.addEventListener("click", () => {
        if (Services.prompt.confirm(window, "Delete Profile", `Delete “${p.name}”? Its logins and cookies will be removed. Spaces using it move to Default.`)) {
          Crescent.deleteProfile(p.id);
          renderProfiles();
        }
      });
      row.append(rename, del);
    }
    pl.append(row);
  }
}
$("new-profile").addEventListener("click", () => {
  const out = { value: "" };
  if (Services.prompt.prompt(window, "New Profile", "Name your new profile (for example Work or School):", out, null, {}) && out.value.trim()) {
    Crescent.createProfile(out.value.trim());
    renderProfiles();
  }
});
$("new-space").addEventListener("click", () => Crescent.newSpace());

// ---------- Shortcuts ----------
const SHORTCUTS = [
  ["Command bar / new tab", "⌘T"],
  ["Focus the address", "⌘L"],
  ["Hide or show the sidebar", "⌘S"],
  ["New Little Crescent window", "⌥⌘N"],
  ["Open Little Crescent tab in Crescent", "⌘↩"],
  ["Switch Space", "⌃1 … ⌃9"],
  ["Next / previous Space", "⌥⌘→ / ⌥⌘←"],
  ["Pin or unpin tab", "⇧⌘D"],
  ["Copy URL", "⇧⌘C"],
  ["Clear unpinned tabs", "⇧⌘K"],
  ["Reopen last closed tab", "⇧⌘T"],
  ["Peek a link", "⇧ + click"],
  ["Split view (side by side)", "⌥⌘V"],
  ["Split view (stacked / grid)", "⌥⌘H / ⌥⌘G"],
  ["Settings", "⌘,"],
];
function renderShortcuts() {
  const box = $("shortcut-list");
  for (const [what, keys] of SHORTCUTS) {
    const row = document.createElement("div");
    row.className = "set";
    const a = document.createElement("div");
    a.textContent = what;
    const k = document.createElement("span");
    k.className = "keys";
    k.textContent = keys;
    row.append(a, k);
    box.append(row);
  }
}
$("edit-keys").addEventListener("click", () => {
  const main = Crescent.mainWindow();
  main?.openTrustedLinkIn("about:keyboard", "tab");
  main?.focus();
});

// ---------- Advanced ----------
$("all-settings").addEventListener("click", () => Crescent.openFullSettings());
$("addons").addEventListener("click", () => {
  const main = Crescent.mainWindow();
  main?.BrowserAddonUI?.openAddonsMgr("addons://list/extension");
  main?.focus();
});
$("import").addEventListener("click", () => {
  const main = Crescent.mainWindow();
  try {
    main?.MigrationUtils?.showMigrationWizard(main, {});
  } catch {
    Crescent.openFullSettings("paneGeneral");
  }
  main?.focus();
});
$("version").textContent = `Crescent, based on Zen ${AppConstants.MOZ_APP_VERSION_DISPLAY || AppConstants.MOZ_APP_VERSION}`;

// ---------- Go ----------
bindPrefs();
renderDefault();
renderEngines().catch(e => Crescent.logError("settings engines", e));
renderShortcuts();
renderProfiles();
window.addEventListener("keydown", e => {
  if (e.key === "Escape" || (e.metaKey && e.key === "w")) window.close();
});
