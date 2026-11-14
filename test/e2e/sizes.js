'use strict'
// Layout check: renders the main surfaces at several window and sidebar
// sizes and screenshots them, and fails if anything in the sidebar overflows.
// Run with: xvfb-run -a -s "-screen 0 2000x1300x24" node test/e2e/sizes.js
const { _electron: electron } = require('playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', 'e2e', 'shots-sizes')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, CRESCENT_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'cr-sizes-')), CRESCENT_SKIP_SETUP: '1', CRESCENT_TEST: '1' },
  })
  const win = await app.firstWindow()
  await sleep(1500)
  const act = (name, ...args) => app.evaluate(async (_e, [n, a]) => { const r = await global.__crescent.actions.run(global.__crescent.main, n, ...a, {}); return r === undefined ? null : JSON.parse(JSON.stringify(r)) }, [name, args])
  // Some content: many spaces, long names, folders, pins.
  for (const n of ['School', 'Cars and Track Days With a Long Name', 'Music', 'Work', 'Gaming', 'Projects', 'Reading']) await act('space:create', { name: n })
  await act('space:switchIndex', 1)
  for (const u of ['data:text/html,<title>A very long tab title that keeps going and going</title>', 'data:text/html,<title>Short</title>']) await act('tab:new', u)
  const fid = await act('folder:create', { title: 'A folder with a really long name for testing' })
  const s = await app.evaluate(() => global.__crescent.main.space.today.map(t => t.id))
  await act('item:move', s[0], { zone: 'pinned', parentId: fid, index: 0 })
  for (let i = 0; i < 6; i++) { await act('tab:new', `data:text/html,<title>Pin ${i}</title>`); const id = await app.evaluate(() => global.__crescent.main.space.activeId); await act('item:move', id, { zone: 'favorites' }) }
  await act('note:new')

  const problems = []
  const check = async label => {
    const bad = await win.evaluate(() => {
      document.documentElement.classList.add('mac') // reserve the traffic-light space like on a Mac
      const out = []
      const sb = document.querySelector('.sidebar')
      if (!sb) return out
      const W = sb.getBoundingClientRect()
      for (const el of sb.querySelectorAll('.topbar .ib, .url, .fav, .row, .bottom .ib, .bottom .sp, .space-name, .player, .update')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right > W.right + 0.5 || r.left < W.left - 0.5) out.push(`${el.className.split(' ')[0]} spills ${Math.round(r.right - W.right)}px`)
      }
      for (const el of sb.querySelectorAll('.tools, .bottom, .spaces')) if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} overflows by ${el.scrollWidth - el.clientWidth}px`)
      return out
    })
    for (const b of bad) problems.push(`${label}: ${b}`)
  }
  const shot = name => { try { execSync(`import -window root ${path.join(SHOTS, name + '.png')}`, { stdio: 'ignore' }) } catch {} }

  const sizes = [[640, 440], [900, 620], [1280, 800], [1900, 1180]]
  const widths = [200, 262, 420]
  for (const [w, h] of sizes) {
    for (const sbw of widths) {
      await app.evaluate((_e, [w, h, sbw]) => { const m = global.__crescent.main; m.win.setBounds({ x: 10, y: 10, width: w, height: h }); m.setSidebarWidth(sbw) }, [w, h, sbw])
      await sleep(350)
      await check(`${w}x${h} sidebar ${sbw}`)
    }
    await app.evaluate(() => global.__crescent.main.setSidebarWidth(262))
    for (const [mode, data] of [['command', { mode: 'new' }], ['settings', { section: 'appearance' }], ['theme', {}], ['focus', {}], ['bookmarks', {}]]) {
      await act('overlay:open', mode, data)
      await sleep(450)
      shot(`${w}x${h}-${mode}`)
      await act('overlay:close')
    }
    await act('library:open', 'archive'); await sleep(300); shot(`${w}x${h}-library`); await act('library:close')
    shot(`${w}x${h}-main`)
  }
  await app.close()
  if (problems.length) { console.log('LAYOUT PROBLEMS:\n' + [...new Set(problems)].join('\n')); process.exit(1) }
  console.log('Layout OK at every size.')
}
main().catch(e => { console.error(e); process.exit(1) })
