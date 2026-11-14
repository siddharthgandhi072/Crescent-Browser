'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../src/main/model')

const fresh = () => M.normalize(M.defaults())
const sp = s => s.spaces[0]

test('new tabs go on top of Today', () => {
  const s = fresh()
  const a = M.addTab(s, sp(s).id, { url: 'https://a.com' })
  const b = M.addTab(s, sp(s).id, { url: 'https://b.com' })
  assert.deepEqual(sp(s).today.map(t => t.id), [b.id, a.id])
})

test('closing a Today tab archives it; closing a pinned tab keeps it', () => {
  const s = fresh()
  const p = M.addTab(s, sp(s).id, { url: 'https://pinned.com' }, { zone: 'pinned' })
  const t = M.addTab(s, sp(s).id, { url: 'https://today.com', title: 'Today' })
  assert.equal(M.closeTab(s, t.id).removed, true)
  assert.equal(s.archive[0].url, 'https://today.com')
  assert.equal(M.closeTab(s, p.id).removed, false)
  assert.ok(M.locate(s, p.id))
})

test('ctrl+number targets skip pinned tabs and favorites', () => {
  const s = fresh()
  M.addTab(s, sp(s).id, { url: 'https://fav.com' }, { zone: 'favorites' })
  M.addTab(s, sp(s).id, { url: 'https://pin.com' }, { zone: 'pinned' })
  const a = M.addTab(s, sp(s).id, { url: 'https://a.com' }, { index: 99 })
  const b = M.addTab(s, sp(s).id, { url: 'https://b.com' }, { index: 99 })
  assert.deepEqual(M.cycleTargets(s, sp(s).id), [a.id, b.id])
})

test('neighbour after close prefers below then above', () => {
  const s = fresh()
  const id = sp(s).id
  const c = M.addTab(s, id, { url: 'c' }); const b = M.addTab(s, id, { url: 'b' }); const a = M.addTab(s, id, { url: 'a' })
  assert.equal(M.neighbourAfterClose(s, b.id), c.id)
  assert.equal(M.neighbourAfterClose(s, c.id), b.id)
  M.closeTab(s, a.id); M.closeTab(s, b.id)
  assert.equal(M.neighbourAfterClose(s, c.id), null)
})

test('pins mode toggle never loses pins', () => {
  const s = fresh()
  const s2 = M.addSpace(s, 'School')
  M.addTab(s, sp(s).id, { url: 'https://mail.com' }, { zone: 'favorites' })
  M.addTab(s, sp(s).id, { url: 'https://cal.com' }, { zone: 'favorites' })
  M.setPinsMode(s, 'space')
  assert.equal(s.favorites.length, 0)
  assert.deepEqual(sp(s).favorites.map(f => f.url), ['https://mail.com', 'https://cal.com'])
  assert.deepEqual(s2.favorites.map(f => f.url), ['https://mail.com', 'https://cal.com'])
  // ids must differ between spaces so they can be edited independently
  assert.notEqual(sp(s).favorites[0].id, s2.favorites[0].id)
  M.addTab(s, s2.id, { url: 'https://canvas.com' }, { zone: 'favorites' })
  M.setPinsMode(s, 'global')
  assert.deepEqual(s.favorites.map(f => f.url), ['https://mail.com', 'https://cal.com', 'https://canvas.com'])
  assert.equal(s2.favorites.length, 0)
})

test('folders: create, nest, refuse cycles, delete keeps children', () => {
  const s = fresh()
  const id = sp(s).id
  const t1 = M.addTab(s, id, { url: 'x' }, { zone: 'pinned' })
  const f = M.createFolder(s, id, { title: 'AP Chem', childIds: [t1.id] })
  assert.equal(f.children[0].id, t1.id)
  const inner = M.createFolder(s, id, { title: 'Inner', parentId: f.id })
  assert.equal(M.moveItem(s, f.id, { spaceId: id, zone: 'pinned', parentId: inner.id }), false)
  assert.equal(M.moveItem(s, f.id, { spaceId: id, zone: 'today' }), false)
  M.deleteFolder(s, f.id)
  assert.ok(sp(s).pinned.some(i => i.id === t1.id))
})

test('drag a Today tab into pinned and into favorites', () => {
  const s = fresh()
  const id = sp(s).id
  const t = M.addTab(s, id, { url: 'https://x.com' })
  assert.ok(M.moveItem(s, t.id, { spaceId: id, zone: 'pinned', index: 0 }))
  assert.equal(M.locate(s, t.id).zone, 'pinned')
  assert.ok(M.moveItem(s, t.id, { spaceId: id, zone: 'favorites', index: 0 }))
  assert.equal(M.locate(s, t.id).zone, 'favorites')
  assert.equal(s.favorites[0].id, t.id)
})

