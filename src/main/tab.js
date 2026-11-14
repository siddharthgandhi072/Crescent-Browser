'use strict'
// A live web page. Wraps one WebContentsView and turns its many events into
// a small set of 'update' events the window controller cares about. A Tab
// does not know which window it lives in, so it can move between the main
// window, Little Crescent and Peek without losing the page.

const { WebContentsView } = require('electron')
const { EventEmitter } = require('node:events')

const RADIUS = 9

class Tab extends EventEmitter {
  // viewOptions: given by setWindowOpenHandler's createWindow so the new tab
  // keeps window.opener (needed by many sign-in and "open in new tab" flows).
  constructor({ id, url, session, background = '#ffffff', kind = 'tab', viewOptions = null, radius = RADIUS, guard = null }) {
    super()
    this.id = id
    this.kind = kind
    this.view = new WebContentsView(viewOptions ? {
      ...viewOptions,
      webPreferences: { ...(viewOptions.webPreferences || {}), session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    } : {
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: true,
        scrollBounce: true,
        autoplayPolicy: 'document-user-activation-required',
      },
    })
    this.view.setBackgroundColor(background)
    if (this.view.setBorderRadius) this.view.setBorderRadius(radius)
    // guard(url) -> false blocks a navigation (used by Focus mode).
    this.guard = guard
    this.wc = this.view.webContents
    this.info = {
      url: url || '', title: '', favicon: null, loading: false, audible: false, muted: false,
      crashed: false, canGoBack: false, canGoForward: false, zoom: 1, error: null, playing: false, video: false,
    }
    this.lastActive = Date.now()
    this.destroyed = false
    this.bind()
    if (url && !viewOptions) this.load(url)
  }

  bind() {
    const wc = this.wc
    const upd = patch => {
      Object.assign(this.info, patch)
      this.emit('update', patch)
    }
    const nav = () => upd({
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
    wc.on('page-title-updated', (_e, title) => upd({ title }))
    wc.on('page-favicon-updated', (_e, favicons) => {
      const fav = pickFavicon(favicons)
      if (fav) upd({ favicon: fav })
    })
    wc.on('did-start-loading', () => upd({ loading: true, crashed: false }))
    wc.on('did-stop-loading', () => { upd({ loading: false }); nav() })
    wc.on('did-navigate', (_e, url, code) => {
      // Back/forward can't be cancelled up front; bounce them after the fact.
      if (this.guard && !this.guard(url)) { this.emit('blocked', url); return }
      upd({ error: null })
      nav()
      this.emit('navigated', { url, main: true, code })
    })
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { nav(); this.emit('navigated', { url, main: true, inPage: true }) } })
    wc.on('did-start-navigation', details => {
      // Drop the old favicon as soon as we leave the site so it never lies.
      if (details.isMainFrame && !details.isSameDocument && hostOf(details.url) !== hostOf(this.info.url)) {
        upd({ favicon: null })
      }
    })
    wc.on('audio-state-changed', e => upd({ audible: !!e.audible }))
    wc.on('media-started-playing', () => {
      upd({ playing: true })
      wc.executeJavaScript(`(() => { const v = [...document.querySelectorAll('video')].find(v => !v.paused && v.videoWidth > 0); const m = navigator.mediaSession && navigator.mediaSession.metadata; return { video: !!v, title: m ? m.title : '', artist: m ? m.artist : '', art: m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : '' } })()`, false)
        .then(r => r && upd({ video: !!r.video, media: { title: r.title || '', artist: r.artist || '', art: r.art || '' } })).catch(() => {})
    })
    wc.on('media-paused', () => upd({ playing: false }))
    const blockNav = e => {
      if (e.isMainFrame === false || !this.guard) return
      if (!this.guard(e.url)) { e.preventDefault(); this.emit('blocked', e.url) }
    }
    wc.on('will-navigate', blockNav)
    wc.on('will-redirect', blockNav)
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      // -3 is ERR_ABORTED (user navigated away, downloads): not an error.
      if (!isMain || code === -3) return
      upd({ error: { code, desc, url }, loading: false })
      this.emit('failed', { code, desc, url })
    })
    wc.on('render-process-gone', (_e, d) => {
      if (d.reason === 'clean-exit') return
      upd({ crashed: true, loading: false })
    })
    wc.on('unresponsive', () => this.emit('unresponsive'))
    wc.on('update-target-url', (_e, url) => this.emit('hover', url))
    wc.on('zoom-changed', (_e, dir) => {
      const z = Math.max(0.3, Math.min(3, wc.getZoomFactor() + (dir === 'in' ? 0.1 : -0.1)))
      wc.setZoomFactor(z); upd({ zoom: z })
    })
    // Pages that ask "are you sure you want to leave?" must not block
    // closing a tab forever. Chrome lets the user decide; we let it go.
    wc.on('will-prevent-unload', e => e.preventDefault())
    wc.on('focus', () => { this.lastActive = Date.now(); this.emit('focus') })
  }

  load(url) {
    if (this.guard && !this.guard(url)) { this.emit('blocked', url); return }
    this.info.url = url
    this.info.error = null
    this.wc.loadURL(url).catch(() => {}) // failures are reported through did-fail-load
  }

  get url() { return this.info.url }

  setBounds(b) { this.view.setBounds(roundRect(b)) }

  setMuted(m) { this.wc.setAudioMuted(!!m); this.info.muted = !!m; this.emit('update', { muted: !!m }) }

  touch() { this.lastActive = Date.now() }

  isBusy() {
    // Never unload a tab that is playing sound, using the camera/mic or
    // streaming, or is in the middle of loading.
    return this.info.audible || this.info.loading || this.wc.isCurrentlyAudible() || this.wc.isBeingCaptured()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.removeAllListeners()
    try { if (!this.wc.isDestroyed()) this.wc.close({ waitForBeforeUnload: false }) } catch {}
  }
}

function pickFavicon(list) {
  if (!Array.isArray(list) || !list.length) return null
  // Prefer an SVG or the largest declared PNG; ignore data: blobs over 64KB.
  const ok = list.filter(u => typeof u === 'string' && !(u.startsWith('data:') && (u.length > 65536 || u.length < 24)))
  return ok.find(u => /\.svg(\?|$)/i.test(u)) || ok[0] || null
}

function hostOf(u) {
  try { return new URL(u).host } catch { return '' }
}

function roundRect(b) {
  return {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)),
  }
}

module.exports = { Tab, hostOf, roundRect, RADIUS }
