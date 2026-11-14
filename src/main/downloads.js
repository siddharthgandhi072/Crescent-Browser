'use strict'
// Downloads. With "Ask where to save" on (the default) every download shows
// the macOS save panel first. Progress shows in the sidebar and Library.

const { app, shell, dialog, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { JsonFile } = require('./store')
const M = require('./model')

class Downloads {
  constructor(c, dir) {
    this.c = c
    this.file = new JsonFile(path.join(dir, 'downloads.json'), [])
    this.items = new Map() // id -> DownloadItem (live only)
    // Anything that was mid-download when we quit is marked interrupted.
    for (const d of this.file.data) if (d.state === 'progressing') d.state = 'interrupted'
    this.attach(c.browseSession)
  }

  attach(ses) { ses.on('will-download', (e, item, wc) => this.onDownload(item, wc)) }

  onDownload(item, wc) {
    const id = M.uid('d')
    const s = this.c.store.state.settings
    const dir = s.downloadDir && fs.existsSync(s.downloadDir) ? s.downloadDir : app.getPath('downloads')
    const name = item.getFilename() || 'download'
    if (s.askWhereToSave) {
      item.setSaveDialogOptions({ defaultPath: path.join(dir, name), title: 'Save Download' })
    } else {
      item.setSavePath(uniquePath(path.join(dir, name)))
    }
    const rec = {
      id, url: item.getURL(), filename: name, path: '', total: item.getTotalBytes(), received: 0,
      state: 'progressing', paused: false, startedAt: Date.now(),
    }
    this.items.set(id, item)
    let announced = false
    const push = () => this.c.broadcast('downloads', this.summary())
    item.on('updated', (_e, state) => {
      rec.path = item.getSavePath() || rec.path
      if (rec.path) rec.filename = path.basename(rec.path)
      rec.received = item.getReceivedBytes()
      rec.total = item.getTotalBytes()
      rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      rec.paused = item.isPaused()
      if (!announced && rec.path) {
        announced = true
        this.file.data.unshift(rec)
        if (this.file.data.length > 200) this.file.data.length = 200
      }
      this.throttledPush(push)
    })
    item.once('done', (_e, state) => {
      this.items.delete(id)
      rec.path = item.getSavePath() || rec.path
      rec.received = item.getReceivedBytes()
      rec.state = state // completed | cancelled | interrupted
      if (state === 'cancelled' && !announced) { push(); return } // user hit Cancel in the save panel
      if (!announced) { this.file.data.unshift(rec); announced = true }
      this.file.save()
      push()
      if (state === 'completed') {
        app.dock?.downloadFinished?.(rec.path)
        const m = this.c.main
        if (m && !m.closed) m.toast(`Downloaded ${rec.filename}`, { action: 'downloads:reveal', actionLabel: 'Show', id })
      }
    })
  }

  throttledPush(fn) {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => { this.pushTimer = null; fn() }, 250)
  }

  summary() {
    const active = this.file.data.filter(d => d.state === 'progressing')
    const total = active.reduce((a, d) => a + (d.total || 0), 0)
    const got = active.reduce((a, d) => a + (d.received || 0), 0)
    return { active: active.length, progress: total ? got / total : active.length ? -1 : 0 }
  }

  list() {
    return this.file.data.map(d => ({ ...d, exists: d.state === 'completed' ? fs.existsSync(d.path) : undefined }))
  }

  open(id) { const d = this.file.data.find(x => x.id === id); if (d && d.path) shell.openPath(d.path) }
  reveal(id) { const d = this.file.data.find(x => x.id === id); if (d && d.path) shell.showItemInFolder(d.path) }
  cancel(id) { const it = this.items.get(id); if (it) it.cancel() }
  togglePause(id) { const it = this.items.get(id); if (!it) return; if (it.isPaused()) it.resume(); else it.pause() }
  clear() {
    this.file.data = this.file.data.filter(d => d.state === 'progressing')
    this.file.save()
    this.c.broadcast('downloads', this.summary())
  }
  flush() { this.file.flush() }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p
  const { dir, name, ext } = path.parse(p)
  for (let i = 1; i < 1000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`)
    if (!fs.existsSync(c)) return c
  }
  return path.join(dir, `${name}-${Date.now()}${ext}`)
}

module.exports = { Downloads, uniquePath }
