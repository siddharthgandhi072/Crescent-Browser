'use strict'
// Site permissions. Electron grants everything by default, which is unsafe;
// here sensitive permissions ask first and decisions are remembered per site.

const path = require('node:path')
const { systemPreferences } = require('electron')
const { JsonFile } = require('./store')
const M = require('./model')

const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'speaker-selection', 'window-management', 'background-sync', 'storage-access', 'top-level-storage-access'])
const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'idle-detection', 'display-capture', 'hid', 'serial', 'usb'])

const LABELS = {
  media: 'use your camera and microphone', 'media:video': 'use your camera', 'media:audio': 'use your microphone',
  geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices', midiSysex: 'use MIDI devices',
  'clipboard-read': 'see text and images you copy', 'idle-detection': 'know when you are away', 'display-capture': 'share your screen',
  hid: 'connect to HID devices', serial: 'connect to serial ports', usb: 'connect to USB devices',
}

class Permissions {
  constructor(c, dir) {
    this.c = c
    this.file = new JsonFile(path.join(dir, 'permissions.json'), {})
    this.pending = new Map()
    const s = c.browseSession
    s.setPermissionRequestHandler((wc, permission, cb, details) => this.request(wc, permission, cb, details))
    s.setPermissionCheckHandler((wc, permission, origin) => this.check(permission, origin))
  }

  key(permission, details) {
    if (permission === 'media' && details && Array.isArray(details.mediaTypes)) {
      const t = details.mediaTypes
      if (t.length === 1) return 'media:' + t[0]
    }
    return permission
  }

  originOf(wc, details) {
    const u = (details && (details.requestingUrl || details.securityOrigin)) || (wc && !wc.isDestroyed() ? wc.getURL() : '')
    try { return new URL(u).origin } catch { return '' }
  }

  check(permission, origin) {
    if (ALWAYS.has(permission)) return true
    let o = origin
    try { o = new URL(origin).origin } catch {}
    const saved = this.file.data[o]
    if (!saved) return false
    if (permission === 'media') return saved['media'] === true || saved['media:video'] === true || saved['media:audio'] === true
    return saved[permission] === true
  }

  async request(wc, permission, cb, details) {
    if (ALWAYS.has(permission)) return cb(true)
    if (!ASK.has(permission)) return cb(false)
    const origin = this.originOf(wc, details)
    if (!origin || origin === 'null') return cb(false)
    const key = this.key(permission, details)
    const saved = this.file.data[origin] && this.file.data[origin][key]
    if (saved === true) return cb(await this.osAccess(key))
    if (saved === false) return cb(false)
    const m = this.c.main
    if (!m || m.closed) return cb(false)
    const id = M.uid('p')
    this.pending.set(id, { cb, origin, key })
    // Requests from background tabs wait until you look at them.
    m.openOverlay('prompt', { id, origin, host: new URL(origin).host, what: LABELS[key] || key, key })
  }

  async osAccess(key) {
    // macOS asks once per app for camera/mic; Chromium handles the rest.
    if (process.platform !== 'darwin') return true
    try {
      if (key === 'media' || key === 'media:video') { if (!(await systemPreferences.askForMediaAccess('camera'))) return false }
      if (key === 'media' || key === 'media:audio') { if (!(await systemPreferences.askForMediaAccess('microphone'))) return false }
    } catch {}
    return true
  }

  async respond(id, allow, remember = true) {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    if (remember) {
      this.file.data[p.origin] = { ...(this.file.data[p.origin] || {}), [p.key]: !!allow }
      this.file.save()
    }
    p.cb(allow ? await this.osAccess(p.key) : false)
  }

  cancelAll() {
    for (const [id, p] of this.pending) { this.pending.delete(id); p.cb(false) }
  }

  list() { return this.file.data }
  reset(origin) { delete this.file.data[origin]; this.file.save() }
  flush() { this.file.flush() }
}

module.exports = { Permissions }
