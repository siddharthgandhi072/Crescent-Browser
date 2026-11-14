'use strict'
const { net } = require('electron')
const M = require('./model')
const { ENGINES, resolveInput, displayUrl } = require('./urls')

class Search {
  constructor(c) {
    this.c = c
    this.ctrl = null
    this.cache = new Map()
  }

  // Instant results: open tabs (all spaces), bookmarks, history.
  local(q, win) {
    const state = this.c.store.state
    const text = String(q || '').trim().toLowerCase()
    const out = { tabs: [], bookmarks: [], history: [], resolved: null }
    const runtime = win ? win.tabs : new Map()

    const tabEntries = []
    const seen = new Set()
    const add = (item, space, zone) => {
      if (seen.has(item.id)) return
      seen.add(item.id)
      const live = runtime.get(item.id)
      const url = live ? live.info.url : item.url
      const title = (live && live.info.title) || item.title || url
      tabEntries.push({ id: item.id, url, title, favicon: item.favicon, space: space ? space.name : '', spaceId: space ? space.id : null, zone, live: !!live })
    }
    for (const t of state.favorites) add(t, null, 'favorites')
    for (const s of state.spaces) {
      for (const z of ['favorites', 'pinned', 'today']) for (const t of M.tabsIn(s[z])) add(t, s, z)
    }

    if (!text) {
      // Empty bar: most recently used tabs first.
      const order = win ? win.mru : []
      out.tabs = order.map(id => tabEntries.find(t => t.id === id)).filter(Boolean)
        .filter(t => !win || t.id !== win.space.activeId).slice(0, 6)
      return out
    }
    const words = text.split(/\s+/).filter(Boolean)
    const match = (title, url) => {
      const hay = (title + ' ' + url).toLowerCase()
      return words.every(w => hay.includes(w))
    }
    const score = (title, url) => {
      const t = (title || '').toLowerCase(); const u = displayUrl(url).toLowerCase()
      let s = 0
      if (u.startsWith(text)) s += 8
      if (t.startsWith(text)) s += 6
      if (u.includes(text)) s += 3
      if (t.includes(text)) s += 2
      return s
    }
    out.tabs = tabEntries.filter(t => match(t.title, t.url)).sort((a, b) => score(b.title, b.url) - score(a.title, a.url)).slice(0, 5)
    out.bookmarks = M.allBookmarks(state).filter(b => match(b.title, b.url))
      .sort((a, b) => score(b.title, b.url) - score(a.title, a.url)).slice(0, 4)
      .map(b => ({ id: b.id, url: b.url, title: b.title, path: b.path }))
    const openUrls = new Set(out.tabs.map(t => t.url).concat(out.bookmarks.map(b => b.url)))
    out.history = this.c.history.search(text, 12).filter(h => !openUrls.has(h.url)).slice(0, 5)
      .map(h => ({ url: h.url, title: h.title || displayUrl(h.url), last: h.last }))
    const r = resolveInput(q, state.settings.searchEngine)
    if (r && !r.isSearch) out.resolved = r.url
    // Inline completion: best history URL that starts with what you typed.
    const best = this.c.history.search(text, 20).map(h => displayUrl(h.url)).find(u => u.toLowerCase().startsWith(text) && u.length > text.length)
    if (best && !/\s/.test(text)) out.complete = best
    return out
  }

  // Search engine suggestions. Aborts the previous request so fast typing
  // never shows results for an old query.
  async suggest(q) {
    const text = String(q || '').trim()
    if (!text || text.length > 200) return []
    const engine = ENGINES[this.c.store.state.settings.searchEngine] || ENGINES.google
    if (!engine.suggest) return []
    if (this.cache.has(text)) return this.cache.get(text)
    if (this.ctrl) this.ctrl.abort()
    const ctrl = new AbortController()
    this.ctrl = ctrl
    const timer = setTimeout(() => ctrl.abort(), 1500)
    try {
      const res = await net.fetch(engine.suggest.replace('%s', encodeURIComponent(text)), { signal: ctrl.signal, credentials: 'omit' })
      if (!res.ok) return []
      const data = await res.json()
      const list = (Array.isArray(data) && Array.isArray(data[1]) ? data[1] : Array.isArray(data) ? data : [])
        .map(x => (typeof x === 'string' ? x : x && (x.phrase || x.q)))
        .filter(x => typeof x === 'string' && x.toLowerCase() !== text.toLowerCase())
        .slice(0, 5)
      this.cache.set(text, list)
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value)
      return list
    } catch {
      return []
    } finally {
      clearTimeout(timer)
      if (this.ctrl === ctrl) this.ctrl = null
    }
  }
}

module.exports = { Search }
