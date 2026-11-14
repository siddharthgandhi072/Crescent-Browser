'use strict'
const path = require('node:path')
const { net, protocol } = require('electron')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..', '..')
const RENDERER = path.join(ROOT, 'src', 'renderer')

// Third-party browser modules served to the UI under crescent://app/vendor/
const VENDOR = {
  'preact.js': path.join(ROOT, 'node_modules', 'preact', 'dist', 'preact.mjs'),
  'hooks.js': path.join(ROOT, 'node_modules', 'preact', 'hooks', 'dist', 'hooks.mjs'),
  'htm.js': path.join(ROOT, 'node_modules', 'htm', 'dist', 'htm.module.js'),
}

const preload = name => path.join(ROOT, 'src', 'preload', name)
const ui = p => 'crescent://app/' + p
const page = p => 'crescent://app/pages/' + p
const asset = p => path.join(ROOT, 'assets', p)

function resolve(urlString, { pagesOnly = false } = {}) {
  let u
  try { u = new URL(urlString) } catch { return null }
  if (u.host !== 'app') return null
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
  if (rel.startsWith('vendor/')) return pagesOnly ? null : VENDOR[rel.slice(7)] || null
  if (pagesOnly && !rel.startsWith('pages/') && !rel.startsWith('shared/')) return null
  const file = path.normalize(path.join(RENDERER, rel))
  if (!file.startsWith(RENDERER + path.sep)) return null // no ../ escapes
  return file
}

// Serve crescent://app/* from src/renderer. Web pages (browse session) may
// only reach the pages/ folder (error page etc.), never the app UI.
function registerProtocol(session, { pagesOnly = false } = {}) {
  const p = session ? session.protocol : protocol
  p.handle('crescent', async req => {
    const file = resolve(req.url, { pagesOnly })
    if (!file) return new Response('Not found', { status: 404 })
    try {
      if (file.endsWith('.mjs')) {
        // Vendor modules import "preact" by bare name; point it at our copy.
        const src = require('node:fs').readFileSync(file, 'utf8').replace(/from\s*["']preact["']/g, 'from"./preact.js"')
        return new Response(src, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } })
      }
      const res = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(res.headers)
      if (file.endsWith('.js')) headers.set('Content-Type', 'text/javascript; charset=utf-8')
      headers.set('Cache-Control', 'no-cache')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

module.exports = { ROOT, RENDERER, preload, ui, page, asset, registerProtocol, resolve }
