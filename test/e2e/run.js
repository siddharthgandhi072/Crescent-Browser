'use strict'
// End-to-end test: launches the real app (under a virtual display on CI),
// drives it through its own action layer and checks behaviour, then takes
// screenshots. Run with: xvfb-run -a node test/e2e/run.js
const { _electron: electron } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', 'e2e', 'shots')
// CRESCENT_BIN=path/to/packaged/binary runs the same checks against a built app.
const BIN = process.env.CRESCENT_BIN
const launchArgs = () => BIN ? { executablePath: BIN, args: ['--no-sandbox', '--disable-gpu'] } : { executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox', '--disable-gpu'] }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const PAGES = {
  a: ['Field Notes — The Krebs cycle', '#f8f4ee', 'Every cell runs the same eight-step loop.'],
  b: ['Unit 4 Problem Set', '#eef4f8', 'Show your work for each question.'],
  c: ['Track day checklist', '#f4f8ee', 'Tyre pressures, fluids, helmet.'],
  d: ['Lab report draft', '#f8eef4', 'Hypothesis, method, results.'],
  e: ['Weekly planner', '#eef8f6', 'Monday: chem quiz.'],
}
function page(key) {
  const [title, bg, body] = PAGES[key] || ['Page ' + key, '#fff', '']
  return `<!doctype html><html><head><title>${title}</title><link rel="icon" href="data:,"><style>
  body{margin:0;font:16px/1.6 Georgia,serif;background:${bg};color:#2a2520}
  nav{height:52px;border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;padding:0 28px;gap:22px;font:500 13px system-ui;color:#6d6660}
  nav b{font:400 22px Georgia;color:#222;margin-right:auto} main{max-width:640px;margin:56px auto;padding:0 20px}
  h1{font-weight:400;font-size:44px;line-height:1.05;margin:0 0 16px} .fig{height:200px;border-radius:8px;background:linear-gradient(120deg,#efe6d8,#e4dcef);margin:22px 0}
  </style></head><body><nav><b>${title.split(' — ')[0]}</b><span>Notes</span><span>Archive</span><span>About</span></nav>
  <main><h1>${title.split(' — ').pop()}</h1><p>${body} ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(3)}</p><div class="fig"></div>
  <p><a id="ext" href="http://localhost:${PORT}/e">A link to another site</a> · <a id="same" href="/d">same site</a></p></main></body></html>`
}
let PORT = 0

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const server = http.createServer((req, res) => {
    const key = req.url.replace(/^\//, '').split(/[?#]/)[0] || 'a'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page(key))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  PORT = server.address().port
  const U = k => `http://127.0.0.1:${PORT}/${k}`

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'crescent-e2e-'))
  const launch = async (extraEnv = {}) => {
    const app = await electron.launch({
      ...launchArgs(),
      env: { ...process.env, CRESCENT_USER_DATA: userData, CRESCENT_SKIP_SETUP: '1', CRESCENT_TEST: '1', ...extraEnv },
      timeout: 60000,
    })
    app.process().stderr.on('data', d => { const s = String(d); if (/Error|error|Uncaught/.test(s) && !/dbus|GPU|gpu|viz|Fontconfig|NODE_OPTION|ERR_TUNNEL|adblock|libva|Gtk/.test(s)) process.stderr.write('[app] ' + s) })
    app.process().stdout.on('data', d => { const s = String(d); if (/\[actions\]|Error/.test(s)) process.stdout.write('[app] ' + s) })
    const win = await app.firstWindow()
    win.on('console', m => { if (m.type() === 'error') console.log('[sidebar console]', m.text()) })
    win.on('response', r => { if (r.status() >= 400) console.log('[sidebar 404]', r.url()) })
    win.on('pageerror', e => console.log('[sidebar pageerror]', e.message))
    await waitFor(app, () => !!(global.__crescent && global.__crescent.main && global.__crescent.main.win))
    await sleep(800)
    return app
  }
  const waitFor = async (app, fn, arg, timeout = 15000) => {
    const t = Date.now()
    while (Date.now() - t < timeout) {
      try { if (await app.evaluate(fn, arg)) return true } catch {}
      await sleep(100)
    }
    throw new Error('timeout waiting for ' + fn.toString().slice(0, 120))
  }
  const act = (app, name, ...args) => app.evaluate(async (_e, [n, a]) => {
    const r = await global.__crescent.actions.run(global.__crescent.main, n, ...a, {})
    return r === undefined ? null : JSON.parse(JSON.stringify(r))
  }, [name, args])
  const snap = app => app.evaluate(() => {
    const c = global.__crescent
    const s = c.store.state
    const sp = s.spaces.find(x => x.id === s.activeSpaceId)
    const titles = {}
    for (const t of c.main.tabs.values()) titles[t.id] = { title: t.info.title, url: t.info.url }
    return JSON.parse(JSON.stringify({ state: s, space: sp, display: c.main.display, live: [...c.main.tabs.keys()], titles, overlay: c.main.overlayMode, peek: !!c.main.peek }))
  })
  const shot = async (name) => {
    await sleep(500)
    try { execSync(`import -window root ${path.join(SHOTS, name + '.png')}`, { stdio: 'ignore' }); console.log('  📸', name) } catch { /* screenshots are optional */ }
  }
  const ok = msg => console.log('  ✓', msg)

  // ------------------------------------------------------------ run 1
  let app = await launch()
  console.log('Launched')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 34, width: 1360, height: 832 }) })

  // Open tabs
  for (const k of ['a', 'b', 'c']) await act(app, 'tab:new', U(k))
  await waitFor(app, () => [...global.__crescent.main.tabs.values()].some(t => t.info.title.startsWith('Track day')))
  let s = await snap(app)
  assert.equal(s.space.today.length, 3)
  assert.equal(s.space.today[0].url, U('c'), 'newest on top')
  assert.deepEqual(s.display, [s.space.today[0].id])
  ok('new tabs open on top and become active')

  // Pin one, favourite one
  const idA = s.space.today.find(t => t.url === U('a')).id
  const idB = s.space.today.find(t => t.url === U('b')).id
  await act(app, 'item:move', idA, { zone: 'pinned', index: 0 })
  await act(app, 'item:move', idB, { zone: 'favorites', index: 0 })
  s = await snap(app)
  assert.equal(s.space.pinned[0].id, idA)
  assert.equal(s.state.favorites[0].id, idB)
  ok('drag to pinned and to pinned bar')

  // Folder in pinned
  const fid = await act(app, 'folder:create', { title: 'AP Chem' })
  await act(app, 'item:move', idA, { zone: 'pinned', parentId: fid, index: 0 })
  s = await snap(app)
  assert.equal(s.space.pinned[0].children[0].id, idA)
  ok('folders in pinned tabs')

  // More today tabs, then ctrl+number skips pinned
  await act(app, 'tab:new', U('d'))
  await act(app, 'tab:new', U('e'))
  s = await snap(app)
  const today = s.space.today.map(t => t.id)
  await act(app, 'tab:selectIndex', 1)
  s = await snap(app)
  assert.equal(s.space.activeId, today[0], 'ctrl+1 = first Today tab, not a pin')
  await act(app, 'tab:selectIndex', 9)
  s = await snap(app)
  assert.equal(s.space.activeId, today[today.length - 1], 'ctrl+9 = last Today tab')
  ok('ctrl+1..9 cycle Today tabs and skip pinned')

  // Screenshot: main window
  await act(app, 'tab:select', idA)
  await waitFor(app, (_e, id) => { const t = global.__crescent.main.tabs.get(id); return t && !t.info.loading && t.info.title }, idA)
  await shot('01-main')

  // Command bar
  await act(app, 'overlay:open', 'command', { mode: 'new' })
  await sleep(300)
  const ovWc = await app.evaluate(() => global.__crescent.main.overlay.webContents.id)
  await app.evaluate(({ webContents }, id) => webContents.fromId(id).insertText('track'), ovWc)
  await sleep(700)
  await shot('02-command-bar')
  await act(app, 'overlay:close')

  // Split view
  await act(app, 'tab:select', today[0])
  await act(app, 'split:new', U('d'))
  s = await snap(app)
  assert.equal(s.display.length, 2)
  assert.equal(s.space.today[0].type, 'split')
  ok('split view')
  await sleep(600)
  await shot('03-split')

  // Close one side unwraps the split
  await act(app, 'tab:close', s.display[1])
  s = await snap(app)
  assert.equal(s.display.length, 1)
  assert.ok(!s.space.today.some(i => i.type === 'split'))
  ok('closing a split side unwraps it')

  // Library + theme picker
  await act(app, 'overlay:open', 'library', { tab: 'archive' })
  await sleep(500)
  await shot('04-library')
  await act(app, 'overlay:close')
  await act(app, 'space:theme')
  await sleep(500)
  await shot('05-theme')
  await act(app, 'overlay:close')

  // Close everything in Today: goes to the most recent pinned tab
  await act(app, 'tab:select', idA)
  await act(app, 'tab:select', today[0])
  for (const t of (await snap(app)).space.today.slice()) await act(app, 'tab:close', t.type === 'split' ? t.children[0].id : t.id)
  s = await snap(app)
  assert.equal(s.space.today.length, 0)
  assert.equal(s.space.activeId, idA, 'falls back to the pinned tab')
  assert.ok(s.state.archive.length >= 3, 'closed tabs archived')
  ok('closing all tabs lands on pinned tab; closed tabs archived')

  // Cmd+W on a pinned tab keeps the pin
  await act(app, 'tab:close', idA)
  s = await snap(app)
  assert.ok(JSON.stringify(s.space.pinned).includes(idA))
  assert.ok(!s.live.includes(idA))
  ok('closing a pinned tab unloads it but keeps the pin')

  // Reopen closed tab
  await act(app, 'tab:reopen')
  s = await snap(app)
  assert.equal(s.space.today.length, 1)
  ok('reopen closed tab')

  // Spaces
  const sid = await act(app, 'space:create', { name: 'School', icon: 'school', theme: { colors: ['#b9cdf3', '#d8c4f0'], mode: 'auto', grain: 0.4 } })
  s = await snap(app)
  assert.equal(s.state.activeSpaceId, sid)
  assert.equal(s.display.length, 0, 'new space starts empty')
  assert.equal(s.state.favorites[0].id, idB, 'global pins visible in every space')
  await shot('06-empty-space')
  await act(app, 'tab:new', U('e'))
  await act(app, 'space:switch', -1)
  s = await snap(app)
  assert.notEqual(s.state.activeSpaceId, sid)
  await act(app, 'space:switch', sid)
  s = await snap(app)
  assert.equal(s.space.today[0].url, U('e'))
  ok('spaces keep their own tabs')

  // Pins mode toggle keeps pins
  await act(app, 'pins:mode', 'space')
  s = await snap(app)
  assert.equal(s.state.favorites.length, 0)
  assert.ok(s.state.spaces.every(x => x.favorites.some(f => f.url === U('b'))))
  await act(app, 'pins:mode', 'global')
  s = await snap(app)
  assert.equal(s.state.favorites.length, 1)
  ok('pins mode switch keeps every pin')

  // Peek (shift-click = new-window disposition)
  await act(app, 'peek:open', U('c'))
  await sleep(800)
  s = await snap(app)
  assert.equal(s.peek, true)
  await shot('07-peek')
  await act(app, 'peek:expand', false)
  s = await snap(app)
  assert.equal(s.peek, false)
  assert.equal(s.space.today[0].url, U('c'))
  ok('peek and promote to tab')

  // Bookmarks
  await act(app, 'bookmarks:addCurrent')
  await act(app, 'overlay:open', 'bookmarks', {})
  await sleep(500)
  await shot('08-bookmarks')
  await act(app, 'overlay:close')
  s = await snap(app)
  assert.equal(s.state.bookmarks.children.length, 1)
  ok('bookmarks')

  // Dark mode screenshot
  await act(app, 'space:update', sid, { theme: { colors: ['#3b2c63', '#4f2c1e'], mode: 'dark', grain: 0.4 } })
  await act(app, 'overlay:open', 'command', { mode: 'new' })
  await sleep(700)
  await shot('09-dark-command')
  await act(app, 'overlay:close')

  // Sidebar hidden
  await act(app, 'sidebar:toggle')
  await sleep(500)
  await shot('10-sidebar-hidden')
  await act(app, 'sidebar:toggle')

  // Little Crescent
  await app.evaluate((_e, url) => global.__crescent.openExternalUrl(url), U('d'))
  await sleep(1500)
  await shot('11-little')
  const moved = await app.evaluate(() => { const l = [...global.__crescent.littles][0]; if (!l) return false; l.moveToMain(); return true })
  assert.ok(moved)
  await sleep(500)
  s = await snap(app)
  assert.equal(s.space.today[0].url, U('d'))
  ok('Little Crescent → main window keeps the page')

  // Persistence across restart
  const before = await snap(app)
  await app.evaluate(() => global.__crescent.store.flush())
  await app.close()
  app = await launch()
  s = await snap(app)
  assert.equal(s.state.spaces.length, before.state.spaces.length)
  assert.equal(s.state.favorites[0].url, U('b'))
  assert.ok(JSON.stringify(s.state).includes('AP Chem'))
  assert.ok(s.live.length <= 1, 'only the active tab loads at startup')
  ok('everything survives a restart; lazy restore')
  await app.close()

  // Settings + setup windows (fresh profile, setup not skipped)
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'crescent-e2e-setup-'))
  const app2 = await electron.launch({ ...launchArgs(), env: { ...process.env, CRESCENT_USER_DATA: fresh, CRESCENT_TEST: '1' } })
  const setup = await app2.firstWindow()
  setup.on('pageerror', e => console.log('[setup pageerror]', e.message))
  await sleep(1500)
  await shot('12-setup-welcome')
  await setup.click('button.pri')
  await sleep(1200)
  await shot('13-setup-import')
  await setup.click('button.gh')
  await sleep(600)
  await shot('14-setup-spaces')
  await setup.click('button.pri')
  await sleep(500)
  await shot('15-setup-pins')
  await setup.click('button.pri')
  await sleep(500)
  await setup.click('button.pri')
  await waitFor(app2, () => !!(global.__crescent.main && global.__crescent.main.win && global.__crescent.store.state.settings.onboarded))
  const st2 = await app2.evaluate(() => global.__crescent.store.state.spaces.map(s => s.name))
  assert.deepEqual(st2, ['Personal', 'School'])
  ok('setup flow creates spaces and opens the browser')
  await app2.evaluate(() => { global.__crescent.main.closeOverlay(); global.__crescent.windows.openSettings('tabs') })
  await sleep(1500)
  await app2.evaluate(() => { const w = global.__crescent.windows.settings; w.setBounds({ x: 290, y: 130, width: 860, height: 640 }); w.moveTop(); w.focus() })
  await sleep(500)
  await shot('16-settings')
  await app2.close()

  server.close()
  console.log('\nAll end-to-end checks passed.')
}

main().catch(err => { console.error('\nE2E FAILED:', err); process.exit(1) })
