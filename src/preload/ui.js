'use strict'
// Bridge for Crescent's own UI pages (sidebar, overlay, setup, settings,
// Little Crescent). Never loaded into websites.
const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = new Set([
  'state', 'runtime', 'layout', 'toast', 'theme', 'downloads', 'extensions', 'rename', 'rename-space',
  'overlay:open', 'overlay:close', 'find:result', 'peek:info', 'import:progress', 'settings:section', 'focus-url', 'update', 'library', 'note:focus',
])

contextBridge.exposeInMainWorld('crescent', {
  platform: process.platform,
  invoke: (action, ...args) => ipcRenderer.invoke('ui:invoke', action, ...args),
  on: (channel, fn) => {
    if (!CHANNELS.has(channel)) throw new Error('unknown channel ' + channel)
    const h = (_e, data) => fn(data)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  },
})

// Extension toolbar icons (<browser-action-list>) in the sidebar only.
if (location.href.startsWith('crescent://app/sidebar/')) {
  try {
    const { injectBrowserAction } = require('electron-chrome-extensions/browser-action')
    injectBrowserAction()
  } catch (e) {
    console.warn('[crescent] extension actions unavailable', e)
  }
}
