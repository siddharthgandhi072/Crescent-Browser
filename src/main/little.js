'use strict'
// Little Crescent: the small window links from other apps open in. One click
// moves the page (still loaded, scroll position intact) into the main
// window. Also used for private windows.

const { BrowserWindow, clipboard, session, Menu } = require('electron')
const { EventEmitter } = require('node:events')
const { Tab, roundRect } = require('./tab')
const { resolveInput } = require('./urls')
const paths = require('./paths')
const M = require('./model')

const BAR = 46
const IS_MAC = process.platform === 'darwin'

class LittleWindow extends EventEmitter {
  constructor(c, { url = '', private: priv = false } = {}) {
    super()
    this.c = c
    this.private = priv
    this.session = priv ? session.fromPartition('private-' + M.uid('p')) : c.browseSession
    if (priv) paths.registerProtocol(this.session, { pagesOnly: true })
    const focused = BrowserWindow.getFocusedWindow()
    const near = focused ? focused.getBounds() : null
    this.win = new BrowserWindow({
      width: priv ? 1200 : 1000, height: priv ? 820 : 720,
      x: near ? near.x + 60 : undefined, y: near ? near.y + 40 : undefined,
      minWidth: 420, minHeight: 300, show: false,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: IS_MAC ? 'sidebar' : undefined,
      backgroundColor: IS_MAC ? '#00000000' : priv ? '#2a2633' : '#efe9f3',
      webPreferences: { preload: paths.preload('ui.js'), session: c.uiSession, contextIsolation: true, sandbox: false },
    })
    c.registerUI(this.win.webContents, this)
    this.win.webContents.on('will-navigate', e => e.preventDefault())
    this.win.webContents.loadURL(paths.ui('little/index.html') + (priv ? '?private=1' : ''))
    this.win.once('ready-to-show', () => this.win.show())
    const resolved = url ? resolveInput(url, c.store.state.settings.searchEngine) : null
    url = resolved ? resolved.url : ''
    this.tab = new Tab({ id: 'little', url: url || null, session: this.session, background: '#ffffff' })
    this.bindTab()
    this.win.contentView.addChildView(this.tab.view)
    this.layout()
    this.win.on('resize', () => this.layout())
    this.win.on('closed', () => {
      if (this.tab) { c.extensions?.removeTab(this.tab.wc); this.tab.destroy() }
      if (priv) this.session.clearStorageData().catch(() => {})
      this.emit('closed')
    })
    if (!priv) c.extensions?.addTab(this.tab.wc, this.win)
    if (!url) setTimeout(() => this.focusUrl(), 300)
    else this.tab.wc.focus()
  }

  bindTab() {
    const t = this.tab
    t.removeAllListeners()
    t.on('update', () => this.push())
    t.on('navigated', ({ url, inPage }) => { if (!this.private && !inPage) this.c.history.visit(url, t.info.title) })
    t.on('failed', err => {
      const q = new URLSearchParams({ url: err.url || '', code: String(err.code), desc: err.desc || '' })
      t.wc.loadURL(paths.page('error.html') + '?' + q).catch(() => {})
    })
    t.wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (disposition === 'new-window' && features) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { session: this.session } } }
      if (this.private) { this.c.windows.openLittle({ url, private: true }); return { action: 'deny' } }
      setImmediate(() => { const m = this.c.ensureMain(); m.newTab({ url, isSearch: false }); m.focus() })
      return { action: 'deny' }
    })
    t.wc.on('context-menu', (_e, p) => this.c.contextMenu.forPage(this.mainProxy(), t, p))
    t.wc.on('enter-html-full-screen', () => { this.fs = true; this.layout() })
    t.wc.on('leave-html-full-screen', () => { this.fs = false; this.layout() })
  }

  // Context menu actions that need a "window" act on the main window.
  mainProxy() {
    const m = this.c.ensureMain()
    return Object.assign(Object.create(m), { win: this.win })
  }

  layout() {
    if (!this.tab || this.win.isDestroyed()) return
    const [w, h] = this.win.getContentSize()
    if (this.fs) this.tab.setBounds({ x: 0, y: 0, width: w, height: h })
    else this.tab.setBounds({ x: 6, y: BAR, width: w - 12, height: h - BAR - 6 })
  }

  push() {
    if (this.win.isDestroyed()) return
    this.win.webContents.send('runtime', { tabs: { little: { ...this.tab.info } }, private: this.private })
  }

  runtime() { return { tabs: { little: this.tab ? { ...this.tab.info } : {} }, private: this.private } }

  navigate(input) {
    const r = resolveInput(input, this.c.store.state.settings.searchEngine)
    if (!r) return
    this.tab.load(r.url)
    this.tab.wc.focus()
  }

  back() { if (this.tab.wc.navigationHistory.canGoBack()) this.tab.wc.navigationHistory.goBack() }
  copyUrl() { clipboard.writeText(this.tab.info.url); this.win.webContents.send('toast', { text: 'Copied URL' }) }
  focusUrl() { if (!this.win.isDestroyed()) { this.win.webContents.focus(); this.win.webContents.send('focus-url') } }
  close() { if (!this.win.isDestroyed()) this.win.close() }

  moveToMain() {
    if (this.private || !this.tab) return
    const tab = this.tab
    this.tab = null
    this.win.contentView.removeChildView(tab.view)
    this.c.extensions?.removeTab(tab.wc)
    this.c.ensureMain().adoptFromLittle(tab)
    this.win.close()
  }

  // Menu shortcuts while this window is focused.
  handleMenu(name, ...a) {
    const t = this.tab
    if (!t) return false
    switch (name) {
      case 'tab:close': this.close(); return true
      case 'tab:reload': t.wc.reload(); return true
      case 'tab:back': this.back(); return true
      case 'tab:forward': if (t.wc.navigationHistory.canGoForward()) t.wc.navigationHistory.goForward(); return true
      case 'tab:copyUrl': this.copyUrl(); return true
      case 'tab:devtools': t.wc.toggleDevTools(); return true
      case 'tab:zoom': { const d = a[0]; t.wc.setZoomFactor(d === 0 ? 1 : Math.max(0.3, Math.min(3, t.wc.getZoomFactor() + d * 0.1))); return true }
      case 'tab:print': t.wc.print(); return true
      case 'overlay:open': if (a[0] === 'command') { this.focusUrl(); return true } return false
      default: return false
    }
  }
}

module.exports = { LittleWindow }
