'use strict'
const M = require('../model')
const C = require('./common')
const chromium = require('./chromium')
const firefox = require('./firefox')
const safari = require('./safari')
const arc = require('./arc')

function detect() {
  const list = []
  for (const fn of [chromium.detect, firefox.detect, safari.detect]) {
    try { list.push(...fn()) } catch (e) { console.error('[import] detect', e.message) }
  }
  // What each source can bring over (shown as checkboxes).
  return list.map(s => ({
    ...s,
    can: {
      spaces: s.browser === 'arc' ? !!s.hasArcSidebar : s.browser === 'zen',
      bookmarks: true,
      history: true,
      passwords: s.kind === 'chromium',
      cookies: s.kind === 'chromium' || s.kind === 'firefox',
      extensions: s.kind === 'chromium',
    },
  }))
}

function addTree(list, nodes) {
  for (const n of nodes) {
    if (n.type === 'folder') {
      const f = { id: M.uid('f'), type: 'folder', title: n.title, open: n.open !== false, children: [] }
      addTree(f.children, n.children || [])
      list.push(f)
    } else if (n.type === 'tab' && n.url) {
      list.push({ id: M.uid('t'), type: 'tab', url: n.url, title: n.title || n.url, favicon: null })
    }
  }
}

function addBookmarkTree(state, parentId, nodes) {
  for (const n of nodes) {
    if (n.type === 'folder') {
      const f = M.addBookmarkFolder(state, { title: n.title, parentId })
      addBookmarkTree(state, f.id, n.children || [])
    } else if (n.url) M.addBookmark(state, { url: n.url, title: n.title, parentId })
  }
}

function importSpaces(state, data) {
  const existing = new Set(state.spaces.map(s => s.name))
  let n = 0
  for (const s of data.spaces) {
    let name = s.name || 'Space'
    while (existing.has(name)) name += ' (imported)'
    existing.add(name)
    const theme = s.colors && s.colors.length ? { colors: s.colors.slice(0, 2), mode: 'auto', grain: 0.4 } : undefined
    const sp = M.addSpace(state, name, { theme, icon: s.emoji ? 'emoji:' + s.emoji : undefined })
    sp.imported = true
    addTree(sp.pinned, s.pinned || [])
    addTree(sp.today, (s.today || []).filter(t => t.type === 'tab'))
    n++
  }
  // Favorites go to the shared pinned bar (or the first imported space).
  const favs = data.favorites || []
  const target = state.settings.pinsMode === 'global' ? state.favorites : state.spaces[state.spaces.length - data.spaces.length]?.favorites || state.favorites
  const have = new Set(target.map(f => f.url))
  for (const f of favs) if (!have.has(f.url)) { target.push({ id: M.uid('t'), type: 'tab', url: f.url, title: f.title || f.url, favicon: null }); have.add(f.url) }
  // Drop the empty starter space if the import brought real ones.
  const starter = state.spaces.find(s => !s.imported && !s.today.length && !s.pinned.length && !s.favorites.length)
  if (starter && n && state.spaces.length > 1) M.removeSpace(state, starter.id)
  state.activeSpaceId = state.spaces[0].id
  return { spaces: n, favorites: favs.length }
}

