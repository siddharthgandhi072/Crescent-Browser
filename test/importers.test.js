'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const C = require('../src/main/importers/common')
const arc = require('../src/main/importers/arc')
const ff = require('../src/main/importers/firefox')
const { parseCsv, originOf } = require('../src/main/passwords')
const { resolveInput, queryFromSearchUrl } = require('../src/main/urls')
const M = require('../src/main/model')

test('chromium v10 decrypt round-trip, with and without cookie domain hash', () => {
  const key = C.chromiumKey('secret-from-keychain')
  assert.equal(C.chromiumDecrypt(C.chromiumEncryptForTest('hunter2', key), key), 'hunter2')
  const hash = crypto.createHash('sha256').update('example.com').digest()
  assert.equal(C.chromiumDecrypt(C.chromiumEncryptForTest('cookieval', key, hash), key, { stripDomainHash: true }), 'cookieval')
  assert.equal(C.chromiumDecrypt(C.chromiumEncryptForTest('x', key), C.chromiumKey('wrong')), null)
  assert.equal(C.chromiumDecrypt(Buffer.from('plain'), key), 'plain')
})

test('webkit timestamps', () => {
  const now = Date.UTC(2026, 0, 1)
  assert.equal(C.webkitToMs(C.msToWebkit(now)), now)
})

test('arc sidebar parser: spaces, folders, favorites, colours', () => {
  const json = {
    sidebar: {
      containers: [{ global: {} }, {
        spaces: ['S1', { title: 'School', containerIDs: ['pinned', 'P1', 'unpinned', 'U1'], customInfo: { windowTheme: { a: { color: { red: 1, green: 0.5, blue: 0 } } }, iconType: { emoji_v2: '📚' } } }],
        items: [
          'P1', { childrenIds: ['F1', 'T1'], data: { itemContainer: {} } },
          'F1', { title: 'AP Chem', childrenIds: ['T2'], data: { list: {} } },
          'T1', { data: { tab: { savedURL: 'https://canvas.example', savedTitle: 'Canvas' } } },
          'T2', { title: 'Problem set', data: { tab: { savedURL: 'https://ps.example', savedTitle: 'PS' } } },
          'U1', { childrenIds: ['T3', 'SV'], data: { itemContainer: {} } },
          'T3', { data: { tab: { savedURL: 'https://news.example', savedTitle: 'News' } } },
          'SV', { childrenIds: ['T4'], data: { splitView: {} } },
          'T4', { data: { tab: { savedURL: 'https://split.example' } } },
          'FAV', { childrenIds: ['T5'], data: { itemContainer: {} } },
          'T5', { data: { tab: { savedURL: 'https://mail.example', savedTitle: 'Mail' } } },
        ],
        topAppsContainerIDs: [{ default: true }, 'FAV'],
      }],
    },
  }
  const r = arc.parse(json)
  assert.equal(r.spaces.length, 1)
  const s = r.spaces[0]
  assert.equal(s.name, 'School')
  assert.equal(s.emoji, '📚')
  assert.deepEqual(s.colors, ['#ff8000'])
  assert.equal(s.pinned[0].type, 'folder')
  assert.equal(s.pinned[0].children[0].title, 'Problem set')
  assert.equal(s.pinned[1].url, 'https://canvas.example')
  assert.deepEqual(s.today.map(t => t.url), ['https://news.example', 'https://split.example'])
  assert.deepEqual(r.favorites.map(f => f.url), ['https://mail.example'])

  // and into Crescent state
  const { importSpaces } = require('../src/main/importers')
  const state = M.normalize(M.defaults())
  importSpaces(state, r)
  assert.equal(state.spaces.length, 1, 'empty starter space replaced')
  assert.equal(state.spaces[0].name, 'School')
  assert.equal(state.favorites[0].url, 'https://mail.example')
  assert.equal(state.spaces[0].pinned[0].type, 'folder')
})

