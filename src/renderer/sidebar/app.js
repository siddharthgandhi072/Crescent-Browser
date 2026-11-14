import { html, render, useState, useEffect, useRef, useMemo, useCallback, useCrescent, useEvent, invoke, isMac, displayUrl, hostOf, Favicon, cls } from '../shared/ui.js'
import { Icon } from '../shared/icons.js'
import { themeVars, applyVars } from '../shared/theme.js'

const DRAG_TYPE = 'application/x-crescent-item'
let dragId = null // id being dragged inside the sidebar

function App() {
  const data = useCrescent()
  const [layout, setLayout] = useState(null)
  const [toast, setToast] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renamingSpace, setRenamingSpace] = useState(null)
  useEvent('layout', setLayout)
  useEvent('toast', t => { setToast({ ...t, key: Date.now() }) })
  useEvent('rename', id => setRenaming(id))
  useEvent('rename-space', id => setRenamingSpace(id))
  useEffect(() => { if (data && data.runtime.layout && !layout) setLayout(data.runtime.layout) }, [data])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const state = data && data.state
  const space = state && (state.spaces.find(s => s.id === state.activeSpaceId) || state.spaces[0])
  const theme = useMemo(() => space ? themeVars(space.theme, state.dark) : null, [space && JSON.stringify(space.theme), state && state.dark])
  useEffect(() => {
    if (!theme) return
    applyVars(document.documentElement, theme.vars)
    document.documentElement.classList.toggle('dark', theme.dark)
    document.documentElement.classList.toggle('mac', isMac)
  }, [theme])

  if (!data || !space) return null
  const { runtime } = data
  const s = state.settings
  const full = runtime.htmlFullscreen
  const showSidebar = !full && (!s.sidebarHidden || runtime.sidebarPeek)
  return html`
    <div class=${cls('frame', s.sidebarHidden && 'hidden-sb', runtime.sidebarPeek && 'peeking', runtime.windowFullscreen && 'winfs')} style=${`--sbw:${s.sidebarWidth}px`}>
      <div class="grain" style="opacity:var(--grain)"></div>
      ${showSidebar && html`<${Sidebar} state=${state} space=${space} runtime=${runtime} toast=${toast}
          renaming=${renaming} setRenaming=${setRenaming} renamingSpace=${renamingSpace} setRenamingSpace=${setRenamingSpace} />`}
      ${!full && s.sidebarHidden && !runtime.sidebarPeek && html`<div class="hotzone" onMouseEnter=${() => invoke('sidebar:peek', true)}></div>`}
      ${layout && !full && html`<${ContentDecor} layout=${layout} runtime=${runtime} space=${space} state=${state} />`}
    </div>`
}

// ---------------------------------------------------------------- sidebar

function Sidebar({ state, space, runtime, toast, renaming, setRenaming, renamingSpace, setRenamingSpace }) {
  const s = state.settings
  const favorites = s.pinsMode === 'global' ? state.favorites : space.favorites
  const activeId = space.activeId
  const display = runtime.display || []
  const active = activeId ? runtime.tabs[activeId] : null
  const leaveTimer = useRef(null)
  const ref = useRef(null)

  // Two-finger horizontal swipe on the sidebar switches spaces (Arc).
  const swipe = useRef({ acc: 0, lock: 0, timer: null })
  const onWheel = e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return
    const sw = swipe.current
    if (Date.now() < sw.lock) return
    sw.acc += e.deltaX
    clearTimeout(sw.timer)
    sw.timer = setTimeout(() => { sw.acc = 0 }, 180)
    if (Math.abs(sw.acc) > 70) {
      invoke('space:switch', sw.acc > 0 ? 1 : -1)
      sw.acc = 0
      sw.lock = Date.now() + 450
    }
  }

  // Space slide direction for the transition.
  const idx = state.spaces.findIndex(x => x.id === space.id)
  const prevIdx = useRef(idx)
  const dir = idx === prevIdx.current ? 0 : idx > prevIdx.current ? 1 : -1
  useEffect(() => { prevIdx.current = idx }, [idx])

  const onLeave = () => {
    if (!s.sidebarHidden) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => invoke('sidebar:peek', false), 250)
  }
  const onEnter = () => clearTimeout(leaveTimer.current)

  return html`
    <aside class="sidebar" ref=${ref} onWheel=${onWheel} onMouseLeave=${onLeave} onMouseEnter=${onEnter}>
      <${TopBar} active=${active} activeId=${activeId} hidden=${s.sidebarHidden} />
      <${UrlPill} active=${active} activeId=${activeId} />
      <${Extensions} />
      <${FavGrid} items=${favorites} runtime=${runtime} activeId=${activeId} display=${display} spaceId=${space.id} />
      <div class="space-scroll">
        <div class=${cls('space-body', dir > 0 && 'from-right', dir < 0 && 'from-left')} key=${space.id}>
          <${SpaceHeader} space=${space} renaming=${renamingSpace === space.id} done=${() => setRenamingSpace(null)} />
          <${PinnedSection} space=${space} runtime=${runtime} activeId=${activeId} display=${display} renaming=${renaming} setRenaming=${setRenaming} />
          <${TodaySection} space=${space} runtime=${runtime} activeId=${activeId} display=${display} renaming=${renaming} setRenaming=${setRenaming} />
        </div>
      </div>
      ${s.showHoverUrl && runtime.hoverUrl && html`<div class="hover-url">${runtime.hoverUrl}</div>`}
      ${toast && html`<${Toast} toast=${toast} key=${toast.key} />`}
      <${BottomBar} state=${state} space=${space} renamingSpace=${renamingSpace} />
      ${!s.sidebarHidden && html`<${ResizeHandle} width=${s.sidebarWidth} />`}
    </aside>`
}

