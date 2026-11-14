'use strict'
// The main Crescent window: sidebar (base renderer), live tabs
// (WebContentsViews), the overlay layer (command bar, popovers, find bar,
// prompts) and Peek. All tab/space behaviour is driven from here.

const { BrowserWindow, WebContentsView, clipboard, Menu, nativeTheme, screen, shell } = require('electron')
const M = require('./model')
const { Tab, hostOf, roundRect } = require('./tab')
const { resolveInput, displayUrl, queryFromSearchUrl } = require('./urls')
const paths = require('./paths')

const PAD = 8
const GAP = 6
const IS_MAC = process.platform === 'darwin'

class MainWindow {
  constructor(app) {
    this.app = app // CrescentApp: store, history, sessions, extensions, downloads, permissions
    this.tabs = new Map()
    this.mru = []
    this.display = []
    this.sidebarPeek = false
    this.htmlFullscreen = false
    this.hoverUrl = ''
    this.peek = null
    this.overlayMode = null
    this.overlayReady = null
    this.runtimePatch = {}
    this.runtimeTimer = null
    this.findState = null
    this.closed = false
  }

  get state() { return this.app.store.state }
  get settings() { return this.state.settings }
  get space() { return M.activeSpace(this.state) }

  // ---------- window ----------

  create() {
    const saved = this.state.window
    const bounds = validBounds(saved)
    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 620,
      minHeight: 420,
      show: false,
      title: 'Crescent',
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: IS_MAC ? 'sidebar' : undefined,
      visualEffectState: 'followWindow',
      backgroundColor: IS_MAC ? '#00000000' : '#efe9f3',
      webPreferences: {
        preload: paths.preload('ui.js'),
        session: this.app.uiSession,
        contextIsolation: true,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    })
    if (saved && saved.maximized) this.win.maximize()
    this.wc = this.win.webContents
    this.app.registerUI(this.wc, this)
    guardUI(this.wc)
    this.wc.loadURL(paths.ui('sidebar/index.html'))
    this.win.once('ready-to-show', () => this.win.show())
    // Fallback in case ready-to-show never fires (GPU hiccup on first launch).
    setTimeout(() => { if (!this.win.isDestroyed() && !this.win.isVisible()) this.win.show() }, 3000)

    this.createOverlay()

    this.win.on('resize', () => this.layout())
    this.win.on('enter-full-screen', () => { this.layout(); this.pushRuntime({ windowFullscreen: true }) })
    this.win.on('leave-full-screen', () => { this.layout(); this.pushRuntime({ windowFullscreen: false }) })
    this.win.on('focus', () => this.app.setFocusedWindow(this))
    const saveBounds = debounce(() => this.saveBounds(), 500)
    this.win.on('move', saveBounds)
    this.win.on('resize', saveBounds)
    this.win.on('close', () => this.saveBounds())
    this.win.on('closed', () => this.onClosed())