test('mozlz4 decoder', () => {
  // Hand-built LZ4 block: literal "abc" then a match copying "abcabc".
  // token: 3 literals, match len 6 (6-4=2) -> 0x32; offset 3
  const block = Buffer.from([0x32, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x21])
  // last sequence: 1 literal '!' (0x10 token, then '!')
  assert.equal(ff.lz4Block(block, 10).toString(), 'abcabcabc!')
})

test('chromium bookmarks + history from fixture profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-home-'))
  process.env.CRESCENT_IMPORT_HOME = home
  const prof = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default')
  fs.mkdirSync(prof, { recursive: true })
  fs.writeFileSync(path.join(prof, 'Bookmarks'), JSON.stringify({
    roots: {
      bookmark_bar: { children: [{ type: 'url', name: 'Docs', url: 'https://docs.example' }, { type: 'folder', name: 'Cars', children: [{ type: 'url', name: 'Track', url: 'https://track.example' }] }] },
      other: { children: [{ type: 'url', name: 'Other', url: 'https://other.example' }] },
      synced: { children: [] },
    },
  }))
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(prof, 'History'))
  db.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INT, typed_count INT, last_visit_time INT, hidden INT)')
  db.prepare('INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time,hidden) VALUES (?,?,?,?,?,0)').run('https://a.example/', 'A', 3, 1, C.msToWebkit(Date.UTC(2026, 5, 1)))
  db.close()
  const chromium = require('../src/main/importers/chromium')
  const found = chromium.detect()
  assert.equal(found[0].name, 'Chrome')
  const bms = chromium.readBookmarks(prof)
  assert.equal(bms[0].title, 'Docs')
  assert.equal(bms[1].children[0].url, 'https://track.example')
  assert.equal(bms[2].title, 'Other Bookmarks')
  const hist = chromium.readHistory(prof)
  assert.equal(hist[0].url, 'https://a.example/')
  assert.equal(hist[0].last, Date.UTC(2026, 5, 1))
  delete process.env.CRESCENT_IMPORT_HOME
})

test('cookie conversion handles domain, secure and __Host- cookies', () => {
  const { toElectronCookie } = require('../src/main/importers/chromium')
  const a = toElectronCookie({ host: '.google.com', name: 'SID', value: 'v', path: '/', secure: true, httpOnly: true, sameSite: 0, expiresMs: Date.now() + 1e6 })
  assert.equal(a.domain, '.google.com'); assert.equal(a.url, 'https://google.com/'); assert.equal(a.sameSite, 'no_restriction')
  const b = toElectronCookie({ host: 'x.com', name: '__Host-s', value: 'v', path: '/a', secure: true })
  assert.equal(b.domain, undefined); assert.equal(b.path, '/')
})

test('password CSV parsing (quotes, commas, CRLF)', () => {
  const rows = parseCsv('name,url,username,password\r\n"Site, Inc",https://a.com,"me@x.com","p""w,d"\r\n')
  assert.deepEqual(rows[1], ['Site, Inc', 'https://a.com', 'me@x.com', 'p"w,d'])
  assert.equal(originOf('a.com/login'), 'https://a.com')
  assert.equal(originOf('javascript:alert(1)'), null)
})

test('address bar input resolution', () => {
  assert.equal(resolveInput('github.com').url, 'https://github.com')
  assert.equal(resolveInput('localhost:3000/x').url, 'http://localhost:3000/x')
  assert.equal(resolveInput('how do turbos work').isSearch, true)
  assert.equal(resolveInput('node.js').url, 'https://node.js')
  assert.equal(resolveInput('https://x.com/a b').isSearch, false)
  assert.equal(resolveInput('file.txt').url, 'https://file.txt') // matches Chrome's behaviour for dotted words
  assert.equal(resolveInput('1+1').isSearch, true)
  assert.equal(queryFromSearchUrl('https://www.google.com/search?q=hello+world&x=1'), 'hello world')
})
