'use strict'
// Pure state model for Crescent. Everything that changes spaces, pins,
// folders, splits, bookmarks or the archive lives here so it can be unit
// tested without Electron. Functions mutate the state object they are given
// and return useful values; callers persist and broadcast afterwards.

const crypto = require('node:crypto')

const uid = (p = 'i') => p + '_' + crypto.randomBytes(6).toString('base64url')

const ARCHIVE_LIMIT = 1000

const DEFAULT_SETTINGS = {
  pinsMode: 'global', // 'global' = favicon grid shared by all spaces, 'space' = per space
  searchEngine: 'google',
  askWhereToSave: true,
  downloadDir: null,
  adblock: true,
  memorySaverMinutes: 45, // 0 disables
  sidebarWidth: 262,
  sidebarHidden: false,
  sidebarRight: false,
  onboarded: false,
  littleCrescent: true,
  peekForPinned: true,
  newTabPosition: 'top', // Arc puts new tabs on top
  fontScale: 1,
  showHoverUrl: true,
  closePinnedResets: true,
  // Appearance
  uiFont: 'crescent', // 'crescent' | 'system' | 'rounded' | 'mono'
  density: 'comfortable', // 'compact' | 'comfortable' | 'roomy'
  pageRadius: 9,
  frameGap: 8,
  glass: 0.8, // sidebar opacity over the desktop blur
  gridColumns: 4,
  showCloseButtons: 'hover', // 'hover' | 'always'
  tabPreviews: true,
  animations: true,
  // Behaviour
  autoPip: true,
  mediaControls: true,
  warnBeforeQuit: true,
  duplicateTabGuard: true,
  unreadDots: true,
  httpsUpgrade: false,
  globalPrivacyControl: true,
  customSearchUrl: '',
  shortcuts: {}, // id -> accelerator overrides
  airTraffic: [], // [{ id, url, app, spaceId }]
  focusSites: ['docs.google.com', 'khanacademy.org', 'wikipedia.org'],
  focusWords: [],
  focusMinutes: 25,
}

const DEFAULT_THEMES = [
  { colors: ['#d9c6ef', '#f3cfb4'], mode: 'auto', grain: 0.4 },
  { colors: ['#bfe0d0', '#e8efc0'], mode: 'auto', grain: 0.4 },
  { colors: ['#b9cdf3', '#d8c4f0'], mode: 'auto', grain: 0.4 },
  { colors: ['#f3c0c0', '#f6e0b0'], mode: 'auto', grain: 0.4 },
]

function makeSpace(name = 'Personal', opts = {}) {
  return {
    id: uid('s'),
    name,
    icon: opts.icon || 'moon',
    theme: opts.theme || { ...DEFAULT_THEMES[0], colors: [...DEFAULT_THEMES[0].colors] },
    favorites: [],
    pinned: [],
    today: [],
    activeId: null,
  }
}

function defaults() {
  const space = makeSpace('Personal')
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    favorites: [],
    spaces: [space],
    activeSpaceId: space.id,
    bookmarks: { id: 'bm_root', type: 'folder', title: 'Bookmarks', children: [] },
    archive: [],
    snoozed: [],
    focus: null,
    window: null,
  }
}

// ---------- helpers ----------

function makeTab({ url = '', title = '', favicon = null } = {}) {
  return { id: uid('t'), type: 'tab', url, title: title || url, favicon }
}

function isTab(x) { return x && x.type === 'tab' }

function getSpace(state, id) { return state.spaces.find(s => s.id === id) || null }
function activeSpace(state) { return getSpace(state, state.activeSpaceId) || state.spaces[0] }

function favoritesList(state, space) {
  return state.settings.pinsMode === 'global' ? state.favorites : space.favorites
}

// Depth-first walk of a list, yielding { item, list, index, parent }.
function* walk(list, parent = null) {
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    yield { item, list, index: i, parent }
    if (item.children) yield* walk(item.children, item)
  }
}

