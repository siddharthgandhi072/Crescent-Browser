// Crescent: the Arc-style features layered on top of Zen.
// Loaded once at startup by crescent.cfg. Sets up every browser window:
//   * Archive: every closed tab is saved (searchable Archive page); old
//     unpinned tabs are archived automatically.
//   * Little Crescent: links opened from other apps open in a small window.
//   * Arc-style Settings window (Cmd+,).
//   * Easels.
//   * Menu items and sidebar buttons for all of the above.

import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  CrescentStore: "chrome://crescent/content/CrescentStore.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  ContextualIdentityService: "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  ShellService: "moz-src:///browser/components/shell/ShellService.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const HTML_NS = "http://www.w3.org/1999/xhtml";
const PAGES = "chrome://crescent/content/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LITTLE_SIZES = { small: [760, 560], medium: [960, 700], large: [1180, 820] };

export const Crescent = {
  report: { errors: [] },
  _settingsWin: null,

  logError(where, e) {
    this.report.errors.push(`${where}: ${e}`);
    console.error(`Crescent ${where}:`, e);
  },

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------
  init({ selfTestDir = "" } = {}) {
    this.selfTestDir = selfTestDir;
    Services.obs.addObserver(this, "browser-window-before-show");
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.obs.addObserver(this, "quit-application-granted");
    try {
      this.catchExternalLinks();
    } catch (e) {
      this.logError("links", e);
    }
  },

  observe(subject, topic) {
    try {
      if (topic === "browser-window-before-show") {
        if (subject.__crescentLittle) {
          subject.document.documentElement.setAttribute("crescent-little", "true");
        }
      } else if (topic === "browser-delayed-startup-finished") {
        this.setUpWindow(subject);
        if (this.selfTestDir && !this._selfTestStarted && !this.isLittle(subject)) {
          this._selfTestStarted = true;
          this.selfTest(subject).catch(e => this.logError("selftest", e));
        }
      } else if (topic === "quit-application-granted") {
        lazy.CrescentStore.flush();
      }
    } catch (e) {
      this.logError(topic, e);
    }
  },

  isLittle(win) {
    return !!win.__crescentLittle || win.document.documentElement.hasAttribute("crescent-little");
  },

  // Most recent normal (not Little, not private) browser window.
  mainWindow(exclude = null) {
    for (const w of lazy.BrowserWindowTracker.orderedWindows) {
      if (w !== exclude && !w.closed && !this.isLittle(w) && !lazy.PrivateBrowsingUtils.isWindowPrivate(w)) {
        return w;
      }
    }
    return null;
  },

  setUpWindow(win) {
    if (win.__crescentReady || !win.gBrowser) {
      return;
    }
    win.__crescentReady = true;
    const little = this.isLittle(win);
    const steps = [
      ["archive", () => this.watchClosedTabs(win)],
      ["settings", () => this.replaceSettings(win)],
      ["keys", () => this.addKeys(win)],
      ["menus", () => this.addMenuItems(win)],
    ];
    if (little) {
      steps.push(["little", () => this.setUpLittle(win)]);
    } else {
      steps.push(["sidebar", () => this.addSidebarButtons(win)]);
      steps.push(["autoarchive", () => this.startAutoArchive(win)]);
    }
    for (const [name, fn] of steps) {
      try {
        fn();
      } catch (e) {
        this.logError(name, e);
      }
    }
  },

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------
  openPage(path, win = null) {
    const main = win && !this.isLittle(win) ? win : this.mainWindow();
    const url = PAGES + path;
    if (!main) {
      return Services.ww.openWindow(null, AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no", this._str(url));
    }
    // Reuse an open copy of the page if there is one.
    const existing = main.gBrowser.tabs.find(t => t.linkedBrowser?.currentURI?.spec === url);
    if (existing) {
      main.gBrowser.selectedTab = existing;
    } else {
      main.openTrustedLinkIn(url, "tab");
    }
    main.focus();
    return main;
  },

  openURL(url, { userContextId = 0, spaceId = null } = {}) {
    const main = this.mainWindow();
    if (!main) {
      Services.ww.openWindow(null, AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,all,dialog=no", this._str(url));
      return;
    }
    const tab = main.gBrowser.addTrustedTab(url, { userContextId });
    try {
      if (spaceId && main.gZenWorkspaces?.getWorkspaceFromId(spaceId)) {
        main.gZenWorkspaces.moveTabToWorkspace(tab, spaceId);
        main.gZenWorkspaces.changeWorkspaceWithID(spaceId);
      }
    } catch (e) {
      this.logError("openURL space", e);
    }
    main.gBrowser.selectedTab = tab;
    main.focus();
  },

  _str(s) {
    const str = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
    str.data = s;
    return str;
  },

  // -------------------------------------------------------------------------
  // Archive
  // -------------------------------------------------------------------------
  watchClosedTabs(win) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
      return;
    }
    win.gBrowser.tabContainer.addEventListener("TabClose", event => {
      try {
        this.archiveTab(win, event.target, event.detail);
      } catch (e) {
        this.logError("archiveTab", e);
      }
    });
  },

  archiveTab(win, tab, detail) {
    if (detail?.adoptedBy || tab.hasAttribute("zen-empty-tab") || tab.hasAttribute("zen-glance-tab")) {
      return;
    }
    let url = "";
    let title = tab.label || "";
    try {
      const state = JSON.parse(lazy.SessionStore.getTabState(tab));
      const entry = state.entries?.[(state.index || state.entries.length) - 1];
      url = entry?.url || "";
      title = entry?.title || title;
    } catch {}
    url ||= tab.linkedBrowser?.currentURI?.spec || "";
    if (!/^(https?|file):/.test(url)) {
      return;
    }
    const spaceId = tab.getAttribute("zen-workspace-id") || null;
    let space = null;
    try {
      space = spaceId ? win.gZenWorkspaces?.getWorkspaceFromId(spaceId) : null;
    } catch {}
    lazy.CrescentStore.addArchive({
      url,
      title: title || url,
      icon: "page-icon:" + url,
      spaceId,
      spaceName: space?.name || "",
      spaceIcon: space?.icon || "",
      userContextId: tab.userContextId || 0,
      auto: !!tab.__crescentAutoArchived,
    });
  },

  startAutoArchive(win) {
    const run = () => {
      try {
        this.archiveOldTabs(win);
      } catch (e) {
        this.logError("autoarchive", e);
      }
    };
    const minutes = Math.max(1, Services.prefs.getIntPref("crescent.archive.check-minutes", 10));
    win.setTimeout(run, 60 * 1000);
    win.setInterval(run, minutes * 60 * 1000);
  },

  archiveOldTabs(win) {
    const hours = Services.prefs.getIntPref("crescent.archive.after-hours", 12);
    if (hours <= 0 || !win.gBrowser) {
      return;
    }
    const cutoff = Date.now() - hours * 3600 * 1000;
    const old = win.gBrowser.tabs.filter(
      t =>
        !t.pinned &&
        !t.hasAttribute("zen-essential") &&
        !t.hasAttribute("zen-glance-tab") &&
        !t.hasAttribute("zen-empty-tab") &&
        !t.splitView &&
        !t.selected &&
        !t.multiselected &&
        !t.soundPlaying &&
        t.lastAccessed > 0 &&
        t.lastAccessed < cutoff
    );
    for (const t of old) {
      t.__crescentAutoArchived = true;
    }
    if (old.length) {
      win.gBrowser.removeTabs(old, { animate: false });
    }
  },

  async restoreArchived(id) {
    const entry = (await lazy.CrescentStore.getArchive()).find(e => e.id === id);
    if (!entry) {
      return;
    }
    this.openURL(entry.url, { userContextId: entry.userContextId || 0, spaceId: entry.spaceId });
    await lazy.CrescentStore.removeArchive(id);
  },

  // -------------------------------------------------------------------------
  // Little Crescent
  // -------------------------------------------------------------------------
  // Firefox opens links from other apps through BrowserDOMWindow.openURI with
  // the OPEN_EXTERNAL flag. Patch that method once (on the class, since the
  // per-window object is read-only) to open Little Crescent instead.
  catchExternalLinks() {
    const { BrowserDOMWindow } = ChromeUtils.importESModule("resource:///modules/BrowserDOMWindow.sys.mjs");
    const proto = BrowserDOMWindow.prototype;
    if (proto.__crescentWrapped) {
      return;
    }
    const original = proto.openURI;
    const self = this;
    proto.openURI = function (uri, openWindowInfo, where, flags, ...rest) {
      try {
        if (
          flags & Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL &&
          uri &&
          /^https?$/.test(uri.scheme) &&
          Services.prefs.getBoolPref("crescent.little.enabled", true) &&
          !(this.win && lazy.PrivateBrowsingUtils.isWindowPrivate(this.win))
        ) {
          self.openLittle(uri.spec);
          return null;
        }
      } catch (e) {
        self.logError("little open", e);
      }
      return original.call(this, uri, openWindowInfo, where, flags, ...rest);
    };
    proto.__crescentWrapped = true;
    this.report.linkHook = "prototype";
  },

  openLittle(url = "about:blank") {
    const size = LITTLE_SIZES[Services.prefs.getStringPref("crescent.little.size", "medium")] || LITTLE_SIZES.medium;
    const w = Services.ww.openWindow(
      null,
      AppConstants.BROWSER_CHROME_URL,
      "_blank",
      `chrome,all,dialog=no,centerscreen,width=${size[0]},height=${size[1]}`,
      this._str(url)
    );
    w.__crescentLittle = true;
    w.__crescentLittleFocus = url === "about:blank"; // empty window: start in the address box
    w._zenStartupSyncFlag = "unsynced"; // Zen: don't mirror this window's tabs elsewhere
    return w;
  },

  setUpLittle(win) {
    const doc = win.document;
    doc.documentElement.setAttribute("crescent-little", "true");
    const h = (tag, props = {}, ...kids) => {
      const el = doc.createElementNS(HTML_NS, tag);
      Object.assign(el, props);
      el.append(...kids);
      return el;
    };
    const icon = h("img", { id: "crescent-little-icon", alt: "" });
    const field = h("input", { id: "crescent-little-url", type: "text", spellcheck: false });
    const copy = h("button", { id: "crescent-little-copy", className: "crescent-little-btn", title: "Copy link" });
    const open = h("button", { id: "crescent-little-open", className: "crescent-little-btn crescent-little-primary", title: "Open in Crescent" }, "Open in Crescent");
    const bar = h("div", { id: "crescent-little-bar" }, icon, field, copy, open);

    const wrapper = doc.getElementById("zen-appcontent-wrapper") || doc.getElementById("browser");
    wrapper.prepend(bar);

    const update = () => {
      const uri = win.gBrowser.currentURI;
      let host = "";
      try {
        host = uri.host || uri.spec;
      } catch {
        host = uri?.spec || "";
      }
      if (doc.activeElement !== field) {
        field.value = host.replace(/^www\./, "");
      }
      icon.src = win.gBrowser.selectedTab.getAttribute("image") || "chrome://global/skin/icons/defaultFavicon.svg";
      doc.title = win.gBrowser.selectedTab.label;
    };
    win.gBrowser.tabContainer.addEventListener("TabAttrModified", update);
    win.gBrowser.tabContainer.addEventListener("TabSelect", update);
    win.gBrowser.addProgressListener({
      onLocationChange: () => update(),
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
    });
    update();

    field.addEventListener("focus", () => {
      field.value = win.gBrowser.currentURI.spec;
      field.select();
    });
    field.addEventListener("blur", update);
    field.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        this.loadTyped(win, field.value);
        win.gBrowser.selectedBrowser.focus();
      } else if (e.key === "Escape") {
        win.gBrowser.selectedBrowser.focus();
      }
    });
    copy.addEventListener("click", () => {
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(win.gBrowser.currentURI.spec);
      copy.classList.add("done");
      win.setTimeout(() => copy.classList.remove("done"), 1200);
    });
    open.addEventListener("click", () => this.promoteLittle(win));
    win.addEventListener(
      "keydown",
      e => {
        if (e.metaKey && !e.altKey && !e.shiftKey && e.code === "KeyL") {
          e.preventDefault();
          e.stopPropagation();
          field.focus();
        } else if (e.metaKey && !e.altKey && !e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          this.promoteLittle(win);
        }
      },
      true
    );
    if (win.__crescentLittleFocus) {
      win.setTimeout(() => field.focus(), 50);
    }
  },

  loadTyped(win, text) {
    text = (text || "").trim();
    if (!text) {
      return;
    }
    const info = Services.uriFixup.getFixupURIInfo(
      text,
      Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS | Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP
    );
    if (info.preferredURI) {
      win.gBrowser.selectedBrowser.loadURI(info.preferredURI, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }
  },

  // "Open in Crescent": move the Little window's tab into the main window.
  promoteLittle(win) {
    const tab = win.gBrowser.selectedTab;
    const url = win.gBrowser.currentURI.spec;
    const main = this.mainWindow(win);
    if (!main) {
      // No main window: turn this one into a normal window.
      win.__crescentLittle = false;
      win.document.documentElement.removeAttribute("crescent-little");
      win.document.getElementById("crescent-little-bar")?.remove();
      return;
    }
    let moved = null;
    try {
      moved = main.gBrowser.adoptTab(tab, { selectTab: true });
    } catch (e) {
      this.logError("adoptTab", e);
    }
    if (!moved) {
      main.openTrustedLinkIn(url, "tab");
    }
    main.focus();
    if (!win.closed) {
      win.close();
    }
  },

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  replaceSettings(win) {
    const original = win.openPreferences;
    if (typeof original !== "function" || original.__crescent) {
      return;
    }
    const self = this;
    const wrapped = function (paneID, extraArgs) {
      if (!paneID && !extraArgs && Services.prefs.getBoolPref("crescent.settings.arc-style", true)) {
        self.openSettings();
        return undefined;
      }
      return original.apply(this, arguments);
    };
    wrapped.__crescent = true;
    win.openPreferences = wrapped;
  },

  openSettings() {
    if (this._settingsWin && !this._settingsWin.closed) {
      this._settingsWin.focus();
      return this._settingsWin;
    }
    this._settingsWin = Services.ww.openWindow(
      null,
      PAGES + "settings.html",
      "crescent-settings",
      "chrome,titlebar,close,minimizable,centerscreen,resizable,dialog=no,width=800,height=640",
      null
    );
    return this._settingsWin;
  },

  openFullSettings(pane = "paneGeneral") {
    const main = this.mainWindow();
    main?.openPreferences(pane);
    main?.focus();
  },

  // Data for the Settings window
  getSpaces() {
    const main = this.mainWindow();
    try {
      return (main?.gZenWorkspaces?.getWorkspaces() || []).map(w => ({
        uuid: w.uuid,
        name: w.name,
        icon: w.icon || "",
        containerTabId: w.containerTabId || 0,
      }));
    } catch (e) {
      this.logError("getSpaces", e);
      return [];
    }
  },

  setSpaceProfile(uuid, containerTabId) {
    const main = this.mainWindow();
    const ws = main?.gZenWorkspaces?.getWorkspaceFromId(uuid);
    if (ws) {
      main.gZenWorkspaces.saveWorkspace({ ...ws, containerTabId: Number(containerTabId) || 0 });
    }
  },

  newSpace() {
    const main = this.mainWindow();
    if (main) {
      main.focus();
      main.gZenWorkspaces.openWorkspaceCreation();
    }
  },

  getProfiles() {
    const CIS = lazy.ContextualIdentityService;
    return [
      { id: 0, name: "Default", color: "", builtIn: true },
      ...CIS.getPublicIdentities().map(i => ({
        id: i.userContextId,
        name: CIS.getUserContextLabel(i.userContextId),
        color: i.color,
        icon: i.icon,
      })),
    ];
  },

  createProfile(name) {
    return lazy.ContextualIdentityService.create(name || "New Profile", "fingerprint", "purple");
  },

  renameProfile(id, name) {
    const CIS = lazy.ContextualIdentityService;
    const i = CIS.getPublicIdentityFromId(id);
    if (i && name) {
      CIS.update(id, name, i.icon, i.color);
    }
  },

  deleteProfile(id) {
    for (const s of this.getSpaces()) {
      if (s.containerTabId === id) {
        this.setSpaceProfile(s.uuid, 0);
      }
    }
    lazy.ContextualIdentityService.remove(id);
  },

  isDefaultBrowser() {
    try {
      return lazy.ShellService.isDefaultBrowser(false, false);
    } catch {
      return false;
    }
  },

  setDefaultBrowser() {
    try {
      lazy.ShellService.setDefaultBrowser(false);
    } catch (e) {
      this.logError("setDefaultBrowser", e);
    }
  },

  // -------------------------------------------------------------------------
  // Easels
  // -------------------------------------------------------------------------
  async newEasel() {
    const easel = await lazy.CrescentStore.createEasel();
    this.openPage("easel.html?id=" + easel.id);
    return easel;
  },

  // Tabs that can be captured into an Easel.
  listCaptureTabs() {
    const out = [];
    for (const w of lazy.BrowserWindowTracker.orderedWindows) {
      for (const t of w.gBrowser.tabs) {
        const url = t.linkedBrowser?.currentURI?.spec || "";
        if (/^https?:/.test(url) && !t.hasAttribute("pending") && t.linkedBrowser.browsingContext?.currentWindowGlobal) {
          out.push({ key: t.linkedPanel, title: t.label, url, icon: t.getAttribute("image") || "" });
        }
      }
    }
    return out;
  },

  async captureTab(key) {
    for (const w of lazy.BrowserWindowTracker.orderedWindows) {
      const t = w.gBrowser.tabs.find(x => x.linkedPanel === key);
      if (t) {
        const wg = t.linkedBrowser.browsingContext.currentWindowGlobal;
        return { bitmap: await wg.drawSnapshot(null, 1, "white"), url: t.linkedBrowser.currentURI.spec, title: t.label };
      }
    }
    throw new Error("Tab not found");
  },

  // -------------------------------------------------------------------------
  // Menus, keys, sidebar buttons
  // -------------------------------------------------------------------------
  addKeys(win) {
    win.addEventListener(
      "keydown",
      e => {
        // Cmd+Option+N: new Little Crescent window (like Arc's Little Arc)
        if (e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey && e.code === "KeyN") {
          e.preventDefault();
          e.stopPropagation();
          this.openLittle();
        }
      },
      true
    );
  },

  addMenuItems(win) {
    const doc = win.document;
    const popup = doc.getElementById("menu_FilePopup");
    if (!popup || doc.getElementById("crescent-menu-little")) {
      return;
    }
    const item = (id, label, fn, accel = "") => {
      const m = doc.createXULElement("menuitem");
      m.id = id;
      m.setAttribute("label", label);
      if (accel) {
        m.setAttribute("acceltext", accel);
      }
      m.addEventListener("command", () => fn());
      return m;
    };
    const anchor = doc.getElementById("menu_newPrivateWindow") || doc.getElementById("menu_newNavigator");
    const items = [
      item("crescent-menu-little", "New Little Crescent Window", () => this.openLittle(), "⌥⌘N"),
      doc.createXULElement("menuseparator"),
      item("crescent-menu-new-easel", "New Easel", () => this.newEasel()),
      item("crescent-menu-easels", "Easels", () => this.openPage("easels.html")),
      item("crescent-menu-archive", "Archive", () => this.openPage("archive.html")),
    ];
    if (anchor?.nextSibling) {
      for (const it of items.reverse()) {
        popup.insertBefore(it, anchor.nextSibling);
      }
    } else {
      popup.append(...items.reverse());
    }
  },

  addSidebarButtons(win) {
    const doc = win.document;
    const foot = doc.getElementById("zen-sidebar-foot-buttons");
    if (!foot || doc.getElementById("crescent-archive-button")) {
      return;
    }
    const button = (id, tooltip, fn) => {
      const b = doc.createXULElement("toolbarbutton");
      b.id = id;
      b.className = "toolbarbutton-1 chromeclass-toolbar-additional zen-sidebar-action-button crescent-sidebar-button";
      b.setAttribute("tooltiptext", tooltip);
      b.setAttribute("removable", "false");
      b.addEventListener("command", () => fn());
      return b;
    };
    const before = doc.getElementById("zen-workspaces-button");
    const archive = button("crescent-archive-button", "Archive", () => this.openPage("archive.html", win));
    const easels = button("crescent-easels-button", "Easels", () => this.openPage("easels.html", win));
    if (before && before.parentNode === foot) {
      foot.insertBefore(archive, before);
      foot.insertBefore(easels, before);
    } else {
      foot.prepend(easels);
      foot.prepend(archive);
    }
  },

  // -------------------------------------------------------------------------
  // Self-test (only when CRESCENT_SELFTEST=/folder is set; used by the build)
  // -------------------------------------------------------------------------
  async snap(win, name) {
    try {
      const bmp = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
      const c = win.document.createElementNS(HTML_NS, "canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      await IOUtils.write(PathUtils.join(this.selfTestDir, name), new Uint8Array(await blob.arrayBuffer()));
      (this.report.snapshots ??= []).push(name);
    } catch (e) {
      this.logError("snap " + name, e);
    }
  },

  async selfTest(main) {
    const r = this.report;
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        this.logError("step " + name, e);
      }
    };
    await sleep(8000);
    r.cssRegistered = !!this.cssRegistered;
    r.policies = { active: Object.keys(Services.policies.getActivePolicies() || {}) };
    r.prefs = {};
    for (const p of ["browser.ml.enable", "browser.ml.chat.enabled", "browser.tabs.groups.smart.enabled", "browser.ai.control.default"]) {
      const t = Services.prefs.getPrefType(p);
      r.prefs[p] = t == Services.prefs.PREF_BOOL ? Services.prefs.getBoolPref(p) : Services.prefs.getStringPref(p, "");
      r.prefs[p + " (locked)"] = Services.prefs.prefIsLocked(p);
    }
    r.brand = {
      quit: main.document.getElementById("menu_FileQuitItem")?.getAttribute("label") || "",
      about: main.document.getElementById("aboutName")?.getAttribute("label") || "",
    };
    r.sidebarButtons = !!main.document.getElementById("crescent-archive-button");
    r.menuItems = !!main.document.getElementById("crescent-menu-little");

    const gB = main.gBrowser;
    const tabs = [];
    await step("tabs", async () => {
      for (const url of [
        "https://www.wikipedia.org/",
        "https://developer.mozilla.org/",
        "https://news.ycombinator.com/",
        "https://github.com/",
        "https://example.com/",
        "https://www.mozilla.org/",
      ]) {
        tabs.push(gB.addTrustedTab(url));
      }
      await sleep(6000);
      try {
        main.gZenPinnedTabManager.addToEssentials(tabs[0]);
        main.gZenPinnedTabManager.addToEssentials(tabs[1]);
      } catch (e) {
        this.logError("essentials", e);
      }
      gB.pinTab(tabs[2]);
      gB.selectedTab = tabs[4];
      await sleep(4000);
    });
    await this.snap(main, "1-main.png");

    await step("archive", async () => {
      const t = tabs[3];
      gB.removeTab(t, { animate: false });
      await sleep(1500);
      r.archiveCount = (await lazy.CrescentStore.getArchive()).length;
      this.openPage("archive.html", main);
      await sleep(3000);
    });
    await this.snap(main, "2-archive.png");

    await step("easel", async () => {
      const easel = await lazy.CrescentStore.createEasel("Weekend ideas");
      easel.items = [
        { id: "a", type: "text", x: 80, y: 70, w: 420, h: 60, text: "Weekend ideas", size: 34, bold: true },
        { id: "b", type: "note", x: 90, y: 170, w: 220, h: 170, text: "Book the cabin before Friday", color: "#ffe58a" },
        { id: "c", type: "note", x: 340, y: 190, w: 220, h: 150, text: "Try the new ramen place", color: "#b9f1d1" },
        { id: "d", type: "shape", x: 620, y: 120, w: 200, h: 140, shape: "ellipse", color: "#c9b6ff" },
        { id: "e", type: "link", x: 610, y: 320, w: 300, h: 70, url: "https://www.wikipedia.org/", title: "Wikipedia" },
      ];
      await lazy.CrescentStore.saveEasel(easel);
      r.easelId = easel.id;
      this.openPage("easel.html?id=" + easel.id, main);
      await sleep(4000);
    });
    await this.snap(main, "3-easel.png");

    await step("settings", async () => {
      const sw = this.openSettings();
      await sleep(4000);
      await this.snap(sw, "4-settings.png");
      r.settingsOpened = !sw.closed;
      sw.close();
    });

    await step("little", async () => {
      const before = gB.tabs.length;
      main.browserDOMWindow.openURI(
        Services.io.newURI("https://example.org/"),
        null,
        Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW,
        Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
        Services.scriptSecurityManager.getSystemPrincipal()
      );
      await sleep(7000);
      const little = lazy.BrowserWindowTracker.orderedWindows.find(w => this.isLittle(w));
      r.littleOpened = !!little;
      if (little) {
        r.littleBar = !!little.document.getElementById("crescent-little-bar");
        await this.snap(little, "5-little.png");
        this.promoteLittle(little);
        await sleep(3000);
        r.littlePromoted = little.closed && gB.tabs.length > before;
      }
    });

    await step("dark", async () => {
      Services.prefs.setIntPref("zen.view.window.scheme", 0);
      gB.selectedTab = tabs[5];
      await sleep(3000);
    });
    await this.snap(main, "6-main-dark.png");

    await IOUtils.writeUTF8(PathUtils.join(this.selfTestDir, "selftest.json"), JSON.stringify(r, null, 2));
  },
};
