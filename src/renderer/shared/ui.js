// Tiny shared toolkit for every Crescent UI page: Preact + htm (no build
// step), the live state subscription, and small helpers.
import { h, render, Fragment } from '../vendor/preact.js'
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from '../vendor/hooks.js'
import htm from '../vendor/htm.js'

export const html = htm.bind(h)
export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect }

export const api = window.crescent
export const invoke = (...a) => api.invoke(...a)
export const isMac = api.platform === 'darwin'

// Live app state: { state, runtime }. Runtime patches merge per-tab.
export function useCrescent() {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    let cur = null
    const set = v => { cur = v; if (alive) setData(v) }
    invoke('snapshot').then(s => { if (s) set({ state: s.state, runtime: s.runtime || { tabs: {} }, version: s.version }) })
    const offs = [
      api.on('state', state => cur && set({ ...cur, state })),
      api.on('runtime', patch => {
        if (!cur) return
        const rt = { ...cur.runtime }
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'tabs') {
            rt.tabs = { ...rt.tabs }
            for (const [id, p] of Object.entries(v)) rt.tabs[id] = { ...(rt.tabs[id] || {}), ...p }
          } else rt[k] = v
        }
        set({ ...cur, runtime: rt })
      }),
      api.on('theme', ({ dark }) => cur && set({ ...cur, state: { ...cur.state, dark } })),
    ]
    return () => { alive = false; offs.forEach(f => f()) }
  }, [])
  return data
}

export function useEvent(channel, fn, deps = []) {
  useEffect(() => api.on(channel, fn), deps)
}

export function displayUrl(u) {
  if (!u) return ''
  try {
    const url = new URL(u)
    if (url.protocol === 'crescent:') return ''
    if (url.protocol === 'file:') return decodeURIComponent(url.pathname)
    return url.host.replace(/^www\./, '') + (url.pathname === '/' ? '' : url.pathname)
  } catch { return u }
}

export function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, '') } catch { return '' }
}

// Deterministic tile colour for sites without a favicon.
export function letterColor(s) {
  let h = 0
  for (const ch of s || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hues = [8, 24, 150, 205, 222, 262, 290, 335, 180, 40]
  return `hsl(${hues[h % hues.length]} 48% 47%)`
}

export function Favicon({ url, src, size = 16, radius = 4 }) {
  // Remember which src failed (not just "failed") so a new favicon gets a fresh try.
  const [bad, setBad] = useState(null)
  const host = hostOf(url)
  if (src && bad !== src) {
    return html`<img src=${src} width=${size} height=${size} style=${`border-radius:${radius}px;flex:none;object-fit:contain`} onError=${() => setBad(src)} draggable=${false} />`
  }
  if (url && url.startsWith('crescent:')) {
    return html`<span class="fav-fallback" style=${`width:${size}px;height:${size}px;background:#8d7fa3`}>C</span>`
  }
  const letter = (host.replace(/^(www|m|app|mail|docs)\./, '')[0] || '•').toUpperCase()
  return html`<span class="fav-fallback" style=${`width:${size}px;height:${size}px;background:${letterColor(host)};font-size:${Math.round(size * 0.58)}px;border-radius:${radius}px`}>${letter}</span>`
}

export function cls(...a) { return a.filter(Boolean).join(' ') }

export function timeAgo(ms) {
  const d = Date.now() - ms
  const m = Math.round(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dayGroup(ms) {
  const d = new Date(ms); const now = new Date()
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'This week'
  if (diff < 31) return 'This month'
  return 'Earlier'
}

export function fmtBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`
}