function TopBar({ active, activeId, hidden }) {
  const loading = active && active.loading
  return html`
    <div class="topbar">
      <div class="drag"></div>
      <div class="tools">
        <button class="ib" title=${hidden ? 'Keep sidebar open (⌘S)' : 'Hide sidebar (⌘S)'} onClick=${() => invoke('sidebar:toggle')}><${Icon} name="sidebar" /></button>
        <button class="ib" title="Back (⌘[)" disabled=${!active || !active.canGoBack} onClick=${() => invoke('tab:back', activeId)}><${Icon} name="back" /></button>
        <button class="ib" title="Forward (⌘])" disabled=${!active || !active.canGoForward} onClick=${() => invoke('tab:forward', activeId)}><${Icon} name="fwd" /></button>
        <button class="ib" title=${loading ? 'Stop' : 'Reload (⌘R)'} disabled=${!active} onClick=${() => invoke(loading ? 'tab:stop' : 'tab:reload', activeId)}><${Icon} name=${loading ? 'stop' : 'reload'} /></button>
        <button class="ib" title="Bookmarks (⌥⌘B)" onClick=${() => invoke('overlay:open', 'bookmarks', {})}><${Icon} name="book" /></button>
      </div>
    </div>`
}

function UrlPill({ active, activeId }) {
  const url = active && active.url
  const shown = displayUrl(url)
  const host = hostOf(url)
  const rest = shown.slice(host.length)
  const secure = url && url.startsWith('https:')
  return html`
    <div class=${cls('url', active && active.loading && 'loading')} onClick=${() => invoke('overlay:open', 'command', active ? { mode: 'edit' } : { mode: 'new' })} title=${url || ''}>
      ${url && !url.startsWith('crescent:') ? html`
        <span class="lock">${secure ? html`<${Icon} name="lock" size=${12} />` : html`<${Icon} name="globe" size=${12} />`}</span>
        <span class="u"><b>${host}</b>${rest}</span>
        <button class="copy" title="Copy URL (⇧⌘C)" onClick=${e => { e.stopPropagation(); invoke('tab:copyUrl') }}><${Icon} name="link" size=${14} /></button>
      ` : html`<span class="u placeholder"><${Icon} name="search" size=${13} /> Search or enter address</span>`}
      <i class="bar"></i>
    </div>`
}

function Extensions() {
  const [count, setCount] = useState(0)
  const load = () => invoke('ext:list').then(l => setCount(Array.isArray(l) ? l.filter(e => e.enabled).length : 0))
  useEffect(() => { load() }, [])
  useEvent('extensions', load)
  if (!count) return null
  return html`<div class="ext-row"><browser-action-list partition="persist:browse" alignment="bottom left"></browser-action-list></div>`
}

// ---------------------------------------------------------------- pinned bar (favicon grid)

