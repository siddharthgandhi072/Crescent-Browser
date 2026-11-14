'use strict'
const { Menu, clipboard, nativeImage, net } = require('electron')
const { searchUrl } = require('./urls')

class ContextMenu {
  constructor(c) { this.c = c }

  forPage(win, tab, p) {
    const wc = tab.wc
    const tpl = []
    const sep = () => { if (tpl.length && tpl[tpl.length - 1].type !== 'separator') tpl.push({ type: 'separator' }) }
    const engine = this.c.engine()

    if (p.isEditable && p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) tpl.push({ label: s, click: () => wc.replaceMisspelling(s) })
      tpl.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
      sep()
    }
    if (p.linkURL) {
      const url = p.linkURL
      tpl.push({ label: 'Open Link in New Tab', click: () => win.newTab({ url, isSearch: false }, { background: true }) })
      tpl.push({ label: 'Open Link in Peek', click: () => win.openPeek(url) })
      tpl.push({ label: 'Open Link in Split View', click: () => win.splitWithNew(url) })
      tpl.push({ label: 'Open Link in Little Crescent', click: () => this.c.windows.openLittle({ url }) })
      sep()
      tpl.push({ label: 'Copy Link', click: () => clipboard.writeText(url) })
      if (p.linkText) tpl.push({ label: 'Copy Link Text', click: () => clipboard.writeText(p.linkText) })
      tpl.push({ label: 'Save Link As…', click: () => wc.downloadURL(url) })
      sep()
    }
    if (p.mediaType === 'image' && p.srcURL) {
      tpl.push({ label: 'Open Image in New Tab', click: () => win.newTab({ url: p.srcURL, isSearch: false }, { background: true }) })
      tpl.push({ label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) })
      tpl.push({ label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) })
      tpl.push({ label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) })
      sep()
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
      tpl.push({ label: 'Save Media As…', click: () => wc.downloadURL(p.srcURL) })
      tpl.push({ label: 'Copy Media Address', click: () => clipboard.writeText(p.srcURL) })
      if (p.mediaType === 'video') tpl.push({ label: 'Picture in Picture', click: () => wc.executeJavaScript(`(()=>{const v=document.elementFromPoint(${p.x},${p.y});const el=v&&v.closest?v.closest('video')||document.querySelector('video'):document.querySelector('video');if(el)el.requestPictureInPicture().catch(()=>{})})()`, true) })
      sep()
    }
    if (p.selectionText && !p.isEditable) {
      const text = p.selectionText.trim()
      tpl.push({ role: 'copy' })
      const short = text.length > 24 ? text.slice(0, 24) + '…' : text
      tpl.push({ label: `Search for “${short}”`, click: () => win.newTab({ url: searchUrl(text, engine), isSearch: true }) })
      if (/^\S+\.\S+$/.test(text)) tpl.push({ label: `Go to ${short}`, click: () => win.newTab(text) })
      sep()
    }
    if (p.isEditable) {
      tpl.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' })
      tpl.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy })
      tpl.push({ role: 'paste', enabled: p.editFlags.canPaste }, { role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste })
      tpl.push({ role: 'selectAll' })
      sep()
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType === 'none') {
      tpl.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
      tpl.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
      tpl.push({ label: 'Reload', click: () => wc.reload() })
      sep()
      tpl.push({ label: 'Copy URL', click: () => clipboard.writeText(wc.getURL()) })
      tpl.push({ label: 'Save Page As…', click: () => this.c.actions.run(win, 'tab:savePage', {}) })
      tpl.push({ label: 'Print…', click: () => wc.print() })
      sep()
    }
    // Items added by extensions (chrome.contextMenus).
    const ext = this.c.extensions && this.c.extensions.menuItems(wc, p)
    if (ext && ext.length) { for (const i of ext) tpl.push(i); sep() }
    tpl.push({ label: 'Inspect Element', click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus() } })
    while (tpl.length && tpl[tpl.length - 1].type === 'separator') tpl.pop()
    Menu.buildFromTemplate(tpl).popup({ window: win.win || win })
  }
}

module.exports = { ContextMenu }
