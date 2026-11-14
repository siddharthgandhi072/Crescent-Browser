'use strict'
// Safari bookmarks and history. macOS protects ~/Library/Safari, so this
// needs Full Disk Access; we detect that and tell you how to grant it.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const C = require('./common')

const dir = () => path.join(C.home(), 'Library', 'Safari')

function detect() {
  if (process.platform !== 'darwin' && !process.env.CRESCENT_IMPORT_HOME) return []
  if (!fs.existsSync(dir())) return []
  let access = true
  try { fs.accessSync(path.join(dir(), 'Bookmarks.plist'), fs.constants.R_OK); fs.readFileSync(path.join(dir(), 'Bookmarks.plist')).subarray(0, 1) } catch { access = false }
  return [{ id: 'safari:default', browser: 'safari', name: 'Safari', profile: 'Default', kind: 'safari', needsFullDiskAccess: !access }]
}

function plistToJson(file) {
  const out = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out.toString('utf8'))
}

function readBookmarks() {
  const file = path.join(dir(), 'Bookmarks.plist')
  const data = file.endsWith('.json') ? C.readJson(file) : plistToJson(file)
  const conv = n => {
    if (!n) return null
    if (n.WebBookmarkType === 'WebBookmarkTypeLeaf' && n.URLString) {
      return { type: 'bookmark', url: n.URLString, title: (n.URIDictionary && n.URIDictionary.title) || n.URLString }
    }
    if (n.WebBookmarkType === 'WebBookmarkTypeList') {
      if (n.Title === 'com.apple.ReadingList') return { type: 'folder', title: 'Reading List', children: (n.Children || []).map(conv).filter(Boolean) }
      return { type: 'folder', title: n.Title === 'BookmarksBar' ? 'Favourites' : n.Title === 'BookmarksMenu' ? 'Bookmarks Menu' : n.Title || 'Folder', children: (n.Children || []).map(conv).filter(Boolean) }
    }
    return null
  }
  return (data.Children || []).map(conv).filter(x => x && (x.type === 'bookmark' || x.children.length))
}

function readHistory(limit = 50000) {
  const h = C.openCopy(path.join(dir(), 'History.db'))
  if (!h) return []
  try {
    return h.db.prepare(`SELECT i.url AS url, v.title AS title, i.visit_count AS visits, max(v.visit_time) AS last
      FROM history_items i JOIN history_visits v ON v.history_item = i.id GROUP BY i.id ORDER BY last DESC LIMIT ?`).all(limit)
      .map(r => ({ url: r.url, title: r.title || '', visits: r.visits || 1, typed: 0, last: Math.round((Number(r.last) + 978307200) * 1000) }))
  } catch { return [] } finally { h.close() }
}

module.exports = { detect, readBookmarks, readHistory }
