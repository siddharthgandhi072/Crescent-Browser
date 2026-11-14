'use strict'
// Built-in ad and tracker blocking using AdGuard's own filter lists (the
// same lists the AdGuard extension uses), run by Ghostery's engine. The
// compiled engine is cached on disk and refreshed every few days.

const path = require('node:path')
const fs = require('node:fs')
const { net } = require('electron')
const { JsonFile } = require('./store')

const LISTS = [
  'https://filters.adtidy.org/extension/ublock/filters/2.txt', // AdGuard Base
  'https://filters.adtidy.org/extension/ublock/filters/3.txt', // AdGuard Tracking Protection
  'https://filters.adtidy.org/extension/ublock/filters/14.txt', // AdGuard Annoyances (cookie banners, popups)
]
const MAX_AGE = 4 * 24 * 3600 * 1000

class Adblock {
  constructor(c, dir) {
    this.c = c
    this.dir = dir
    this.cacheFile = path.join(dir, 'adblock-engine.bin')
    this.allow = new JsonFile(path.join(dir, 'adblock-allow.json'), [])
    this.blocker = null
    this.enabled = false
    this.blockedByTab = new Map()
  }

  async init() {
    let ElectronBlocker
    try { ({ ElectronBlocker } = require('@ghostery/adblocker-electron')) } catch (e) { console.error('[adblock] module missing', e); return }
    this.Blocker = ElectronBlocker
    const fetchFn = (url, opts) => net.fetch(url, opts)
    let blocker = null
    try {
      const st = fs.statSync(this.cacheFile)
      if (Date.now() - st.mtimeMs < MAX_AGE) blocker = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(this.cacheFile)))
    } catch {}
    if (!blocker) {
      try {
        blocker = await ElectronBlocker.fromLists(fetchFn, LISTS, { enableCompression: true, loadNetworkFilters: true, loadCosmeticFilters: true })
        fs.writeFileSync(this.cacheFile, Buffer.from(blocker.serialize()))
      } catch (e) {
        console.error('[adblock] list download failed, trying prebuilt', e.message)
        try { blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchFn) } catch (e2) { console.error('[adblock] unavailable', e2.message); return }
      }
    }
    this.blocker = blocker
    // Per-site off switch: skip blocking when the top page is on the allow list.
    const isAllowed = details => {
      const wc = details.webContents
      try {
        const host = new URL(wc && !wc.isDestroyed() ? wc.getURL() : details.referrer || '').hostname
        return this.allow.data.includes(host)
      } catch { return false }
    }
    const origBefore = blocker.onBeforeRequest
    blocker.onBeforeRequest = (details, cb) => {
      if (isAllowed(details)) return cb({})
      return origBefore(details, r => {
        if (r && (r.cancel || r.redirectURL) && details.webContents) {
          const id = details.webContents.id
          this.blockedByTab.set(id, (this.blockedByTab.get(id) || 0) + 1)
        }
        cb(r)
      })
    }
    const origHeaders = blocker.onHeadersReceived
    blocker.onHeadersReceived = (details, cb) => (isAllowed(details) ? cb({}) : origHeaders(details, cb))
    this.setEnabled(this.c.store.state.settings.adblock)
  }

  setEnabled(on) {
    if (!this.blocker) return
    const s = this.c.browseSession
    if (on && !this.enabled) { this.blocker.enableBlockingInSession(s); this.enabled = true }
    if (!on && this.enabled) { this.blocker.disableBlockingInSession(s); this.enabled = false }
  }

  status(tab) {
    if (!tab) return { enabled: this.enabled, site: null, blocked: 0 }
    let host = ''
    try { host = new URL(tab.info.url).hostname } catch {}
    return { enabled: this.enabled, ready: !!this.blocker, site: host, allowed: this.allow.data.includes(host), blocked: this.blockedByTab.get(tab.wc.id) || 0 }
  }

  toggleSite(tab) {
    if (!tab) return
    let host = ''
    try { host = new URL(tab.info.url).hostname } catch { return }
    const i = this.allow.data.indexOf(host)
    if (i === -1) this.allow.data.push(host); else this.allow.data.splice(i, 1)
    this.allow.save()
  }
}

module.exports = { Adblock }
