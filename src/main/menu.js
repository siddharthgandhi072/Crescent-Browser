'use strict'
// The app menu doubles as the keyboard shortcut table. Menu accelerators
// work no matter which page or panel has focus, which is what makes the
// shortcuts reliable. Accelerators come from shortcuts.js (remappable).

const { app, Menu, BrowserWindow } = require('electron')
const { byId, accelFor } = require('./shortcuts')
const IS_MAC = process.platform === 'darwin'

function buildMenu(c, opts = {}) {
  const settings = c.store ? c.store.state.settings : {}
  const run = (name, ...a) => () => {
    const fw = BrowserWindow.getFocusedWindow()
    const little = [...c.littles].find(l => l.win === fw)
    if (little && little.handleMenu(name, ...a)) return
    if (c.windows && c.windows.setup && fw === c.windows.setup) return
    if (name === 'location') return (c.main || c.ensureMain()).commandBarFor('edit')
    c.actions.run(c.main || c.ensureMain(), name, ...a, {})
  }
  // A menu item for a shortcut id.
  const S = (id, extra = {}) => {
    const s = byId.get(id)
    return { label: s.label[0].toUpperCase() + s.label.slice(1), accelerator: opts.noAccel ? undefined : accelFor(settings, id), click: run(...s.action), ...extra }
  }
  const range = prefix => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => S(`${prefix}-${n}`))

  let quitArmed = 0
  const quit = () => {
    // Arc-style safety: press ⌘Q twice to quit, so a stray ⌘Q never closes
    // everything.
    if (!settings.warnBeforeQuit || Date.now() - quitArmed < 1600) return app.quit()
    quitArmed = Date.now()
    if (c.main && !c.main.closed) c.main.toast('Press ⌘Q again to quit')
    else app.quit()
  }

  const template = [
    ...(IS_MAC ? [{
      label: 'Crescent',
      submenu: [
        { role: 'about', label: 'About Crescent' },
        { label: 'Check for Updates…', click: () => c.updater.check(true) },
        { type: 'separator' },
        S('settings', { label: 'Settings…' }),
        { label: 'Set as Default Browser', click: run('default:set') },
        { label: 'Import from Another Browser…', click: run('settings:open', 'import') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Crescent' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit Crescent', accelerator: 'Cmd+Q', click: quit },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        S('new-tab', { label: 'New Tab' }), S('open-location', { label: 'Open Location' }), S('new-note', { label: 'New Note' }),
        S('little', { label: 'New Little Crescent Window' }), S('private-window', { label: 'New Private Window' }),
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => c.ensureMain().focus() },
        { type: 'separator' },
        S('reopen-tab', { label: 'Reopen Closed Tab' }), S('close-tab', { label: 'Close Tab' }),
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => { const fw = BrowserWindow.getFocusedWindow(); if (fw) fw.close() } },
        { type: 'separator' },
        S('save-page', { label: 'Save Page As…' }), S('print', { label: 'Print…' }),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
        { role: 'delete' }, { role: 'selectAll' },
        { type: 'separator' },
        S('copy-url', { label: 'Copy URL' }), S('copy-markdown', { label: 'Copy Link as Markdown' }),
        S('find', { label: 'Find…' }),
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => c.main && c.main.findState && c.main.find(c.main.findState.text, { forward: true }) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => c.main && c.main.findState && c.main.find(c.main.findState.text, { forward: false }) },
        ...(IS_MAC ? [{ type: 'separator' }, { role: 'startSpeaking' }, { role: 'stopSpeaking' }] : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        S('toggle-sidebar', { label: 'Toggle Sidebar' }), S('command-bar', { label: 'Command Bar' }),
        S('focus', { label: 'Focus Mode…' }),
        { type: 'separator' },
        S('reload', { label: 'Reload' }), S('hard-reload', { label: 'Hard Reload' }), S('stop', { label: 'Stop' }),
        { type: 'separator' },
        S('zoom-in', { label: 'Zoom In' }),
        { label: 'Zoom In ', accelerator: 'CmdOrCtrl+Plus', visible: false, click: run('tab:zoom', 1) },
        S('zoom-out', { label: 'Zoom Out' }), S('zoom-reset', { label: 'Actual Size' }),
        { type: 'separator' },
        S('theme', { label: 'Edit Space Colours…' }), S('library', { label: 'Library' }), S('downloads', { label: 'Downloads' }),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        S('devtools', { label: 'Developer Tools' }), S('view-source', { label: 'View Source' }),
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        S('pin-tab', { label: 'Pin / Unpin Tab' }), S('favorite-tab', { label: 'Add to Pinned Bar' }), S('split', { label: 'Split View' }),
        S('duplicate-tab', { label: 'Duplicate Tab' }), S('snooze-tab', { label: 'Snooze Tab Until Tomorrow' }),
        S('screenshot', { label: 'Copy Screenshot of Page' }), S('clear-today', { label: 'Clear Unpinned Tabs' }),
        { type: 'separator' },
        S('next-tab', { label: 'Next Tab' }), S('prev-tab', { label: 'Previous Tab' }),
        S('next-tab-2', { label: 'Next Tab ' }), S('prev-tab-2', { label: 'Previous Tab ' }),
        { type: 'separator' },
        ...range('tab'),
      ],
    },
    {
      label: 'Spaces',
      submenu: [
        S('next-space', { label: 'Next Space' }), S('prev-space', { label: 'Previous Space' }),
        S('new-space', { label: 'New Space' }), S('private-space', { label: 'Private Space' }),
        { type: 'separator' },
        ...range('space'),
      ],
    },
    {
      label: 'Go',
      submenu: [
        S('back', { label: 'Back' }), S('forward', { label: 'Forward' }),
        S('bookmarks', { label: 'Bookmarks' }), S('bookmark-page', { label: 'Bookmark This Page' }),
        { label: 'History', click: run('library:open', 'history') },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: run('settings:open', 'shortcuts') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { buildMenu }
