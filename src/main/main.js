'use strict'
const { app, BrowserWindow, ipcMain, nativeTheme, protocol, session, systemPreferences } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Tests and portable runs can point user data somewhere else.
if (process.env.CRESCENT_USER_DATA) app.setPath('userData', process.env.CRESCENT_USER_DATA)
app.setName('Crescent')

protocol.registerSchemesAsPrivileged([
  { scheme: 'crescent', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

// Sites (Google sign-in especially) treat anything that says "Electron" as
// an embedded webview. Present as the Chrome version we actually run.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\sCrescent\/\S+/i, '')
  .replace(/\screscent\/\S+/i, '')

// Smoother scrolling and lower memory on Apple Silicon.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,BackForwardCache')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,CalculateNativeWinOcclusion')

const paths = require('./paths')
const { Store } = require('./store')
const { History } = require('./history')
const { MainWindow } = require('./browser')
const { Actions } = require('./actions')
const { buildMenu } = require('./menu')
const { ContextMenu } = require('./contextmenu')
const { Downloads } = require('./downloads')
const { Permissions } = require('./permissions')
const { Search } = require('./search')
const { Adblock } = require('./adblock')
const { Extensions } = require('./extensions')
const { LittleWindow } = require('./little')
const { Passwords } = require('./passwords')
const { Windows } = require('./windows')
const M = require('./model')

class CrescentApp {
  constructor() {
    this.ui = new Map() // webContents.id -> owner window controller
    this.main = null
    this.focused = null
    this.littles = new Set()
    this.pendingUrls = []
    this.stateQueued = false
  }

  async start() {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    this.store = new Store(dir)
    this.store.load()
    this.history = new History(dir)

    // Web pages live in their own persistent session; the app's own UI uses
    // the default one. Keeps pages away from UI files and lets extension
    // icons render in the sidebar.
    this.uiSession = session.defaultSession
    this.browseSession = session.fromPartition('persist:browse')
    paths.registerProtocol(this.uiSession)
    paths.registerProtocol(this.browseSession, { pagesOnly: true })
    this.browseSession.setSpellCheckerLanguages?.(['en-US'])
    this.browseSession.registerPreloadScript({ type: 'frame', filePath: paths.preload('page.js'), id: 'crescent-page' })

    this.actions = new Actions(this)
    this.contextMenu = new ContextMenu(this)
    this.downloads = new Downloads(this, dir)
    this.permissions = new Permissions(this, dir)
    this.search = new Search(this)
    this.passwords = new Passwords(this, dir)
    this.windows = new Windows(this)
    this.adblock = new Adblock(this, dir)
    this.extensions = new Extensions(this)

    ipcMain.handle('ui:invoke', (e, action, ...args) => this.actions.run(this.ui.get(e.sender.id) || null, action, ...args, { sender: e.sender }))
    ipcMain.handle('page:invoke', (e, action, data) => this.passwords.handle(e, action, data))

    nativeTheme.on('updated', () => this.broadcast('theme', { dark: nativeTheme.shouldUseDarkColors }))
    buildMenu(this)

    // Extensions first so tabs restored at startup get content scripts.
    await this.extensions.init().catch(err => console.error('[extensions]', err))
    this.adblock.init().catch(err => console.error('[adblock]', err))

    if (!this.store.state.settings.onboarded && !process.env.CRESCENT_SKIP_SETUP) this.windows.openSetup()
    else this.ensureMain()

    for (const u of this.pendingUrls.splice(0)) this.openExternalUrl(u)

    app.on('activate', () => { if (!this.windows.setup) this.ensureMain().focus() })
  }

  ensureMain() {
    if (this.main && !this.main.closed) return this.main
    this.main = new MainWindow(this).create()
    this.focused = this.main
    buildMenu(this)
    return this.main
  }

  onMainClosed(w) {
    if (this.main === w) this.main = null
    this.store.flush()
  }

  setFocusedWindow(w) { this.focused = w }

  registerUI(wc, owner) {
    this.ui.set(wc.id, owner)
    const id = wc.id
    wc.once('destroyed', () => this.ui.delete(id))
  }

  broadcast(channel, data) {
    for (const id of this.ui.keys()) {
      const wc = require('electron').webContents.fromId(id)
      if (wc && !wc.isDestroyed()) wc.send(channel, data)
    }
  }

  // State changes are coalesced: many mutations in one tick = one message.
  broadcastState() {
    if (this.stateQueued) return
    this.stateQueued = true
    setImmediate(() => {
      this.stateQueued = false
      this.broadcast('state', this.publicState())
    })
  }

  publicState() {
    const s = this.store.state
    return { ...s, archive: undefined, archiveCount: s.archive.length, dark: nativeTheme.shouldUseDarkColors, platform: process.platform }
  }

  snapshot(owner) {
    const runtime = owner && owner.runtime ? owner.runtime() : (this.main ? this.main.runtime() : { tabs: {} })
    return { state: this.publicState(), runtime, version: app.getVersion() }
  }

  // Links from other apps (Crescent as default browser).
  openExternalUrl(url) {
    if (!/^(https?|file):/i.test(url)) return
    if (!this.store) { this.pendingUrls.push(url); return }
    if (this.store.state.settings.littleCrescent) {
      const w = new LittleWindow(this, { url })
      this.littles.add(w)
      w.on('closed', () => this.littles.delete(w))
    } else {
      const m = this.ensureMain()
      m.newTab({ url, isSearch: false })
      m.focus()
    }
  }

  quit() {
    try { this.store.flush() } catch {}
    try { this.downloads.flush() } catch {}
    try { this.permissions.flush() } catch {}
    try { this.history.close() } catch {}
  }
}

const crescent = new CrescentApp()
if (process.env.CRESCENT_TEST) global.__crescent = crescent
module.exports = crescent

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find(a => /^https?:\/\//i.test(a))
    if (url) crescent.openExternalUrl(url)
    else if (crescent.store) crescent.ensureMain().focus()
  })
  app.on('open-url', (e, url) => { e.preventDefault(); crescent.openExternalUrl(url) })
  app.on('open-file', (e, file) => { e.preventDefault(); crescent.openExternalUrl('file://' + file) })
  app.whenReady().then(() => crescent.start()).catch(err => {
    console.error('[crescent] failed to start', err)
    require('electron').dialog.showErrorBox('Crescent could not start', String(err && err.stack || err))
    app.exit(1)
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => crescent.quit())
}
