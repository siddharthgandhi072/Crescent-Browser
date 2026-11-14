'use strict'
// Every UI -> main request goes through here. One place to validate input
// and one place to look when something misbehaves.

const { app, clipboard, dialog, shell, nativeTheme } = require('electron')
const M = require('./model')
const { MainWindow } = require('./browser')
const { resolveInput } = require('./urls')

class Actions {
  constructor(crescent) {
    this.c = crescent
    this.table = this.build()
  }

  async run(owner, name, ...rest) {
    const ctx = rest.pop() || {}
    const fn = this.table[name]
    if (!fn) { console.warn('[actions] unknown', name); return null }
    const w = owner instanceof MainWindow ? owner : null
    try {
      return await fn.call(this, { owner, w, main: () => w || this.c.ensureMain(), ctx }, ...rest)
    } catch (err) {
      console.error('[actions]', name, err)
      return { error: String(err && err.message || err) }
    }
  }

  build() {
    const c = this.c
    const st = () => c.store.state
    const save = () => { c.store.save(); c.broadcastState() }
    return {
      // ----- general -----
      snapshot: ({ owner }) => c.snapshot(owner),
      'overlay:ready': ({ w }) => w && w.overlayRendered(),
      'overlay:open': ({ main }, mode, data) => main().openOverlay(mode, data || {}),
      'overlay:close': ({ owner, w }) => { if (w) w.closeOverlay(); else if (owner && owner.closeOverlay) owner.closeOverlay() },

      // ----- tabs -----
      'tab:select': ({ main }, id) => main().select(id),
      'tab:close': ({ main }, id) => main().closeTab(id),
      'tab:new': ({ main }, input, opts = {}) => {
        const m = main()
        if (opts.split) return m.splitWithNew(input)
        return m.newTab(input, { typed: true, zone: opts.zone, parentId: opts.parentId }) ? true : false
      },
      'tab:navigate': ({ main }, id, input) => main().navigate(id, input),
      'tab:back': ({ main }, id) => { const t = main().liveTab(id || main().space.activeId); if (t && t.wc.navigationHistory.canGoBack()) t.wc.navigationHistory.goBack() },
      'tab:forward': ({ main }, id) => { const t = main().liveTab(id || main().space.activeId); if (t && t.wc.navigationHistory.canGoForward()) t.wc.navigationHistory.goForward() },
      'tab:reload': ({ main }, id, hard) => {
        const m = main(); const t = m.liveTab(id || m.space.activeId)
        if (!t) return
        if (t.info.crashed || t.info.error) t.load(t.info.error ? t.info.error.url || t.info.url : t.info.url)
        else if (hard) t.wc.reloadIgnoringCache()
        else t.wc.reload()
      },
      'tab:stop': ({ main }) => { const t = main().activeTab(); if (t) t.wc.stop() },
      'tab:mute': ({ main }, id) => { const t = main().liveTab(id); if (t) t.setMuted(!t.info.muted) },
      'tab:resetPinned': ({ main }, id) => main().resetPinned(id),
      'tab:rename': ({}, id, title) => { if (M.renameItem(st(), id, title)) save() },
      'tab:menu': ({ main }, id) => main().itemMenu(id),
      'tab:copyUrl': ({ main }) => main().copyUrl(),
      'tab:togglePin': ({ main }) => {
        const m = main(); const id = m.space.activeId
        const loc = M.locate(st(), id)
        if (!loc) return
        if (loc.zone === 'today') {
          if (loc.parent && loc.parent.type === 'split') return
          M.moveItem(st(), id, { spaceId: m.space.id, zone: 'pinned' })
          m.toast('Pinned')
        } else {
          M.moveItem(st(), id, { spaceId: m.space.id, zone: 'today', index: 0 })
          m.toast('Unpinned')
        }
        save()
      },
      'tab:favorite': ({ main }) => {
        const m = main(); const id = m.space.activeId
        const loc = M.locate(st(), id)
        if (!loc || loc.zone === 'favorites' || (loc.parent && loc.parent.type === 'split')) return
        M.moveItem(st(), id, { spaceId: m.space.id, zone: 'favorites' })
        save()
      },
      'tab:duplicate': ({ main }) => { const m = main(); const t = m.activeTab(); if (t) m.newTab({ url: t.info.url, isSearch: false }) },
      'tab:reopen': ({ main }) => {
        const a = st().archive[0]
        if (!a) return
        const m = main()
        const r = M.restoreArchived(st(), a.id, m.space.id)
        if (r) m.select(r.tab.id)
      },
      'tab:devtools': ({ main }) => { const t = main().activeTab(); if (t) t.wc.toggleDevTools() },
      'tab:print': ({ main }) => { const t = main().activeTab(); if (t) t.wc.print() },
      'tab:savePage': async ({ main }) => {
        const m = main(); const t = m.activeTab(); if (!t) return
        const { filePath } = await dialog.showSaveDialog(m.win, { defaultPath: (t.info.title || 'page').replace(/[\\/:*?"<>|]/g, '-') + '.html' })
        if (filePath) await t.wc.savePage(filePath, 'HTMLComplete')
      },
      'tab:selectIndex': ({ main }, n) => main().selectIndex(n),
      'tab:cycle': ({ main }, d) => main().cycle(d),
      'tab:zoom': ({ main }, d) => main().zoom(d),
      'tab:screenshot': async ({ main }) => {
        const m = main(); const t = m.activeTab(); if (!t) return
        const img = await t.wc.capturePage()
        clipboard.writeImage(img)
        m.toast('Screenshot copied')
      },
      'tab:viewSource': ({ main }) => { const m = main(); const t = m.activeTab(); if (t && /^https?:/.test(t.info.url)) m.newTab({ url: 'view-source:' + t.info.url, isSearch: false }) },
      'tab:unload': ({ main }, id) => main().unloadTab(id),

      // ----- sidebar items -----
      'item:move': ({ main }, id, target) => {
        const m = main()
        if (!target || typeof target !== 'object') return false
        const ok = M.moveItem(st(), id, { ...target, spaceId: target.spaceId || m.space.id })
        if (ok) {
          save()
          // A tab moved to another space stops being shown here.
          const loc = M.locate(st(), id)
          if (loc && loc.space && loc.space.id !== m.space.id && m.isDisplayed(id)) m.closeDisplayedMoved(id)
        }
        return ok
      },
      'item:dropUrl': ({ main }, url, target) => {
        const m = main()
        const r = resolveInput(url)
        if (!r) return
        const tab = M.addTab(st(), m.space.id, { url: r.url, title: r.url }, { zone: target.zone, parentId: target.parentId, index: target.index })
        save()
        m.select(tab.id)
      },
      'item:delete': ({ main }, id) => main().deleteItem(id),
      'folder:create': ({ main }, opts = {}) => { const f = M.createFolder(st(), main().space.id, opts); save(); return f.id },
      'folder:toggle': ({}, id, open) => { if (M.toggleFolder(st(), id, open)) save() },
      'folder:rename': ({}, id, title) => { if (M.renameItem(st(), id, title)) save() },
      'folder:delete': ({}, id) => { if (M.deleteFolder(st(), id)) save() },
      'today:clear': ({ main }) => {
        const m = main()
        const ids = M.clearToday(st(), m.space.id)
        for (const id of ids) m.destroyTab(id)
        m.mru = m.mru.filter(x => !ids.includes(x))
        if (!m.space.activeId || ids.includes(m.space.activeId) || m.display.some(d => ids.includes(d))) {
          const next = m.fallbackSelection(ids)
          if (next) m.select(next); else m.showNothing()
        } else save()
      },

      // ----- split -----
      'split:with': ({ main }, id) => main().splitWith(id),
      'split:new': ({ main }, input) => main().splitWithNew(input),
      'split:unsplit': ({ main }) => main().unsplit(),
      'split:sizes': ({ main }, sizes) => main().setSplitSizes(sizes),
      'split:toggle': ({ main }) => {
        const m = main()
        if (M.splitOf(st(), m.space.activeId)) m.unsplit()
        else m.openOverlay('command', { mode: 'split' })
      },

      // ----- peek -----
      'peek:close': ({ main }) => main().closeOverlay(),
      'peek:expand': ({ main }, split) => main().expandPeek(!!split),
      'peek:open': ({ main }, url) => main().openPeek(url),

      // ----- spaces -----
      'space:switch': ({ main }, idOrDelta) => main().switchSpace(idOrDelta),
      'space:switchIndex': ({ main }, n) => { const s = st().spaces[n - 1]; if (s) main().switchSpace(s.id) },
      'space:create': ({ main }, opts = {}) => {
        const m = main()
        const s = M.addSpace(st(), opts.name || 'New Space', opts)
        m.switchSpace(s.id)
        save()
        if (!opts.name) setTimeout(() => m.wc.send('rename-space', s.id), 250)
        return s.id
      },
      'space:update': ({}, id, patch) => { if (M.updateSpace(st(), id, patch || {})) save() },
      'space:move': ({}, id, index) => { if (M.moveSpace(st(), id, index)) save() },
      'space:menu': ({ main }, id) => main().spaceMenu(id),
      'space:theme': ({ main }) => main().openOverlay('theme', { spaceId: st().activeSpaceId }),

      // ----- pins -----
      'pins:mode': ({}, mode) => { if (M.setPinsMode(st(), mode)) save() },

      // ----- bookmarks -----
      'bookmarks:addCurrent': ({ main }) => {
        const m = main(); const t = m.activeTab()
        if (!t || !/^https?:/.test(t.info.url)) return
        if (M.findBookmarkByUrl(st(), t.info.url)) { m.toast('Already bookmarked'); return }
        M.addBookmark(st(), { url: t.info.url, title: t.info.title })
        save(); m.toast('Bookmarked')
      },
      'bookmarks:add': ({}, data) => { const b = M.addBookmark(st(), data); save(); return b && b.id },
      'bookmarks:folder': ({}, data) => { const f = M.addBookmarkFolder(st(), data || {}); save(); return f && f.id },
      'bookmarks:remove': ({}, id) => { if (M.removeBookmark(st(), id)) save() },
      'bookmarks:rename': ({}, id, title) => { const l = M.bmLocate(st(), id); if (l && title) { l.item.title = String(title).slice(0, 300); save() } },
      'bookmarks:move': ({}, id, parentId, index) => { if (M.moveBookmark(st(), id, parentId, index)) save() },
      'bookmarks:open': ({ main }, url, how) => {
        const m = main()
        if (how === 'split') m.splitWithNew(url)
        else if (how === 'peek') m.openPeek(url)
        else m.newTab({ url, isSearch: false })
      },
      'bookmarks:isBookmarked': ({}, url) => !!M.findBookmarkByUrl(st(), url),

      // ----- library -----
      'archive:list': ({}, q) => {
        const a = st().archive
        if (!q) return a.slice(0, 400)
        const s = String(q).toLowerCase()
        return a.filter(x => (x.title || '').toLowerCase().includes(s) || x.url.toLowerCase().includes(s)).slice(0, 400)
      },
      'archive:restore': ({ main }, id) => {
        const m = main()
        const r = M.restoreArchived(st(), id, m.space.id)
        if (r) { m.closeOverlay({ refocus: false }); m.select(r.tab.id) }
      },
      'archive:remove': ({}, id) => { const a = st().archive; const i = a.findIndex(x => x.id === id); if (i !== -1) { a.splice(i, 1); save() } },
      'archive:clear': ({}) => { st().archive = []; save() },
      'history:list': ({}, q, offset) => q ? c.history.search(q, 200) : c.history.recent(200, offset || 0),
      'history:remove': ({}, url) => c.history.remove(url),
      'history:clear': async ({ owner }, sinceMs) => {
        c.history.clear(sinceMs || 0)
        await c.browseSession.clearCache()
        return true
      },
      'data:clear': async ({}, what = {}) => {
        const storages = []
        if (what.cookies) storages.push('cookies')
        if (what.storage) storages.push('localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'websql')
        if (storages.length) await c.browseSession.clearStorageData({ storages })
        if (what.cache) await c.browseSession.clearCache()
        if (what.history) c.history.clear(0)
        return true
      },

      // ----- downloads -----
      'downloads:list': () => c.downloads.list(),
      'downloads:open': ({}, id) => c.downloads.open(id),
      'downloads:reveal': ({}, id) => c.downloads.reveal(id),
      'downloads:cancel': ({}, id) => c.downloads.cancel(id),
      'downloads:pause': ({}, id) => c.downloads.togglePause(id),
      'downloads:clear': () => c.downloads.clear(),

      // ----- search / command bar -----
      'search:local': ({ owner }, q) => c.search.local(q, owner instanceof MainWindow ? owner : c.main),
      'search:suggest': ({}, q) => c.search.suggest(q),
      'cmd:run': ({ main }, id, arg) => this.command(main(), id, arg),

      // ----- find -----
      'find:open': ({ main }) => { const m = main(); if (m.activeTab()) m.openOverlay('find', {}) },
      'find:query': ({ main }, text, opts) => main().find(text, opts),

      // ----- sidebar -----
      'sidebar:toggle': ({ main }) => main().toggleSidebar(),
      'sidebar:peek': ({ main }, on) => main().setSidebarPeek(on),
      'sidebar:width': ({ main }, px) => main().setSidebarWidth(px),
      'sidebar:widthDone': () => c.store.save(),

      // ----- settings -----
      'settings:get': () => st().settings,
      'settings:set': ({ main }, key, value) => {
        if (!(key in M.DEFAULT_SETTINGS)) return false
        if (key === 'pinsMode') return M.setPinsMode(st(), value) && (save(), true)
        st().settings[key] = value
        save()
        if (key === 'adblock') c.adblock.setEnabled(!!value)
        if (key === 'sidebarHidden' || key === 'sidebarRight' || key === 'sidebarWidth') c.main && c.main.layout()
        return true
      },
      'settings:open': ({}, section) => c.windows.openSettings(section),
      'settings:chooseDownloadDir': async () => {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
        if (!r.canceled && r.filePaths[0]) { st().settings.downloadDir = r.filePaths[0]; save(); return r.filePaths[0] }
        return null
      },
      'app:info': () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch }),
      'app:openExternal': ({}, url) => { if (/^(https?|x-apple\.systempreferences):/.test(url)) shell.openExternal(url) },
      'app:checkUpdate': () => c.windows.checkUpdate(),

      // ----- default browser -----
      'default:is': () => app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http'),
      'default:set': () => { app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https'); return true },

      // ----- setup -----
      'setup:finish': ({}, data = {}) => c.windows.finishSetup(data),

      // ----- import -----
      'import:detect': () => require('./importers').detect(),
      'import:run': ({}, sourceId, what) => require('./importers').run(c, sourceId, what || {}),
      'import:passwordsCsv': async () => {
        const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })
        if (r.canceled || !r.filePaths[0]) return null
        return c.passwords.importCsv(r.filePaths[0])
      },

      // ----- passwords -----
      'passwords:list': async ({}, reveal) => c.passwords.list(reveal),
      'passwords:remove': ({}, id) => c.passwords.remove(id),
      'passwords:respond': ({}, id, accept) => c.passwords.respondSave(id, accept),

      // ----- permissions -----
      'permission:respond': ({ main }, id, allow, remember) => { c.permissions.respond(id, allow, remember); main().closeOverlay() },
      'permission:list': () => c.permissions.list(),
      'permission:reset': ({}, origin) => c.permissions.reset(origin),

      // ----- extensions -----
      'ext:list': () => c.extensions.list(),
      'ext:remove': ({}, id) => c.extensions.remove(id),
      'ext:toggle': ({}, id, on) => c.extensions.toggle(id, on),
      'ext:store': ({ main }) => { const m = main(); m.newTab({ url: 'https://chromewebstore.google.com/', isSearch: false }); m.focus() },
      'ext:options': ({ main }, id) => c.extensions.openOptions(id, main()),

      // ----- adblock -----
      'adblock:status': ({ main }) => c.adblock.status(main().activeTab()),
      'adblock:toggleSite': ({ main }) => { const m = main(); c.adblock.toggleSite(m.activeTab()); const t = m.activeTab(); if (t) t.wc.reload() },

      // ----- little crescent -----
      'little:openInMain': ({ owner }) => owner && owner.moveToMain && owner.moveToMain(),
      'little:navigate': ({ owner }, input) => owner && owner.navigate && owner.navigate(input),
      'little:close': ({ owner }) => owner && owner.close && owner.close(),
      'little:back': ({ owner }) => owner && owner.back && owner.back(),
      'little:copyUrl': ({ owner }) => owner && owner.copyUrl && owner.copyUrl(),
      'little:new': ({}, opts = {}) => c.windows.openLittle(opts),

      'theme:dark': () => nativeTheme.shouldUseDarkColors,
    }
  }

  // Commands from the command bar ("> ..." or typed names).
  command(m, id, arg) {
    const run = (name, ...a) => this.run(m, name, ...a, {})
    m.closeOverlay({ refocus: id !== 'theme' && id !== 'library' })
    switch (id) {
      case 'new-space': return run('space:create')
      case 'toggle-sidebar': return m.toggleSidebar()
      case 'copy-url': return m.copyUrl()
      case 'settings': return this.c.windows.openSettings()
      case 'clear-today': return run('today:clear')
      case 'library': return setTimeout(() => m.openOverlay('library', { tab: 'archive' }), 10)
      case 'downloads': return setTimeout(() => m.openOverlay('library', { tab: 'downloads' }), 10)
      case 'history': return setTimeout(() => m.openOverlay('library', { tab: 'history' }), 10)
      case 'theme': return setTimeout(() => m.openOverlay('theme', { spaceId: m.space.id }), 10)
      case 'pin': return run('tab:togglePin')
      case 'favorite': return run('tab:favorite')
      case 'duplicate': return run('tab:duplicate')
      case 'mute': { const t = m.activeTab(); if (t) t.setMuted(!t.info.muted); return }
      case 'reload': return run('tab:reload')
      case 'devtools': return run('tab:devtools')
      case 'screenshot': return run('tab:screenshot')
      case 'find': return setTimeout(() => run('find:open'), 10)
      case 'zoom-in': return m.zoom(1)
      case 'zoom-out': return m.zoom(-1)
      case 'zoom-reset': return m.zoom(0)
      case 'bookmark': return run('bookmarks:addCurrent')
      case 'bookmarks': return setTimeout(() => m.openOverlay('bookmarks', {}), 10)
      case 'reopen': return run('tab:reopen')
      case 'split': return setTimeout(() => m.openOverlay('command', { mode: 'split' }), 10)
      case 'unsplit': return m.unsplit()
      case 'little': return this.c.windows.openLittle({})
      case 'private': return this.c.windows.openLittle({ private: true })
      case 'import': return this.c.windows.openSettings('import')
      case 'extensions': return this.c.windows.openSettings('extensions')
      case 'webstore': return run('ext:store')
      case 'pins-global': return run('pins:mode', 'global')
      case 'pins-space': return run('pins:mode', 'space')
      case 'print': return run('tab:print')
      case 'view-source': return run('tab:viewSource')
      case 'adblock-site': return run('adblock:toggleSite')
      case 'close-others': {
        const keep = m.space.activeId
        for (const t of M.tabsIn(m.space.today)) if (t.id !== keep && !m.isDisplayed(t.id)) m.closeTab(t.id)
        return
      }
      case 'default-browser': return run('default:set')
      case 'switch-space': return arg && m.switchSpace(arg)
      case 'go-tab': return arg && m.select(arg)
      default: return null
    }
  }
}

module.exports = { Actions }
