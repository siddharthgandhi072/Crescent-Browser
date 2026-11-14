import { html, render, useState, useEffect, useRef, useMemo, useCrescent, useEvent, invoke, isMac, displayUrl, hostOf, Favicon, cls, timeAgo, dayGroup, fmtBytes } from '../shared/ui.js'
import { Icon, ICON_NAMES } from '../shared/icons.js'
import { themeVars, applyVars, appearanceVars } from '../shared/theme.js'

const DRAG_TYPE = 'application/x-crescent-item'
let dragId = null // id being dragged inside the sidebar

function App() {
  const data = useCrescent()
  const [layout, setLayout] = useState(null)
  const [toast, setToast] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [renamingSpace, setRenamingSpace] = useState(null)
  const [library, setLibrary] = useState(null)
  useEvent('layout', setLayout)
  useEvent('toast', t => setToast({ ...t, key: Date.now() }))
  useEvent('rename', id => setRenaming(id))
  useEvent('rename-space', id => setRenamingSpace(id))
  useEvent('library', tab => setLibrary(cur => (cur === tab ? cur : tab)))
  useEffect(() => { if (data && data.runtime.layout && !layout) setLayout(data.runtime.layout) }, [data])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  const state = data && data.state
  const space = state && (state.spaces.find(s => s.id === state.activeSpaceId) || state.spaces[0])
  const s = state && state.settings
  const theme = useMemo(() => space ? themeVars(space.theme, state.dark, { glass: s.glass }) : null, [space && JSON.stringify(space.theme), state && state.dark, s && s.glass])
  useEffect(() => {
    if (!theme) return
    const root = document.documentElement
    applyVars(root, theme.vars)
    applyVars(root, appearanceVars(s))
    root.classList.toggle('dark', theme.dark)
    root.classList.toggle('mac', isMac)
    root.classList.toggle('no-anim', s.animations === false)
    root.classList.toggle('close-always', s.showCloseButtons === 'always')
  }, [theme, s && s.uiFont, s && s.density, s && s.gridColumns, s && s.animations, s && s.showCloseButtons, s && s.pageRadius])

  if (!data || !space) return null
  const { runtime } = data
  const full = runtime.htmlFullscreen
  const showSidebar = !full && (!s.sidebarHidden || runtime.sidebarPeek)
  const activeItem = space.activeId ? findItem(space, state, space.activeId) : null
  return html`
    <div class=${cls('frame', s.sidebarHidden && 'hidden-sb', runtime.sidebarPeek && 'peeking', runtime.windowFullscreen && 'winfs', space.private && 'private')} style=${`--sbw:${s.sidebarWidth}px`}>
      <div class="grain" style="opacity:var(--grain)"></div>
      ${showSidebar && html`<${Sidebar} state=${state} space=${space} runtime=${runtime} toast=${toast} library=${library} setLibrary=${setLibrary}
          renaming=${renaming} setRenaming=${setRenaming} renamingSpace=${renamingSpace} setRenamingSpace=${setRenamingSpace} />`}
      ${!full && s.sidebarHidden && !runtime.sidebarPeek && html`<div class="hotzone" onMouseEnter=${() => invoke('sidebar:peek', true)}></div>`}
      ${layout && !full && html`<${ContentDecor} layout=${layout} runtime=${runtime} space=${space} state=${state} note=${activeItem && activeItem.type === 'note' ? activeItem : null} />`}
    </div>`
}

function findItem(space, state, id) {
  const lists = [space.pinned, space.today, state.favorites, space.favorites]
  const rec = list => { for (const it of list) { if (it.id === id) return it; if (it.children) { const r = rec(it.children); if (r) return r } } return null }
  for (const l of lists) { const r = rec(l); if (r) return r }
  return null
}

// ---------------------------------------------------------------- sidebar