test('moving down within a list lands at the drop position', () => {
  const s = fresh()
  const id = sp(s).id
  const [a, b, c] = ['a', 'b', 'c'].map(u => M.addTab(s, id, { url: u }, { index: 99 }))
  M.moveItem(s, a.id, { spaceId: id, zone: 'today', index: 2 }) // drop between b and c
  assert.deepEqual(sp(s).today.map(t => t.url), ['b', 'a', 'c'])
})

test('split view: create, close a side unwraps, pins are copied not consumed', () => {
  const s = fresh()
  const id = sp(s).id
  const pin = M.addTab(s, id, { url: 'https://pin.com' }, { zone: 'pinned' })
  const a = M.addTab(s, id, { url: 'https://a.com' })
  const r = M.createSplit(s, a.id, pin.id)
  assert.ok(r)
  assert.equal(sp(s).today[0].type, 'split')
  assert.ok(M.locate(s, pin.id), 'pinned tab still exists')
  assert.notEqual(r.ids[1], pin.id)
  M.closeTab(s, r.ids[1])
  assert.equal(sp(s).today[0].type, 'tab')
  assert.equal(sp(s).today[0].id, a.id)
})

test('clear archives every Today tab', () => {
  const s = fresh()
  const id = sp(s).id
  M.addTab(s, id, { url: 'a' }); M.addTab(s, id, { url: 'b' })
  assert.equal(M.clearToday(s, id).length, 2)
  assert.equal(sp(s).today.length, 0)
  assert.equal(s.archive.length, 2)
  const r = M.restoreArchived(s, s.archive[0].id, id)
  assert.equal(sp(s).today[0].id, r.tab.id)
})

test('normalize repairs corrupt state', () => {
  const s = M.normalize({
    spaces: [{ id: 'dup', today: [{ type: 'folder', children: [] }, { type: 'split', children: [{ type: 'tab', url: 'a' }] }, null, { id: 'dup', type: 'tab', url: 'b' }] }],
    favorites: [{ type: 'folder' }],
    activeSpaceId: 'nope',
    settings: { pinsMode: 'weird' },
  })
  const space = s.spaces[0]
  assert.equal(s.activeSpaceId, space.id)
  assert.equal(s.settings.pinsMode, 'global')
  assert.equal(s.favorites.length, 0)
  assert.deepEqual(space.today.map(t => t.type), ['tab', 'tab'])
  const ids = [space.id, ...space.today.map(t => t.id)]
  assert.equal(new Set(ids).size, ids.length)
  assert.doesNotThrow(() => M.normalize(null))
  assert.doesNotThrow(() => M.normalize('garbage'))
})

test('removing a space archives its tabs and keeps one space', () => {
  const s = fresh()
  const b = M.addSpace(s, 'B')
  M.addTab(s, b.id, { url: 'https://x' })
  s.activeSpaceId = b.id
  M.removeSpace(s, b.id)
  assert.equal(s.spaces.length, 1)
  assert.equal(s.activeSpaceId, s.spaces[0].id)
  assert.equal(s.archive[0].url, 'https://x')
  assert.equal(M.removeSpace(s, s.spaces[0].id), false)
})

test('bookmarks: add, move into folder, refuse cycles', () => {
  const s = fresh()
  const f = M.addBookmarkFolder(s, { title: 'School' })
  const g = M.addBookmarkFolder(s, { title: 'Inner', parentId: f.id })
  const b = M.addBookmark(s, { url: 'https://x', title: 'X' })
  assert.ok(M.moveBookmark(s, b.id, f.id))
  assert.equal(f.children.at(-1).id, b.id)
  assert.equal(M.moveBookmark(s, f.id, g.id), false)
  assert.equal(M.findBookmarkByUrl(s, 'https://x').id, b.id)
  assert.equal(M.allBookmarks(s)[0].path, 'School')
})

test('theme validation rejects junk colours', () => {
  const s = fresh()
  M.updateSpace(s, sp(s).id, { theme: { colors: ['red', '#123456'], mode: 'nope', grain: 9 } })
  assert.deepEqual(sp(s).theme.colors, ['#123456'])
  assert.equal(sp(s).theme.mode, 'auto')
  assert.equal(sp(s).theme.grain, 1)
})
