'use strict'
// Firefox-family browsers: Zen, Firefox, LibreWolf, Floorp.
const fs = require('node:fs')
const path = require('node:path')
const C = require('./common')

const BROWSERS = [
  { id: 'zen', name: 'Zen', dir: ['zen'] },
  { id: 'firefox', name: 'Firefox', dir: ['Firefox'] },
  { id: 'librewolf', name: 'LibreWolf', dir: ['librewolf'] },
  { id: 'floorp', name: 'Floorp', dir: ['Floorp'] },
]

function profiles(b) {
  const root = C.appSupport(...b.dir)
  const pdir = path.join(root, 'Profiles')
  if (!fs.existsSync(pdir)) return []
  return fs.readdirSync(pdir)
    .map(d => path.join(pdir, d))
    .filter(d => fs.existsSync(path.join(d, 'places.sqlite')))
    .map(d => ({ dir: d, name: path.basename(d).replace(/^[a-z0-9]+\./, ''), mtime: fs.statSync(path.join(d, 'places.sqlite')).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}

function detect() {
  const out = []
  for (const b of BROWSERS) {
    const ps = profiles(b)
    for (const p of ps) out.push({ id: `${b.id}:${path.basename(p.dir)}`, browser: b.id, name: b.name, profile: p.name, kind: 'firefox', multiProfile: ps.length > 1 })
  }
  return out
}

function profileDir(sourceId) {
  const [bid, base] = sourceId.split(':')
  const b = BROWSERS.find(x => x.id === bid)
  if (!b) return null
  const p = profiles(b).find(x => path.basename(x.dir) === base)
  return p ? { browser: b, dir: p.dir } : null
}

function readBookmarks(dir) {
  const h = C.openCopy(path.join(dir, 'places.sqlite'))
  if (!h) return []
  try {
    const rows = h.db.prepare(`SELECT b.id, b.type, b.parent, b.position, b.title, b.guid, p.url FROM moz_bookmarks b
      LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all()
    const byParent = new Map()
    for (const r of rows) { if (!byParent.has(r.parent)) byParent.set(r.parent, []); byParent.get(r.parent).push(r) }
    const conv = (r, depth = 0) => {
      if (depth > 40) return null
      if (r.type === 1 && r.url && !r.url.startsWith('place:')) return { type: 'bookmark', title: r.title || r.url, url: r.url }
      if (r.type === 2) return { type: 'folder', title: r.title || 'Folder', children: (byParent.get(r.id) || []).map(c => conv(c, depth + 1)).filter(Boolean) }
      return null
    }
    const root = r => rows.find(x => x.guid === r)
    const out = []
    const toolbar = root('toolbar_____')
    if (toolbar) for (const c of byParent.get(toolbar.id) || []) { const x = conv(c); if (x) out.push(x) }
    for (const [guid, title] of [['menu________', 'Bookmarks Menu'], ['unfiled_____', 'Other Bookmarks']]) {
      const r = root(guid)
      if (!r) continue
      const kids = (byParent.get(r.id) || []).map(c => conv(c)).filter(Boolean)
      if (kids.length) out.push({ type: 'folder', title, children: kids })
    }
    return out
  } catch { return [] } finally { h.close() }
}

function readHistory(dir, limit = 50000) {
  const h = C.openCopy(path.join(dir, 'places.sqlite'))
  if (!h) return []
  try {
    return h.db.prepare(`SELECT url, title, visit_count AS visits, typed, last_visit_date AS last FROM moz_places
      WHERE hidden = 0 AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?`).all(limit)
      .map(r => ({ url: r.url, title: r.title || '', visits: r.visits || 1, typed: r.typed || 0, last: Math.round(Number(r.last) / 1000) }))
  } catch { return [] } finally { h.close() }
}

function readCookies(dir) {
  const h = C.openCopy(path.join(dir, 'cookies.sqlite'))
  if (!h) return { rows: [], failed: 0 }
  try {
    const now = Date.now() / 1000
    const rows = h.db.prepare(`SELECT host, name, value, path, expiry, isSecure AS secure, isHttpOnly AS httpOnly, sameSite FROM moz_cookies`).all()
    const { toElectronCookie } = require('./chromium')
    return {
      rows: rows.filter(r => !r.expiry || r.expiry > now).map(r => {
        // Firefox sameSite: 0 none, 1 lax, 2 strict. Expiry may be ms in new versions.
        const exp = Number(r.expiry) > 1e11 ? Number(r.expiry) : Number(r.expiry) * 1000
        return toElectronCookie({ host: r.host, name: r.name, value: r.value, path: r.path, secure: !!r.secure, httpOnly: !!r.httpOnly, sameSite: r.sameSite, expiresMs: exp })
      }).filter(Boolean),
      failed: 0,
    }
  } catch { return { rows: [], failed: 0 } } finally { h.close() }
}

// ---- mozLz4 (Firefox's session files) ----
function lz4Block(src, outLen) {
  const dst = Buffer.alloc(outLen)
  let si = 0, di = 0
  while (si < src.length) {
    const token = src[si++]
    let lit = token >> 4
    if (lit === 15) { let b; do { b = src[si++]; lit += b } while (b === 255) }
    src.copy(dst, di, si, si + lit); si += lit; di += lit
    if (si >= src.length) break
    const off = src[si] | (src[si + 1] << 8); si += 2
    let ml = token & 15
    if (ml === 15) { let b; do { b = src[si++]; ml += b } while (b === 255) }
    ml += 4
    let from = di - off
    if (off === 0 || from < 0) throw new Error('bad lz4 data')
    for (let k = 0; k < ml; k++) dst[di++] = dst[from++]
  }
  return dst.subarray(0, di)
}

function readMozLz4(file) {
  const buf = fs.readFileSync(file)
  if (buf.subarray(0, 8).toString('binary') !== 'mozLz40\0') throw new Error('not mozlz4')
  const size = buf.readUInt32LE(8)
  return JSON.parse(lz4Block(buf.subarray(12), size).toString('utf8'))
}

// Zen workspaces, essentials (= pinned bar), pinned and open tabs.
function readZenSpaces(dir) {
  const candidates = ['zen-sessions.jsonlz4', 'sessionstore.jsonlz4', path.join('sessionstore-backups', 'recovery.jsonlz4'), path.join('sessionstore-backups', 'previous.jsonlz4')]
  let session = null
  for (const c of candidates) {
    const f = path.join(dir, c)
    if (!fs.existsSync(f)) continue
    try { session = readMozLz4(f); break } catch {}
  }
  let workspaces = []
  const h = C.openCopy(path.join(dir, 'places.sqlite'))
  if (h) {
    try { if (C.tableExists(h.db, 'zen_workspaces')) workspaces = h.db.prepare('SELECT uuid, name, icon, position FROM zen_workspaces ORDER BY position').all() } catch {}
    h.close()
  }
  if (!session) return null
  const spaceList = (session.spaces || session.workspaces || workspaces || []).map(w => ({ uuid: w.uuid, name: w.name, icon: w.icon }))
  const tabs = []
  const pushTab = t => {
    const entries = t.entries || []
    const e = entries[(t.index || entries.length) - 1] || entries[entries.length - 1]
    const url = (e && e.url) || t.zenPinnedEntry && JSON.parse(t.zenPinnedEntry || '{}').url
    if (!url || /^(about|chrome):/.test(url)) return
    tabs.push({ url, title: (e && e.title) || url, ws: t.zenWorkspace || null, pinned: !!t.pinned, essential: !!t.zenEssential })
  }
  for (const t of session.tabs || []) pushTab(t)
  for (const w of session.windows || []) for (const t of w.tabs || []) pushTab(t)
  if (!tabs.length) return null
  const favorites = []
  const seenFav = new Set()
  const spaces = (spaceList.length ? spaceList : [{ uuid: null, name: 'Zen' }]).map(s => ({ name: s.name || 'Space', emoji: s.icon && !/^chrome:/.test(s.icon) ? s.icon : null, colors: [], pinned: [], today: [], uuid: s.uuid }))
  for (const t of tabs) {
    if (t.essential) { if (!seenFav.has(t.url)) { seenFav.add(t.url); favorites.push({ type: 'tab', url: t.url, title: t.title }) } continue }
    const sp = spaces.find(s => s.uuid && s.uuid === t.ws) || spaces[0]
    const list = t.pinned ? sp.pinned : sp.today
    if (!list.some(x => x.url === t.url)) list.push({ type: 'tab', url: t.url, title: t.title })
  }
  return { spaces, favorites }
}

module.exports = { BROWSERS, detect, profileDir, readBookmarks, readHistory, readCookies, readZenSpaces, readMozLz4, lz4Block }