// Locate an item anywhere. Returns { item, list, index, parent, zone, space }.
function locate(state, id) {
  if (!id) return null
  for (const r of walk(state.favorites)) if (r.item.id === id) return { ...r, zone: 'favorites', space: null }
  for (const space of state.spaces) {
    for (const zone of ['favorites', 'pinned', 'today']) {
      for (const r of walk(space[zone])) if (r.item.id === id) return { ...r, zone, space }
    }
  }
  return null
}

function tabsIn(list) {
  const out = []
  for (const { item } of walk(list)) if (isTab(item)) out.push(item)
  return out
}

// Every tab id reachable from a space (incl. favorites currently shown).
function spaceTabIds(state, space) {
  return [
    ...tabsIn(favoritesList(state, space)),
    ...tabsIn(space.pinned),
    ...tabsIn(space.today),
  ].map(t => t.id)
}

function allTabIds(state) {
  const ids = new Set(tabsIn(state.favorites).map(t => t.id))
  for (const s of state.spaces) {
    for (const z of ['favorites', 'pinned', 'today']) for (const t of tabsIn(s[z])) ids.add(t.id)
  }
  return ids
}

function isDescendant(ancestor, id) {
  if (!ancestor.children) return false
  for (const { item } of walk(ancestor.children)) if (item.id === id) return true
  return false
}

// ---------- normalize / repair ----------

// Repairs anything that could make the UI misbehave: bad ids, duplicate ids,
// splits with fewer than two tabs, folders in the wrong zone, dangling
// active ids. Runs on every load, so a corrupt file never crashes the app.
function normalize(raw) {
  const base = defaults()
  const state = raw && typeof raw === 'object' ? raw : {}
  state.version = 1
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) }
  if (!['global', 'space'].includes(state.settings.pinsMode)) state.settings.pinsMode = 'global'
  if (!Array.isArray(state.favorites)) state.favorites = []
  if (!Array.isArray(state.spaces) || state.spaces.length === 0) state.spaces = base.spaces
  if (!state.bookmarks || state.bookmarks.type !== 'folder') state.bookmarks = base.bookmarks
  if (!Array.isArray(state.bookmarks.children)) state.bookmarks.children = []
  if (!Array.isArray(state.archive)) state.archive = []
  if (!Array.isArray(state.snoozed)) state.snoozed = []
  state.settings.sidebarWidth = Math.max(236, Math.min(440, Number(state.settings.sidebarWidth) || 262))
  if (state.focus && !(state.focus.endsAt > Date.now())) state.focus = null
  if (!state.settings.shortcuts || typeof state.settings.shortcuts !== 'object') state.settings.shortcuts = {}
  if (!Array.isArray(state.settings.airTraffic)) state.settings.airTraffic = []

  const seen = new Set()
  const fixItem = (item, zone, depth) => {
    if (!item || typeof item !== 'object') return null
    if (!item.id || seen.has(item.id)) item.id = uid(item.type === 'folder' ? 'f' : item.type === 'split' ? 'x' : 't')
    seen.add(item.id)
    if (item.type === 'tab') {
      item.url = typeof item.url === 'string' ? item.url : ''
      item.title = typeof item.title === 'string' ? item.title : item.url
      return item
    }
    if (item.type === 'note') {
      if (zone === 'favorites' || depth > 0 && zone === 'today') return null
      item.title = typeof item.title === 'string' ? item.title : 'Untitled'
      item.body = typeof item.body === 'string' ? item.body : ''
      return item
    }
    if (item.type === 'folder') {
      if (zone !== 'pinned') return null // folders only live in the pinned section
      item.title = item.title || 'Folder'
      item.open = item.open !== false
      item.children = (Array.isArray(item.children) ? item.children : []).map(c => fixItem(c, zone, depth + 1)).filter(Boolean)
      return item
    }
    if (item.type === 'split') {
      if (zone === 'favorites') return null
      item.children = (Array.isArray(item.children) ? item.children : []).filter(isTab).map(c => fixItem(c, zone, depth + 1)).filter(Boolean)
      if (item.children.length === 0) return null
      if (item.children.length === 1) return item.children[0]
      if (!Array.isArray(item.sizes) || item.sizes.length !== item.children.length) {
        item.sizes = item.children.map(() => 1 / item.children.length)
      }
      if (item.orientation !== 'column') item.orientation = 'row'
      return item
    }
    return null
  }
  const fixList = (list, zone) => (Array.isArray(list) ? list : []).map(i => fixItem(i, zone, 0)).filter(Boolean)

  state.favorites = fixList(state.favorites, 'favorites').filter(isTab)
  state.spaces = state.spaces.filter(s => s && typeof s === 'object' && !s.private)
  if (!state.spaces.length) state.spaces = base.spaces
  for (const s of state.spaces) {
    if (!s.id || seen.has(s.id)) s.id = uid('s')
    seen.add(s.id)
    s.name = s.name || 'Space'
    s.icon = s.icon || 'moon'
    s.theme = s.theme && Array.isArray(s.theme.colors) && s.theme.colors.length
      ? { mode: 'auto', grain: 0.4, angle: 160, style: 'linear', intensity: 0.5, ...s.theme }
      : { ...DEFAULT_THEMES[0], colors: [...DEFAULT_THEMES[0].colors] }
    s.favorites = fixList(s.favorites, 'favorites').filter(isTab)
    s.pinned = fixList(s.pinned, 'pinned')
    s.today = fixList(s.today, 'today').filter(i => i.type !== 'folder')
    if (s.activeId && !locate(state, s.activeId)) s.activeId = null
  }
  if (!getSpace(state, state.activeSpaceId)) state.activeSpaceId = state.spaces[0].id
  state.archive = state.archive.filter(a => a && a.url).slice(0, ARCHIVE_LIMIT)
  return state
}

