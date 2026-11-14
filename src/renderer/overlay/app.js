import { html, render, useState, useEffect, useRef, useMemo, useLayoutEffect, useCrescent, useEvent, invoke, displayUrl, hostOf, Favicon, cls, timeAgo, dayGroup, fmtBytes } from '../shared/ui.js'
import { Icon, ICON_NAMES } from '../shared/icons.js'
import { themeVars, applyVars, hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from '../shared/theme.js'

const close = () => invoke('overlay:close')

function App() {
  const data = useCrescent()
  const [ov, setOv] = useState(null)
  useEvent('overlay:open', o => setOv({ ...o, key: Date.now() }))
  useEvent('overlay:close', () => setOv(null))
  useEffect(() => { if (ov) requestAnimationFrame(() => invoke('overlay:ready')) }, [ov && ov.key])

  const state = data && data.state
  const space = state && (state.spaces.find(s => s.id === state.activeSpaceId) || state.spaces[0])
  useEffect(() => {
    if (!space) return
    const t = themeVars(space.theme, state.dark)
    applyVars(document.documentElement, t.vars)
    document.documentElement.classList.toggle('dark', t.dark)
  }, [space && JSON.stringify(space.theme), state && state.dark])

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape' || !ov) return
      e.preventDefault()
      if (ov.mode === 'prompt') invoke('permission:respond', ov.data.id, false, false)
      else if (ov.mode === 'savepw') invoke('passwords:respond', ov.data.id, false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ov])

  if (!ov || !data) return null
  const props = { data: ov.data || {}, layout: ov.layout, state, space, runtime: data.runtime, key: ov.key }
  const Mode = MODES[ov.mode]
  if (!Mode) return null
  const modal = !['find', 'toast'].includes(ov.mode)
  return html`
    <div class=${cls('ov', 'm-' + ov.mode)}>
      ${modal && html`<div class=${cls('backdrop', (ov.mode === 'command' || ov.mode === 'peek') && 'dim')} onMouseDown=${() => {
        if (ov.mode === 'prompt') invoke('permission:respond', ov.data.id, false, false)
        else if (ov.mode === 'savepw') invoke('passwords:respond', ov.data.id, false)
        else close()
      }}></div>`}
      <${Mode} ...${props} />
    </div>`
}

// ================================================================ command bar

const COMMANDS = [
  { id: 'new-space', label: 'New Space', icon: 'plus', keys: '⇧⌘S' },
  { id: 'theme', label: 'Edit Theme', icon: 'palette', keys: '⇧⌘E', words: 'colour color appearance' },
  { id: 'library', label: 'Open Library', icon: 'archive', keys: '⌘Y', words: 'archive closed' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'downloads', label: 'Downloads', icon: 'down', keys: '⇧⌘J' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'book', keys: '⌥⌘B' },
  { id: 'bookmark', label: 'Bookmark This Page', icon: 'star', keys: '⌥⌘D' },
  { id: 'pin', label: 'Pin / Unpin Tab', icon: 'pin', keys: '⌘D' },
  { id: 'favorite', label: 'Add to Pinned Bar', icon: 'star', keys: '⇧⌘D', words: 'favorite favourite' },
  { id: 'split', label: 'Split View', icon: 'split', keys: '⌃⇧=', words: 'side by side' },
  { id: 'unsplit', label: 'Separate Split View', icon: 'split' },
  { id: 'copy-url', label: 'Copy URL', icon: 'link', keys: '⇧⌘C', words: 'link' },
  { id: 'duplicate', label: 'Duplicate Tab', icon: 'copy', keys: '⇧⌘K' },
  { id: 'reopen', label: 'Reopen Closed Tab', icon: 'undo', keys: '⇧⌘T', words: 'restore undo' },
  { id: 'clear-today', label: 'Clear Unpinned Tabs', icon: 'archive', keys: '⇧⌘⌫' },
  { id: 'close-others', label: 'Close Other Tabs', icon: 'x' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon: 'sidebar', keys: '⌘S', words: 'hide show' },
  { id: 'find', label: 'Find on Page', icon: 'search', keys: '⌘F' },
  { id: 'screenshot', label: 'Copy Screenshot of Page', icon: 'camera', keys: '⇧⌘2', words: 'capture' },
  { id: 'mute', label: 'Mute / Unmute Tab', icon: 'speaker', words: 'sound audio' },
  { id: 'zoom-in', label: 'Zoom In', icon: 'plus', keys: '⌘=' },
  { id: 'zoom-out', label: 'Zoom Out', icon: 'search', keys: '⌘-' },
  { id: 'zoom-reset', label: 'Actual Size', icon: 'search', keys: '⌘0' },
  { id: 'little', label: 'New Little Crescent Window', icon: 'window', keys: '⌥⌘N', words: 'mini' },
  { id: 'private', label: 'New Private Window', icon: 'incognito', keys: '⇧⌘N', words: 'incognito' },
  { id: 'devtools', label: 'Developer Tools', icon: 'code', keys: '⌥⌘I', words: 'inspect console' },
  { id: 'view-source', label: 'View Page Source', icon: 'code', keys: '⌥⌘U' },
  { id: 'print', label: 'Print Page', icon: 'pen', keys: '⌘P' },
  { id: 'adblock-site', label: 'Pause / Resume Ad Blocking on This Site', icon: 'shield', words: 'adblock ads' },
  { id: 'extensions', label: 'Manage Extensions', icon: 'puzzle' },
  { id: 'webstore', label: 'Open Chrome Web Store', icon: 'puzzle', words: 'extensions add' },
  { id: 'import', label: 'Import from Another Browser', icon: 'down', words: 'arc chrome zen safari brave' },
  { id: 'settings', label: 'Settings', icon: 'gear', keys: '⌘,', words: 'preferences' },
  { id: 'pins-global', label: 'Pinned Bar: Same in Every Space', icon: 'pin' },
  { id: 'pins-space', label: 'Pinned Bar: Different per Space', icon: 'pin' },
  { id: 'default-browser', label: 'Make Crescent the Default Browser', icon: 'moon' },
]