function FavGrid({ items, runtime, activeId, display, spaceId }) {
  const [drop, setDrop] = useState(null)
  const onDragOver = (e, i) => {
    if (!acceptsDrag(e)) return
    e.preventDefault(); e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setDrop(i === items.length ? items.length : e.clientX < r.left + r.width / 2 ? i : i + 1)
  }
  const onDrop = (e, index) => {
    e.preventDefault(); e.stopPropagation()
    const target = { zone: 'favorites', index: drop ?? index, spaceId }
    setDrop(null)
    handleDrop(e, target)
  }
  return html`
    <div class=${cls('grid', !items.length && 'empty')} onDragOver=${e => onDragOver(e, items.length)} onDragLeave=${() => setDrop(null)} onDrop=${e => onDrop(e, items.length)}>
      ${items.map((t, i) => {
        const rt = runtime.tabs[t.id] || {}
        const on = display.includes(t.id)
        return html`
          <div key=${t.id} class=${cls('fav', on && 'on', rt.live && 'live', drop === i && 'drop-before', drop === i + 1 && i === items.length - 1 && 'drop-after')}
            title=${(rt.title || t.title || t.url)}
            draggable=${true} onDragStart=${e => startDrag(e, t)} onDragEnd=${endDrag}
            onDragOver=${e => onDragOver(e, i)} onDrop=${e => onDrop(e, i)}
            onMouseDown=${e => { if (e.button === 0) invoke('tab:select', t.id) }}
            onAuxClick=${e => { if (e.button === 1) invoke('tab:close', t.id) }}
            onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', t.id) }}>
            <${Favicon} url=${rt.url || t.url} src=${rt.favicon || t.favicon} size=${18} radius=${5} />
            ${rt.audible && html`<span class="fav-audio" onMouseDown=${e => { e.stopPropagation(); invoke('tab:mute', t.id) }}><${Icon} name=${rt.muted ? 'mute' : 'speaker'} size=${10} /></span>`}
          </div>`
      })}
      ${!items.length && html`<div class="grid-hint">Drag tabs here to keep them in every space</div>`}
    </div>`
}

// ---------------------------------------------------------------- space header / sections

function SpaceHeader({ space, renaming, done }) {
  return html`
    <div class="space-name" onContextMenu=${e => { e.preventDefault(); invoke('space:menu', space.id) }} onDblClick=${() => invoke('space:menu', space.id)}>
      <${Icon} name=${space.icon} size=${14} />
      ${renaming ? html`<${InlineInput} value=${space.name} onDone=${v => { if (v) invoke('space:update', space.id, { name: v }); done() }} />` : html`<span class="t">${space.name}</span>`}
      <span class="hdr-actions">
        <button class="ib sm" title="New folder" onClick=${() => invoke('folder:create', {})}><${Icon} name="folder" size=${14} /></button>
        <button class="ib sm" title="Edit theme (⇧⌘E)" onClick=${() => invoke('space:theme')}><${Icon} name="palette" size=${14} /></button>
      </span>
    </div>`
}

function PinnedSection({ space, runtime, activeId, display, renaming, setRenaming }) {
  const [over, setOver] = useState(false)
  return html`
    <div class=${cls('section pinned', over && 'over', !space.pinned.length && 'empty')}
      onDragOver=${e => { if (acceptsDrag(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); handleDrop(e, { zone: 'pinned', index: space.pinned.length }) }}>
      <${ItemList} list=${space.pinned} zone="pinned" parentId=${null} depth=${0} runtime=${runtime} activeId=${activeId} display=${display} renaming=${renaming} setRenaming=${setRenaming} />
      ${!space.pinned.length && html`<div class="pin-hint">Pinned tabs live here</div>`}
    </div>`
}

function TodaySection({ space, runtime, activeId, display, renaming, setRenaming }) {
  const [over, setOver] = useState(false)
  return html`
    <div class="divider">
      <hr />
      ${space.today.length > 0 && html`<button class="clear" title="Archive all unpinned tabs (⇧⌘⌫)" onClick=${() => invoke('today:clear')}>↓ Clear</button>`}
    </div>
    <div class="row new" onClick=${() => invoke('overlay:open', 'command', { mode: 'new' })}>
      <span class="ico"><${Icon} name="plus" /></span><span class="t">New Tab</span>
    </div>
    <div class=${cls('section today', over && 'over')}
      onDragOver=${e => { if (acceptsDrag(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); handleDrop(e, { zone: 'today', index: space.today.length }) }}>
      <${ItemList} list=${space.today} zone="today" parentId=${null} depth=${0} runtime=${runtime} activeId=${activeId} display=${display} renaming=${renaming} setRenaming=${setRenaming} />
    </div>`
}

