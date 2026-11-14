'use strict'
// Arc's sidebar (spaces, pinned tabs, folders, favorites, unpinned tabs)
// from ~/Library/Application Support/Arc/StorableSidebar.json.
//
// Arc stores lists as flat alternating arrays: [id, object, id, object...]
// and items reference each other by id (childrenIds / parentID).

const C = require('./common')

function pairs(arr) {
  const map = new Map()
  if (!Array.isArray(arr)) return map
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v && typeof v === 'object' && v.id) map.set(v.id, v)
    else if (typeof v === 'string' && arr[i + 1] && typeof arr[i + 1] === 'object') { map.set(v, { id: v, ...arr[i + 1] }); i++ }
  }
  return map
}

// Arc colours are 0..1 floats: { red, green, blue }. Collect a few.
function findColors(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14 || out.length >= 3) return out
  if (typeof obj.red === 'number' && typeof obj.green === 'number' && typeof obj.blue === 'number') {
    const h = x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')
    const hex = '#' + h(obj.red) + h(obj.green) + h(obj.blue)
    if (!out.includes(hex)) out.push(hex)
    return out
  }
  for (const v of Object.values(obj)) findColors(v, out, depth + 1)
  return out
}

function findEmoji(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null
  for (const [k, v] of Object.entries(obj)) {
    if (/emoji/i.test(k) && typeof v === 'string') return v
    const r = findEmoji(v, depth + 1)
    if (r) return r
  }
  return null
}

function parse(json) {
  const containers = json && json.sidebar && json.sidebar.containers
  if (!Array.isArray(containers)) throw new Error('Unrecognised Arc sidebar format')
  const main = containers.find(c => c && c.spaces && c.items) || containers[1]
  if (!main) throw new Error('No Arc spaces found')
  const items = pairs(main.items)
  const spacesMap = pairs(main.spaces)

  const toTab = it => {
    const tab = it.data && it.data.tab
    if (!tab || !tab.savedURL) return null
    return { type: 'tab', url: tab.savedURL, title: it.title || tab.savedTitle || tab.savedURL }
  }
  const convert = (id, depth = 0) => {
    const it = items.get(id)
    if (!it || depth > 30) return []
    const d = it.data || {}
    if (d.tab) { const t = toTab(it); return t ? [t] : [] }
    if (d.list !== undefined) {
      return [{ type: 'folder', title: it.title || 'Folder', open: true, children: (it.childrenIds || []).flatMap(c => convert(c, depth + 1)) }]
    }
    // Split views and other groups: keep their tabs.
    return (it.childrenIds || []).flatMap(c => convert(c, depth + 1))
  }
  const containerChildren = cid => {
    const it = items.get(cid)
    return it ? (it.childrenIds || []).flatMap(c => convert(c)) : []
  }

  const spaces = []
  const orderIds = Array.isArray(main.spaces) ? main.spaces.filter(x => typeof x === 'string') : []
  const ordered = orderIds.length ? orderIds.map(id => spacesMap.get(id)).filter(Boolean) : [...spacesMap.values()]
  for (const sp of ordered) {
    const cids = Array.isArray(sp.containerIDs) ? sp.containerIDs : []
    let pinnedId = null, unpinnedId = null
    for (let i = 0; i < cids.length - 1; i++) {
      if (cids[i] === 'pinned') pinnedId = cids[i + 1]
      if (cids[i] === 'unpinned') unpinnedId = cids[i + 1]
    }
    const colors = findColors(sp.customInfo && sp.customInfo.windowTheme).slice(0, 2)
    spaces.push({
      name: sp.title || 'Space',
      emoji: findEmoji(sp.customInfo),
      colors,
      pinned: pinnedId ? containerChildren(pinnedId) : [],
      today: unpinnedId ? containerChildren(unpinnedId).filter(x => x.type === 'tab') : [],
    })
  }

  // Favorites (the icon grid). Containers listed in topAppsContainerIDs.
  const favorites = []
  const seen = new Set()
  for (const cid of Array.isArray(main.topAppsContainerIDs) ? main.topAppsContainerIDs : []) {
    if (typeof cid !== 'string') continue
    for (const t of containerChildren(cid)) {
      if (t.type === 'tab' && !seen.has(t.url)) { seen.add(t.url); favorites.push(t) }
    }
  }
  return { spaces, favorites }
}

function read() {
  const file = C.appSupport('Arc', 'StorableSidebar.json')
  const json = C.readJson(file)
  if (!json) return null
  return parse(json)
}

module.exports = { parse, read, pairs, findColors }
