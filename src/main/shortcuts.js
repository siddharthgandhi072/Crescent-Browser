'use strict'
// Every keyboard shortcut in one table. Settings → Shortcuts lets you
// remap any of them; overrides are stored as settings.shortcuts[id].

const SHORTCUTS = [
  // Tabs
  { id: 'new-tab', label: 'New tab / command bar', group: 'Tabs', accel: 'CmdOrCtrl+T', action: ['overlay:open', 'command', { mode: 'new' }] },
  { id: 'command-bar', label: 'Command bar', group: 'Tabs', accel: 'CmdOrCtrl+K', action: ['overlay:open', 'command', { mode: 'new' }] },
  { id: 'open-location', label: 'Edit current URL', group: 'Tabs', accel: 'CmdOrCtrl+L', action: ['location'] },
  { id: 'close-tab', label: 'Close tab (pinned tabs stay)', group: 'Tabs', accel: 'CmdOrCtrl+W', action: ['tab:close'] },
  { id: 'reopen-tab', label: 'Reopen closed tab', group: 'Tabs', accel: 'CmdOrCtrl+Shift+T', action: ['tab:reopen'] },
  { id: 'pin-tab', label: 'Pin / unpin tab', group: 'Tabs', accel: 'CmdOrCtrl+D', action: ['tab:togglePin'] },
  { id: 'favorite-tab', label: 'Add to pinned bar', group: 'Tabs', accel: 'CmdOrCtrl+Shift+D', action: ['tab:favorite'] },
  { id: 'duplicate-tab', label: 'Duplicate tab', group: 'Tabs', accel: 'CmdOrCtrl+Shift+K', action: ['tab:duplicate'] },
  { id: 'next-tab', label: 'Next tab', group: 'Tabs', accel: 'Ctrl+Tab', action: ['tab:cycle', 1] },
  { id: 'prev-tab', label: 'Previous tab', group: 'Tabs', accel: 'Ctrl+Shift+Tab', action: ['tab:cycle', -1] },
  { id: 'next-tab-2', label: 'Next tab (alternate)', group: 'Tabs', accel: 'CmdOrCtrl+Alt+Down', action: ['tab:cycle', 1] },
  { id: 'prev-tab-2', label: 'Previous tab (alternate)', group: 'Tabs', accel: 'CmdOrCtrl+Alt+Up', action: ['tab:cycle', -1] },
  { id: 'clear-today', label: 'Clear unpinned tabs', group: 'Tabs', accel: 'CmdOrCtrl+Shift+Backspace', action: ['today:clear'] },
  { id: 'snooze-tab', label: 'Snooze tab until tomorrow', group: 'Tabs', accel: 'CmdOrCtrl+Alt+Z', action: ['tab:snooze', 'tomorrow'] },
  { id: 'new-note', label: 'New note', group: 'Tabs', accel: 'CmdOrCtrl+Alt+K', action: ['note:new'] },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: `tab-${n}`, label: n === 9 ? 'Last tab' : `Tab ${n}`, group: 'Tabs', accel: `Ctrl+${n}`, action: ['tab:selectIndex', n] })),
  // View
  { id: 'toggle-sidebar', label: 'Toggle sidebar', group: 'View', accel: 'CmdOrCtrl+S', action: ['sidebar:toggle'] },
  { id: 'split', label: 'Split view', group: 'View', accel: 'Ctrl+Shift+=', action: ['split:toggle'] },
  { id: 'reload', label: 'Reload', group: 'View', accel: 'CmdOrCtrl+R', action: ['tab:reload'] },
  { id: 'hard-reload', label: 'Hard reload', group: 'View', accel: 'CmdOrCtrl+Shift+R', action: ['tab:reload', null, true] },
  { id: 'zoom-in', label: 'Zoom in', group: 'View', accel: 'CmdOrCtrl+=', action: ['tab:zoom', 1] },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', accel: 'CmdOrCtrl+-', action: ['tab:zoom', -1] },
  { id: 'zoom-reset', label: 'Actual size', group: 'View', accel: 'CmdOrCtrl+0', action: ['tab:zoom', 0] },
  { id: 'theme', label: 'Edit space colours', group: 'View', accel: 'CmdOrCtrl+Shift+E', action: ['space:theme'] },
  { id: 'library', label: 'Library', group: 'View', accel: 'CmdOrCtrl+Y', action: ['library:open', 'archive'] },
  { id: 'downloads', label: 'Downloads', group: 'View', accel: 'CmdOrCtrl+Shift+J', action: ['library:open', 'downloads'] },
  { id: 'focus', label: 'Focus mode', group: 'View', accel: 'CmdOrCtrl+Shift+F', action: ['focus:open'] },
  { id: 'devtools', label: 'Developer tools', group: 'View', accel: 'CmdOrCtrl+Alt+I', action: ['tab:devtools'] },
  { id: 'view-source', label: 'View source', group: 'View', accel: 'CmdOrCtrl+Alt+U', action: ['tab:viewSource'] },
  // Page
  { id: 'copy-url', label: 'Copy URL', group: 'Page', accel: 'CmdOrCtrl+Shift+C', action: ['tab:copyUrl'] },
  { id: 'copy-markdown', label: 'Copy link as Markdown', group: 'Page', accel: 'CmdOrCtrl+Alt+C', action: ['tab:copyMarkdown'] },
  { id: 'find', label: 'Find on page', group: 'Page', accel: 'CmdOrCtrl+F', action: ['find:open'] },
  { id: 'screenshot', label: 'Copy screenshot of page', group: 'Page', accel: 'CmdOrCtrl+Shift+2', action: ['tab:screenshot'] },
  { id: 'back', label: 'Back', group: 'Page', accel: 'CmdOrCtrl+[', action: ['tab:back'] },
  { id: 'forward', label: 'Forward', group: 'Page', accel: 'CmdOrCtrl+]', action: ['tab:forward'] },
  { id: 'stop', label: 'Stop loading', group: 'Page', accel: 'CmdOrCtrl+.', action: ['tab:stop'] },
  { id: 'print', label: 'Print', group: 'Page', accel: 'CmdOrCtrl+P', action: ['tab:print'] },
  { id: 'save-page', label: 'Save page as', group: 'Page', accel: 'CmdOrCtrl+Alt+S', action: ['tab:savePage'] },
  { id: 'bookmarks', label: 'Bookmarks', group: 'Page', accel: 'CmdOrCtrl+Alt+B', action: ['overlay:open', 'bookmarks', {}] },
  { id: 'bookmark-page', label: 'Bookmark page', group: 'Page', accel: 'CmdOrCtrl+Alt+D', action: ['bookmarks:addCurrent'] },
  // Spaces
  { id: 'next-space', label: 'Next space', group: 'Spaces', accel: 'CmdOrCtrl+Alt+Right', action: ['space:switch', 1] },
  { id: 'prev-space', label: 'Previous space', group: 'Spaces', accel: 'CmdOrCtrl+Alt+Left', action: ['space:switch', -1] },
  { id: 'new-space', label: 'New space', group: 'Spaces', accel: 'CmdOrCtrl+Shift+S', action: ['space:create'] },
  { id: 'private-space', label: 'Private space', group: 'Spaces', accel: 'CmdOrCtrl+Shift+P', action: ['space:private'] },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: `space-${n}`, label: `Space ${n}`, group: 'Spaces', accel: `Ctrl+Alt+${n}`, action: ['space:switchIndex', n] })),
  // Windows
  { id: 'little', label: 'Little Crescent window', group: 'Windows', accel: 'CmdOrCtrl+Alt+N', action: ['little:new', {}] },
  { id: 'private-window', label: 'Private window', group: 'Windows', accel: 'CmdOrCtrl+Shift+N', action: ['little:new', { private: true }] },
  { id: 'settings', label: 'Settings', group: 'Windows', accel: 'CmdOrCtrl+,', action: ['settings:open'] },
]

const byId = new Map(SHORTCUTS.map(s => [s.id, s]))

function accelFor(settings, id) {
  const o = settings && settings.shortcuts && settings.shortcuts[id]
  if (o === '') return undefined // explicitly unassigned
  return o || (byId.get(id) || {}).accel
}

// Shown in the UI with Mac symbols.
function pretty(accel) {
  if (!accel) return ''
  const mac = process.platform === 'darwin'
  return accel.split('+').map(k => ({
    CmdOrCtrl: mac ? '⌘' : 'Ctrl', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧',
    Backspace: '⌫', Tab: '⇥', Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Return: '↵', Space: 'Space', Plus: '+',
  }[k] || k)).join('')
}

function list(settings) {
  return SHORTCUTS.map(s => ({ id: s.id, label: s.label, group: s.group, accel: accelFor(settings, s.id) || '', default: s.accel, pretty: pretty(accelFor(settings, s.id)) }))
}

module.exports = { SHORTCUTS, byId, accelFor, pretty, list }
