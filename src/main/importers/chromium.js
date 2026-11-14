'use strict'
// Chrome, Brave, Edge, Arc, Helium, Vivaldi, Opera, Dia, Chromium.
const fs = require('node:fs')
const path = require('node:path')
const C = require('./common')

const BROWSERS = [
  { id: 'arc', name: 'Arc', dir: ['Arc', 'User Data'], keychain: ['Arc Safe Storage', 'Arc'] },
  { id: 'chrome', name: 'Chrome', dir: ['Google', 'Chrome'], keychain: ['Chrome Safe Storage'] },
  { id: 'brave', name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser'], keychain: ['Brave Safe Storage', 'Brave Browser Safe Storage'] },
  { id: 'helium', name: 'Helium', dir: ['net.imput.helium'], keychain: ['Helium Storage Key', 'Helium Safe Storage'] },
  { id: 'edge', name: 'Edge', dir: ['Microsoft Edge'], keychain: ['Microsoft Edge Safe Storage'] },
  { id: 'vivaldi', name: 'Vivaldi', dir: ['Vivaldi'], keychain: ['Vivaldi Safe Storage'] },
  { id: 'opera', name: 'Opera', dir: ['com.operasoftware.Opera'], keychain: ['Opera Safe Storage'] },
  { id: 'dia', name: 'Dia', dir: ['Dia', 'User Data'], keychain: ['Dia Safe Storage'] },
  { id: 'chromium', name: 'Chromium', dir: ['Chromium'], keychain: ['Chromium Safe Storage'] },
]

function profiles(browser) {
  const root = C.appSupport(...browser.dir)
  if (!fs.existsSync(root)) return []
  const local = C.readJson(path.join(root, 'Local State'))
  const names = local && local.profile && local.profile.info_cache ? local.profile.info_cache : null
  const dirs = names ? Object.keys(names) : fs.readdirSync(root).filter(d => d === 'Default' || /^Profile \d+$/.test(d))
  // Opera keeps its single profile in the root.
  if (!dirs.length && fs.existsSync(path.join(root, 'Bookmarks'))) dirs.push('.')
  return dirs
    .map(d => ({ dir: path.join(root, d), name: (names && names[d] && names[d].name) || (d === '.' ? 'Default' : d) }))
    .filter(p => fs.existsSync(p.dir))
}

function detect() {
  const found = []
  for (const b of BROWSERS) {
    const ps = profiles(b)
    if (!ps.length) continue
    for (const p of ps) {
      found.push({
        id: `${b.id}:${path.basename(p.dir)}`, browser: b.id, name: b.name, profile: p.name, kind: 'chromium',
        multiProfile: ps.length > 1, hasArcSidebar: b.id === 'arc' && !!arcSidebarPath(),
      })
    }
  }
  return found
}

function browserById(id) { return BROWSERS.find(b => b.id === id) }

function profileDir(sourceId) {
  const [bid, base] = sourceId.split(':')
  const b = browserById(bid)
  if (!b) return null
  const p = profiles(b).find(x => path.basename(x.dir) === base)
  return p ? { browser: b, dir: p.dir } : null
}

// ---- bookmarks ----
function readBookmarks(dir) {
  const data = C.readJson(path.join(dir, 'Bookmarks'))
  if (!data || !data.roots) return []
  const conv = node => {
    if (!node) return null
    if (node.type === 'url') return { type: 'bookmark', title: node.name || node.url, url: node.url }
    if (node.type === 'folder') return { type: 'folder', title: node.name || 'Folder', children: (node.children || []).map(conv).filter(Boolean) }
    return null
  }
  const out = []
  const bar = data.roots.bookmark_bar
  if (bar && bar.children) for (const c of bar.children) { const x = conv(c); if (x) out.push(x) }
  for (const key of ['other', 'synced']) {
    const r = data.roots[key]
    if (r && r.children && r.children.length) out.push({ type: 'folder', title: key === 'other' ? 'Other Bookmarks' : 'Mobile Bookmarks', children: r.children.map(conv).filter(Boolean) })
  }
  return out
}

// ---- history ----
function readHistory(dir, limit = 50000) {
  const h = C.openCopy(path.join(dir, 'History'))
  if (!h) return []
  try {
    return h.db.prepare(`SELECT url, title, visit_count AS visits, typed_count AS typed, (last_visit_time / 1000 - 11644473600000) AS last FROM urls
      WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`).all(limit)
      .map(r => ({ url: r.url, title: r.title, visits: r.visits, typed: r.typed, last: Math.max(0, r.last) }))
  } catch { return [] } finally { h.close() }
}

// ---- passwords ----
function readPasswords(dir, key) {
  const h = C.openCopy(path.join(dir, 'Login Data'))
  if (!h) return { rows: [], failed: 0 }
  let failed = 0
  try {
    const rows = h.db.prepare(`SELECT origin_url AS url, username_value AS username, password_value AS pw, (date_created / 1000 - 11644473600000) AS created FROM logins WHERE blacklisted_by_user = 0`).all()
    const out = []
    for (const r of rows) {
      const password = C.chromiumDecrypt(r.pw, key)
      if (password === null) { failed++; continue }
      if (!password) continue
      out.push({ url: r.url, username: r.username, password, createdAt: Math.max(0, r.created) })
    }
    return { rows: out, failed }
  } catch { return { rows: [], failed } } finally { h.close() }
}

// ---- cookies ----
function readCookies(dir, key) {
  const file = fs.existsSync(path.join(dir, 'Network', 'Cookies')) ? path.join(dir, 'Network', 'Cookies') : path.join(dir, 'Cookies')
  const h = C.openCopy(file)
  if (!h) return { rows: [], failed: 0 }
  let failed = 0
  try {
    let version = 0
    try { version = Number(h.db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get().value) } catch {}
    const strip = version >= 24
    const now = Date.now()
    const rows = h.db.prepare(`SELECT host_key AS host, name, value, encrypted_value AS enc, path, (CASE WHEN expires_utc = 0 THEN 0 ELSE expires_utc / 1000 - 11644473600000 END) AS expires,
      is_secure AS secure, is_httponly AS httpOnly, samesite AS sameSite FROM cookies`).all()
    const out = []
    for (const r of rows) {
      let value = r.value
      if (!value && r.enc && r.enc.length) {
        value = C.chromiumDecrypt(r.enc, key, { stripDomainHash: strip })
        if (value === null) { failed++; continue }
      }
      const expiresMs = r.expires // already converted to ms in SQL (WebKit times overflow JS numbers)
      if (expiresMs && expiresMs < now) continue // already expired
      out.push(toElectronCookie({ host: r.host, name: r.name, value, path: r.path, secure: !!r.secure, httpOnly: !!r.httpOnly, sameSite: r.sameSite, expiresMs }))
    }
    return { rows: out.filter(Boolean), failed }
  } catch (e) { return { rows: [], failed, error: e.message } } finally { h.close() }
}

function toElectronCookie(c) {
  if (!c.host || !c.name) return null
  const domainCookie = c.host.startsWith('.')
  const host = c.host.replace(/^\./, '')
  const ss = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' }[String(c.sameSite)] || 'unspecified'
  const cookie = {
    url: (c.secure ? 'https://' : 'http://') + host + (c.path || '/'),
    name: c.name, value: c.value || '', path: c.path || '/',
    secure: !!c.secure || ss === 'no_restriction', httpOnly: !!c.httpOnly, sameSite: ss,
  }
  if (cookie.secure && cookie.url.startsWith('http://')) cookie.url = 'https://' + cookie.url.slice(7)
  if (domainCookie) cookie.domain = c.host
  if (c.expiresMs) cookie.expirationDate = c.expiresMs / 1000
  if (c.name.startsWith('__Host-')) { delete cookie.domain; cookie.path = '/'; cookie.secure = true }
  return cookie
}

// ---- extensions (installed from the Web Store) ----
function readExtensions(dir) {
  const ids = new Map()
  for (const f of ['Secure Preferences', 'Preferences']) {
    const prefs = C.readJson(path.join(dir, f))
    const settings = prefs && prefs.extensions && prefs.extensions.settings
    if (!settings) continue
    for (const [id, s] of Object.entries(settings)) {
      if (!/^[a-p]{32}$/.test(id)) continue
      const fromStore = s.from_webstore || (s.manifest && s.manifest.update_url && /google\.com|googleapis/.test(s.manifest.update_url))
      if (!fromStore || s.location === 5 || s.was_installed_by_default || s.was_installed_by_oem) continue
      if (s.state === 0 && s.disable_reasons) continue
      ids.set(id, (s.manifest && s.manifest.name) || id)
    }
  }
  // Fall back to scanning the Extensions folder.
  if (!ids.size) {
    const ext = path.join(dir, 'Extensions')
    if (fs.existsSync(ext)) for (const id of fs.readdirSync(ext)) if (/^[a-p]{32}$/.test(id)) ids.set(id, id)
  }
  return [...ids].map(([id, name]) => ({ id, name }))
}

function arcSidebarPath() {
  const p = C.appSupport('Arc', 'StorableSidebar.json')
  return require('node:fs').existsSync(p) ? p : null
}

module.exports = { BROWSERS, detect, profiles, profileDir, readBookmarks, readHistory, readPasswords, readCookies, readExtensions, toElectronCookie, arcSidebarPath }