function ItemList(p) {
  return p.list.map((item, i) => {
    const common = { ...p, item, index: i, key: item.id }
    if (item.type === 'folder') return html`<${FolderRow} ...${common} />`
    if (item.type === 'split') return html`<${SplitRow} ...${common} />`
    return html`<${TabRow} ...${common} />`
  })
}

// Drop position inside a row: before / after / into (folders).
function useRowDrop(item, zone, parentId, index, isFolder) {
  const [pos, setPos] = useState(null)
  const onDragOver = e => {
    if (!acceptsDrag(e) || dragId === item.id) return
    e.preventDefault(); e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    setPos(isFolder ? (y < 0.28 ? 'before' : y > 0.72 && !item.open ? 'after' : 'into') : y < 0.5 ? 'before' : 'after')
  }
  const onDrop = e => {
    e.preventDefault(); e.stopPropagation()
    const target = pos === 'into' ? { zone, parentId: item.id, index: 0 } : { zone, parentId, index: pos === 'after' ? index + 1 : index }
    setPos(null)
    handleDrop(e, target)
  }
  return { pos, bind: { onDragOver, onDragLeave: () => setPos(null), onDrop } }
}

function TabRow({ item, zone, parentId, index, depth, runtime, activeId, display, renaming, setRenaming }) {
  const rt = runtime.tabs[item.id] || {}
  const on = display.includes(item.id)
  const focused = activeId === item.id && display.length > 1
  const title = item.customTitle ? item.title : (rt.live && rt.title) || item.title || displayUrl(item.url)
  const away = zone !== 'today' && rt.live && rt.url && stripUrl(rt.url) !== stripUrl(item.url)
  const { pos, bind } = useRowDrop(item, zone, parentId, index, false)
  return html`
    <div class=${cls('row tab', on && 'on', focused && 'focused', rt.live && 'live', zone !== 'today' && !rt.live && 'asleep', pos && 'drop-' + pos)}
      style=${`padding-left:${10 + depth * 16}px`}
      draggable=${renaming !== item.id} onDragStart=${e => startDrag(e, { ...item, url: rt.url || item.url })} onDragEnd=${endDrag} ...${bind}
      onMouseDown=${e => { if (e.button === 0 && !e.target.closest('button')) invoke('tab:select', item.id) }}
      onAuxClick=${e => { if (e.button === 1) invoke('tab:close', item.id) }}
      onDblClick=${e => { if (!e.target.closest('button')) setRenaming(item.id) }}
      onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', item.id) }}
      title=${rt.url || item.url}>
      <span class="ico">${rt.loading && on ? html`<span class="spin"></span>` : html`<${Favicon} url=${rt.url || item.url} src=${rt.favicon || item.favicon} />`}</span>
      ${renaming === item.id
        ? html`<${InlineInput} value=${title} onDone=${v => { if (v && v !== title) invoke('tab:rename', item.id, v); setRenaming(null) }} />`
        : html`<span class="t">${away && html`<span class="slash">/</span>`}${title}</span>`}
      ${rt.audible && html`<button class="mini" title=${rt.muted ? 'Unmute' : 'Mute'} onClick=${() => invoke('tab:mute', item.id)}><${Icon} name=${rt.muted ? 'mute' : 'speaker'} size=${13} /></button>`}
      ${away && html`<button class="mini hov" title="Back to pinned page" onClick=${() => invoke('tab:resetPinned', item.id)}><${Icon} name="undo" size=${13} /></button>`}
      ${(zone === 'today' || rt.live) && html`<button class="mini x hov" title=${zone === 'today' ? 'Close tab (⌘W)' : 'Close (stays pinned)'} onClick=${() => invoke('tab:close', item.id)}><${Icon} name=${zone === 'today' ? 'x' : 'stop'} size=${13} /></button>`}
    </div>`
}

