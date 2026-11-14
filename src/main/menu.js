'use strict'
// The app menu doubles as the keyboard shortcut table. Menu accelerators
// work no matter which page or panel has focus, which is what makes the
// shortcuts reliable.

const { app, Menu, BrowserWindow } = require('electron')
const IS_MAC = process.platform === 'darwin'

function buildMenu(c) {
  const run = (name, ...a) => () => {
    const fw = BrowserWindow.getFocusedWindow()
    const little = [...c.littles].find(l => l.win === fw)
    if (little && little.handleMenu(name, ...a)) return
    if (c.windows.setup && fw === c.windows.setup) return
    c.actions.run(c.main || c.ensureMain(), name, ...a, {})
  }
  const cmd = id => run('cmd:run', id)
  const overlay = (mode, data) => run('overlay:open', mode, data || {})

  const tabIndex = []
  for (let i = 1; i <= 9; i++) {
    tabIndex.push({ label: i === 9 ? 'Last Tab' : `Tab ${i}`, accelerator: `Ctrl+${i}`, click: run('tab:selectIndex', i) })
  }
  const spaceIndex = []
  for (let i = 1; i <= 9; i++) {
    spaceIndex.push({ label: `Space ${i}`, accelerator: `Ctrl+Alt+${i}`, click: run('space:switchIndex', i) })
  }

  const template = [
    ...(IS_MAC ? [{
      label: 'Crescent',
      submenu: [
        { role: 'about', label: 'About Crescent' },
        { label: 'Check for Updates…', click: () => c.windows.checkUpdate(true) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => c.windows.openSettings() },
        { label: 'Set as Default Browser', click: run('default:set') },
        { label: 'Import from Another Browser…', click: () => c.windows.openSettings('import') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Crescent' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Crescent' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: run('overlay:open', 'command', { mode: 'new' }) },
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: () => { const fw = BrowserWindow.getFocusedWindow(); const l = [...c.littles].find(x => x.win === fw); if (l) return l.focusUrl(); (c.main || c.ensureMain()).commandBarFor('edit') } },
        { label: 'New Little Crescent Window', accelerator: 'CmdOrCtrl+Alt+N', click: () => c.windows.openLittle({}) },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => c.windows.openLittle({ private: true }) },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => c.ensureMain().focus() },
        { type: 'separator' },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: run('tab:reopen') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: run('tab:close') },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: () => { const fw = BrowserWindow.getFocusedWindow(); if (fw) fw.close() } },
        { type: 'separator' },
        { label: 'Save Page As…', accelerator: 'CmdOrCtrl+Alt+S', click: run('tab:savePage') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: run('tab:print') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
        { role: 'delete' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Copy URL', accelerator: 'CmdOrCtrl+Shift+C', click: run('tab:copyUrl') },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: run('find:open') },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => c.main && c.main.findState && c.main.find(c.main.findState.text, { forward: true }) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: () => c.main && c.main.findState && c.main.find(c.main.findState.text, { forward: false }) },
        ...(IS_MAC ? [{ type: 'separator' }, { role: 'startSpeaking' }, { role: 'stopSpeaking' }] : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: run('sidebar:toggle') },
        { label: 'Command Bar', accelerator: 'CmdOrCtrl+K', click: run('overlay:open', 'command', { mode: 'new' }) },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: run('tab:reload') },
        { label: 'Hard Reload', accelerator: 'CmdOrCtrl+Shift+R', click: run('tab:reload', null, true) },
        { label: 'Stop', accelerator: 'CmdOrCtrl+.', click: run('tab:stop') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: run('tab:zoom', 1) },
        { label: 'Zoom In ', accelerator: 'CmdOrCtrl+Plus', visible: false, click: run('tab:zoom', 1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: run('tab:zoom', -1) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: run('tab:zoom', 0) },
        { type: 'separator' },
        { label: 'Edit Theme…', accelerator: 'CmdOrCtrl+Shift+E', click: run('space:theme') },
        { label: 'Library', accelerator: 'CmdOrCtrl+Y', click: overlay('library', { tab: 'archive' }) },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: overlay('library', { tab: 'downloads' }) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', click: run('tab:devtools') },
        { label: 'View Source', accelerator: 'CmdOrCtrl+Alt+U', click: run('tab:viewSource') },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Pin / Unpin Tab', accelerator: 'CmdOrCtrl+D', click: run('tab:togglePin') },
        { label: 'Add to Pinned Bar', accelerator: 'CmdOrCtrl+Shift+D', click: run('tab:favorite') },
        { label: 'Split View', accelerator: 'Ctrl+Shift+=', click: run('split:toggle') },
        { label: 'Duplicate Tab', accelerator: 'CmdOrCtrl+Shift+K', click: run('tab:duplicate') },
        { label: 'Copy Screenshot of Page', accelerator: 'CmdOrCtrl+Shift+2', click: run('tab:screenshot') },
        { label: 'Clear Unpinned Tabs', accelerator: 'CmdOrCtrl+Shift+Backspace', click: run('today:clear') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: run('tab:cycle', 1) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: run('tab:cycle', -1) },
        { label: 'Next Tab ', accelerator: 'CmdOrCtrl+Alt+Down', click: run('tab:cycle', 1) },
        { label: 'Previous Tab ', accelerator: 'CmdOrCtrl+Alt+Up', click: run('tab:cycle', -1) },
        { type: 'separator' },
        ...tabIndex,
      ],
    },
    {
      label: 'Spaces',
      submenu: [
        { label: 'Next Space', accelerator: 'CmdOrCtrl+Alt+Right', click: run('space:switch', 1) },
        { label: 'Previous Space', accelerator: 'CmdOrCtrl+Alt+Left', click: run('space:switch', -1) },
        { label: 'New Space', accelerator: 'CmdOrCtrl+Shift+S', click: run('space:create') },
        { type: 'separator' },
        ...spaceIndex,
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: run('tab:back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: run('tab:forward') },
        { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Alt+B', click: overlay('bookmarks') },
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+Alt+D', click: run('bookmarks:addCurrent') },
        { label: 'History', click: overlay('library', { tab: 'history' }) },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => c.windows.openSettings('shortcuts') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

module.exports = { buildMenu }