async function run(c, sourceId, what) {
  const all = detect()
  const src = all.find(s => s.id === sourceId)
  if (!src) throw new Error('That browser was not found on this Mac.')
  const state = c.store.state
  const res = { source: src.name, bookmarks: 0, history: 0, passwords: 0, cookies: 0, extensions: 0, spaces: 0, warnings: [] }
  const progress = step => c.broadcast('import:progress', { step, source: src.name })

  if (src.kind === 'chromium') {
    const p = chromium.profileDir(sourceId)
    let key = null
    if (what.passwords || what.cookies) {
      progress('Asking macOS Keychain for access…')
      const pw = await C.keychainPassword(p.browser.keychain)
      if (pw) key = C.chromiumKey(pw)
      else res.warnings.push(`Keychain access to ${src.name} was not allowed, so passwords and logins were skipped.`)
    }
    if (what.spaces && src.browser === 'arc') {
      progress('Bringing over spaces and pinned tabs…')
      try {
        const data = arc.read()
        if (data) { const r = importSpaces(state, data); res.spaces = r.spaces; res.favorites = r.favorites }
      } catch (e) { res.warnings.push('Arc spaces: ' + e.message) }
    }
    if (what.bookmarks) {
      progress('Copying bookmarks…')
      const tree = chromium.readBookmarks(p.dir)
      if (tree.length) {
        const f = M.addBookmarkFolder(state, { title: `From ${src.name}` })
        addBookmarkTree(state, f.id, tree)
        res.bookmarks = countBookmarks(tree)
      }
    }
    if (what.history) {
      progress('Copying history…')
      res.history = c.history.importMany(chromium.readHistory(p.dir))
    }
    if (what.passwords && key) {
      progress('Copying passwords…')
      const { rows, failed } = chromium.readPasswords(p.dir, key)
      res.passwords = c.passwords.importMany(rows)
      if (failed) res.warnings.push(`${failed} passwords could not be decrypted.`)
    }
    if (what.cookies && key) {
      progress('Keeping you signed in…')
      const { rows, failed } = chromium.readCookies(p.dir, key)
      res.cookies = await setCookies(c, rows)
      if (failed) res.warnings.push(`${failed} cookies could not be decrypted.`)
    }
    if (what.extensions) {
      progress('Installing extensions from the Chrome Web Store…')
      const list = chromium.readExtensions(p.dir)
      const installed = new Set(c.extensions.list().map(e => e.id))
      for (const e of list) {
        if (installed.has(e.id)) continue
        progress(`Installing ${e.name}…`)
        try { await c.extensions.installById(e.id); res.extensions++ } catch (err) { res.warnings.push(`${e.name}: ${err.message}`) }
      }
    }
  } else if (src.kind === 'firefox') {
    const p = firefox.profileDir(sourceId)
    if (what.spaces && src.browser === 'zen') {
      progress('Bringing over workspaces and pinned tabs…')
      try {
        const data = firefox.readZenSpaces(p.dir)
        if (data) { const r = importSpaces(state, data); res.spaces = r.spaces }
        else res.warnings.push('No Zen workspaces found. Quit Zen and try again so its session file is up to date.')
      } catch (e) { res.warnings.push('Zen workspaces: ' + e.message) }
    }
    if (what.bookmarks) {
      progress('Copying bookmarks…')
      const tree = firefox.readBookmarks(p.dir)
      if (tree.length) {
        const f = M.addBookmarkFolder(state, { title: `From ${src.name}` })
        addBookmarkTree(state, f.id, tree)
        res.bookmarks = countBookmarks(tree)
      }
    }
    if (what.history) { progress('Copying history…'); res.history = c.history.importMany(firefox.readHistory(p.dir)) }
    if (what.cookies) { progress('Keeping you signed in…'); res.cookies = await setCookies(c, firefox.readCookies(p.dir).rows) }
    if (what.passwords) res.warnings.push(`${src.name} encrypts passwords with its own key. Export them from ${src.name} (Passwords → Export) and use “Import passwords from CSV” in Settings.`)
  } else if (src.kind === 'safari') {
    try {
      if (what.bookmarks) {
        progress('Copying bookmarks…')
        const tree = safari.readBookmarks()
        if (tree.length) {
          const f = M.addBookmarkFolder(state, { title: 'From Safari' })
          addBookmarkTree(state, f.id, tree)
          res.bookmarks = countBookmarks(tree)
        }
      }
      if (what.history) { progress('Copying history…'); res.history = c.history.importMany(safari.readHistory()) }
      if (what.passwords) res.warnings.push('Safari passwords: open the Passwords app → File → Export All Passwords, then use “Import passwords from CSV” in Settings.')
    } catch (e) {
      res.needsFullDiskAccess = true
      res.warnings.push('Crescent needs Full Disk Access to read Safari. Open System Settings → Privacy & Security → Full Disk Access, turn on Crescent, then try again.')
    }
  }
  c.store.save()
  c.broadcastState()
  if (c.main) {
    const sp = c.main.space
    if (sp.activeId && M.locate(state, sp.activeId)) c.main.select(sp.activeId)
    else c.main.showNothing()
  }
  progress(null)
  return res
}

async function setCookies(c, rows) {
  let n = 0
  const ses = c.browseSession
  // Set in small parallel batches; a few thousand cookies take ~1s.
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    const results = await Promise.allSettled(batch.map(ck => ses.cookies.set(ck)))
    n += results.filter(r => r.status === 'fulfilled').length
  }
  try { await ses.cookies.flushStore() } catch {}
  return n
}

function countBookmarks(tree) {
  let n = 0
  const rec = l => { for (const x of l) { if (x.type === 'folder') rec(x.children || []); else n++ } }
  rec(tree)
  return n
}

module.exports = { detect, run, importSpaces, addTree }
