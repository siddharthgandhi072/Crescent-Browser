'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../src/main/model')
const { cmp } = require('../src/main/updater')

const fresh = () => M.normalize(M.defaults())
const sp = s => s.spaces[0]

test('notes live in Today/pinned, survive close and clear', () => {
  const s = fresh()
  const n = M.addNote(s, sp(s).id, { title: 'Ideas' })
  M.addTab(s, sp(s).id, { url: 'https://a' })
  assert.equal(M.closeTab(s, n.id).removed, false)
  M.clearToday(s, sp(s).id)
  assert.deepEqual(sp(s).today.map(i => i.type), ['note'])
  assert.ok(M.updateNote(s, n.id, { body: 'hello' }))
  assert.equal(M.locate(s, n.id).item.body, 'hello')
  assert.equal(M.moveItem(s, n.id, { spaceId: sp(s).id, zone: 'favorites' }), false)
  assert.ok(M.moveItem(s, n.id, { spaceId: sp(s).id, zone: 'pinned' }))
})

test('drag a tab onto a tab makes a split, onto a split adds to it (max 4)', () => {
  const s = fresh()
  const id = sp(s).id
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(u => M.addTab(s, id, { url: u }, { index: 99 }))
  let r = M.splitByDrop(s, b.id, a.id)
  assert.equal(r.split.children.length, 2)
  r = M.splitByDrop(s, c.id, a.id)
  assert.equal(r.split.children.length, 3)
  M.splitByDrop(s, d.id, b.id)
  assert.equal(M.splitByDrop(s, e.id, a.id), null, 'no fifth pane')
  assert.equal(sp(s).today.filter(i => i.type === 'split').length, 1)
})

test('split orientation and swap', () => {
  const s = fresh()
  const id = sp(s).id
  const a = M.addTab(s, id, { url: 'a' }); const b = M.addTab(s, id, { url: 'b' })
  const r = M.createSplit(s, a.id, b.id)
  M.setSplitSizes(s, r.split.id, [0.7, 0.3])
  M.setSplitOrientation(s, r.split.id, 'column')
  M.swapSplit(s, r.split.id)
  const split = M.locate(s, r.split.id).item
  assert.equal(split.orientation, 'column')
  assert.equal(split.children[0].id, b.id)
  assert.deepEqual(split.sizes.map(x => +x.toFixed(2)), [0.3, 0.7])
})

test('snooze removes the tab and wakes it later on top with a dot', () => {
  const s = fresh()
  const t = M.addTab(s, sp(s).id, { url: 'https://later' })
  assert.ok(M.snoozeTab(s, t.id, Date.now() + 1000))
  assert.equal(sp(s).today.length, 0)
  assert.deepEqual(M.wakeSnoozed(s, Date.now()), [])
  const ids = M.wakeSnoozed(s, Date.now() + 2000)
  assert.equal(ids.length, 1)
  assert.equal(sp(s).today[0].url, 'https://later')
  assert.equal(sp(s).today[0].unread, true)
})

test('private space never reaches disk and leaves no archive', () => {
  const s = fresh()
  const p = M.addPrivateSpace(s)
  s.activeSpaceId = p.id
  const t = M.addTab(s, p.id, { url: 'https://secret' })
  M.closeTab(s, t.id)
  assert.equal(s.archive.length, 0)
  const disk = M.persistable(s)
  assert.ok(!disk.spaces.some(x => x.private))
  assert.notEqual(disk.activeSpaceId, p.id)
  assert.ok(!M.normalize(JSON.parse(JSON.stringify(s))).spaces.some(x => x.private))
})

test('version compare for updates', () => {
  assert.ok(cmp('0.2.0', '0.1.9') > 0)
  assert.ok(cmp('0.10.0', '0.9.0') > 0)
  assert.equal(cmp('1.0.0', '1.0.0'), 0)
})

test('calculator and unit conversion', async () => {
  const { calculate } = await import('../src/renderer/shared/calc.js')
  assert.equal(calculate('2+2*3').value, '8')
  assert.equal(calculate('(1+2)^2').value, '9')
  assert.equal(calculate('sqrt(16)').value, '4')
  assert.equal(calculate('10 km in miles').value, '6.2137119224 miles')
  assert.equal(calculate('212 f to c').value, '100 c')
  assert.equal(calculate('hello world'), null)
  assert.equal(calculate('42'), null)
  assert.equal(calculate('alert(1)'), null)
  assert.equal(calculate('process.exit()'), null)
})