    // Restore the active tab of the active space only. Everything else is
    // loaded the first time you click it: fast startup, low memory.
    const space = this.space
    if (space.activeId && M.locate(this.state, space.activeId)) this.select(space.activeId, { focus: false })
    this.layout()
    this.applyWindowButtons()
    this.memoryTimer = setInterval(() => this.memorySaver(), 60 * 1000)
    return this
  }

  saveBounds() {
    if (!this.win || this.win.isDestroyed() || this.win.isFullScreen()) return
    const maximized = this.win.isMaximized()
    this.state.window = { ...(maximized && this.state.window ? this.state.window : this.win.getNormalBounds()), maximized }
    this.app.store.save()
  }

  onClosed() {
    this.closed = true
    clearInterval(this.memoryTimer)
    for (const t of this.tabs.values()) { this.app.extensions?.removeTab(t.wc); t.destroy() }
    this.tabs.clear()
    if (this.peek) this.peek.tab.destroy()
    this.peek = null
    this.app.onMainClosed(this)
  }

  focus() {
    if (this.win.isMinimized()) this.win.restore()
    this.win.show()
    this.win.focus()
  }

  // ---------- overlay layer ----------

  createOverlay() {
    const v = new WebContentsView({
      webPreferences: {
        preload: paths.preload('ui.js'),
        session: this.app.uiSession,
        contextIsolation: true,
        sandbox: false,
        spellcheck: false,
        transparent: true,
      },
    })
    v.setBackgroundColor('#00000000')
    v.setVisible(false)
    this.overlay = v
    this.app.registerUI(v.webContents, this)
    guardUI(v.webContents)
    v.webContents.loadURL(paths.ui('overlay/index.html'))
    v.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && this.overlayMode === 'find') {
        e.preventDefault(); this.closeOverlay()
      }
    })
    this.win.contentView.addChildView(v)
  }

  // mode: 'command' | 'bookmarks' | 'library' | 'theme' | 'find' | 'peek' | 'prompt' | 'toast' | 'spaces' | 'extensions'
  openOverlay(mode, data = {}) {
    if (this.closed) return
    if (mode !== 'peek' && this.peek) this.closePeek()
    this.overlayMode = mode
    this.overlayBounds()
    this.overlay.webContents.send('overlay:open', { mode, data, layout: this.layoutInfo() })
    const show = () => {
      if (this.overlayMode !== mode) return
      this.overlay.setVisible(true)
      this.restack()
      if (mode !== 'toast') this.overlay.webContents.focus()
    }
    clearTimeout(this.overlayReady)
    this.overlayShow = show
    this.overlayReady = setTimeout(show, 120) // in case the renderer is slow to ack
  }

  overlayRendered() {
    clearTimeout(this.overlayReady)
    if (this.overlayShow) { this.overlayShow(); this.overlayShow = null }
  }

  closeOverlay({ refocus = true } = {}) {
    if (!this.overlayMode) return
    const wasFind = this.overlayMode === 'find'
    const wasPrompt = this.overlayMode === 'prompt'
    this.overlayMode = null
    this.overlayShow = null
    clearTimeout(this.overlayReady)
    this.overlay.setVisible(false)
    this.overlay.webContents.send('overlay:close')
    if (wasFind) this.stopFind()
    if (wasPrompt) this.app.permissions.cancelAll() // never leave a site waiting forever
    if (this.peek) this.closePeek()
    if (refocus) this.focusActive()
  }

  overlayBounds() {
    if (!this.overlayMode) return
    const [w, h] = this.win.getContentSize()
    const c = this.contentRect()
    if (this.overlayMode === 'find') {
      this.overlay.setBounds(roundRect({ x: c.x + c.width - 372, y: c.y + 10, width: 362, height: 56 }))
    } else if (this.overlayMode === 'toast') {
      this.overlay.setBounds(roundRect({ x: c.x + c.width / 2 - 200, y: c.y + c.height - 70, width: 400, height: 60 }))
    } else {
      this.overlay.setBounds({ x: 0, y: 0, width: w, height: h })
    }
  }

  toast(text, opts = {}) {
    // Shown in the sidebar when it is visible, otherwise floating over the page.
    if (!this.settings.sidebarHidden || this.sidebarPeek) {
      this.wc.send('toast', { text, ...opts })
    } else if (!this.overlayMode) {
      this.openOverlay('toast', { text, ...opts })
      clearTimeout(this.toastTimer)
      this.toastTimer = setTimeout(() => { if (this.overlayMode === 'toast') this.closeOverlay({ refocus: false }) }, 1800)
    }
  }

  // ---------- layout ----------

  contentRect() {
    const [w, h] = this.win.getContentSize()
    if (this.htmlFullscreen) return { x: 0, y: 0, width: w, height: h }
    const sbw = this.settings.sidebarWidth
    const hidden = this.settings.sidebarHidden
    const right = this.settings.sidebarRight
    let x, width
    if (hidden) {
      x = PAD; width = w - PAD * 2
      if (this.sidebarPeek) x += right ? -(sbw - PAD) : sbw - PAD // slide, don't resize
    } else if (right) {
      x = PAD; width = w - sbw - PAD
    } else {
      x = sbw; width = w - sbw - PAD
    }
    return { x, y: PAD, width: Math.max(100, width), height: Math.max(100, h - PAD * 2) }
  }

  displayRects() {
    const c = this.contentRect()
    const ids = this.display
    if (ids.length <= 1) return ids.map(id => ({ id, ...c }))
    const split = M.splitOf(this.state, ids[0])
    const sizes = split && split.sizes && split.sizes.length === ids.length ? split.sizes : ids.map(() => 1 / ids.length)
    const usable = c.width - GAP * (ids.length - 1)
    let x = c.x
    return ids.map((id, i) => {
      const width = i === ids.length - 1 ? c.x + c.width - x : usable * sizes[i]
      const r = { id, x, y: c.y, width, height: c.height }
      x += width + GAP
      return r
    })
  }

  layoutInfo() {
    const [w, h] = this.win.getContentSize()
    return { width: w, height: h, content: this.contentRect(), rects: this.displayRects(), fullscreen: this.htmlFullscreen }
  }

  layout() {
    if (this.closed) return
    for (const r of this.displayRects()) {
      const t = this.tabs.get(r.id)
      if (t) t.setBounds(r)
    }
    if (this.peek) this.peek.tab.setBounds(this.peekRect())
    this.overlayBounds()
    this.wc.send('layout', this.layoutInfo())
  }

  // Attaches exactly the views that should be visible, in z-order.
  restack() {
    const cv = this.win.contentView
    const want = this.display.map(id => this.tabs.get(id)).filter(Boolean)
    for (const t of this.tabs.values()) {
      if (!want.includes(t) && cv.children.includes(t.view)) cv.removeChildView(t.view)
    }
    for (const t of want) cv.addChildView(t.view) // re-adding moves to top
    if (this.overlayMode) cv.addChildView(this.overlay)
    if (this.peek) cv.addChildView(this.peek.tab.view)
  }

  applyWindowButtons() {
    if (!IS_MAC || !this.win.setWindowButtonVisibility) return
    const visible = this.htmlFullscreen ? false : !this.settings.sidebarHidden || this.sidebarPeek
    this.win.setWindowButtonVisibility(visible)
  }

  // ---------- tabs ----------

  liveTab(id) { return this.tabs.get(id) || null }

  ensureTab(id) {
    let t = this.tabs.get(id)
    if (t) return t
    const loc = M.locate(this.state, id)
    if (!loc || loc.item.type !== 'tab') return null
    t = new Tab({ id, url: loc.item.url, session: this.app.browseSession, background: this.pageBackground() })
    this.adoptTab(t)
    return t
  }

  // Wire a Tab (new, or moved in from Little Crescent/Peek) to this window.
  adoptTab(t) {
    t.removeAllListeners()
    this.tabs.set(t.id, t)
    t.on('update', patch => this.onTabUpdate(t, patch))
    t.on('navigated', ({ url, inPage }) => this.onTabNavigated(t, url, inPage))
    t.on('hover', url => { if (this.isDisplayed(t.id)) { this.hoverUrl = url; this.pushRuntime({ hoverUrl: url }) } })
    t.on('failed', err => this.showError(t, err))
    t.on('focus', () => {
      if (this.display.length > 1 && this.display.includes(t.id) && this.space.activeId !== t.id) {
        this.space.activeId = t.id
        this.touchMru(t.id)
        this.pushState()
      }
    })
    const wc = t.wc
    wc.setWindowOpenHandler(details => this.onWindowOpen(t, details))
    wc.on('context-menu', (_e, params) => this.app.contextMenu.forPage(this, t, params))
    wc.on('found-in-page', (_e, result) => this.overlay.webContents.send('find:result', result))
    wc.on('enter-html-full-screen', () => this.setHtmlFullscreen(true))
    wc.on('leave-html-full-screen', () => this.setHtmlFullscreen(false))
    wc.on('before-input-event', (e, input) => this.onPageInput(t, e, input))
    this.app.extensions?.addTab(wc, this.win)
    this.pushRuntime({ tabs: { [t.id]: { ...t.info, live: true } } })
  }

  pageBackground() { return nativeTheme.shouldUseDarkColors ? '#1d1b21' : '#ffffff' }

  onTabUpdate(t, patch) {
    this.pushRuntime({ tabs: { [t.id]: { ...patch, live: true } } })
    const loc = M.locate(this.state, t.id)
    if (!loc) return
    const item = loc.item
    let dirty = false
    if (patch.title && !item.customTitle && item.title !== patch.title && !isInternal(t.info.url)) {
      if (loc.zone === 'today' || !item.title || item.title === item.url) { item.title = patch.title; dirty = true }
      this.app.history.setTitle(t.info.url, patch.title)
    }
    if (patch.favicon && item.favicon !== patch.favicon && (loc.zone === 'today' || hostOf(t.info.url) === hostOf(item.url))) {
      item.favicon = patch.favicon; dirty = true
    }
    if (dirty) this.pushState(true)
  }

  onTabNavigated(t, url, inPage) {
    if (isInternal(url)) return
    const loc = M.locate(this.state, t.id)
    if (!loc) return
    if (loc.zone === 'today' && loc.item.url !== url) {
      loc.item.url = url
      this.pushState(true)
    }
    if (!inPage) this.app.history.visit(url, t.info.title, false)
  }

  showError(t, err) {
    if (err.code === -6 /* FILE_NOT_FOUND */ && /^file:/.test(err.url)) return
    const q = new URLSearchParams({ url: err.url || '', code: String(err.code), desc: err.desc || '' })
    t.wc.loadURL(paths.page('error.html') + '?' + q.toString()).catch(() => {})
  }

  isDisplayed(id) { return this.display.includes(id) }

  touchMru(id) {
    const i = this.mru.indexOf(id)
    if (i !== -1) this.mru.splice(i, 1)
    this.mru.unshift(id)
    if (this.mru.length > 200) this.mru.length = 200
    const t = this.tabs.get(id)
    if (t) t.touch()
  }

  // Show a tab. Switches space if it belongs to another one.
  select(id, { focus = true } = {}) {
    if (this.closed) return
    const loc = M.locate(this.state, id)
    if (!loc || loc.item.type !== 'tab') return
    if (loc.space && loc.space.id !== this.state.activeSpaceId) {
      this.state.activeSpaceId = loc.space.id
    }
    const space = this.space
    space.activeId = id
    const split = loc.parent && loc.parent.type === 'split' ? loc.parent : null
    this.display = split ? split.children.map(c => c.id) : [id]
    for (const did of this.display) this.ensureTab(did)
    this.touchMru(id)
    this.layout()
    this.restack()
    const t = this.tabs.get(id)
    if (t) {
      this.app.extensions?.selectTab(t.wc)
      if (focus && !this.overlayMode) t.wc.focus()
    }
    this.hoverUrl = ''
    this.pushState(true)
    this.pushRuntime({ hoverUrl: '' })
  }

  showNothing() {
    this.space.activeId = null
    this.display = []
    this.restack()
    this.layout()
    this.pushState(true)
  }

  activeTab() {
    const id = this.space.activeId
    return id ? this.tabs.get(id) || null : null
  }

  focusActive() {
    const t = this.activeTab()
    if (t && !t.destroyed) t.wc.focus()
    else this.wc.focus()
  }

  newTab(input, opts = {}) {
    const r = typeof input === 'string' ? resolveInput(input, this.settings.searchEngine) : input
    if (!r) return null
    const space = opts.spaceId ? M.getSpace(this.state, opts.spaceId) : this.space
    const tab = M.addTab(this.state, space.id, { url: r.url, title: opts.title || displayUrl(r.url) || r.url }, opts)
    if (r.isSearch === false && opts.typed) this.app.history.visit(r.url, '', true)
    if (opts.background) {
      this.ensureTab(tab.id)
      this.pushState(true)
    } else {
      this.select(tab.id)
    }
    return tab
  }

  navigate(id, input) {
    const r = resolveInput(input, this.settings.searchEngine)
    if (!r) return
    const t = this.ensureTab(id || this.space.activeId)
    if (!t) { this.newTab(r); return }
    t.load(r.url)
    if (!r.isSearch) this.app.history.visit(r.url, '', true)
    if (!this.isDisplayed(t.id)) this.select(t.id)
    else t.wc.focus()
  }

  closeTab(id = this.space.activeId) {
    if (!id) return
    const loc = M.locate(this.state, id)
    if (!loc) return
    const wasActive = this.space.activeId === id || this.isDisplayed(id)
    const next = loc.zone === 'today' ? M.neighbourAfterClose(this.state, id) : null
    const res = M.closeTab(this.state, id)
    const ids = res.removed ? res.ids : [id]
    for (const tid of ids) this.destroyTab(tid)
    this.mru = this.mru.filter(m => !ids.includes(m))
    if (res.zone && res.zone !== 'today') {
      // Pinned tab / favorite: page unloads, the pin stays. Reopening goes
      // back to the pinned URL.
      this.pushRuntime({ tabs: { [id]: { live: false, url: loc.item.url, title: '', loading: false, audible: false } } })
    }
    if (wasActive) {
      const target = (next && M.locate(this.state, next) && next) || this.fallbackSelection(ids)
      if (target) this.select(target)
      else this.showNothing()
    } else {
      this.pushState(true)
    }
  }

  // When nothing is left in Today: most recent pinned tab or favorite in
  // this space, else the first pinned, else the first favorite.
  fallbackSelection(exclude = []) {
    const space = this.space
    const ids = new Set(M.spaceTabIds(this.state, space).filter(i => !exclude.includes(i)))
    const recent = this.mru.find(i => ids.has(i))
    if (recent) return recent
    const today = M.tabsIn(space.today).find(t => !exclude.includes(t.id))
    if (today) return today.id
    const pinned = M.tabsIn(space.pinned).find(t => !exclude.includes(t.id))
    if (pinned) return pinned.id
    const fav = M.favoritesList(this.state, space).find(t => !exclude.includes(t.id))
    return fav ? fav.id : null
  }

  destroyTab(id) {
    const t = this.tabs.get(id)
    if (!t) return
    this.tabs.delete(id)
    this.display = this.display.filter(d => d !== id)
    if (this.win.contentView.children.includes(t.view)) this.win.contentView.removeChildView(t.view)
    this.app.extensions?.removeTab(t.wc)
    t.destroy()
  }

  unloadTab(id) {
    if (this.isDisplayed(id)) return
    this.destroyTab(id)
    this.pushRuntime({ tabs: { [id]: { live: false, loading: false, audible: false } } })
  }

  memorySaver() {
    const mins = this.settings.memorySaverMinutes
    if (!mins) return
    const cutoff = Date.now() - mins * 60 * 1000
    for (const t of [...this.tabs.values()]) {
      if (this.isDisplayed(t.id) || t.lastActive > cutoff || t.isBusy()) continue
      this.unloadTab(t.id)
    }
  }

  resetPinned(id = this.space.activeId) {
    const loc = M.locate(this.state, id)
    if (!loc || loc.zone === 'today') return
    const t = this.ensureTab(id)
    if (t) t.load(loc.item.url)
  }

  // Ctrl+1..9: Today tabs only, pinned tabs and favorites are skipped.
  // Ctrl+9 always means the last one, like every other browser.
  selectIndex(n) {
    const targets = M.cycleTargets(this.state, this.space.id)
    if (!targets.length) return
    const id = n >= 9 ? targets[targets.length - 1] : targets[n - 1]
    if (id) this.select(id)
  }

  cycle(delta) {
    const targets = M.cycleTargets(this.state, this.space.id)
    if (!targets.length) return
    const cur = this.space.activeId
    const split = cur && M.splitOf(this.state, cur)
    const curKey = split ? split.children[0].id : cur
    let i = targets.indexOf(curKey)
    i = i === -1 ? (delta > 0 ? 0 : targets.length - 1) : (i + delta + targets.length) % targets.length
    this.select(targets[i])
  }

  // ---------- spaces ----------

  switchSpace(idOrDelta) {
    const spaces = this.state.spaces
    let target
    if (typeof idOrDelta === 'number') {
      const i = spaces.findIndex(s => s.id === this.state.activeSpaceId)
      const j = i + idOrDelta
      if (j < 0 || j >= spaces.length) return
      target = spaces[j]
    } else target = M.getSpace(this.state, idOrDelta)
    if (!target || target.id === this.state.activeSpaceId) return
    if (this.overlayMode && this.overlayMode !== 'toast') this.closeOverlay({ refocus: false })
    this.state.activeSpaceId = target.id
    if (target.activeId && M.locate(this.state, target.activeId)) this.select(target.activeId)
    else this.showNothing()
    this.app.store.save()
  }

  // ---------- window.open / links ----------

  onWindowOpen(opener, details) {
    const { url, disposition, features } = details
    if (!url) return { action: 'deny' }
    // Real popups (OAuth, payment) keep their opener so sign-in works.
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 680, parent: this.win, modal: false, autoHideMenuBar: true,
          webPreferences: { session: this.app.browseSession, sandbox: true, contextIsolation: true },
        },
      }
    }
    const loc = M.locate(this.state, opener.id)
    const fromPin = loc && loc.zone !== 'today'
    // Shift+click (new-window) always peeks. Links that leave a pinned tab's
    // site open in Peek too, so your pinned app stays where it is (Arc).
    if (disposition === 'new-window' || (fromPin && this.settings.peekForPinned && disposition === 'foreground-tab' && hostOf(url) !== hostOf(opener.url))) {
      setImmediate(() => this.openPeek(url))
      return { action: 'deny' }
    }
    const background = disposition === 'background-tab'
    return {
      action: 'allow',
      createWindow: options => {
        const after = loc && loc.zone === 'today' && !loc.parent ? { afterId: opener.id } : {}
        const item = M.addTab(this.state, this.space.id, { url, title: displayUrl(url) }, after)
        const t = new Tab({ id: item.id, url, session: this.app.browseSession, background: this.pageBackground(), viewOptions: options })
        this.adoptTab(t)
        if (background) this.pushState(true)
        else setImmediate(() => this.select(item.id))
        return t.wc
      },
    }
  }

  onPageInput(t, e, input) {
    if (input.type !== 'keyDown') return
    if (input.key === 'Escape' && this.peek && t === this.peek.tab) { e.preventDefault(); this.closeOverlay() }
  }

  // ---------- peek ----------

  peekRect() {
    const c = this.contentRect()
    const w = Math.min(c.width - 80, 1100)
    const h = c.height - 80
    return { x: c.x + (c.width - w) / 2, y: c.y + 52, width: w, height: h - 12 }
  }

  openPeek(url) {
    if (this.peek) { this.peek.tab.load(url); return }
    const tab = new Tab({ id: M.uid('t'), url, session: this.app.browseSession, background: this.pageBackground(), kind: 'peek' })
    tab.wc.setWindowOpenHandler(d => {
      setImmediate(() => this.newTab({ url: d.url, isSearch: false }))
      return { action: 'deny' }
    })
    tab.wc.on('context-menu', (_e, params) => this.app.contextMenu.forPage(this, tab, params))
    tab.wc.on('before-input-event', (e, input) => this.onPageInput(tab, e, input))
    tab.on('update', () => this.overlay.webContents.send('peek:info', { ...tab.info, display: displayUrl(tab.info.url) }))
    this.peek = { tab }
    tab.setBounds(this.peekRect())
    this.openOverlay('peek', { url, rect: this.peekRect() })
    this.restack()
    tab.wc.focus()
  }

  closePeek() {
    if (!this.peek) return
    const { tab } = this.peek
    this.peek = null
    if (this.win.contentView.children.includes(tab.view)) this.win.contentView.removeChildView(tab.view)
    tab.destroy()
    if (this.overlayMode === 'peek') this.closeOverlay()
  }

  // Peek -> real tab, keeping the live page.
  expandPeek(asSplit = false) {
    if (!this.peek) return
    const { tab } = this.peek
    this.peek = null
    if (this.win.contentView.children.includes(tab.view)) this.win.contentView.removeChildView(tab.view)
    const activeId = this.space.activeId
    const item = M.addTab(this.state, this.space.id, { url: tab.info.url, title: tab.info.title, favicon: tab.info.favicon })
    tab.id = item.id
    tab.kind = 'tab'
    this.adoptTab(tab)
    this.overlayMode = null
    this.overlay.setVisible(false)
    this.overlay.webContents.send('overlay:close')
    if (asSplit && activeId) {
      const r = M.createSplit(this.state, activeId, item.id)
      if (r) {
        for (const [i, cid] of r.copied.entries()) if (cid) this.ensureTab(cid)
        this.select(item.id)
        return
      }
    }
    this.select(item.id)
  }

  // ---------- adopt from Little Crescent ----------

  adoptFromLittle(tab) {
    const item = M.addTab(this.state, this.space.id, { url: tab.info.url, title: tab.info.title, favicon: tab.info.favicon })
    tab.id = item.id
    tab.view.setBackgroundColor(this.pageBackground())
    this.adoptTab(tab)
    this.select(item.id)
    this.focus()
  }

  // ---------- split ----------

  splitWith(otherId) {
    const cur = this.space.activeId
    if (!cur || !otherId || cur === otherId) return
    const r = M.createSplit(this.state, cur, otherId)
    if (!r) return
    this.select(r.ids[0])
  }

  splitWithNew(input) {
    const cur = this.space.activeId
    const r = resolveInput(input, this.settings.searchEngine)
    if (!r) return
    const existingSplit = cur && M.splitOf(this.state, cur)
    if (existingSplit) {
      const tab = M.addToSplit(this.state, existingSplit.id, { url: r.url, title: displayUrl(r.url) })
      if (tab) { this.select(tab.id); return }
    }
    if (!cur) { this.newTab(r); return }
    const t = M.addTab(this.state, this.space.id, { url: r.url, title: displayUrl(r.url) })
    const s = M.createSplit(this.state, cur, t.id)
    if (s) this.select(t.id)
  }

  unsplit() {
    const split = M.splitOf(this.state, this.space.activeId)
    if (!split) return
    const keep = this.space.activeId
    M.unsplit(this.state, split.id)
    this.select(keep)
  }

  setSplitSizes(sizes) {
    const split = M.splitOf(this.state, this.space.activeId)
    if (!split) return
    if (M.setSplitSizes(this.state, split.id, sizes)) { this.layout(); this.app.store.save() }
  }

  // ---------- fullscreen / sidebar ----------

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on
    if (on && !this.win.isFullScreen()) { this.fsFromHtml = true; this.win.setFullScreen(true) }
    if (!on && this.fsFromHtml) { this.fsFromHtml = false; this.win.setFullScreen(false) }
    this.applyWindowButtons()
    this.layout()
    this.pushRuntime({ htmlFullscreen: on })
  }

  toggleSidebar() {
    this.settings.sidebarHidden = !this.settings.sidebarHidden
    this.sidebarPeek = false
    this.applyWindowButtons()
    this.layout()
    this.pushState(true)
  }

  setSidebarPeek(on) {
    if (!this.settings.sidebarHidden || this.sidebarPeek === !!on) return
    this.sidebarPeek = !!on
    this.applyWindowButtons()
    this.layout()
    this.pushRuntime({ sidebarPeek: this.sidebarPeek })
  }

  setSidebarWidth(px) {
    this.settings.sidebarWidth = Math.max(200, Math.min(420, Math.round(px)))
    this.layout()
    this.pushState(true)
  }

  // ---------- find ----------

  find(text, opts = {}) {
    const t = this.activeTab()
    if (!t) return
    if (!text) { t.wc.stopFindInPage('clearSelection'); this.findState = null; return }
    const again = this.findState && this.findState.text === text
    this.findState = { text, tab: t }
    t.wc.findInPage(text, { forward: opts.forward !== false, findNext: !again, matchCase: false })
  }

  stopFind() {
    if (this.findState && !this.findState.tab.destroyed) this.findState.tab.wc.stopFindInPage('keepSelection')
    this.findState = null
  }

  // ---------- page actions ----------

  copyUrl() {
    const t = this.activeTab()
    if (!t || !t.info.url || isInternal(t.info.url)) return
    clipboard.writeText(t.info.url)
    this.toast('Copied URL')
  }

  zoom(dir) {
    const t = this.activeTab()
    if (!t) return
    const z = dir === 0 ? 1 : Math.max(0.3, Math.min(3, +(t.wc.getZoomFactor() + dir * 0.1).toFixed(2)))
    t.wc.setZoomFactor(z)
    t.info.zoom = z
    this.toast(`Zoom ${Math.round(z * 100)}%`)
  }

  commandBarFor(mode) {
    const t = this.activeTab()
    const url = t ? t.info.url : ''
    if (mode === 'edit' && t && !isInternal(url)) {
      const q = queryFromSearchUrl(url)
      this.openOverlay('command', { mode: 'edit', text: q || url, tabId: t.id })
    } else {
      this.openOverlay('command', { mode: 'new' })
    }
  }

  // ---------- state push ----------

  pushState(save = false) {
    if (save) this.app.store.save()
    this.app.broadcastState()
    if (this.lastDisplay !== this.display.join()) {
      this.lastDisplay = this.display.join()
      this.pushRuntime({ display: this.display })
    }
  }

  pushRuntime(patch) {
    // Coalesce rapid updates (titles, loading spinners) into one message.
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'tabs') {
        this.runtimePatch.tabs = this.runtimePatch.tabs || {}
        for (const [id, p] of Object.entries(v)) this.runtimePatch.tabs[id] = { ...(this.runtimePatch.tabs[id] || {}), ...p }
      } else this.runtimePatch[k] = v
    }
    if (this.runtimeTimer) return
    this.runtimeTimer = setTimeout(() => {
      this.runtimeTimer = null
      const p = this.runtimePatch
      this.runtimePatch = {}
      this.app.broadcast('runtime', p)
    }, 30)
  }

  runtime() {
    const tabs = {}
    for (const t of this.tabs.values()) tabs[t.id] = { ...t.info, live: true }
    return {
      tabs,
      display: this.display,
      hoverUrl: this.hoverUrl,
      sidebarPeek: this.sidebarPeek,
      htmlFullscreen: this.htmlFullscreen,
      windowFullscreen: this.win && !this.win.isDestroyed() ? this.win.isFullScreen() : false,
      layout: this.win && !this.win.isDestroyed() ? this.layoutInfo() : null,
    }
  }

  // ---------- sidebar context menus (native) ----------

  itemMenu(id) {
    const loc = M.locate(this.state, id)
    if (!loc) return
    const item = loc.item
    const t = this.tabs.get(id)
    const tpl = []
    if (item.type === 'folder') {
      tpl.push(
        { label: 'Rename…', click: () => this.wc.send('rename', id) },
        { label: 'New Tab in Folder', click: () => this.openOverlay('command', { mode: 'new', zone: 'pinned', parentId: id }) },
        { label: 'New Folder Inside', click: () => { M.createFolder(this.state, loc.space.id, { parentId: id }); this.pushState(true) } },
        { type: 'separator' },
        { label: 'Delete Folder (keep tabs)', click: () => { M.deleteFolder(this.state, id); this.pushState(true) } },
      )
    } else if (item.type === 'tab') {
      const url = t ? t.info.url : item.url
      const zone = loc.zone
      tpl.push({ label: 'Copy Link', click: () => { clipboard.writeText(url); this.toast('Copied URL') } })
      tpl.push({ label: 'Rename…', click: () => this.wc.send('rename', id) })
      tpl.push({ label: 'Duplicate', click: () => this.newTab({ url, isSearch: false }) })
      tpl.push({ type: 'separator' })
      if (zone !== 'favorites') tpl.push({ label: 'Add to Pinned Bar', click: () => { M.moveItem(this.state, id, { spaceId: this.space.id, zone: 'favorites' }); this.pushState(true) } })
      if (zone !== 'pinned') tpl.push({ label: zone === 'favorites' ? 'Move to Pinned Tabs' : 'Pin Tab', click: () => { M.moveItem(this.state, id, { spaceId: this.space.id, zone: 'pinned' }); this.pushState(true) } })
      if (zone !== 'today') tpl.push({ label: 'Unpin', click: () => { M.moveItem(this.state, id, { spaceId: this.space.id, zone: 'today', index: 0 }); this.pushState(true) } })
      if (zone !== 'today') {
        const differs = t && hostOf(t.info.url) + new URL(t.info.url || 'about:blank').pathname !== hostOf(item.url) + new URL(item.url || 'about:blank').pathname
        tpl.push({ label: 'Go Back to Pinned URL', enabled: !!differs, click: () => this.resetPinned(id) })
        tpl.push({ label: 'Set Pinned URL to Current Page', enabled: !!differs, click: () => { item.url = t.info.url; this.pushState(true) } })
      }
      if (zone === 'pinned') {
        tpl.push({ label: 'New Folder with Tab', click: () => { M.createFolder(this.state, this.space.id, { childIds: [id], index: loc.parent ? undefined : loc.index }); this.pushState(true) } })
      }
      const others = this.state.spaces.filter(s => s.id !== this.space.id)
      if (zone === 'today' && others.length) {
        tpl.push({ label: 'Move to Space', submenu: others.map(s => ({ label: s.name, click: () => { M.moveTabToSpace(this.state, id, s.id); if (this.isDisplayed(id)) this.closeDisplayedMoved(id); this.pushState(true) } })) })
      }
      tpl.push({ type: 'separator' })
      const active = this.space.activeId
      if (active && active !== id && !M.splitOf(this.state, id)) tpl.push({ label: 'Open in Split View', click: () => this.splitWith(id) })
      if (M.splitOf(this.state, id)) tpl.push({ label: 'Separate Split View', click: () => { const s = M.splitOf(this.state, id); M.unsplit(this.state, s.id); this.select(id) } })
      if (t) tpl.push({ label: t.info.muted ? 'Unmute' : 'Mute', click: () => t.setMuted(!t.info.muted) })
      if (t && !this.isDisplayed(id)) tpl.push({ label: 'Unload Tab (free memory)', click: () => this.unloadTab(id) })
      tpl.push({ type: 'separator' })
      if (zone === 'today') tpl.push({ label: 'Close Tab', click: () => this.closeTab(id) })
      else {
        if (t) tpl.push({ label: 'Close (keep pinned)', click: () => this.closeTab(id) })
        tpl.push({ label: zone === 'favorites' ? 'Remove from Pinned Bar' : 'Delete Pinned Tab', click: () => this.deleteItem(id) })
      }
    } else if (item.type === 'split') {
      tpl.push({ label: 'Separate Split View', click: () => { M.unsplit(this.state, id); this.pushState(true); if (this.space.activeId) this.select(this.space.activeId) } })
      tpl.push({ label: 'Close Split', click: () => this.closeTab(item.children[0].id) })
    }
    Menu.buildFromTemplate(tpl).popup({ window: this.win })
  }

  closeDisplayedMoved(id) {
    const next = this.fallbackSelection([id])
    this.destroyTab(id)
    if (next) this.select(next)
    else this.showNothing()
  }

  deleteItem(id) {
    const loc = M.locate(this.state, id)
    if (!loc) return
    if (loc.zone === 'today') return this.closeTab(id)
    const wasActive = this.isDisplayed(id)
    M.archiveTab(this.state, loc.item, loc.space ? loc.space.id : null)
    M.detach(this.state, id)
    this.destroyTab(id)
    this.mru = this.mru.filter(m => m !== id)
    if (wasActive) {
      const next = this.fallbackSelection([id])
      if (next) this.select(next)
      else this.showNothing()
    } else this.pushState(true)
  }

  spaceMenu(id) {
    const s = M.getSpace(this.state, id)
    if (!s) return
    Menu.buildFromTemplate([
      { label: 'Rename Space…', click: () => this.wc.send('rename-space', id) },
      { label: 'Edit Theme…', click: () => { this.switchSpace(id); this.openOverlay('theme', { spaceId: id }) } },
      { label: 'Change Icon…', click: () => { this.switchSpace(id); this.openOverlay('icons', { spaceId: id }) } },
      { type: 'separator' },
      { label: 'New Space', click: () => this.app.actions.run(this, 'space:create') },
      { type: 'separator' },
      {
        label: 'Delete Space', enabled: this.state.spaces.length > 1, click: async () => {
          const { response } = await require('electron').dialog.showMessageBox(this.win, {
            type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
            message: `Delete “${s.name}”?`, detail: 'Its tabs are moved to the Library archive, so nothing is lost.',
          })
          if (response === 0) {
            for (const t of M.tabsIn(s.today).concat(M.tabsIn(s.pinned), M.tabsIn(s.favorites))) this.destroyTab(t.id)
            M.removeSpace(this.state, id)
            const sp = this.space
            if (sp.activeId && M.locate(this.state, sp.activeId)) this.select(sp.activeId)
            else this.showNothing()
          }
        },
      },
    ]).popup({ window: this.win })
  }
}

function isInternal(u) { return typeof u === 'string' && u.startsWith('crescent:') }

function guardUI(wc) {
  // UI pages never navigate or open windows.
  wc.on('will-navigate', e => e.preventDefault())
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function validBounds(b) {
  const def = { width: 1360, height: 860 }
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return def
  // Make sure the window is on a connected display (monitor unplugged).
  const visible = screen.getAllDisplays().some(d => {
    const a = d.workArea
    return b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100
  })
  if (!visible) return { width: Math.max(620, b.width), height: Math.max(420, b.height) }
  return { x: b.x, y: b.y, width: Math.max(620, b.width), height: Math.max(420, b.height) }
}

function debounce(fn, ms) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

module.exports = { MainWindow, isInternal }
