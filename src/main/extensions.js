'use strict'
// Chrome extensions: Web Store installs ("Add to Chrome" works on
// chromewebstore.google.com), chrome.tabs/windows/action APIs mapped onto
// Crescent's tabs, and extension context-menu items.

const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, dialog } = require('electron')
const { JsonFile } = require('./store')

class Extensions {
  constructor(c) {
    this.c = c
    this.ext = null
    this.disabled = new JsonFile(path.join(app.getPath('userData'), 'extensions-disabled.json'), [])
    this.dir = path.join(app.getPath('userData'), 'Extensions')
  }

  get session() { return this.c.browseSession }

  async init() {
    const { ElectronChromeExtensions } = require('electron-chrome-extensions')
    const { installChromeWebStore } = require('electron-chrome-web-store')
    const c = this.c
    const tabFor = wc => {
      const m = c.main
      if (!m) return null
      for (const t of m.tabs.values()) if (t.wc === wc) return t
      return null
    }
    this.ext = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: this.session,
      createTab: async details => {
        const m = c.ensureMain()
        const tab = m.newTab({ url: details.url || 'https://www.google.com/', isSearch: false }, { background: details.active === false })
        const t = m.ensureTab(tab.id)
        return [t.wc, m.win]
      },
      selectTab: wc => { const t = tabFor(wc); if (t) c.main.select(t.id) },
      removeTab: wc => { const t = tabFor(wc); if (t) c.main.closeTab(t.id) },
      createWindow: async details => {
        const url = Array.isArray(details.url) ? details.url[0] : details.url
        const win = new BrowserWindow({
          width: details.width || 420, height: details.height || 640,
          x: details.left, y: details.top, autoHideMenuBar: true,
          webPreferences: { session: this.session, sandbox: true, contextIsolation: true },
        })
        if (url) win.loadURL(url)
        return win
      },
      removeWindow: win => { if (win && !win.isDestroyed()) win.close() },
      assignTabDetails: (details, wc) => {
        const t = tabFor(wc)
        if (t) details.discarded = false
      },
    })
    ElectronChromeExtensions.handleCRXProtocol(this.c.uiSession)

    await installChromeWebStore({
      session: this.session,
      extensionsPath: this.dir,
      autoUpdate: true,
      loadExtensions: true,
      minimumManifestVersion: 2,
      beforeInstall: async details => {
        const parent = BrowserWindow.getFocusedWindow() || (c.main && c.main.win)
        const { response } = await dialog.showMessageBox(parent, {
          type: 'question',
          buttons: ['Add Extension', 'Cancel'], defaultId: 0, cancelId: 1,
          message: `Add “${details.localizedName || details.manifest?.name || 'extension'}” to Crescent?`,
          detail: permissionText(details.manifest),
        })
        return { action: response === 0 ? 'allow' : 'deny' }
      },
    })
    // Respect extensions you switched off.
    for (const id of this.disabled.data) {
      try { this.exts().removeExtension(id) } catch {}
    }
    this.session.extensions?.on?.('extension-loaded', () => c.broadcast('extensions', null))
    this.session.extensions?.on?.('extension-unloaded', () => c.broadcast('extensions', null))
  }

  exts() { return this.session.extensions || this.session }

  addTab(wc, win) { try { this.ext && this.ext.addTab(wc, win) } catch {} }
  removeTab(wc) { try { this.ext && !wc.isDestroyed() && this.ext.removeTab(wc) } catch {} }
  selectTab(wc) { try { this.ext && this.ext.selectTab(wc) } catch {} }
  menuItems(wc, params) { try { return this.ext ? this.ext.getContextMenuItems(wc, params) : [] } catch { return [] } }

  list() {
    const loaded = this.exts().getAllExtensions()
    const out = loaded.map(e => ({ id: e.id, name: e.name, version: e.version, enabled: true, icon: iconData(e), options: optionsPage(e.manifest), description: e.manifest.description || '' }))
    // Disabled ones are on disk but not loaded.
    for (const id of this.disabled.data) {
      if (out.some(x => x.id === id)) continue
      const info = readInstalled(this.dir, id)
      if (info) out.push({ id, name: info.name, version: info.version, enabled: false, icon: null, description: '' })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async toggle(id, on) {
    if (on) {
      this.disabled.data = this.disabled.data.filter(x => x !== id)
      this.disabled.save()
      const info = readInstalled(this.dir, id)
      if (info) await this.exts().loadExtension(info.path, { allowFileAccess: false })
    } else {
      if (!this.disabled.data.includes(id)) this.disabled.data.push(id)
      this.disabled.save()
      try { this.exts().removeExtension(id) } catch {}
    }
    this.c.broadcast('extensions', null)
    return true
  }

  async remove(id) {
    const { uninstallExtension } = require('electron-chrome-web-store')
    try { await uninstallExtension(id, { session: this.session, extensionsPath: this.dir }) } catch (e) {
      try { this.exts().removeExtension(id) } catch {}
    }
    this.disabled.data = this.disabled.data.filter(x => x !== id)
    this.disabled.save()
    this.c.broadcast('extensions', null)
    return true
  }

  async installById(id) {
    const { installExtension } = require('electron-chrome-web-store')
    return installExtension(id, { session: this.session, extensionsPath: this.dir })
  }

  openOptions(id, win) {
    const e = this.exts().getExtension(id)
    if (!e) return
    const page = optionsPage(e.manifest)
    if (page) win.newTab({ url: `chrome-extension://${id}/${page}`, isSearch: false })
  }
}

function optionsPage(m) {
  return (m.options_ui && m.options_ui.page) || m.options_page || null
}

function iconData(e) {
  try {
    const icons = e.manifest.icons || {}
    const size = Object.keys(icons).map(Number).sort((a, b) => Math.abs(a - 32) - Math.abs(b - 32))[0]
    if (!size) return null
    const p = path.join(e.path, icons[size])
    const buf = fs.readFileSync(p)
    const ext = path.extname(p).slice(1).toLowerCase()
    return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${buf.toString('base64')}`
  } catch { return null }
}

function readInstalled(dir, id) {
  try {
    const base = path.join(dir, id)
    const versions = fs.readdirSync(base).filter(v => fs.existsSync(path.join(base, v, 'manifest.json')))
    if (!versions.length) return null
    const v = versions.sort().pop()
    const m = JSON.parse(fs.readFileSync(path.join(base, v, 'manifest.json'), 'utf8'))
    return { path: path.join(base, v), name: m.name, version: m.version }
  } catch { return null }
}

function permissionText(m) {
  if (!m) return ''
  const p = [...(m.permissions || []), ...(m.host_permissions || [])]
  if (p.includes('<all_urls>') || p.some(x => /^\*:\/\/\*\//.test(x))) return 'It can read and change data on all websites.'
  if (p.length) return 'Permissions: ' + p.slice(0, 6).join(', ') + (p.length > 6 ? '…' : '')
  return ''
}

module.exports = { Extensions }
