'use strict'
// Secondary windows: first-run setup, settings, Little Crescent, updates.

const { app, BrowserWindow, dialog, net, shell } = require('electron')
const paths = require('./paths')
const M = require('./model')

const REPO = 'siddharthgandhi072/crescent-browser'
const IS_MAC = process.platform === 'darwin'

class Windows {
  constructor(c) {
    this.c = c
    this.setup = null
    this.settings = null
    setTimeout(() => this.checkUpdate(false), 20 * 1000)
  }

  uiWindow(file, opts) {
    const win = new BrowserWindow({
      show: false,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: IS_MAC ? '#00000000' : '#f4efea',
      vibrancy: IS_MAC ? 'under-window' : undefined,
      ...opts,
      webPreferences: { preload: paths.preload('ui.js'), session: this.c.uiSession, contextIsolation: true, sandbox: false },
    })
    this.c.registerUI(win.webContents, { kind: file })
    win.webContents.on('will-navigate', e => e.preventDefault())
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' } })
    win.loadURL(paths.ui(file))
    win.once('ready-to-show', () => win.show())
    return win
  }

  openSetup() {
    if (this.setup && !this.setup.isDestroyed()) return this.setup.focus()
    this.setup = this.uiWindow('setup/index.html', { width: 1120, height: 760, minWidth: 900, minHeight: 640, resizable: true })
    this.setup.on('closed', () => {
      this.setup = null
      // Closing setup early still gets you a browser.
      if (!this.c.main) { this.c.store.state.settings.onboarded = true; this.c.store.save(); this.c.ensureMain() }
    })
  }

  finishSetup(data) {
    const state = this.c.store.state
    if (Array.isArray(data.spaces) && data.spaces.length) {
      // Replace the untouched starter space; keep anything an import created.
      const starter = state.spaces.filter(s => !s.imported && !s.today.length && !s.pinned.length && !s.favorites.length)
      let added = 0
      for (const sp of data.spaces) {
        const name = String(sp.name || '').trim().slice(0, 60)
        if (!name || state.spaces.some(s => s.name === name && !starter.includes(s))) continue
        M.addSpace(state, name, { icon: sp.icon, theme: sp.theme })
        added++
      }
      if (added) for (const s of starter) if (state.spaces.length > 1) M.removeSpace(state, s.id)
      state.activeSpaceId = state.spaces[0].id
    }
    if (data.pinsMode) M.setPinsMode(state, data.pinsMode)
    if (data.searchEngine) state.settings.searchEngine = data.searchEngine
    if (data.setDefault) { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https') }
    state.settings.onboarded = true
    this.c.store.flush()
    const main = this.c.ensureMain()
    if (this.setup && !this.setup.isDestroyed()) this.setup.destroy()
    this.setup = null
    main.focus()
    setTimeout(() => { if (!main.space.activeId) main.openOverlay('command', { mode: 'new' }) }, 600)
    return true
  }

  openSettings(section) {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.focus()
      if (section) this.settings.webContents.send('settings:section', section)
      return
    }
    this.settings = this.uiWindow('settings/index.html' + (section ? '#' + section : ''), { width: 860, height: 640, minWidth: 720, minHeight: 480 })
    this.settings.on('closed', () => { this.settings = null })
  }

  openLittle(opts) {
    const { LittleWindow } = require('./little')
    const w = new LittleWindow(this.c, opts || {})
    this.c.littles.add(w)
    w.on('closed', () => this.c.littles.delete(w))
    return w
  }

  async checkUpdate(interactive) {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error('No releases yet')
      const rel = await res.json()
      const latest = String(rel.tag_name || '').replace(/^v/, '')
      const newer = cmp(latest, app.getVersion()) > 0
      if (newer) {
        const { response } = await dialog.showMessageBox({
          type: 'info', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1,
          message: `Crescent ${latest} is available`, detail: `You have ${app.getVersion()}. Your spaces and tabs carry over when you replace the app.`,
        })
        if (response === 0) shell.openExternal(rel.html_url)
      } else if (interactive) {
        dialog.showMessageBox({ type: 'info', message: 'Crescent is up to date', detail: `Version ${app.getVersion()}` })
      }
      return { latest, newer }
    } catch (e) {
      if (interactive) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: e.message })
      return { error: e.message }
    }
  }
}

function cmp(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  return 0
}

module.exports = { Windows, cmp }
