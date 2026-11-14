'use strict'

const ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://www.google.com/complete/search?client=chrome&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave Search', search: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
  kagi: { name: 'Kagi', search: 'https://kagi.com/search?q=%s', suggest: null },
  ecosia: { name: 'Ecosia', search: 'https://www.ecosia.org/search?q=%s', suggest: null },
}

const SCHEME = /^(https?|file|crescent|chrome-extension|about|data|view-source|mailto|ftp):/i

// Turns whatever was typed into a URL. Returns { url, isSearch }.
function resolveInput(input, engine = 'google') {
  const text = String(input || '').trim()
  if (!text) return null
  if (SCHEME.test(text)) {
    if (/^(file|data|view-source):/i.test(text) || isValidUrl(text)) return { url: text, isSearch: false }
  }
  if (!/\s/.test(text)) {
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return { url: 'http://' + text, isSearch: false }
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return { url: 'http://' + text, isSearch: false }
    // something.tld[/path] - require a letter TLD of 2+ chars
    if (/^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9-]{1,62}\.?(:\d+)?([/?#].*)?$/i.test(text)) {
      const u = 'https://' + text
      if (isValidUrl(u)) return { url: u, isSearch: false }
    }
  }
  return { url: searchUrl(text, engine), isSearch: true }
}

function searchUrl(q, engine = 'google') {
  if (typeof engine === 'string' && /^https?:\/\/.*%s/.test(engine)) return engine.replace('%s', encodeURIComponent(q))
  const e = ENGINES[engine] || ENGINES.google
  return e.search.replace('%s', encodeURIComponent(q))
}

function isValidUrl(u) {
  try { new URL(u); return true } catch { return false }
}

function displayUrl(u) {
  try {
    const url = new URL(u)
    if (url.protocol === 'crescent:') return ''
    return (url.host.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search).slice(0, 300)
  } catch { return u || '' }
}

// Searching: 'google.com/search?q=hi' -> 'hi' so Cmd+L shows the query.
function queryFromSearchUrl(u) {
  try {
    const url = new URL(u)
    for (const e of Object.values(ENGINES)) {
      const t = new URL(e.search.replace('%s', 'X'))
      if (url.host === t.host && url.pathname === t.pathname) {
        const key = [...t.searchParams.entries()].find(([, v]) => v === 'X')
        if (key) return url.searchParams.get(key[0])
      }
    }
  } catch {}
  return null
}

module.exports = { ENGINES, resolveInput, searchUrl, displayUrl, queryFromSearchUrl, isValidUrl }