function Sidebar({ state, space, runtime, toast, library, setLibrary, renaming, setRenaming, renamingSpace, setRenamingSpace }) {
  const s = state.settings
  const favorites = s.pinsMode === 'global' ? state.favorites : space.favorites
  const activeId = space.activeId
  const display = runtime.display || []
  const active = activeId ? runtime.tabs[activeId] : null
  const leaveTimer = useRef(null)
  const [preview, setPreview] = useState(null)

  // Two-finger horizontal swipe on the sidebar switches spaces (Arc).
  const swipe = useRef({ acc: 0, lock: 0, timer: null })
  const onWheel = e => {
    if (library || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return
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

  const idx = state.spaces.findIndex(x => x.id === space.id)
  const prevIdx = useRef(idx)
  const dir = idx === prevIdx.current ? 0 : idx > prevIdx.current ? 1 : -1
  useEffect(() => { prevIdx.current = idx }, [idx])

  const onLeave = () => {
    setPreview(null)
    if (!s.sidebarHidden) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => invoke('sidebar:peek', false), 280)
  }
  const onEnter = () => clearTimeout(leaveTimer.current)
  const rowProps = { runtime, activeId, display, renaming, setRenaming, setPreview, settings: s }

  return html`
    <aside class="sidebar" onWheel=${onWheel} onMouseLeave=${onLeave} onMouseEnter=${onEnter}>
      <${TopBar} active=${active} activeId=${activeId} hidden=${s.sidebarHidden} focus=${state.focus} />
      ${library ? html`<${Library} tab=${library} setTab=${setLibrary} state=${state} />` : html`
        <${UrlPill} active=${active} activeId=${activeId} isNote=${!!(activeId && !active && findItem(space, state, activeId)?.type === 'note')} />
        <${Extensions} />
        <${FavGrid} items=${favorites} runtime=${runtime} activeId=${activeId} display=${display} spaceId=${space.id} setPreview=${setPreview} />
        <div class="space-scroll">
          <div class=${cls('space-body', dir > 0 && 'from-right', dir < 0 && 'from-left')} key=${space.id}>
            <${SpaceHeader} space=${space} renaming=${renamingSpace === space.id} setRenaming=${v => setRenamingSpace(v ? space.id : null)} />
            <${PinnedSection} space=${space} ...${rowProps} />
            <${TodaySection} space=${space} ...${rowProps} />
          </div>
        </div>
        ${preview && html`<${Preview} p=${preview} />`}
      `}
      ${s.showHoverUrl && runtime.hoverUrl && !library && html`<div class="hover-url">${runtime.hoverUrl}</div>`}
      ${s.mediaControls !== false && html`<${MiniPlayer} runtime=${runtime} display=${display} state=${state} />`}
      <${UpdatePill} />
      ${toast && html`<${Toast} toast=${toast} key=${toast.key} />`}
      <${BottomBar} state=${state} space=${space} library=${library} setLibrary=${setLibrary} />
      ${!s.sidebarHidden && html`<${ResizeHandle} width=${s.sidebarWidth} />`}
    </aside>`
}

function TopBar({ active, activeId, hidden, focus }) {
  const loading = active && active.loading
  return html`
    <div class="topbar">
      <div class="drag"></div>
      <div class="tools">
        <button class="ib" title=${hidden ? 'Keep sidebar open' : 'Hide sidebar'} onClick=${() => invoke('sidebar:toggle')}><${Icon} name="sidebar" /></button>
        <button class="ib" title="Back" disabled=${!active || !active.canGoBack} onClick=${() => invoke('tab:back', activeId)}><${Icon} name="back" /></button>
        <button class="ib" title="Forward" disabled=${!active || !active.canGoForward} onClick=${() => invoke('tab:forward', activeId)}><${Icon} name="fwd" /></button>
        <button class="ib" title=${loading ? 'Stop' : 'Reload'} disabled=${!active} onClick=${() => invoke(loading ? 'tab:stop' : 'tab:reload', activeId)}><${Icon} name=${loading ? 'stop' : 'reload'} /></button>
        <button class="ib" title="Bookmarks" onClick=${() => invoke('overlay:open', 'bookmarks', {})}><${Icon} name="book" /></button>
        <button class=${cls('ib', focus && 'on-focus')} title="Focus mode" onClick=${() => invoke('focus:open')}><${Icon} name="target" /></button>
      </div>
    </div>`
}

function UrlPill({ active, activeId, isNote }) {
  const url = active && active.url
  const shown = displayUrl(url)
  const host = hostOf(url)
  const rest = shown.slice(host.length)
  const secure = url && url.startsWith('https:')
  if (isNote) return html`<div class="url note-pill"><span class="lock"><${Icon} name="pen" size=${12} /></span><span class="u"><b>Note</b></span></div>`
  return html`
    <div class=${cls('url', active && active.loading && 'loading')} onClick=${() => invoke('overlay:open', 'command', active ? { mode: 'edit' } : { mode: 'new' })} title=${url || ''}>
      ${url && !url.startsWith('crescent:') ? html`
        <span class="lock">${secure ? html`<${Icon} name="lock" size=${12} />` : html`<${Icon} name="globe" size=${12} />`}</span>
        <span class="u"><b>${host}</b>${rest}</span>
        <button class="copy" title="Copy link" onClick=${e => { e.stopPropagation(); invoke('tab:copyUrl') }}><${Icon} name="link" size=${14} /></button>
      ` : html`<span class="u placeholder"><${Icon} name="search" size=${13} /> Search or type a URL</span>`}
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

// ---------------------------------------------------------------- hover previews

function usePreview(id, setPreview, enabled) {
  const timer = useRef(null)
  const enter = e => {
    if (!enabled || dragId) return
    const rect = e.currentTarget.getBoundingClientRect()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      invoke('tab:preview', id).then(img => setPreview(p => ({ id, img, top: rect.bottom + 6, title: e.target.closest('[title]')?.getAttribute('data-title') || '', url: e.target.closest('[title]')?.getAttribute('title') || '' })))
    }, 650)
  }
  const leave = () => { clearTimeout(timer.current); setPreview(p => (p && p.id === id ? null : p)) }
  useEffect(() => () => clearTimeout(timer.current), [])
  return { onMouseEnter: enter, onMouseLeave: leave }
}

function Preview({ p }) {
  const top = Math.min(p.top, window.innerHeight - (p.img ? 220 : 80))
  return html`
    <div class="preview" style=${`top:${top}px`}>
      ${p.img && html`<img src=${p.img} />`}
      <div class="pv-t">${p.title}</div>
      <div class="pv-u">${displayUrl(p.url)}</div>
    </div>`
}

// ---------------------------------------------------------------- pinned bar (favicon grid)

function FavGrid({ items, runtime, activeId, display, spaceId, setPreview }) {
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
      ${items.map((t, i) => html`<${FavTile} key=${t.id} t=${t} i=${i} n=${items.length} rt=${runtime.tabs[t.id] || {}} on=${display.includes(t.id)} drop=${drop} onDragOver=${onDragOver} onDrop=${onDrop} setPreview=${setPreview} />`)}
      ${!items.length && html`<div class="grid-hint">Drop tabs here to keep them in every space</div>`}
    </div>`
}

function FavTile({ t, i, n, rt, on, drop, onDragOver, onDrop, setPreview }) {
  const pv = usePreview(t.id, setPreview, true)
  return html`
    <div class=${cls('fav', on && 'on', rt.live && 'live', drop === i && 'drop-before', drop === i + 1 && i === n - 1 && 'drop-after')}
      title=${rt.url || t.url} data-title=${rt.title || t.title}
      draggable=${true} onDragStart=${e => { setPreview(null); startDrag(e, t) }} onDragEnd=${endDrag}
      onDragOver=${e => onDragOver(e, i)} onDrop=${e => onDrop(e, i)} ...${pv}
      onMouseDown=${e => { if (e.button === 0) invoke('tab:select', t.id) }}
      onAuxClick=${e => { if (e.button === 1) invoke('tab:close', t.id) }}
      onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', t.id) }}>
      <${Favicon} url=${rt.url || t.url} src=${rt.favicon || t.favicon} size=${18} radius=${5} />
      ${rt.audible && html`<span class="fav-audio" onMouseDown=${e => { e.stopPropagation(); invoke('tab:mute', t.id) }}><${Icon} name=${rt.muted ? 'mute' : 'speaker'} size=${10} /></span>`}
    </div>`
}

// ---------------------------------------------------------------- space header

function SpaceHeader({ space, renaming, setRenaming }) {
  const [icons, setIcons] = useState(false)
  return html`
    <div class="space-name" onContextMenu=${e => { e.preventDefault(); invoke('space:menu', space.id) }}>
      <button class="sp-icon" title="Change icon" onClick=${() => setIcons(v => !v)}><${Icon} name=${space.icon} size=${14} /></button>
      ${renaming
        ? html`<${InlineInput} value=${space.name} onDone=${v => { if (v) invoke('space:update', space.id, { name: v }); setRenaming(false) }} />`
        : html`<span class="t" title="Click to rename" onClick=${() => !space.private && setRenaming(true)}>${space.name}</span>`}
      <span class="hdr-actions">
        ${space.private
          ? html`<button class="end-private" onClick=${() => invoke('space:endPrivate')}>End</button>`
          : html`
            <button class="ib sm" title="New folder" onClick=${() => invoke('folder:create', {})}><${Icon} name="folder" size=${14} /></button>
            <button class="ib sm" title="Space colours" onClick=${() => invoke('space:theme')}><${Icon} name="palette" size=${14} /></button>`}
      </span>
    </div>
    ${icons && html`<${IconPicker} space=${space} close=${() => setIcons(false)} />`}`
}

function IconPicker({ space, close }) {
  const [emoji, setEmoji] = useState('')
  const set = icon => { invoke('space:update', space.id, { icon }); close() }
  return html`
    <div class="icon-picker">
      <div class="ip-grid">${ICON_NAMES.map(n => html`<button class=${cls(space.icon === n && 'on')} onClick=${() => set(n)} title=${n}><${Icon} name=${n} size=${15} /></button>`)}</div>
      <input placeholder="or an emoji…" value=${emoji} maxLength=${4} onInput=${e => setEmoji(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && emoji.trim()) set('emoji:' + emoji.trim()); if (e.key === 'Escape') close() }} />
    </div>`
}

// ---------------------------------------------------------------- sections

function PinnedSection(p) {
  const { space } = p
  const [over, setOver] = useState(false)
  return html`
    <div class=${cls('section pinned', over && 'over', !space.pinned.length && 'empty')}
      onDragOver=${e => { if (acceptsDrag(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); handleDrop(e, { zone: 'pinned', index: space.pinned.length }) }}>
      <${ItemList} list=${space.pinned} zone="pinned" parentId=${null} depth=${0} ...${p} />
      ${!space.pinned.length && html`<div class="pin-hint">Drop here to pin</div>`}
    </div>`
}

function TodaySection(p) {
  const { space } = p
  const [over, setOver] = useState(false)
  const hasTabs = space.today.some(i => i.type !== 'note')
  return html`
    <div class="divider">
      <hr />
      ${hasTabs && html`<button class="clear" title="Move unpinned tabs to the archive" onClick=${() => invoke('today:clear')}>↓ Clear</button>`}
    </div>
    <div class="row new" onClick=${() => invoke('overlay:open', 'command', { mode: 'new' })}>
      <span class="ico"><${Icon} name="plus" /></span><span class="t">New Tab</span>
    </div>
    <div class=${cls('section today', over && 'over')}
      onDragOver=${e => { if (acceptsDrag(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); handleDrop(e, { zone: 'today', index: space.today.length }) }}>
      <${ItemList} list=${space.today} zone="today" parentId=${null} depth=${0} ...${p} />
    </div>`
}

function ItemList(p) {
  return p.list.map((item, i) => {
    const common = { ...p, item, index: i, key: item.id }
    if (item.type === 'folder') return html`<${FolderRow} ...${common} />`
    if (item.type === 'split') return html`<${SplitRow} ...${common} />`
    if (item.type === 'note') return html`<${NoteRow} ...${common} />`
    return html`<${TabRow} ...${common} />`
  })
}

// Drop position inside a row: before / after / into (folder, or split for tabs).
function useRowDrop(item, zone, parentId, index, kind) {
  const [pos, setPos] = useState(null)
  const onDragOver = e => {
    if (!acceptsDrag(e) || dragId === item.id) return
    e.preventDefault(); e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    const internal = e.dataTransfer.types.includes(DRAG_TYPE)
    if (kind === 'folder') setPos(y < 0.28 ? 'before' : y > 0.72 && !item.open ? 'after' : 'into')
    else if (kind === 'tab' && internal) setPos(y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'split')
    else setPos(y < 0.5 ? 'before' : 'after')
  }
  const onDrop = e => {
    e.preventDefault(); e.stopPropagation()
    const p = pos
    setPos(null)
    if (p === 'split') {
      const id = e.dataTransfer.getData(DRAG_TYPE)
      endDrag()
      if (id) invoke('split:drop', id, item.id)
      return
    }
    const target = p === 'into' ? { zone, parentId: item.id, index: 0 } : { zone, parentId, index: p === 'after' ? index + 1 : index }
    handleDrop(e, target)
  }
  return { pos, bind: { onDragOver, onDragLeave: () => setPos(null), onDrop } }
}

function TabRow({ item, zone, parentId, index, depth, runtime, activeId, display, renaming, setRenaming, setPreview, settings }) {
  const rt = runtime.tabs[item.id] || {}
  const on = display.includes(item.id)
  const focused = activeId === item.id && display.length > 1
  const title = item.customTitle ? item.title : (rt.live && rt.title) || item.title || displayUrl(item.url)
  const away = zone !== 'today' && rt.live && rt.url && stripUrl(rt.url) !== stripUrl(item.url)
  const { pos, bind } = useRowDrop(item, zone, parentId, index, 'tab')
  const pv = usePreview(item.id, setPreview, settings.tabPreviews !== false)
  return html`
    <div class=${cls('row tab', on && 'on', focused && 'focused', rt.live && 'live', zone !== 'today' && !rt.live && 'asleep', pos && 'drop-' + pos)}
      style=${`padding-left:${10 + depth * 16}px`}
      draggable=${renaming !== item.id} onDragStart=${e => { setPreview(null); startDrag(e, { ...item, url: rt.url || item.url }) }} onDragEnd=${endDrag} ...${bind} ...${pv}
      onMouseDown=${e => { if (e.button === 0 && !e.target.closest('button')) { setPreview(null); invoke('tab:select', item.id) } }}
      onAuxClick=${e => { if (e.button === 1) invoke('tab:close', item.id) }}
      onDblClick=${e => { if (!e.target.closest('button')) setRenaming(item.id) }}
      onContextMenu=${e => { e.preventDefault(); setPreview(null); invoke('tab:menu', item.id) }}
      title=${rt.url || item.url} data-title=${title}>
      <span class="ico">${rt.loading && on ? html`<span class="spin"></span>` : html`<${Favicon} url=${rt.url || item.url} src=${rt.favicon || item.favicon} />`}</span>
      ${renaming === item.id
        ? html`<${InlineInput} value=${title} onDone=${v => { if (v && v !== title) invoke('tab:rename', item.id, v); setRenaming(null) }} />`
        : html`<span class="t">${away && html`<span class="slash">/</span>`}${title}</span>`}
      ${item.unread && !on && html`<i class="unread"></i>`}
      ${rt.audible && html`<button class="mini" title=${rt.muted ? 'Unmute' : 'Mute'} onClick=${() => invoke('tab:mute', item.id)}><${Icon} name=${rt.muted ? 'mute' : 'speaker'} size=${13} /></button>`}
      ${away && html`<button class="mini hov" title="Back to the pinned page" onClick=${() => invoke('tab:resetPinned', item.id)}><${Icon} name="undo" size=${13} /></button>`}
      ${(zone === 'today' || rt.live) && html`<button class="mini x hov" title=${zone === 'today' ? 'Close' : 'Close (stays pinned)'} onClick=${() => invoke('tab:close', item.id)}><${Icon} name=${zone === 'today' ? 'x' : 'minus'} size=${13} /></button>`}
    </div>`
}

function NoteRow({ item, zone, parentId, index, depth, activeId, renaming, setRenaming }) {
  const { pos, bind } = useRowDrop(item, zone, parentId, index, 'note')
  return html`
    <div class=${cls('row note', activeId === item.id && 'on', pos && 'drop-' + pos)} style=${`padding-left:${10 + depth * 16}px`}
      draggable=${renaming !== item.id} onDragStart=${e => startDrag(e, item)} onDragEnd=${endDrag} ...${bind}
      onMouseDown=${e => { if (e.button === 0) invoke('tab:select', item.id) }}
      onDblClick=${() => setRenaming(item.id)}
      onContextMenu=${e => { e.preventDefault(); invoke('tab:menu', item.id) }}>
      <span class="ico note-ico"><${Icon} name="pen" size=${14} /></span>
      ${renaming === item.id
        ? html`<${InlineInput} value=${item.title} onDone=${v => { if (v) invoke('note:update', item.id, { title: v }); setRenaming(null) }} />`
        : html`<span class="t">${item.title || 'Untitled'}</span>`}
    </div>`
}

function FolderRow(p) {
  const { item, zone, parentId, index, depth, display, renaming, setRenaming } = p
  const { pos, bind } = useRowDrop(item, zone, parentId, index, 'folder')
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
    ${item.open && html`<div class="folder-kids"><${ItemList} ...${p} list=${item.children} parentId=${item.id} depth=${depth + 1} /></div>`}
    ${item.open && !item.children.length && html`<div class="row empty-folder" style=${`padding-left:${34 + depth * 16}px`}>Empty</div>`}`
}

function SplitRow({ item, zone, parentId, index, depth, runtime, display }) {
  const { pos, bind } = useRowDrop(item, zone, parentId, index, 'split')
  const on = item.children.some(c => display.includes(c.id))
  return html`
    <div class=${cls('row split', on && 'on', item.orientation === 'column' && 'col', pos && 'drop-' + pos)} style=${`padding-left:${10 + depth * 16}px`}
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
      <button class="mini hov" title="Split layout" onClick=${() => invoke('tab:menu', item.id)}><${Icon} name="dots" size=${13} /></button>
    </div>`
}

// ---------------------------------------------------------------- library (Arc keeps it in the sidebar)

function Library({ tab, setTab, state }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const input = useRef(null)
  const load = () => {
    if (tab === 'archive') invoke('archive:list', q).then(setItems)
    else if (tab === 'history') invoke('history:list', q).then(setItems)
    else if (tab === 'snoozed') invoke('snoozed:list').then(setItems)
    else invoke('downloads:list').then(l => setItems(q ? l.filter(d => d.filename.toLowerCase().includes(q.toLowerCase())) : l))
  }
  useEffect(() => { load() }, [tab, q, state.archiveCount, state.snoozed && state.snoozed.length])
  useEvent('downloads', () => { if (tab === 'downloads') load() }, [tab, q])
  useEffect(() => { input.current && input.current.focus() }, [tab])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setTab(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const spaceName = id => (state.spaces.find(s => s.id === id) || {}).name || ''
  const groups = []
  for (const it of items || []) {
    const g = tab === 'snoozed' ? 'Coming back' : dayGroup(it.closedAt || it.last || it.startedAt || 0)
    if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] })
    groups[groups.length - 1].items.push(it)
  }
  const empty = { archive: 'Closed tabs land here. Nothing is ever really gone.', history: 'No history yet.', downloads: 'No downloads yet.', snoozed: 'Snooze a tab from its right-click menu and it comes back when you said.' }[tab]
  return html`
    <div class="library">
      <div class="lib-h">
        <button class="ib" title="Back to tabs" onClick=${() => setTab(null)}><${Icon} name="back" /></button>
        <span>Library</span>
      </div>
      <div class="seg">
        ${[['archive', 'Archive'], ['history', 'History'], ['downloads', 'Downloads'], ['snoozed', 'Snoozed']].map(([t, l]) => html`<button class=${cls(tab === t && 'on')} onClick=${() => { setTab(t); setQ('') }}>${l}</button>`)}
      </div>
      ${tab !== 'snoozed' && html`<div class="lib-search"><${Icon} name="search" size=${13} /><input ref=${input} placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} /></div>`}
      <div class="lib-list">
        ${items && !items.length && html`<div class="lib-none">${q ? 'Nothing matches.' : empty}</div>`}
        ${groups.map(g => html`
          <div class="lib-grp">${g.g}</div>
          ${g.items.map(it => tab === 'downloads' ? html`<${DownloadRow} d=${it} key=${it.id} />`
            : tab === 'snoozed' ? html`
              <div class="row lib-row" key=${it.id} title=${it.url} onClick=${() => invoke('snoozed:wake', it.id)}>
                <span class="ico"><${Favicon} url=${it.url} src=${it.favicon} /></span>
                <span class="t">${it.title || displayUrl(it.url)}</span>
                <small>${new Date(it.until).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
                <button class="mini x hov" title="Forget" onClick=${e => { e.stopPropagation(); invoke('snoozed:remove', it.id) }}><${Icon} name="x" size=${13} /></button>
              </div>`
            : html`
              <div class="row lib-row" key=${it.id || it.url} title=${it.url}
                onClick=${() => tab === 'archive' ? invoke('archive:restore', it.id) : invoke('tab:new', it.url)}>
                <span class="ico"><${Favicon} url=${it.url} src=${it.favicon} /></span>
                <span class="t">${it.title || displayUrl(it.url)}</span>
                <small>${tab === 'archive' && it.spaceId ? spaceName(it.spaceId) : timeAgo(it.closedAt || it.last)}</small>
                <button class="mini x hov" title="Remove" onClick=${e => { e.stopPropagation(); (tab === 'archive' ? invoke('archive:remove', it.id) : invoke('history:remove', it.url)).then(load) }}><${Icon} name="x" size=${13} /></button>
              </div>`)}
        `)}
      </div>
      ${tab === 'archive' && items && items.length > 0 && html`<button class="lib-foot" onClick=${() => invoke('archive:clear').then(load)}>Clear archive</button>`}
      ${tab === 'downloads' && items && items.length > 0 && html`<button class="lib-foot" onClick=${() => invoke('downloads:clear').then(load)}>Clear list</button>`}
    </div>`
}

function DownloadRow({ d }) {
  const pct = d.total ? Math.round((d.received / d.total) * 100) : null
  const active = d.state === 'progressing'
  return html`
    <div class="row lib-row dl" onClick=${() => d.state === 'completed' && invoke('downloads:open', d.id)} title=${d.path}>
      <span class="ico"><${Icon} name=${active ? 'down' : d.state === 'completed' ? 'check' : 'x'} size=${15} /></span>
      <div class="dl-main">
        <span class="t">${d.filename}</span>
        <small>${active ? `${fmtBytes(d.received)} of ${d.total ? fmtBytes(d.total) : '?'}${d.paused ? ' · paused' : ''}` : d.state === 'completed' ? (d.exists === false ? 'Moved or deleted' : fmtBytes(d.total || d.received)) : d.state}</small>
        ${active && html`<i class="prog"><b style=${`width:${pct ?? 30}%`}></b></i>`}
      </div>
      ${active ? html`
        <button class="mini" title=${d.paused ? 'Resume' : 'Pause'} onClick=${e => { e.stopPropagation(); invoke('downloads:pause', d.id) }}><${Icon} name=${d.paused ? 'fwd' : 'stop'} size=${13} /></button>
        <button class="mini" title="Cancel" onClick=${e => { e.stopPropagation(); invoke('downloads:cancel', d.id) }}><${Icon} name="x" size=${13} /></button>`
        : d.state === 'completed' && d.exists !== false ? html`<button class="mini hov" title="Show in Finder" onClick=${e => { e.stopPropagation(); invoke('downloads:reveal', d.id) }}><${Icon} name="search" size=${13} /></button>` : null}
    </div>`
}

// ---------------------------------------------------------------- media mini player

function MiniPlayer({ runtime, display, state }) {
  // The most recent tab making sound that you're not looking at.
  const entry = Object.entries(runtime.tabs).find(([id, t]) => t.live && (t.audible || t.playing) && !display.includes(id))
  if (!entry) return null
  const [id, t] = entry
  const m = t.media || {}
  const title = m.title || t.title || displayUrl(t.url)
  return html`
    <div class="player">
      <button class="pl-art" onClick=${() => invoke('tab:select', id)} title="Go to tab">
        ${m.art ? html`<img src=${m.art} />` : html`<${Favicon} url=${t.url} src=${t.favicon} size=${18} />`}
      </button>
      <div class="pl-text" onClick=${() => invoke('tab:select', id)}>
        <b>${title}</b><span>${m.artist || hostOf(t.url)}</span>
      </div>
      <button class="mini" title="Back 10 seconds" onClick=${() => invoke('media:skip', id, -1)}><${Icon} name="back" size=${13} /></button>
      <button class="mini" title=${t.playing ? 'Pause' : 'Play'} onClick=${() => invoke('media:toggle', id)}><${Icon} name=${t.playing || t.audible ? 'pause' : 'play'} size=${13} /></button>
      <button class="mini" title=${t.muted ? 'Unmute' : 'Mute'} onClick=${() => invoke('tab:mute', id)}><${Icon} name=${t.muted ? 'mute' : 'speaker'} size=${13} /></button>
    </div>`
}

// ---------------------------------------------------------------- update pill

function UpdatePill() {
  const [u, setU] = useState(null)
  useEffect(() => { invoke('update:status').then(setU) }, [])
  useEvent('update', setU)
  if (!u || !['ready', 'manual', 'downloading'].includes(u.state)) return null
  if (u.state === 'downloading') return html`<div class="update dl"><span>Downloading Crescent ${u.version}</span><i><b style=${`width:${Math.round((u.progress || 0) * 100)}%`}></b></i></div>`
  return html`
    <button class="update" onClick=${() => invoke('update:install')} title=${u.notes || ''}>
      <${Icon} name="down" size=${14} />
      <span>${u.state === 'ready' ? `Restart to update to ${u.version}` : `Crescent ${u.version} is out`}</span>
    </button>`
}

// ---------------------------------------------------------------- bottom bar

function BottomBar({ state, space, library, setLibrary }) {
  const [dl, setDl] = useState({ active: 0, progress: 0 })
  const [menu, setMenu] = useState(false)
  useEvent('downloads', setDl)
  const spaces = state.spaces
  const many = spaces.length > 7
  return html`
    ${menu && html`<${PlusMenu} close=${() => setMenu(false)} hasPrivate=${spaces.some(s => s.private)} />`}
    <div class="bottom">
      <button class=${cls('ib lib', (dl.active || library) && 'on')} title="Library" onClick=${() => setLibrary(library ? null : dl.active ? 'downloads' : 'archive')}>
        <${Icon} name=${dl.active ? 'down' : 'archive'} />
        ${dl.active > 0 && html`<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" pathLength="100" style=${`stroke-dasharray:${Math.max(4, Math.round((dl.progress < 0 ? 0.3 : dl.progress) * 100))} 100`} /></svg>`}
      </button>
      <div class="spaces">
        ${spaces.map((sp, i) => html`<${SpaceButton} key=${sp.id} sp=${sp} i=${i} on=${sp.id === space.id} many=${many} />`)}
      </div>
      <button class=${cls('ib', menu && 'on')} title="New…" onClick=${() => setMenu(v => !v)}><${Icon} name="plus" /></button>
    </div>`
}

function SpaceButton({ sp, i, on, many }) {
  const [over, setOver] = useState(false)
  const hoverTimer = useRef(null)
  return html`
    <button class=${cls('sp', on && 'on', many && 'dot', over && 'over', sp.private && 'priv')} title=${sp.name}
      onClick=${() => invoke('space:switch', sp.id)}
      onContextMenu=${e => { e.preventDefault(); invoke('space:menu', sp.id) }}
      draggable=${!sp.private}
      onDragStart=${e => e.dataTransfer.setData('application/x-crescent-space', sp.id)}
      onDragOver=${e => {
        const t = e.dataTransfer.types
        if (t.includes('application/x-crescent-space') || t.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true) }
        // Hover a dragged tab over a space for a moment to switch to it.
        if (t.includes(DRAG_TYPE) && !hoverTimer.current) hoverTimer.current = setTimeout(() => invoke('space:switch', sp.id), 700)
      }}
      onDragLeave=${() => { setOver(false); clearTimeout(hoverTimer.current); hoverTimer.current = null }}
      onDrop=${e => {
        setOver(false); clearTimeout(hoverTimer.current); hoverTimer.current = null
        const sid = e.dataTransfer.getData('application/x-crescent-space')
        if (sid) { e.preventDefault(); invoke('space:move', sid, i); return }
        const id = e.dataTransfer.getData(DRAG_TYPE)
        if (id) { e.preventDefault(); endDrag(); invoke('item:move', id, { zone: 'today', index: 0, spaceId: sp.id }) }
      }}>
      ${many ? html`<i></i>` : html`<${Icon} name=${sp.icon} size=${14} />`}
      <span class="sp-label">${sp.name}</span>
    </button>`
}

function PlusMenu({ close, hasPrivate }) {
  const item = (icon, label, action, ...args) => html`<button onClick=${() => { close(); invoke(action, ...args) }}><${Icon} name=${icon} size=${15} /> ${label}</button>`
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return html`
    <div class="plus-scrim" onMouseDown=${close}></div>
    <div class="plus-menu">
      ${item('moon', 'New Space', 'space:create')}
      ${item('incognito', hasPrivate ? 'Go to Private Space' : 'New Private Space', 'space:private')}
      ${item('folder', 'New Folder', 'folder:create', {})}
      ${item('pen', 'New Note', 'note:new')}
      ${item('split', 'New Split View', 'split:toggle')}
      ${item('window', 'Little Crescent Window', 'little:new', {})}
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

// ---------------------------------------------------------------- content area (gaps around pages, notes, empty state)

function ContentDecor({ layout, runtime, space, state, note }) {
  const rects = layout.rects || []
  const c = layout.content
  if (note) return html`<${NoteEditor} c=${c} note=${note} key=${note.id} />`
  if (!rects.length) return html`<${EmptyState} c=${c} space=${space} />`
  if (rects.length < 2) return null
  const focusRect = rects.find(r => r.id === space.activeId)
  const column = layout.orientation === 'column'
  return html`
    ${focusRect && html`<div class="focus-ring" style=${`left:${focusRect.x - 2}px;top:${focusRect.y - 2}px;width:${focusRect.width + 4}px;height:${focusRect.height + 4}px`}></div>`}
    ${rects.slice(0, -1).map((r, i) => html`<${SplitHandle} key=${i} i=${i} rects=${rects} c=${c} column=${column} />`)}`
}

function SplitHandle({ i, rects, c, column }) {
  const r = rects[i]
  const onDown = e => {
    e.preventDefault()
    const lens = rects.map(x => (column ? x.height : x.width))
    const total = lens.reduce((a, b) => a + b, 0)
    const start = column ? e.clientY : e.clientX
    let raf = 0
    const move = ev => {
      const d = (column ? ev.clientY : ev.clientX) - start
      const w = [...lens]
      const min = column ? 140 : 220
      const a = Math.max(min, Math.min(lens[i] + lens[i + 1] - min, lens[i] + d))
      w[i + 1] = lens[i] + lens[i + 1] - a
      w[i] = a
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => invoke('split:sizes', w.map(x => x / total)))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing') }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const style = column
    ? `top:${r.y + r.height}px;left:${c.x}px;width:${c.width}px;height:6px`
    : `left:${r.x + r.width}px;top:${c.y}px;height:${c.height}px;width:6px`
  return html`<div class=${cls('split-handle', column && 'col')} style=${style} onMouseDown=${onDown} onDblClick=${() => invoke('split:sizes', rects.map(() => 1 / rects.length))}><i></i></div>`
}

function NoteEditor({ c, note }) {
  const [title, setTitle] = useState(note.title === 'Untitled' ? '' : note.title)
  const [body, setBody] = useState(note.body || '')
  const [saved, setSaved] = useState(true)
  const bodyRef = useRef(null)
  const titleRef = useRef(null)
  const timer = useRef(null)
  const pending = useRef(null)
  const save = (patch) => {
    setSaved(false)
    pending.current = patch
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { pending.current = null; invoke('note:update', note.id, patch).then(() => setSaved(true)) }, 350)
  }
  useEffect(() => { (title ? bodyRef : titleRef).current?.focus() }, [])
  useEvent('note:focus', id => { if (id === note.id) titleRef.current?.focus() })
  // Switching away mid-typing still saves the last keystrokes.
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current) invoke('note:update', note.id, pending.current) }, [])
  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  // Typing "- [ ] " makes a checkbox line; clicking toggles it.
  const toggleLine = idx => {
    const lines = body.split('\n')
    lines[idx] = lines[idx].replace(/^(\s*- \[)( |x)(\])/, (m, a, x, b) => a + (x === 'x' ? ' ' : 'x') + b)
    const next = lines.join('\n')
    setBody(next); save({ title: title || 'Untitled', body: next })
  }
  const checks = body.split('\n').map((l, i) => [l, i]).filter(([l]) => /^\s*- \[( |x)\]/.test(l))
  return html`
    <div class="note-page" style=${`left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px`}>
      <div class="note-inner">
        <input class="note-title" ref=${titleRef} placeholder="Untitled" value=${title}
          onInput=${e => { setTitle(e.target.value); save({ title: e.target.value || 'Untitled', body }) }}
          onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current.focus() } }} />
        <div class="note-meta">${new Date(note.updatedAt || Date.now()).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} · ${words} words · ${saved ? 'Saved' : 'Saving…'}</div>
        ${checks.length > 0 && html`<div class="note-checks">${checks.map(([l, i]) => html`<label><input type="checkbox" checked=${/\[x\]/.test(l)} onChange=${() => toggleLine(i)} /> ${l.replace(/^\s*- \[( |x)\]\s*/, '')}</label>`)}</div>`}
        <textarea class="note-body" ref=${bodyRef} placeholder="Start writing. Lines starting with “- [ ] ” become checkboxes." value=${body}
          onInput=${e => { setBody(e.target.value); save({ title: title || 'Untitled', body: e.target.value }) }}></textarea>
      </div>
    </div>`
}

function EmptyState({ c, space }) {
  return html`
    <div class="empty-state" style=${`left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px`}>
      <div class="es-inner">
        <h1>${space.name}</h1>
        <div class="es-keys">
          <button onClick=${() => invoke('overlay:open', 'command', { mode: 'new' })}><span>New tab</span><kbd>⌘T</kbd></button>
          <button onClick=${() => invoke('note:new')}><span>New note</span><kbd>⌥⌘K</kbd></button>
          <button onClick=${() => invoke('library:open', 'archive')}><span>Library</span><kbd>⌘Y</kbd></button>
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
    onBlur=${e => finish(e.target.value.trim())} onMouseDown=${e => e.stopPropagation()} onClick=${e => e.stopPropagation()} />`
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