function FolderRow({ item, zone, parentId, index, depth, runtime, activeId, display, renaming, setRenaming }) {
  const { pos, bind } = useRowDrop(item, zone, parentId, index, true)
  const hasActive = !item.open && containsId(item, display)
  return html`
    <div class=${cls('row folder', pos && 'drop-' + pos, hasActive && 'has-active')} style=${`padding-left:${10 + depth * 16}px`}
      draggable=${renaming !== item.id} onDragStart=${e => startDrag(e, item)} onDragEnd=${endDrag} ...${bind}
      onClick=${() => invoke('folder:toggle', item.id)}
      onDblClick=${() => setRenaming(item.id)}
      onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', item.id) }}>
      <span class="ico fo"><${Icon} name=${item.open ? 'folderopen' : 'folder'} /></span>
      ${renaming === item.id
        ? html`<${InlineInput} value=${item.title} onDone=${v => { if (v) invoke('folder:rename', item.id, v); setRenaming(null) }} />`
        : html`<span class="t">${item.title}</span>`}
      <span class="count">${item.children.length || ''}</span>
    </div>
    ${item.open && html`<${ItemList} list=${item.children} zone=${zone} parentId=${item.id} depth=${depth + 1} runtime=${runtime} activeId=${activeId} display=${display} renaming=${renaming} setRenaming=${setRenaming} />`}
    ${item.open && !item.children.length && html`<div class="row empty-folder" style=${`padding-left:${34 + depth * 16}px`}>Empty</div>`}`
}

function SplitRow({ item, zone, parentId, index, depth, runtime, display }) {
  const { pos, bind } = useRowDrop(item, zone, parentId, index, false)
  const on = item.children.some(c => display.includes(c.id))
  return html`
    <div class=${cls('row split', on && 'on', pos && 'drop-' + pos)} style=${`padding-left:${10 + depth * 16}px`}
      draggable=${true} onDragStart=${e => startDrag(e, item)} onDragEnd=${endDrag} ...${bind}
      onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', item.id) }}>
      ${item.children.map((c, i) => {
        const rt = runtime.tabs[c.id] || {}
        return html`
          ${i > 0 && html`<span class="split-sep"></span>`}
          <span class=${cls('split-part', display.includes(c.id) && 'cur')} onMouseDown=${e => { if (e.button === 0) invoke('tab:select', c.id) }} title=${rt.title || c.title}>
            <${Favicon} url=${rt.url || c.url} src=${rt.favicon || c.favicon} size=${15} />
            <span class="t">${rt.title || c.title || displayUrl(c.url)}</span>
          </span>`
      })}
      <button class="mini x hov" title="Close split" onClick=${() => invoke('tab:close', item.children[0].id)}><${Icon} name="x" size=${13} /></button>
    </div>`
}

// ---------------------------------------------------------------- bottom bar