// ---------- tabs ----------

function addTab(state, spaceId, data, opts = {}) {
  const space = getSpace(state, spaceId) || activeSpace(state)
  const tab = makeTab(data)
  const zone = opts.zone || 'today'
  let list = zone === 'favorites' ? favoritesList(state, space) : space[zone]
  if (opts.parentId) {
    const p = locate(state, opts.parentId)
    if (p && p.item.type === 'folder') list = p.item.children
  }
  let index
  if (opts.afterId) {
    const at = list.findIndex(i => i.id === opts.afterId)
    index = at === -1 ? 0 : at + 1
  } else if (typeof opts.index === 'number') index = opts.index
  else index = zone === 'today' && state.settings.newTabPosition === 'top' ? 0 : list.length
  list.splice(Math.max(0, Math.min(index, list.length)), 0, tab)
  return tab
}

function updateTab(state, id, patch) {
  const loc = locate(state, id)
  if (!loc || !isTab(loc.item)) return null
  for (const k of ['url', 'title', 'favicon']) if (patch[k] !== undefined) loc.item[k] = patch[k]
  return loc.item
}

// Removes an item from wherever it lives. A split left with one tab is
// unwrapped back into a normal tab so the sidebar never shows a lone split.
function detach(state, id) {
  const loc = locate(state, id)
  if (!loc) return null
  loc.list.splice(loc.index, 1)
  if (loc.parent && loc.parent.type === 'split') {
    const split = loc.parent
    if (split.sizes) split.sizes.splice(loc.index, 1)
    if (split.children.length === 1) {
      const sl = locate(state, split.id)
      sl.list.splice(sl.index, 1, split.children[0])
    } else if (split.sizes) {
      const sum = split.sizes.reduce((a, b) => a + b, 0) || 1
      split.sizes = split.sizes.map(s => s / sum)
    }
  }
  return loc
}

