'use strict'
// The main Crescent window: sidebar (base renderer), live tabs
// (WebContentsViews), the overlay layer (command bar, popovers, find bar,
// prompts) and Peek. All tab/space behaviour is driven from here.

const { BrowserWindow, WebContentsView, clipboard, Menu, nativeTheme, screen, shell } = require('electron')
const M = require('./model')
const { Tab, hostOf, roundRect } = require('./tab')
const { resolveInput, displayUrl, queryFromSearchUrl } = require('./urls')
const paths = require('./paths')

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
    this.thumbs = new Map() // tab id -> { data, at } for hover previews
    this.pipTabs = new Set()
  }

  get pad() { return Math.max(0, Math.min(16, Number(this.settings.frameGap) || 0)) }

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
    this.win.on('leave-full-screen', () => {
      this.layout(); this.pushRuntime({ windowFullscreen: false })
      // Focus mode keeps you in full screen until the timer ends.
      const f = this.state.focus
      if (f && f.fullscreen && f.endsAt > Date.now()) setTimeout(() => { if (this.state.focus && !this.win.isDestroyed()) this.win.setFullScreen(true) }, 400)
    })
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
    this.snoozeTimer = setInterval(() => this.wakeSnoozed(), 30 * 1000)
    setTimeout(() => this.wakeSnoozed(), 3000)
    if (this.state.focus) this.win.once('ready-to-show', () => setTimeout(() => this.applyFocus(), 300))
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
    clearInterval(this.snoozeTimer)
    clearTimeout(this.focusTimer)
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
      if (mode !== 'toast' && mode !== 'focusbar') this.overlay.webContents.focus()
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
    // The focus timer stays on screen for the whole session.
    if (this.state.focus && !this.overlayMode) setTimeout(() => { if (!this.overlayMode && this.state.focus) this.openOverlay('focusbar', { focus: this.state.focus }) }, 30)
  }

  overlayBounds() {
    if (!this.overlayMode) return
    const [w, h] = this.win.getContentSize()
    const c = this.contentRect()
    if (this.overlayMode === 'find') {
      this.overlay.setBounds(roundRect({ x: c.x + c.width - 372, y: c.y + 10, width: 362, height: 56 }))
    } else if (this.overlayMode === 'focusbar') {
      this.overlay.setBounds(roundRect({ x: c.x + c.width - 252, y: c.y + 10, width: 242, height: 56 }))
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
    const pad = this.pad
    const sbw = this.settings.sidebarWidth
    const hidden = this.settings.sidebarHidden
    const right = this.settings.sidebarRight
    let x, width
    if (hidden) {
      x = pad; width = w - pad * 2
      if (this.sidebarPeek) x += right ? -(sbw - pad) : sbw - pad // slide, don't resize
    } else if (right) {
      x = pad; width = w - sbw - pad
    } else {
      x = sbw; width = w - sbw - pad
    }
    return { x, y: pad, width: Math.max(100, width), height: Math.max(100, h - pad * 2) }
  }

  displayRects() {
    const c = this.contentRect()
    const ids = this.display
    if (ids.length <= 1) return ids.map(id => ({ id, ...c }))
    const split = M.splitOf(this.state, ids[0])
    const sizes = split && split.sizes && split.sizes.length === ids.length ? split.sizes : ids.map(() => 1 / ids.length)
    const column = split && split.orientation === 'column'
    const total = column ? c.height : c.width
    const usable = total - GAP * (ids.length - 1)
    let pos = column ? c.y : c.x
    const end = pos + total
    return ids.map((id, i) => {
      const len = i === ids.length - 1 ? end - pos : usable * sizes[i]
      const r = column ? { id, x: c.x, y: pos, width: c.width, height: len } : { id, x: pos, y: c.y, width: len, height: c.height }
      pos += len + GAP
      return r
    })
  }

  layoutInfo() {
    const [w, h] = this.win.getContentSize()
    const split = this.display.length > 1 ? M.splitOf(this.state, this.display[0]) : null
    return { width: w, height: h, content: this.contentRect(), rects: this.displayRects(), fullscreen: this.htmlFullscreen, orientation: split ? split.orientation : 'row', radius: this.settings.pageRadius }
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
    const priv = !!(loc.space && loc.space.private)
    t = new Tab({ id, url: null, session: priv ? this.app.privateSession() : this.app.browseSession, background: this.pageBackground(), radius: this.settings.pageRadius })
    t.private = priv
    this.adoptTab(t)
    if (loc.item.url) t.load(loc.item.url)
    return t
  }

  // Wire a Tab (new, or moved in from Little Crescent/Peek) to this window.
  adoptTab(t) {
    t.removeAllListeners()
    this.tabs.set(t.id, t)
    t.guard = url => this.focusAllows(url)
    t.on('blocked', url => this.showBlocked(t, url))
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
    if (!t.private) this.app.extensions?.addTab(wc, this.win)
    this.pushRuntime({ tabs: { [t.id]: { ...t.info, live: true } } })
  }

  showBlocked(t, url) {
    const q = new URLSearchParams({ url: url || '', until: String(this.state.focus ? this.state.focus.endsAt : 0) })
    t.wc.loadURL(paths.page('blocked.html') + '?' + q.toString()).catch(() => {})
    t.info.url = url
  }

  pageBackground() { return nativeTheme.shouldUseDarkColors ? '#1d1b21' : '#ffffff' }

  onTabUpdate(t, patch) {
    this.pushRuntime({ tabs: { [t.id]: { ...patch, live: true } } })
    const loc = M.locate(this.state, t.id)
    if (!loc) return
    // Error and focus-blocked pages never rename or re-icon the saved tab.
    if (isInternal(t.wc.isDestroyed() ? '' : t.wc.getURL())) return
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
    if (!inPage && !t.private) this.app.history.visit(url, t.info.title, false)
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
    if (!loc || (loc.item.type !== 'tab' && loc.item.type !== 'note')) return
    if (loc.space && loc.space.id !== this.state.activeSpaceId) {
      this.state.activeSpaceId = loc.space.id
    }
    const outgoing = this.display.filter(d => this.tabs.has(d))
    const space = this.space
    space.activeId = id
    if (loc.item.unread) delete loc.item.unread
    if (loc.item.type === 'note') {
      // Notes are drawn by the sidebar renderer in the page area.
      this.display = []
    } else {
      const split = loc.parent && loc.parent.type === 'split' ? loc.parent : null
      this.display = split ? split.children.map(c => c.id) : [id]
      for (const did of this.display) this.ensureTab(did)
    }
    this.leaving(outgoing.filter(o => !this.display.includes(o)))
    this.touchMru(id)
    this.layout()
    this.restack()
    const t = this.tabs.get(id)
    if (t) {
      if (!t.private) this.app.extensions?.selectTab(t.wc)
      if (focus && !this.overlayMode) t.wc.focus()
      if (this.pipTabs.has(t.id)) { this.pipTabs.delete(t.id); t.wc.executeJavaScript('document.pictureInPictureElement && document.exitPictureInPicture()', true).catch(() => {}) }
    } else if (loc.item.type === 'note') {
      this.wc.focus()
    }
    this.hoverUrl = ''
    this.pushState(true)
    this.pushRuntime({ hoverUrl: '' })
  }

  // Tabs going out of view: snapshot for hover previews, and pop playing
  // video into picture-in-picture (Arc's auto PiP).
  leaving(ids) {
    for (const oid of ids) {
      const t = this.tabs.get(oid)
      if (!t || t.destroyed) continue
      if (this.settings.tabPreviews && t.info.url && !t.info.url.startsWith('crescent:')) {
        t.wc.capturePage().then(img => {
          if (img.isEmpty()) return
          const small = img.resize({ width: 480, quality: 'good' })
          this.thumbs.set(oid, { data: small.toDataURL(), at: Date.now() })
          if (this.thumbs.size > 60) this.thumbs.delete(this.thumbs.keys().next().value)
        }).catch(() => {})
      }
      if (this.settings.autoPip && t.info.playing && t.info.video) {
        t.wc.executeJavaScript(`(() => { const v = [...document.querySelectorAll('video')].find(v => !v.paused && v.videoWidth > 0); if (v && !document.pictureInPictureElement && !v.disablePictureInPicture) return v.requestPictureInPicture().then(() => true, () => false); return false })()`, true)
          .then(ok => { if (ok) this.pipTabs.add(oid) }).catch(() => {})
      }
    }
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

  engine() {
    const s = this.settings
    return s.searchEngine === 'custom' && /%s/.test(s.customSearchUrl || '') ? s.customSearchUrl : s.searchEngine
  }

  newTab(input, opts = {}) {
    const r = typeof input === 'string' ? resolveInput(input, this.engine()) : input
    if (!r) return null
    const space = opts.spaceId ? M.getSpace(this.state, opts.spaceId) : this.space
    // Already open? Go there instead of opening a second copy.
    if (opts.typed && !r.isSearch && this.settings.duplicateTabGuard) {
      const norm = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
      const want = norm(r.url)
      for (const id of M.spaceTabIds(this.state, space)) {
        const live = this.tabs.get(id)
        const loc = M.locate(this.state, id)
        if (norm(live ? live.info.url : loc.item.url) === want) { this.select(id); this.toast('Switched to the open tab'); return loc.item }
      }
    }
    const tab = M.addTab(this.state, space.id, { url: r.url, title: opts.title || displayUrl(r.url) || r.url }, opts)
    if (r.isSearch === false && opts.typed && !space.private) this.app.history.visit(r.url, '', true)
    if (opts.background) {
      if (this.settings.unreadDots) tab.unread = true
      this.ensureTab(tab.id)
      this.pushState(true)
    } else {
      this.select(tab.id)
    }
    return tab
  }

  navigate(id, input) {
    const r = resolveInput(input, this.engine())
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
    const r = resolveInput(input, this.engine())
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

  applyAppearance() {
    const r = Math.max(0, Math.min(16, Number(this.settings.pageRadius) || 0))
    for (const t of this.tabs.values()) if (t.view.setBorderRadius) t.view.setBorderRadius(r)
    this.layout()
    this.pushState(true)
  }

  setSidebarWidth(px) {
    this.settings.sidebarWidth = Math.max(236, Math.min(440, Math.round(px)))
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

  // ---------- focus mode ----------

  focusAllows(url) {
    const f = this.state.focus
    if (!f || !url) return true
    if (f.endsAt <= Date.now()) { setImmediate(() => this.endFocus(true)); return true }
    if (/^(crescent|chrome-extension|about|data|blob|devtools|chrome|view-source):/i.test(url)) return true
    let u
    try { u = new URL(url) } catch { return true }
    if (!/^https?:$/.test(u.protocol)) return true
    const host = u.hostname.replace(/^www\./, '')
    if (isSearchPage(u)) return true
    if (/^(accounts\.google\.com|accounts\.youtube\.com|login\.microsoftonline\.com|appleid\.apple\.com)$/.test(host)) return true
    if ((f.sites || []).some(d => d && (host === d || host.endsWith('.' + d)))) return true
    let hay = u.href.toLowerCase()
    try { hay = decodeURIComponent(hay) } catch {}
    if ((f.words || []).some(w => w && hay.includes(w.toLowerCase()))) return true
    return false
  }

  startFocus({ minutes, sites, words, fullscreen = true } = {}) {
    const mins = Math.max(1, Math.min(600, Number(minutes) || 25))
    const clean = list => [...new Set((Array.isArray(list) ? list : []).map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(Boolean))].slice(0, 100)
    const cleanWords = list => [...new Set((Array.isArray(list) ? list : []).map(x => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 100)
    const s = this.settings
    s.focusSites = clean(sites)
    s.focusWords = cleanWords(words)
    s.focusMinutes = mins
    this.state.focus = { startedAt: Date.now(), endsAt: Date.now() + mins * 60000, sites: s.focusSites, words: s.focusWords, prevSidebarHidden: s.sidebarHidden, fullscreen }
    this.applyFocus()
    this.app.store.save()
  }

  // Puts the window into focus state (also used to resume after a restart).
  applyFocus() {
    const f = this.state.focus
    if (!f) return
    this.closeOverlay({ refocus: false })
    this.settings.sidebarHidden = true
    this.sidebarPeek = false
    if (f.fullscreen && !this.win.isFullScreen()) this.win.setFullScreen(true)
    this.applyWindowButtons()
    this.layout()
    for (const id of this.display) {
      const t = this.tabs.get(id)
      if (t && !this.focusAllows(t.info.url)) this.showBlocked(t, t.info.url)
    }
    clearTimeout(this.focusTimer)
    this.focusTimer = setTimeout(() => this.endFocus(true), Math.max(0, f.endsAt - Date.now()))
    this.openOverlay('focusbar', { focus: f })
    this.pushState()
  }

  endFocus(finished = false) {
    const f = this.state.focus
    if (!f) return
    this.state.focus = null
    clearTimeout(this.focusTimer)
    this.settings.sidebarHidden = !!f.prevSidebarHidden
    if (this.overlayMode === 'focusbar') this.closeOverlay({ refocus: false })
    if (f.fullscreen && this.win.isFullScreen()) this.win.setFullScreen(false)
    this.applyWindowButtons()
    this.layout()
    // Pages that were blocked come back.
    for (const id of this.display) {
      const t = this.tabs.get(id)
      if (t && t.wc.getURL().startsWith('crescent://app/pages/blocked')) t.load(t.info.url)
    }
    this.pushState(true)
    this.toast(finished ? 'Focus session complete' : 'Focus session ended')
  }

  // ---------- library (lives in the sidebar, like Arc) ----------

  openLibrary(tab = 'archive') {
    if (this.overlayMode && this.overlayMode !== 'focusbar') this.closeOverlay({ refocus: false })
    if (this.settings.sidebarHidden) this.setSidebarPeek(true)
    this.wc.send('library', tab)
  }

  // ---------- private space ----------

  openPrivateSpace() {
    const s = M.addPrivateSpace(this.state)
    this.switchSpace(s.id)
    this.pushState()
    if (!s.today.length && !s.activeId) setTimeout(() => { if (this.space.private && !this.space.activeId && !this.overlayMode) this.openOverlay('command', { mode: 'new' }) }, 200)
  }

  endPrivateSpace() {
    const s = this.state.spaces.find(x => x.private)
    if (!s) return
    for (const t of [...M.tabsIn(s.today), ...M.tabsIn(s.pinned)]) this.destroyTab(t.id)
    const wasActive = this.state.activeSpaceId === s.id
    this.state.spaces = this.state.spaces.filter(x => x !== s)
    if (this.app._private) this.app._private.clearStorageData().catch(() => {})
    if (wasActive) {
      this.state.activeSpaceId = this.state.spaces[0].id
      const sp = this.space
      if (sp.activeId && M.locate(this.state, sp.activeId)) this.select(sp.activeId)
      else this.showNothing()
    }
    this.pushState()
    this.toast('Private session cleared')
  }

  // ---------- snooze ----------

  snooze(id = this.space.activeId, when = 'tomorrow') {
    const loc = M.locate(this.state, id)
    if (!loc || loc.item.type !== 'tab' || (loc.space && loc.space.private)) return
    const until = snoozeTime(when)
    const wasShown = this.isDisplayed(id)
    const next = wasShown && loc.zone === 'today' ? M.neighbourAfterClose(this.state, id) : null
    const t = this.tabs.get(id)
    if (t) loc.item.url = t.info.url || loc.item.url
    if (!M.snoozeTab(this.state, id, until)) return
    if (loc.zone === 'today') {
      this.destroyTab(id)
      if (wasShown) { const target = next || this.fallbackSelection([id]); if (target) this.select(target); else this.showNothing() }
    }
    this.pushState(true)
    this.toast(`Snoozed until ${new Date(until).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`)
  }

  wakeSnoozed() {
    const ids = M.wakeSnoozed(this.state)
    if (!ids.length) return
    this.pushState(true)
    this.toast(ids.length === 1 ? 'A snoozed tab is back' : `${ids.length} snoozed tabs are back`)
  }

  // ---------- notes ----------

  newNote(opts = {}) {
    const n = M.addNote(this.state, this.space.id, opts)
    this.select(n.id)
    setTimeout(() => this.wc.send('note:focus', n.id), 60)
    return n.id
  }

  // ---------- split extras ----------

  splitDrop(draggedId, targetId) {
    const r = M.splitByDrop(this.state, draggedId, targetId)
    if (!r) return false
    this.select(r.focus)
    return true
  }

  splitOrientation(orientation) {
    const split = M.splitOf(this.state, this.space.activeId)
    if (split && M.setSplitOrientation(this.state, split.id, orientation)) { this.layout(); this.pushState(true) }
  }

  splitSwap() {
    const split = M.splitOf(this.state, this.space.activeId)
    if (split && M.swapSplit(this.state, split.id)) { this.display = split.children.map(c => c.id); this.layout(); this.pushState(true) }
  }

  // ---------- media ----------

  mediaToggle(id) {
    const t = this.tabs.get(id)
    if (!t) return
    t.wc.executeJavaScript(`(() => { const all = [...document.querySelectorAll('video,audio')]; const on = all.filter(m => !m.paused); if (on.length) { on.forEach(m => m.pause()); return false } const m = all.find(m => m.currentTime > 0) || all[0]; if (m) { m.play(); return true } return null })()`, true).catch(() => {})
  }

  mediaSkip(id, dir) {
    const t = this.tabs.get(id)
    if (!t) return
    t.wc.executeJavaScript(`(() => { const m = [...document.querySelectorAll('video,audio')].find(m => !m.paused) || document.querySelector('video,audio'); if (m) m.currentTime = Math.max(0, m.currentTime + (${dir > 0 ? 10 : -10})) })()`, true).catch(() => {})
  }

  async preview(id) {
    if (!this.settings.tabPreviews) return null
    const t = this.tabs.get(id)
    if (t && this.isDisplayed(id)) {
      try { const img = await t.wc.capturePage(); if (!img.isEmpty()) return img.resize({ width: 480, quality: 'good' }).toDataURL() } catch {}
    }
    const c = this.thumbs.get(id)
    return c ? c.data : null
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
      if (M.splitOf(this.state, id)) tpl.push(...this.splitMenu(M.splitOf(this.state, id), id))
      if (!loc.space || !loc.space.private) tpl.push({ label: 'Snooze', submenu: [['later', 'Later Today (3 hours)'], ['evening', 'This Evening'], ['tomorrow', 'Tomorrow Morning'], ['weekend', 'This Weekend'], ['nextweek', 'Next Week']].map(([w, l]) => ({ label: l, click: () => this.snooze(id, w) })) })
      if (t) tpl.push({ label: t.info.muted ? 'Unmute' : 'Mute', click: () => t.setMuted(!t.info.muted) })
      if (t && !this.isDisplayed(id)) tpl.push({ label: 'Unload Tab (free memory)', click: () => this.unloadTab(id) })
      tpl.push({ type: 'separator' })
      if (zone === 'today') tpl.push({ label: 'Close Tab', click: () => this.closeTab(id) })
      else {
        if (t) tpl.push({ label: 'Close (keep pinned)', click: () => this.closeTab(id) })
        tpl.push({ label: zone === 'favorites' ? 'Remove from Pinned Bar' : 'Delete Pinned Tab', click: () => this.deleteItem(id) })
      }
    } else if (item.type === 'split') {
      tpl.push(...this.splitMenu(item, item.children[0].id))
      tpl.push({ type: 'separator' })
      tpl.push({ label: 'Close Split', click: () => { for (const c of [...item.children]) this.closeTab(c.id) } })
    } else if (item.type === 'note') {
      tpl.push({ label: 'Rename…', click: () => this.wc.send('rename', id) })
      if (loc.zone === 'today') tpl.push({ label: 'Pin Note', click: () => { M.moveItem(this.state, id, { spaceId: this.space.id, zone: 'pinned' }); this.pushState(true) } })
      else tpl.push({ label: 'Unpin Note', click: () => { M.moveItem(this.state, id, { spaceId: this.space.id, zone: 'today', index: 0 }); this.pushState(true) } })
      tpl.push({ label: 'Copy Text', click: () => clipboard.writeText((item.title ? item.title + '\n\n' : '') + item.body) })
      tpl.push({ type: 'separator' })
      tpl.push({
        label: 'Delete Note…', click: async () => {
          const { response } = await require('electron').dialog.showMessageBox(this.win, { type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, message: `Delete “${item.title || 'Untitled'}”?`, detail: 'Notes can’t be restored after deleting.' })
          if (response !== 0) return
          const shown = this.space.activeId === id
          M.detach(this.state, id)
          if (shown) { const n = this.fallbackSelection([id]); if (n) this.select(n); else this.showNothing() } else this.pushState(true)
        },
      })
    }
    Menu.buildFromTemplate(tpl).popup({ window: this.win })
  }

  splitMenu(split, focusId) {
    const pick = fn => () => { this.select(focusId); fn() }
    return [
      { label: 'Side by Side', type: 'radio', checked: split.orientation !== 'column', click: pick(() => this.splitOrientation('row')) },
      { label: 'Top and Bottom', type: 'radio', checked: split.orientation === 'column', click: pick(() => this.splitOrientation('column')) },
      { label: split.orientation === 'column' ? 'Swap Top and Bottom' : 'Swap Left and Right', click: pick(() => this.splitSwap()) },
      { label: 'Equal Sizes', click: pick(() => this.setSplitSizes(split.children.map(() => 1 / split.children.length))) },
      { label: 'Separate Tabs', click: () => { M.unsplit(this.state, split.id); this.select(focusId) } },
    ]
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

function isSearchPage(u) {
  const h = u.hostname.replace(/^www\./, '')
  const p = u.pathname
  if (/^google\.[a-z.]+$/.test(h)) return p === '/' || p === '/search' || p === '/webhp' || p.startsWith('/complete')
  if (h === 'duckduckgo.com' || h === 'html.duckduckgo.com') return true
  if (h === 'bing.com') return p === '/' || p === '/search'
  if (h === 'search.brave.com' || h === 'kagi.com' || h === 'ecosia.org') return true
  return false
}

function snoozeTime(when) {
  const d = new Date()
  const at = (days, hour) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0, 0); return x.getTime() }
  if (typeof when === 'number') return when
  switch (when) {
    case 'later': return Date.now() + 3 * 3600 * 1000
    case 'evening': return d.getHours() < 17 ? at(0, 18) : Date.now() + 3600 * 1000
    case 'weekend': { const add = (6 - d.getDay() + 7) % 7 || 7; return at(add, 9) }
    case 'nextweek': { const add = (8 - d.getDay()) % 7 || 7; return at(add, 9) }
    default: return at(1, 9) // tomorrow morning
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