function BottomBar({ state, space }) {
  const [dl, setDl] = useState({ active: 0, progress: 0 })
  useEvent('downloads', setDl)
  const spaces = state.spaces
  const many = spaces.length > 6
  return html`
    <div class="bottom">
      <button class=${cls('ib lib', dl.active && 'dl')} title="Library (⌘Y)" onClick=${() => invoke('overlay:open', 'library', { tab: dl.active ? 'downloads' : 'archive' })}>
        <${Icon} name=${dl.active ? 'down' : 'archive'} />
        ${dl.active > 0 && html`<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" pathLength="100" style=${`stroke-dasharray:${Math.max(4, Math.round((dl.progress < 0 ? 0.3 : dl.progress) * 100))} 100`} /></svg>`}
      </button>
      <div class="spaces">
        ${spaces.map((sp, i) => html`
          <button key=${sp.id} class=${cls('sp', sp.id === space.id && 'on', many && 'dot')} title=${`${sp.name}  ⌃⌥${i + 1}`}
            onClick=${() => invoke('space:switch', sp.id)}
            onContextMenu=${e => { e.preventDefault(); invoke('space:menu', sp.id) }}
            draggable=${true}
            onDragStart=${e => { e.dataTransfer.setData('application/x-crescent-space', sp.id) }}
            onDragOver=${e => { if (e.dataTransfer.types.includes('application/x-crescent-space')) e.preventDefault(); else if (acceptsDrag(e)) { e.preventDefault(); invoke('space:switch', sp.id) } }}
            onDrop=${e => {
              const sid = e.dataTransfer.getData('application/x-crescent-space')
              if (sid) { e.preventDefault(); invoke('space:move', sid, i) }
            }}>
            ${many ? html`<i></i>` : html`<${Icon} name=${sp.icon} size=${14} />`}
          </button>`)}
      </div>
      <button class="ib" title="New space (⇧⌘S)" onClick=${() => invoke('space:create')}><${Icon} name="plus" /></button>
    </div>`
}

function Toast({ toast }) {
  return html`<div class="toast">${toast.text}${toast.action && html`<button onClick=${() => invoke(toast.action, toast.id)}>${toast.actionLabel || 'Open'}</button>`}</div>`
}

function ResizeHandle({ width }) {
  const onDown = e => {
    e.preventDefault()
    const startX = e.clientX
    let raf = 0
    const move = ev => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => invoke('sidebar:width', width + ev.clientX - startX))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); invoke('sidebar:widthDone') }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return html`<div class="resize" onMouseDown=${onDown} onDblClick=${() => invoke('sidebar:width', 262)}></div>`
}

// ---------------------------------------------------------------- content area (gaps around pages)

function ContentDecor({ layout, runtime, space, state }) {
  const rects = layout.rects || []
  const c = layout.content
  if (!rects.length) return html`<${EmptyState} c=${c} space=${space} state=${state} />`
  if (rects.length < 2) return null
  const focusRect = rects.find(r => r.id === space.activeId)
  return html`
    ${focusRect && html`<div class="focus-ring" style=${`left:${focusRect.x - 2}px;top:${focusRect.y - 2}px;width:${focusRect.width + 4}px;height:${focusRect.height + 4}px`}></div>`}
    ${rects.slice(0, -1).map((r, i) => html`<${SplitHandle} key=${i} i=${i} rects=${rects} c=${c} />`)}`
}

function SplitHandle({ i, rects, c }) {
  const r = rects[i]
  const onDown = e => {
    e.preventDefault()
    const widths = rects.map(x => x.width)
    const total = widths.reduce((a, b) => a + b, 0)
    const startX = e.clientX
    let raf = 0
    const move = ev => {
      const dx = ev.clientX - startX
      const w = [...widths]
      const min = 220
      const a = Math.max(min, Math.min(widths[i] + widths[i + 1] - min, widths[i] + dx))
      w[i + 1] = widths[i] + widths[i + 1] - a
      w[i] = a
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => invoke('split:sizes', w.map(x => x / total)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return html`<div class="split-handle" style=${`left:${r.x + r.width}px;top:${c.y}px;height:${c.height}px`} onMouseDown=${onDown} onDblClick=${() => invoke('split:sizes', rects.map(() => 1 / rects.length))}><i></i></div>`
}

function EmptyState({ c, space, state }) {
  return html`
    <div class="empty-state" style=${`left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px`}>
      <div class="es-inner">
        <div class="es-icon"><${Icon} name=${space.icon} size=${22} /></div>
        <h1>${space.name}</h1>
        <p>Nothing open here yet.</p>
        <div class="es-keys">
          <button onClick=${() => invoke('overlay:open', 'command', { mode: 'new' })}><kbd>⌘</kbd><kbd>T</kbd><span>Open something</span></button>
          <button onClick=${() => invoke('overlay:open', 'library', { tab: 'archive' })}><kbd>⌘</kbd><kbd>Y</kbd><span>Library</span></button>
          <button onClick=${() => invoke('space:switch', 1)}><kbd>⌃</kbd><kbd>⌥</kbd><kbd>→</kbd><span>Next space</span></button>
        </div>
      </div>
    </div>`
}

// ---------------------------------------------------------------- helpers

function InlineInput({ value, onDone }) {
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => { const el = ref.current; el.focus(); el.select() }, [])
  const finish = v => { if (done.current) return; done.current = true; onDone(v) }
  return html`<input class="inline" ref=${ref} defaultValue=${value}
    onKeyDown=${e => { if (e.key === 'Enter') finish(e.target.value.trim()); if (e.key === 'Escape') finish(null); e.stopPropagation() }}
    onBlur=${e => finish(e.target.value.trim())} onMouseDown=${e => e.stopPropagation()} />`
}

function startDrag(e, item) {
  dragId = item.id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(DRAG_TYPE, item.id)
  if (item.url) { e.dataTransfer.setData('text/uri-list', item.url); e.dataTransfer.setData('text/plain', item.url) }
  document.body.classList.add('dragging')
}
function endDrag() { dragId = null; document.body.classList.remove('dragging') }

function acceptsDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types
  return t && (t.includes(DRAG_TYPE) || t.includes('text/uri-list'))
}

function handleDrop(e, target) {
  const id = e.dataTransfer.getData(DRAG_TYPE)
  endDrag()
  if (id) return invoke('item:move', id, target)
  const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#'))
  if (url) invoke('item:dropUrl', url.trim(), target)
}

function containsId(folder, ids) {
  for (const c of folder.children) {
    if (ids.includes(c.id)) return true
    if (c.children && containsId(c, ids)) return true
  }
  return false
}

function stripUrl(u) {
  try { const x = new URL(u); return x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') } catch { return u }
}

render(html`<${App} />`, document.getElementById('root'))