function archiveTab(state, tab, spaceId) {
  if (!tab || !tab.url || tab.url.startsWith('crescent:')) return
  const sp = spaceId && getSpace(state, spaceId)
  if (sp && sp.private) return // private browsing leaves no trace
  state.archive.unshift({
    id: uid('a'), url: tab.url, title: tab.title || tab.url, favicon: tab.favicon || null,
    spaceId: spaceId || null, closedAt: Date.now(),
  })
  if (state.archive.length > ARCHIVE_LIMIT) state.archive.length = ARCHIVE_LIMIT
}

// Close behaviour (Arc): today tabs are archived and removed; pinned tabs
// and favorites stay in the sidebar and only their live page is unloaded.
// Returns { removed: bool, zone }.
function closeTab(state, id) {
  const loc = locate(state, id)
  if (!loc) return { removed: false, zone: null }
  if (loc.zone !== 'today' || loc.item.type === 'note') return { removed: false, zone: loc.zone }
  if (loc.item.type === 'split') {
    for (const t of loc.item.children) archiveTab(state, t, loc.space.id)
    detach(state, id)
    return { removed: true, zone: 'today', ids: loc.item.children.map(c => c.id) }
  }
  archiveTab(state, loc.item, loc.space.id)
  detach(state, id)
  return { removed: true, zone: 'today', ids: [id] }
}

// Which tab should be shown after `id` closes. Prefers the next tab below in
// Today, then the one above, then whatever the caller's MRU says.
function neighbourAfterClose(state, id) {
  const loc = locate(state, id)
  if (!loc || loc.zone !== 'today') return null
  let { list, index, parent } = loc
  if (parent && parent.type === 'split') {
    const sib = parent.children[index + 1] || parent.children[index - 1]
    if (sib) return sib.id
    const pl = locate(state, parent.id); list = pl.list; index = pl.index
  }
  const pick = it => (it.type === 'split' ? it.children[0].id : it.id)
  if (list[index + 1]) return pick(list[index + 1])
  if (list[index - 1]) return pick(list[index - 1])
  return null
}

function clearToday(state, spaceId) {
  const space = getSpace(state, spaceId)
  if (!space) return []
  const ids = tabsIn(space.today).map(t => t.id)
  for (const t of tabsIn(space.today)) archiveTab(state, t, space.id)
  space.today = space.today.filter(i => i.type === 'note')
  if (ids.includes(space.activeId)) space.activeId = null
  return ids
}

function restoreArchived(state, archiveId, spaceId) {
  const i = state.archive.findIndex(a => a.id === archiveId)
  if (i === -1) return null
  const [a] = state.archive.splice(i, 1)
  const target = getSpace(state, spaceId) || getSpace(state, a.spaceId) || activeSpace(state)
  return { tab: addTab(state, target.id, { url: a.url, title: a.title, favicon: a.favicon }), spaceId: target.id }
}

// Ctrl+1..9 targets: top-level Today items in order. Pinned tabs and
// favorites are deliberately skipped. A split counts as one entry.
function cycleTargets(state, spaceId) {
  const space = getSpace(state, spaceId)
  if (!space) return []
  return space.today.map(it => (it.type === 'split' ? it.children[0].id : it.id))
}

// ---------- moving (drag and drop) ----------

// target: { spaceId, zone: 'favorites'|'pinned'|'today', parentId?, index }
function moveItem(state, id, target) {
  const loc = locate(state, id)
  if (!loc) return false
  const item = loc.item
  const space = getSpace(state, target.spaceId) || loc.space || activeSpace(state)
  const zone = target.zone
  if (!['favorites', 'pinned', 'today'].includes(zone)) return false
  if (zone === 'favorites' && !isTab(item)) return false
  if (item.type === 'note' && target.parentId && zone !== 'pinned') return false
  if (zone === 'today' && item.type === 'folder') return false

  let list = zone === 'favorites' ? favoritesList(state, space) : space[zone]
  let parent = null
  if (target.parentId) {
    const p = locate(state, target.parentId)
    if (!p || p.item.type !== 'folder' || zone !== 'pinned') return false
    if (p.item.id === item.id || isDescendant(item, p.item.id)) return false
    parent = p.item
    list = p.item.children
  }
  // Index correction when moving within the same list downwards.
  let index = typeof target.index === 'number' ? target.index : list.length
  if (loc.list === list && loc.index < index) index -= 1
  detach(state, id)
  index = Math.max(0, Math.min(index, list.length))
  list.splice(index, 0, item)
  if (parent) parent.open = true
  return true
}