function Command({ data, state, runtime }) {
  const mode = data.mode || 'new'
  const [text, setText] = useState(data.text || '')
  const [local, setLocal] = useState({ tabs: [], bookmarks: [], history: [] })
  const [sugg, setSugg] = useState([])
  const [sel, setSel] = useState(0)
  const [noComplete, setNoComplete] = useState(false)
  const input = useRef(null)
  const list = useRef(null)

  useLayoutEffect(() => { const el = input.current; el.focus(); el.select() }, [])

  useEffect(() => {
    let alive = true
    const q = text.startsWith('>') ? '' : text
    invoke('search:local', q).then(r => { if (alive && r) setLocal(r) })
    if (!q.trim() || mode === 'edit' && q === data.text) { setSugg([]); return }
    const t = setTimeout(() => invoke('search:suggest', q).then(r => { if (alive) setSugg(Array.isArray(r) ? r : []) }), 70)
    return () => { alive = false; clearTimeout(t) }
  }, [text])
  useEffect(() => setSel(0), [text])

  const q = text.trim()
  const isCmd = text.startsWith('>')
  const complete = !noComplete && !isCmd && local.complete && local.complete.toLowerCase().startsWith(q.toLowerCase()) && q.length >= 2 ? local.complete : null

  const spaces = state.spaces.map(s => ({ id: 'switch-space', arg: s.id, label: `Go to ${s.name}`, icon: s.icon, words: 'space ' + s.name }))
  const rows = useMemo(() => {
    const out = []
    const push = (group, r) => out.push({ group, ...r })
    if (isCmd) {
      const cq = text.slice(1).trim().toLowerCase()
      for (const c of [...COMMANDS, ...spaces]) if (!cq || (c.label + ' ' + (c.words || '')).toLowerCase().includes(cq)) push('Commands', { kind: 'cmd', ...c })
      return out
    }
    if (!q) {
      for (const t of local.tabs) push('Recent tabs', { kind: 'tab', ...t })
      for (const c of COMMANDS.slice(0, 4)) push('Try', { kind: 'cmd', ...c })
      return out
    }
    if (complete) push('Go', { kind: 'go', url: 'https://' + complete.replace(/^https?:\/\//, ''), label: complete })
    else if (local.resolved) push('Go', { kind: 'go', url: local.resolved, label: displayUrl(local.resolved) || local.resolved })
    else push('Search', { kind: 'search', q, label: q })
    for (const s of sugg) push('Search', { kind: 'search', q: s, label: s })
    if (local.resolved && !complete) push('Search', { kind: 'search', q, label: q })
    for (const t of local.tabs) push('Open tabs', { kind: 'tab', ...t })
    for (const b of local.bookmarks) push('Bookmarks', { kind: 'bookmark', ...b })
    for (const h of local.history) push('History', { kind: 'history', ...h })
    const cq = q.toLowerCase()
    const cmds = [...COMMANDS, ...spaces].filter(c => (c.label + ' ' + (c.words || '')).toLowerCase().includes(cq)).slice(0, 3)
    for (const c of cmds) push('Commands', { kind: 'cmd', ...c })
    return out
  }, [text, local, sugg, complete])

  useEffect(() => {
    const el = list.current && list.current.querySelector('.r.sel')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const engine = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave Search', kagi: 'Kagi', ecosia: 'Ecosia' }[state.settings.searchEngine] || 'Google'

  const go = (row, mods = {}) => {
    if (!row) return
    if (row.kind === 'cmd') return invoke('cmd:run', row.id, row.arg)
    if (row.kind === 'tab' && !mods.split && mode !== 'split') { close(); return invoke('tab:select', row.id) }
    if (row.kind === 'tab' && (mods.split || mode === 'split')) { close(); return invoke('split:with', row.id) }
    const url = row.kind === 'search' ? row.q : row.url
    close()
    if (mods.little) return invoke('little:new', { url })
    if (mods.peek) return invoke('peek:open', url)
    if (mods.split || mode === 'split') return invoke('split:new', url)
    if (mode === 'edit' && data.tabId) return invoke('tab:navigate', data.tabId, url)
    return invoke('tab:new', url, { zone: data.zone, parentId: data.parentId })
  }

  const onKey = e => {
    const n = rows.length
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setSel(s => Math.min(n - 1, s + 1)) }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Tab' && complete) { e.preventDefault(); setText(complete) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      go(rows[sel], { split: e.metaKey || e.ctrlKey, little: e.shiftKey, peek: e.altKey })
    } else if (e.key === 'Backspace' || e.key === 'Delete') setNoComplete(true)
    else if (e.key.length === 1) setNoComplete(false)
  }

  let lastGroup = null
  const title = mode === 'split' ? 'Open in split view' : mode === 'edit' ? null : null
  return html`
    <div class="cmd" onMouseDown=${e => e.stopPropagation()}>
      <div class="in">
        <${Icon} name=${mode === 'split' ? 'split' : 'search'} size=${18} />
        <div class="field">
          <input ref=${input} value=${text} placeholder=${mode === 'split' ? 'Open in split view…' : 'Search or enter address…'} spellcheck=${false}
            onInput=${e => setText(e.target.value)} onKeyDown=${onKey} />
          ${complete && html`<div class="ghost"><span>${text}</span>${complete.slice(text.length)}</div>`}
        </div>
        ${mode === 'edit' && html`<button class="pill" onClick=${() => { invoke('tab:copyUrl'); close() }} title="Copy URL"><${Icon} name="link" size=${14} /></button>`}
      </div>
      ${rows.length > 0 && html`
        <div class="results" ref=${list}>
          ${rows.map((r, i) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group, html`<div class="grp">${r.group === 'Search' ? engine : r.group}</div>`) : null
            return html`${head}<${Row} r=${r} sel=${i === sel} onHover=${() => setSel(i)} onClick=${e => go(r, { split: e.metaKey, little: e.shiftKey, peek: e.altKey })} mode=${mode} />`
          })}
        </div>`}
      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>⌘</kbd><kbd>↵</kbd> split</span>
        <span><kbd>⌥</kbd><kbd>↵</kbd> peek</span>
        <span><kbd>⇧</kbd><kbd>↵</kbd> Little Crescent</span>
        <span class="r">Type <kbd>></kbd> for commands</span>
      </div>
    </div>`
}

function Row({ r, sel, onHover, onClick, mode }) {
  const right = r.kind === 'tab' ? html`<span class="k">${mode === 'split' ? 'Split with tab' : 'Switch to tab'} <kbd>↵</kbd></span>`
    : r.keys ? html`<span class="k">${r.keys.split('').filter(c => c.trim()).map(c => html`<kbd>${c}</kbd>`)}</span>`
    : sel && (r.kind === 'search' || r.kind === 'go') ? html`<span class="k"><kbd>↵</kbd></span>` : null
  let icon
  if (r.kind === 'search') icon = html`<${Icon} name="search" />`
  else if (r.kind === 'go') icon = html`<${Favicon} url=${r.url} size=${16} />`
  else if (r.kind === 'cmd') icon = html`<${Icon} name=${r.icon || 'dots'} />`
  else if (r.kind === 'history') icon = html`<${Icon} name="clock" />`
  else if (r.kind === 'bookmark') icon = html`<${Icon} name="book" />`
  else icon = html`<${Favicon} url=${r.url} src=${r.favicon} size=${16} />`
  let sub = null
  if (r.kind === 'tab') sub = [r.space, r.zone === 'pinned' ? 'pinned' : r.zone === 'favorites' ? 'pinned bar' : null].filter(Boolean).join(' · ')
  if (r.kind === 'bookmark') sub = r.path || displayUrl(r.url)
  if (r.kind === 'history') sub = displayUrl(r.url)
  if (r.kind === 'search' && sel) sub = null
  return html`
    <div class=${cls('r', sel && 'sel')} onMouseMove=${onHover} onMouseDown=${e => { e.preventDefault(); onClick(e) }}>
      <span class="ri">${icon}</span>
      <span class="rt">${r.label || r.title || displayUrl(r.url)}</span>
      ${sub && html`<span class="sub">${sub}</span>`}
      ${right}
    </div>`
}

// ================================================================ bookmarks popover

function Bookmarks({ state, layout }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({})
  const [renaming, setRenaming] = useState(null)
  const input = useRef(null)
  useLayoutEffect(() => input.current && input.current.focus(), [])
  const root = state.bookmarks
  const left = Math.max(12, Math.min((layout ? layout.content.x : 262) - 120, 400))
  const flat = useMemo(() => {
    if (!q.trim()) return null
    const out = []
    const s = q.toLowerCase()
    const rec = (list, path) => { for (const n of list) { if (n.type === 'folder') rec(n.children, [...path, n.title]); else if ((n.title + n.url).toLowerCase().includes(s)) out.push({ ...n, path: path.join(' / ') }) } }
    rec(root.children, [])
    return out.slice(0, 80)
  }, [q, root])
  const openUrl = (url, e) => { close(); invoke('bookmarks:open', url, e && e.altKey ? 'peek' : e && e.metaKey ? 'split' : 'tab') }
  const tree = (list, depth) => list.map(n => n.type === 'folder' ? html`
      <div key=${n.id}>
        <div class="r" style=${`padding-left:${9 + depth * 16}px`} onClick=${() => setOpen(o => ({ ...o, [n.id]: !o[n.id] }))} onDblClick=${() => setRenaming(n.id)}>
          <${Icon} name=${open[n.id] ? 'folderopen' : 'folder'} />
          ${renaming === n.id ? html`<${Inline} value=${n.title} onDone=${v => { if (v) invoke('bookmarks:rename', n.id, v); setRenaming(null) }} />` : html`<span class="rt">${n.title}</span>`}
          <small>${countLeaves(n)}</small>
          <button class="x" title="Delete folder" onClick=${e => { e.stopPropagation(); invoke('bookmarks:remove', n.id) }}><${Icon} name="trash" size=${13} /></button>
        </div>
        ${open[n.id] && tree(n.children, depth + 1)}
      </div>` : html`
      <div key=${n.id} class="r" style=${`padding-left:${9 + depth * 16}px`} onClick=${e => openUrl(n.url, e)} onDblClick=${e => { e.stopPropagation(); setRenaming(n.id) }} title=${n.url}>
        <${Favicon} url=${n.url} size=${16} />
        ${renaming === n.id ? html`<${Inline} value=${n.title} onDone=${v => { if (v) invoke('bookmarks:rename', n.id, v); setRenaming(null) }} />` : html`<span class="rt">${n.title}</span>`}
        <button class="x" title="Remove bookmark" onClick=${e => { e.stopPropagation(); invoke('bookmarks:remove', n.id) }}><${Icon} name="x" size=${13} /></button>
      </div>`)
  return html`
    <div class="panel bm" style=${`left:${left}px;top:44px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="search"><${Icon} name="search" size=${14} /><input ref=${input} placeholder="Search bookmarks" value=${q} onInput=${e => setQ(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && flat && flat[0]) openUrl(flat[0].url, e) }} /></div>
      <div class="scroll">
        ${flat ? (flat.length ? flat.map(n => html`
          <div class="r" key=${n.id} onClick=${e => openUrl(n.url, e)} title=${n.url}><${Favicon} url=${n.url} size=${16} /><span class="rt">${n.title}</span><small>${n.path}</small></div>`)
          : html`<div class="none">No bookmarks match “${q}”</div>`)
          : root.children.length ? tree(root.children, 0) : html`<div class="none">No bookmarks yet. Press <kbd>⌥</kbd><kbd>⌘</kbd><kbd>D</kbd> on any page.</div>`}
      </div>
      <div class="pfoot">
        <button onClick=${() => { invoke('bookmarks:addCurrent'); close() }}><${Icon} name="star" size=${14} /> Bookmark this page</button>
        <button onClick=${() => invoke('bookmarks:folder', { title: 'New Folder' }).then(id => setRenaming(id))}><${Icon} name="folder" size=${14} /> New folder</button>
      </div>
    </div>`
}

function countLeaves(n) { let c = 0; for (const x of n.children) c += x.type === 'folder' ? countLeaves(x) : 1; return c }

// ================================================================ library

function Library({ data, layout, state }) {
  const [tab, setTab] = useState(data.tab || 'archive')
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const input = useRef(null)
  const load = () => {
    if (tab === 'archive') invoke('archive:list', q).then(setItems)
    else if (tab === 'history') invoke('history:list', q).then(setItems)
    else invoke('downloads:list').then(l => setItems(q ? l.filter(d => d.filename.toLowerCase().includes(q.toLowerCase())) : l))
  }
  useEffect(() => { load() }, [tab, q, state.archiveCount])
  useEvent('downloads', () => { if (tab === 'downloads') load() }, [tab, q])
  useLayoutEffect(() => input.current && input.current.focus(), [tab])
  const spaceName = id => (state.spaces.find(s => s.id === id) || {}).name || ''
  const left = layout ? layout.content.x : 262
  const groups = []
  for (const it of items) {
    const g = dayGroup(it.closedAt || it.last || it.startedAt || 0)
    if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] })
    groups[groups.length - 1].items.push(it)
  }
  return html`
    <div class="panel lib" style=${`left:${left}px;top:8px;bottom:8px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="lib-h"><${Icon} name="archive" size=${18} /> Library</div>
      <div class="seg">
        ${['archive', 'history', 'downloads'].map(t => html`<button class=${cls(tab === t && 'on')} onClick=${() => { setTab(t); setQ('') }}>${t[0].toUpperCase() + t.slice(1)}</button>`)}
      </div>
      <div class="search"><${Icon} name="search" size=${14} /><input ref=${input} placeholder=${tab === 'archive' ? 'Search closed tabs' : tab === 'history' ? 'Search history' : 'Search downloads'} value=${q} onInput=${e => setQ(e.target.value)} /></div>
      <div class="scroll">
        ${!items.length && html`<div class="none">${q ? 'Nothing matches.' : tab === 'archive' ? 'Tabs you close show up here, so nothing is ever really gone.' : tab === 'history' ? 'No history yet.' : 'No downloads yet.'}</div>`}
        ${groups.map(g => html`
          <div class="grp">${g.g}</div>
          ${g.items.map(it => tab === 'downloads' ? html`<${DownloadRow} d=${it} key=${it.id} />` : html`
            <div class="r" key=${it.id || it.url} title=${it.url}
              onClick=${() => tab === 'archive' ? invoke('archive:restore', it.id) : (close(), invoke('tab:new', it.url))}>
              <${Favicon} url=${it.url} src=${it.favicon} size=${16} />
              <span class="rt">${it.title || displayUrl(it.url)}</span>
              <small class="when">${tab === 'archive' && it.spaceId ? spaceName(it.spaceId) : timeAgo(it.closedAt || it.last)}</small>
              <span class="restore">${tab === 'archive' ? 'Restore' : 'Open'}</span>
              <button class="x" title="Remove" onClick=${e => { e.stopPropagation(); (tab === 'archive' ? invoke('archive:remove', it.id) : invoke('history:remove', it.url)).then(load) }}><${Icon} name="x" size=${13} /></button>
            </div>`)}
        `)}
      </div>
      ${tab === 'archive' && items.length > 0 && html`<div class="pfoot"><button onClick=${() => invoke('archive:clear').then(load)}>Clear archive</button></div>`}
      ${tab === 'downloads' && items.length > 0 && html`<div class="pfoot"><button onClick=${() => invoke('downloads:clear').then(load)}>Clear list</button><button onClick=${() => invoke('cmd:run', 'settings')}>Download settings</button></div>`}
    </div>`
}

function DownloadRow({ d }) {
  const pct = d.total ? Math.round((d.received / d.total) * 100) : null
  const active = d.state === 'progressing'
  return html`
    <div class="r dl" onClick=${() => d.state === 'completed' && invoke('downloads:open', d.id)} title=${d.path}>
      <${Icon} name=${active ? 'down' : d.state === 'completed' ? 'check' : 'x'} />
      <div class="dl-main">
        <span class="rt">${d.filename}</span>
        <small>${active ? `${fmtBytes(d.received)} of ${d.total ? fmtBytes(d.total) : '?'}${d.paused ? ' · paused' : ''}` : d.state === 'completed' ? (d.exists === false ? 'Moved or deleted' : fmtBytes(d.total || d.received)) : d.state}</small>
        ${active && html`<i class="prog"><b style=${`width:${pct ?? 30}%`}></b></i>`}
      </div>
      ${active ? html`
        <button class="x vis" title=${d.paused ? 'Resume' : 'Pause'} onClick=${e => { e.stopPropagation(); invoke('downloads:pause', d.id) }}><${Icon} name=${d.paused ? 'fwd' : 'stop'} size=${13} /></button>
        <button class="x vis" title="Cancel" onClick=${e => { e.stopPropagation(); invoke('downloads:cancel', d.id) }}><${Icon} name="x" size=${13} /></button>`
        : d.state === 'completed' && d.exists !== false ? html`<button class="x" title="Show in Finder" onClick=${e => { e.stopPropagation(); invoke('downloads:reveal', d.id) }}><${Icon} name="search" size=${13} /></button>` : null}
    </div>`
}

// ================================================================ theme picker (Arc-style)

const PRESETS = [
  ['#d9c6ef', '#f3cfb4'], ['#bfe0d0', '#e8efc0'], ['#b9cdf3', '#d8c4f0'], ['#f3c0c0', '#f6e0b0'],
  ['#c4e3f0', '#c7c4f3'], ['#efd3a8', '#e6b8a9'], ['#cfd4d9'], ['#2c2a33', '#4a3f5e'],
]

function Theme({ data, state, layout }) {
  const space = state.spaces.find(s => s.id === (data.spaceId || state.activeSpaceId))
  const [theme, setTheme] = useState(() => space ? { ...space.theme, colors: [...space.theme.colors] } : null)
  const field = useRef(null)
  const raf = useRef(0)
  if (!space || !theme) return null
  const W = 288, H = 216, cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy)
  const commit = t => {
    setTheme(t)
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => invoke('space:update', space.id, { theme: t }))
  }
  const toPos = hex => {
    const [h, s] = rgbToHsl(hexToRgb(hex))
    const r = Math.min(1, s) * R * 0.92
    const a = (h - 90) * Math.PI / 180
    return [Math.max(10, Math.min(W - 10, cx + Math.cos(a) * r)), Math.max(10, Math.min(H - 10, cy + Math.sin(a) * r))]
  }
  const fromPos = (x, y) => {
    const dx = x - cx, dy = y - cy
    const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360
    const sat = Math.min(1, Math.hypot(dx, dy) / (R * 0.92))
    return rgbToHex(hslToRgb([hue, 0.12 + sat * 0.78, 0.72]))
  }
  const local = e => { const r = field.current.getBoundingClientRect(); return [Math.max(0, Math.min(W, e.clientX - r.left)), Math.max(0, Math.min(H, e.clientY - r.top))] }
  const drag = (i, e) => {
    e.preventDefault(); e.stopPropagation()
    const move = ev => { const [x, y] = local(ev); const colors = [...theme.colors]; colors[i] = fromPos(x, y); theme.colors = colors; commit({ ...theme, colors }) }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const add = e => {
    if (theme.colors.length >= 3) return
    const [x, y] = local(e)
    commit({ ...theme, colors: [...theme.colors, fromPos(x, y)] })
  }
  const remove = (i, e) => {
    e.stopPropagation()
    if (theme.colors.length <= 1) return
    commit({ ...theme, colors: theme.colors.filter((_, j) => j !== i) })
  }
  const left = (layout ? layout.content.x : 262) + 12
  return html`
    <div class="panel theme" style=${`left:${left}px;top:52px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="tt"><${Icon} name="palette" size=${16} /> ${space.name} <small>Space theme</small></div>
      <div class="cfield" ref=${field} style=${`width:${W}px;height:${H}px`} onMouseDown=${add}>
        <i class="dotgrid"></i>
        ${theme.colors.map((c, i) => {
          const [x, y] = toPos(c)
          return html`<span class="knob" style=${`left:${x}px;top:${y}px;background:${c}`} onMouseDown=${e => drag(i, e)} onDblClick=${e => remove(i, e)} title="Drag to change, double-click to remove"></span>`
        })}
      </div>
      <p class="hint">${theme.colors.length < 3 ? 'Click to add a colour · ' : ''}double-click a dot to remove it</p>
      <div class="seg3">
        ${['light', 'auto', 'dark'].map(m => html`<button class=${cls(theme.mode === m && 'on')} onClick=${() => commit({ ...theme, mode: m })}><${Icon} name=${m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'globe'} size=${13} /> ${m[0].toUpperCase() + m.slice(1)}</button>`)}
      </div>
      <label class="slider">Grain
        <input type="range" min="0" max="1" step="0.01" value=${theme.grain} onInput=${e => commit({ ...theme, grain: Number(e.target.value) })} />
      </label>
      <div class="presets">
        ${PRESETS.map(p => html`<button class=${cls('sw', p.join() === theme.colors.join() && 'on')} style=${`background:${p.length > 1 ? `linear-gradient(135deg,${p[0]},${p[1]})` : p[0]}`} onClick=${() => commit({ ...theme, colors: [...p], mode: p[0] === '#2c2a33' ? 'dark' : theme.mode === 'dark' ? 'auto' : theme.mode })}></button>`)}
      </div>
    </div>`
}

function Icons({ data, state, layout }) {
  const space = state.spaces.find(s => s.id === (data.spaceId || state.activeSpaceId))
  const [emoji, setEmoji] = useState('')
  if (!space) return null
  const set = icon => { invoke('space:update', space.id, { icon }); close() }
  const left = (layout ? layout.content.x : 262) + 12
  return html`
    <div class="panel icons" style=${`left:${left}px;bottom:46px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="tt"><${Icon} name=${space.icon} size=${16} /> Icon for ${space.name}</div>
      <div class="igrid">${ICON_NAMES.map(n => html`<button class=${cls(space.icon === n && 'on')} onClick=${() => set(n)}><${Icon} name=${n} /></button>`)}</div>
      <div class="search"><input placeholder="…or type an emoji" value=${emoji} maxLength=${4} onInput=${e => setEmoji(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter' && emoji.trim()) set('emoji:' + emoji.trim()) }} /></div>
    </div>`
}

// ================================================================ find

function Find() {
  const [text, setText] = useState('')
  const [res, setRes] = useState(null)
  const input = useRef(null)
  useLayoutEffect(() => input.current.focus(), [])
  useEvent('find:result', r => { if (r.finalUpdate !== false) setRes(r) })
  useEffect(() => { invoke('find:query', text, { forward: true }); if (!text) setRes(null) }, [text])
  return html`
    <div class="find">
      <input ref=${input} placeholder="Find on page" value=${text} onInput=${e => setText(e.target.value)} spellcheck=${false}
        onKeyDown=${e => { if (e.key === 'Enter') invoke('find:query', text, { forward: !e.shiftKey }) }} />
      <span class="count">${res && text ? `${res.matches ? res.activeMatchOrdinal : 0}/${res.matches}` : ''}</span>
      <button onClick=${() => invoke('find:query', text, { forward: false })}><${Icon} name="chev" style="transform:rotate(180deg)" /></button>
      <button onClick=${() => invoke('find:query', text, { forward: true })}><${Icon} name="chev" /></button>
      <button onClick=${close}><${Icon} name="x" /></button>
    </div>`
}

// ================================================================ peek

function Peek({ data }) {
  const [info, setInfo] = useState({ display: displayUrl(data.url) })
  useEvent('peek:info', setInfo)
  const r = data.rect
  return html`
    <div class="peek-frame" style=${`left:${r.x - 6}px;top:${r.y - 44}px;width:${r.width + 12}px;height:${r.height + 50}px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="peek-bar">
        <${Favicon} url=${info.url || data.url} src=${info.favicon} size=${15} />
        <span class="pu">${info.title || info.display || displayUrl(data.url)}</span>
        <button title="Open in split view" onClick=${() => invoke('peek:expand', true)}><${Icon} name="split" size=${15} /></button>
        <button title="Open as tab" onClick=${() => invoke('peek:expand', false)}><${Icon} name="expand" size=${15} /></button>
        <button title="Close (Esc)" onClick=${close}><${Icon} name="x" size=${15} /></button>
      </div>
    </div>`
}

// ================================================================ prompts

function Prompt({ data, layout }) {
  const [remember, setRemember] = useState(true)
  const c = layout ? layout.content : { x: 262, width: 900, y: 8 }
  return html`
    <div class="card prompt" style=${`left:${c.x + c.width / 2 - 190}px;top:${c.y + 14}px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="ph"><${Favicon} url=${'https://' + data.host} size=${18} /><b>${data.host}</b></div>
      <p>wants to <b>${data.what}</b>.</p>
      <label class="chk"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.target.checked)} /> Remember for this site</label>
      <div class="btns">
        <button onClick=${() => invoke('permission:respond', data.id, false, remember)}>Block</button>
        <button class="pri" onClick=${() => invoke('permission:respond', data.id, true, remember)}>Allow</button>
      </div>
    </div>`
}

function SavePw({ data, layout }) {
  const c = layout ? layout.content : { x: 262, width: 900, y: 8 }
  return html`
    <div class="card prompt" style=${`left:${c.x + c.width - 392}px;top:${c.y + 14}px`} onMouseDown=${e => e.stopPropagation()}>
      <div class="ph"><${Icon} name="key" size=${18} /><b>${data.update ? 'Update password?' : 'Save password?'}</b></div>
      <p>${data.username ? html`<b>${data.username}</b> on ` : ''}${data.host}</p>
      <p class="sm">Stored encrypted in your macOS Keychain and filled in next time.</p>
      <div class="btns">
        <button onClick=${() => invoke('passwords:respond', data.id, false)}>Not now</button>
        <button class="pri" onClick=${() => invoke('passwords:respond', data.id, true)}>${data.update ? 'Update' : 'Save'}</button>
      </div>
    </div>`
}

function Toast({ data }) {
  return html`<div class="otoast">${data.text}</div>`
}

function Inline({ value, onDone }) {
  const ref = useRef(null)
  const done = useRef(false)
  useLayoutEffect(() => { ref.current.focus(); ref.current.select() }, [])
  const fin = v => { if (!done.current) { done.current = true; onDone(v) } }
  return html`<input class="inline" ref=${ref} defaultValue=${value} onClick=${e => e.stopPropagation()}
    onKeyDown=${e => { e.stopPropagation(); if (e.key === 'Enter') fin(e.target.value.trim()); if (e.key === 'Escape') fin(null) }} onBlur=${e => fin(e.target.value.trim())} />`
}

const MODES = { command: Command, bookmarks: Bookmarks, library: Library, theme: Theme, icons: Icons, find: Find, peek: Peek, prompt: Prompt, savepw: SavePw, toast: Toast }

render(html`<${App} />`, document.getElementById('root'))
