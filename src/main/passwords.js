'use strict'
// Password vault + autofill. Stored encrypted with the macOS Keychain
// (Electron safeStorage). Pages only ever see logins for their own origin,
// and only after you pick one.

const path = require('node:path')
const fs = require('node:fs')
const { safeStorage, systemPreferences } = require('electron')
const M = require('./model')
const { writeAtomic } = require('./store')

class Passwords {
  constructor(c, dir) {
    this.c = c
    this.file = path.join(dir, 'passwords.vault')
    this.items = null
    this.pendingSave = new Map()
  }

  load() {
    if (this.items) return this.items
    this.items = []
    try {
      const buf = fs.readFileSync(this.file)
      const txt = buf.subarray(0, 4).toString() === 'PLN:' ? buf.subarray(4).toString('utf8') : safeStorage.decryptString(buf)
      const data = JSON.parse(txt)
      if (Array.isArray(data)) this.items = data
    } catch {}
    return this.items
  }

  persist() {
    const json = JSON.stringify(this.items || [])
    let buf
    if (safeStorage.isEncryptionAvailable()) buf = safeStorage.encryptString(json)
    else buf = Buffer.concat([Buffer.from('PLN:'), Buffer.from(json)]) // dev/test machines without a keyring
    writeAtomic(this.file, buf)
  }

  importMany(rows) {
    this.load()
    let added = 0
    for (const r of rows) {
      const origin = originOf(r.url || r.origin)
      if (!origin || !r.password) continue
      const existing = this.items.find(i => i.origin === origin && i.username === (r.username || ''))
      if (existing) { if (existing.password !== r.password) { existing.password = r.password; added++ } continue }
      this.items.push({ id: M.uid('pw'), origin, username: r.username || '', password: r.password, createdAt: r.createdAt || Date.now(), lastUsed: 0 })
      added++
    }
    this.persist()
    return added
  }

  importCsv(file) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'))
    if (!rows.length) return 0
    const head = rows[0].map(h => h.trim().toLowerCase())
    const col = names => head.findIndex(h => names.includes(h))
    const iu = col(['url', 'login_uri', 'website', 'origin', 'login url'])
    const in_ = col(['username', 'login_username', 'login', 'user', 'email'])
    const ip = col(['password', 'login_password'])
    if (iu === -1 || ip === -1) throw new Error('This CSV has no url/password columns.')
    return this.importMany(rows.slice(1).map(r => ({ url: r[iu], username: in_ === -1 ? '' : r[in_], password: r[ip] })))
  }

  async list(reveal) {
    this.load()
    if (reveal && process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      try { await systemPreferences.promptTouchID('show your saved passwords') } catch { return { locked: true } }
    }
    return this.items.map(i => ({ id: i.id, origin: i.origin, username: i.username, password: reveal ? i.password : undefined, lastUsed: i.lastUsed }))
      .sort((a, b) => a.origin.localeCompare(b.origin))
  }

  remove(id) {
    this.load()
    this.items = this.items.filter(i => i.id !== id)
    this.persist()
    return true
  }

  // ---- page bridge (from src/preload/page.js) ----
  handle(e, action, data) {
    const frameUrl = e.senderFrame ? e.senderFrame.url : e.sender.getURL()
    const origin = originOf(frameUrl)
    if (!origin || !/^https?:/.test(origin)) return null
    // Private windows never touch the vault.
    if (e.sender.session !== this.c.browseSession) return null
    this.load()
    if (action === 'query') {
      return this.items.filter(i => i.origin === origin).map(i => ({ id: i.id, username: i.username }))
    }
    if (action === 'fill') {
      const it = this.items.find(i => i.id === data && i.origin === origin)
      if (!it) return null
      it.lastUsed = Date.now()
      this.persist()
      return { username: it.username, password: it.password }
    }
    if (action === 'offer') {
      const username = String((data && data.username) || '').slice(0, 300)
      const password = String((data && data.password) || '')
      if (!password || password.length > 500) return null
      const same = this.items.find(i => i.origin === origin && i.username === username)
      if (same && same.password === password) return null
      const id = M.uid('ps')
      this.pendingSave.set(id, { origin, username, password, update: !!same })
      const m = this.c.main
      if (m && !m.closed) m.openOverlay('savepw', { id, host: new URL(origin).host, username, update: !!same })
      return true
    }
    return null
  }

  respondSave(id, accept) {
    const p = this.pendingSave.get(id)
    this.pendingSave.delete(id)
    if (this.c.main) this.c.main.closeOverlay()
    if (!p || !accept) return
    this.importMany([{ url: p.origin, username: p.username, password: p.password }])
  }
}

function originOf(u) {
  if (!u) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u)
    if (!/^https?:$/.test(url.protocol)) return null
    return url.origin
  } catch { return null }
}

// RFC 4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

module.exports = { Passwords, parseCsv, originOf }