// ---------- folders ----------

function createFolder(state, spaceId, opts = {}) {
  const space = getSpace(state, spaceId) || activeSpace(state)
  const folder = { id: uid('f'), type: 'folder', title: opts.title || 'New Folder', open: true, children: [] }
  let list = space.pinned
  if (opts.parentId) {
    const p = locate(state, opts.parentId)
    if (p && p.item.type === 'folder') list = p.item.children
  }
  list.splice(typeof opts.index === 'number' ? opts.index : list.length, 0, folder)
  for (const cid of opts.childIds || []) moveItem(state, cid, { spaceId: space.id, zone: 'pinned', parentId: folder.id })
  return folder
}

function renameItem(state, id, title) {
  const loc = locate(state, id)
  if (!loc) return false
  loc.item.title = String(title || '').slice(0, 200) || loc.item.title
  if (isTab(loc.item)) loc.item.customTitle = true
  return true
}

function toggleFolder(state, id, open) {
  const loc = locate(state, id)
  if (!loc || loc.item.type !== 'folder') return false
  loc.item.open = open === undefined ? !loc.item.open : !!open
  return true
}

// Deleting a folder never loses tabs: children move to where the folder was.
function deleteFolder(state, id) {
  const loc = locate(state, id)
  if (!loc || loc.item.type !== 'folder') return false
  loc.list.splice(loc.index, 1, ...loc.item.children)
  return true
}

// ---------- splits ----------

function createSplit(state, idA, idB) {
  const a = locate(state, idA)
  const b = locate(state, idB)
  if (!a || !b || idA === idB || !isTab(a.item) || !isTab(b.item)) return null
  const space = a.space || b.space || activeSpace(state)
  // Splits only take Today tabs. Pinned tabs and favorites are copied so the
  // pin itself is never consumed.
  const take = loc => {
    if (loc.zone === 'today' && !(loc.parent && loc.parent.type === 'split')) {
      detach(state, loc.item.id)
      return loc.item
    }
    return makeTab({ url: loc.item.url, title: loc.item.title, favicon: loc.item.favicon })
  }
  let anchorIndex = a.zone === 'today' && !a.parent ? a.index : 0
  const tA = take(a)
  const bl = locate(state, idB)
  if (bl && bl.zone === 'today' && !bl.parent && bl.index < anchorIndex) anchorIndex -= 1
  const tB = take(bl || b)
  const split = { id: uid('x'), type: 'split', children: [tA, tB], sizes: [0.5, 0.5] }
  space.today.splice(Math.max(0, Math.min(anchorIndex, space.today.length)), 0, split)
  return { split, ids: [tA.id, tB.id], copied: [tA.id !== idA ? tA.id : null, tB.id !== idB ? tB.id : null] }
}

function addToSplit(state, splitId, data) {
  const loc = locate(state, splitId)
  if (!loc || loc.item.type !== 'split' || loc.item.children.length >= 4) return null
  const tab = makeTab(data)
  loc.item.children.push(tab)
  const n = loc.item.children.length
  loc.item.sizes = loc.item.children.map(() => 1 / n)
  return tab
}

function unsplit(state, splitId) {
  const loc = locate(state, splitId)
  if (!loc || loc.item.type !== 'split') return false
  loc.list.splice(loc.index, 1, ...loc.item.children)
  return true
}

function splitOf(state, tabId) {
  const loc = locate(state, tabId)
  return loc && loc.parent && loc.parent.type === 'split' ? loc.parent : null
}

function setSplitSizes(state, splitId, sizes) {
  const loc = locate(state, splitId)
  if (!loc || loc.item.type !== 'split' || !Array.isArray(sizes) || sizes.length !== loc.item.children.length) return false
  const clean = sizes.map(s => Math.max(0.15, Number(s) || 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  loc.item.sizes = clean.map(s => s / sum)
  return true
}

// ---------- pins mode ----------

// Switching never deletes pins. Global -> per space copies the shared grid
// into every space (new ids, so they can diverge). Per space -> global merges
// every space's grid, de-duplicated by URL, in space order.
function setPinsMode(state, mode) {
  if (mode !== 'global' && mode !== 'space') return false
  const prev = state.settings.pinsMode
  if (prev === mode) return true
  if (mode === 'space') {
    for (const s of state.spaces) {
      const existing = new Set(s.favorites.map(f => f.url))
      for (const f of state.favorites) {
        if (!existing.has(f.url)) s.favorites.push({ ...f, id: s === state.spaces[0] ? f.id : uid('t') })
      }
    }
    state.favorites = []
  } else {
    const seen = new Set()
    const merged = []
    for (const f of state.favorites) if (!seen.has(f.url)) { seen.add(f.url); merged.push(f) }
    for (const s of state.spaces) {
      for (const f of s.favorites) if (!seen.has(f.url)) { seen.add(f.url); merged.push(f) }
      s.favorites = []
    }
    state.favorites = merged
  }
  state.settings.pinsMode = mode
  for (const s of state.spaces) if (s.activeId && !locate(state, s.activeId)) s.activeId = null
  return true
}

// ---------- spaces ----------

function addSpace(state, name, opts = {}) {
  const theme = opts.theme || DEFAULT_THEMES[state.spaces.length % DEFAULT_THEMES.length]
  const s = makeSpace(name || 'New Space', { icon: opts.icon, theme: { ...theme, colors: [...theme.colors] } })
  state.spaces.push(s)
  return s
}

function removeSpace(state, id) {
  if (state.spaces.length <= 1) return false
  const i = state.spaces.findIndex(s => s.id === id)
  if (i === -1) return false
  const [s] = state.spaces.splice(i, 1)
  for (const t of tabsIn(s.today)) archiveTab(state, t, null)
  for (const t of tabsIn(s.pinned)) archiveTab(state, t, null)
  if (state.activeSpaceId === id) state.activeSpaceId = state.spaces[Math.max(0, i - 1)].id
  return s
}

function updateSpace(state, id, patch) {
  const s = getSpace(state, id)
  if (!s) return false
  if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim().slice(0, 60)
  if (typeof patch.icon === 'string') s.icon = patch.icon
  if (patch.theme && typeof patch.theme === 'object') {
    const t = { ...s.theme, ...patch.theme }
    if (!Array.isArray(t.colors) || t.colors.length === 0 || t.colors.length > 3) t.colors = s.theme.colors
    t.colors = t.colors.filter(c => /^#[0-9a-f]{6}$/i.test(c))
    if (t.colors.length === 0) t.colors = [...DEFAULT_THEMES[0].colors]
    if (!['auto', 'light', 'dark'].includes(t.mode)) t.mode = 'auto'
    t.grain = Math.max(0, Math.min(1, Number(t.grain) || 0))
    s.theme = t
  }
  return true
}

function moveSpace(state, id, index) {
  const i = state.spaces.findIndex(s => s.id === id)
  if (i === -1) return false
  const [s] = state.spaces.splice(i, 1)
  state.spaces.splice(Math.max(0, Math.min(index, state.spaces.length)), 0, s)
  return true
}

function moveTabToSpace(state, id, spaceId) {
  const loc = locate(state, id)
  const space = getSpace(state, spaceId)
  if (!loc || !space || !isTab(loc.item)) return false
  return moveItem(state, id, { spaceId, zone: 'today', index: 0 })
}

// ---------- bookmarks ----------

function bmLocate(state, id) {
  if (id === state.bookmarks.id) return { item: state.bookmarks, list: null, index: -1, parent: null }
  for (const r of walk(state.bookmarks.children, state.bookmarks)) if (r.item.id === id) return r
  return null
}

function addBookmark(state, { url, title, parentId, index }) {
  const p = (parentId && bmLocate(state, parentId)) || { item: state.bookmarks }
  if (p.item.type !== 'folder') return null
  const bm = { id: uid('b'), type: 'bookmark', url, title: title || url, addedAt: Date.now() }
  const list = p.item.children
  list.splice(typeof index === 'number' ? index : list.length, 0, bm)
  return bm
}

function addBookmarkFolder(state, { title, parentId, index }) {
  const p = (parentId && bmLocate(state, parentId)) || { item: state.bookmarks }
  if (p.item.type !== 'folder') return null
  const f = { id: uid('bf'), type: 'folder', title: title || 'New Folder', children: [] }
  p.item.children.splice(typeof index === 'number' ? index : p.item.children.length, 0, f)
  return f
}

function removeBookmark(state, id) {
  const loc = bmLocate(state, id)
  if (!loc || !loc.list) return false
  loc.list.splice(loc.index, 1)
  return true
}

function moveBookmark(state, id, parentId, index) {
  const loc = bmLocate(state, id)
  const p = bmLocate(state, parentId)
  if (!loc || !loc.list || !p || p.item.type !== 'folder') return false
  if (p.item.id === id || isDescendant(loc.item, p.item.id)) return false
  let i = typeof index === 'number' ? index : p.item.children.length
  if (loc.list === p.item.children && loc.index < i) i -= 1
  loc.list.splice(loc.index, 1)
  p.item.children.splice(Math.max(0, Math.min(i, p.item.children.length)), 0, loc.item)
  return true
}

function findBookmarkByUrl(state, url) {
  for (const { item } of walk(state.bookmarks.children)) if (item.type === 'bookmark' && item.url === url) return item
  return null
}

function allBookmarks(state) {
  const out = []
  const rec = (list, path) => {
    for (const it of list) {
      if (it.type === 'folder') rec(it.children, [...path, it.title])
      else out.push({ ...it, path: path.join(' / ') })
    }
  }
  rec(state.bookmarks.children, [])
  return out
}

// ---------- notes ----------

function addNote(state, spaceId, opts = {}) {
  const space = getSpace(state, spaceId) || activeSpace(state)
  const note = { id: uid('n'), type: 'note', title: opts.title || 'Untitled', body: opts.body || '', updatedAt: Date.now() }
  const zone = opts.zone === 'pinned' ? 'pinned' : 'today'
  let list = space[zone]
  if (opts.parentId && zone === 'pinned') {
    const p = locate(state, opts.parentId)
    if (p && p.item.type === 'folder') list = p.item.children
  }
  list.splice(zone === 'today' ? 0 : list.length, 0, note)
  return note
}

function updateNote(state, id, patch) {
  const loc = locate(state, id)
  if (!loc || loc.item.type !== 'note') return false
  if (typeof patch.title === 'string') loc.item.title = patch.title.slice(0, 300)
  if (typeof patch.body === 'string') loc.item.body = patch.body.slice(0, 500000)
  loc.item.updatedAt = Date.now()
  return true
}

// ---------- split extras ----------

// Dropping tab B onto tab A: A's split grows, or a new split is made.
function splitByDrop(state, draggedId, targetId) {
  if (draggedId === targetId) return null
  const t = locate(state, targetId)
  const d = locate(state, draggedId)
  if (!t || !d || !isTab(t.item) || !isTab(d.item)) return null
  const tSplit = t.parent && t.parent.type === 'split' ? t.parent : null
  if (tSplit) {
    if (d.parent === tSplit || tSplit.children.length >= 4) return null
    let tab = d.item
    if (d.zone === 'today') detach(state, draggedId)
    else tab = makeTab({ url: d.item.url, title: d.item.title, favicon: d.item.favicon })
    tSplit.children.push(tab)
    const n = tSplit.children.length
    tSplit.sizes = tSplit.children.map(() => 1 / n)
    return { split: tSplit, ids: tSplit.children.map(c => c.id), focus: tab.id }
  }
  const r = createSplit(state, targetId, draggedId)
  return r ? { split: r.split, ids: r.ids, focus: r.ids[1] } : null
}

function setSplitOrientation(state, splitId, orientation) {
  const loc = locate(state, splitId)
  if (!loc || loc.item.type !== 'split') return false
  loc.item.orientation = orientation === 'column' ? 'column' : 'row'
  return true
}

function swapSplit(state, splitId) {
  const loc = locate(state, splitId)
  if (!loc || loc.item.type !== 'split') return false
  loc.item.children.reverse()
  loc.item.sizes = [...loc.item.sizes].reverse()
  return true
}

// ---------- snooze ----------

function snoozeTab(state, id, until) {
  const loc = locate(state, id)
  if (!loc || !isTab(loc.item) || !(until > Date.now())) return false
  const t = loc.item
  state.snoozed.push({ id: uid('z'), url: t.url, title: t.title, favicon: t.favicon || null, spaceId: loc.space ? loc.space.id : null, until })
  if (loc.zone === 'today') detach(state, id)
  return true
}

// Brings back snoozed tabs whose time has come. Returns the new tab ids.
function wakeSnoozed(state, now = Date.now()) {
  const due = state.snoozed.filter(z => z.until <= now)
  if (!due.length) return []
  state.snoozed = state.snoozed.filter(z => z.until > now)
  return due.map(z => {
    const space = getSpace(state, z.spaceId) || activeSpace(state)
    const tab = addTab(state, space.id, { url: z.url, title: z.title, favicon: z.favicon }, { index: 0 })
    tab.unread = true
    return tab.id
  })
}

// ---------- private space ----------

function addPrivateSpace(state) {
  const existing = state.spaces.find(s => s.private)
  if (existing) return existing
  const s = makeSpace('Private', { icon: 'incognito', theme: { colors: ['#3b2f55', '#231d2e'], mode: 'dark', grain: 0.5, angle: 160, style: 'linear', intensity: 0.5 } })
  s.private = true
  state.spaces.push(s)
  return s
}

// What gets written to disk: private spaces never touch it.
function persistable(state) {
  if (!state.spaces.some(s => s.private)) return state
  const spaces = state.spaces.filter(s => !s.private)
  const activeSpaceId = spaces.some(s => s.id === state.activeSpaceId) ? state.activeSpaceId : spaces[0].id
  return { ...state, spaces, activeSpaceId }
}

module.exports = {
  addNote, updateNote, splitByDrop, setSplitOrientation, swapSplit, snoozeTab, wakeSnoozed, addPrivateSpace, persistable,
  uid, defaults, normalize, makeTab, makeSpace, DEFAULT_SETTINGS, DEFAULT_THEMES, ARCHIVE_LIMIT,
  getSpace, activeSpace, favoritesList, locate, walk, tabsIn, spaceTabIds, allTabIds,
  addTab, updateTab, detach, closeTab, neighbourAfterClose, clearToday, archiveTab, restoreArchived,
  cycleTargets, moveItem, createFolder, renameItem, toggleFolder, deleteFolder,
  createSplit, addToSplit, unsplit, splitOf, setSplitSizes, setPinsMode,
  addSpace, removeSpace, updateSpace, moveSpace, moveTabToSpace,
  addBookmark, addBookmarkFolder, removeBookmark, moveBookmark, findBookmarkByUrl, allBookmarks, bmLocate,
}
