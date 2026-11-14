'use strict'
// One-click updates from GitHub Releases.
//
// Checks the latest release, downloads the .zip for this Mac's chip in the
// background, unpacks it and verifies it, then shows "Restart to update" in
// the sidebar. On restart a tiny helper script waits for Crescent to quit,
// swaps the app bundle in place and reopens it. Files downloaded by Crescent
// itself carry no quarantine flag, so macOS doesn't show its warning again.

const { app, net, shell, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')

const REPO = 'siddharthgandhi072/crescent-browser'
const CHECK_EVERY = 4 * 3600 * 1000

class Updater {
  constructor(c) {
    this.c = c
    this.dir = path.join(app.getPath('userData'), 'updates')
    this.status = { state: 'idle', version: null, progress: 0, notes: '', error: null }
    this.timer = null
  }

  start() {
    setTimeout(() => this.check(false), 15 * 1000)
    this.timer = setInterval(() => this.check(false), CHECK_EVERY)
  }

  set(patch) {
    Object.assign(this.status, patch)
    this.c.broadcast('update', this.status)
  }

  bundlePath() {
    // .../Crescent.app/Contents/MacOS/Crescent -> .../Crescent.app
    const exe = app.getPath('exe')
    const i = exe.indexOf('.app/Contents/MacOS/')
    return i === -1 ? null : exe.slice(0, i + 4)
  }

  canSelfUpdate() {
    if (process.platform !== 'darwin' || !app.isPackaged) return false
    const b = this.bundlePath()
    if (!b) return false
    try { fs.accessSync(path.dirname(b), fs.constants.W_OK); return true } catch { return false }
  }

  async latest() {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub said ${res.status}`)
    return res.json()
  }

  async check(interactive) {
    if (this.status.state === 'downloading' || this.status.state === 'ready') {
      if (interactive && this.status.state === 'ready') this.c.main && this.c.main.toast(`Crescent ${this.status.version} is ready. Restart to update.`)
      return this.status
    }
    try {
      this.set({ state: 'checking', error: null })
      const rel = await this.latest()
      const latest = rel ? String(rel.tag_name || '').replace(/^v/, '') : null
      if (!rel || cmp(latest, app.getVersion()) <= 0) {
        this.set({ state: 'idle' })
        if (interactive) dialog.showMessageBox({ type: 'info', message: 'Crescent is up to date', detail: `You have version ${app.getVersion()}.` })
        return this.status
      }
      this.set({ version: latest, notes: (rel.body || '').slice(0, 2000), url: rel.html_url })
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const asset = (rel.assets || []).find(a => a.name.endsWith('.zip') && a.name.includes(arch))
      if (!asset || !this.canSelfUpdate()) {
        // Can't swap in place (running from the DMG, read-only folder, or no
        // zip in the release): offer the download page instead.
        this.set({ state: 'manual' })
        return this.status
      }
      await this.download(asset, latest)
    } catch (e) {
      this.set({ state: 'error', error: e.message })
      if (interactive) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: e.message })
    }
    return this.status
  }

  async download(asset, version) {
    fs.rmSync(this.dir, { recursive: true, force: true })
    fs.mkdirSync(this.dir, { recursive: true })
    const zip = path.join(this.dir, asset.name)
    this.set({ state: 'downloading', progress: 0 })
    const res = await net.fetch(asset.browser_download_url)
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || asset.size || 0
    const out = fs.createWriteStream(zip)
    let got = 0
    let last = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      got += value.length
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r))
      if (total && Date.now() - last > 300) { last = Date.now(); this.set({ progress: got / total }) }
    }
    await new Promise((r, j) => out.end(err => (err ? j(err) : r())))
    if (asset.size && got !== asset.size) throw new Error('Download was incomplete')
    // Unpack with ditto, which keeps the app's signature and symlinks intact.
    const unpack = path.join(this.dir, 'app')
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpack])
    const appDir = fs.readdirSync(unpack).find(f => f.endsWith('.app'))
    if (!appDir) throw new Error('Update package has no app inside')
    const newApp = path.join(unpack, appDir)
    const plist = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(newApp, 'Contents', 'Info.plist')])
    if (plist.trim() !== version) throw new Error(`Update package is version ${plist.trim()}, expected ${version}`)
    await run('/usr/bin/codesign', ['--verify', '--deep', newApp]).catch(() => { throw new Error('Update package failed signature check') })
    fs.rmSync(zip, { force: true })
    this.newApp = newApp
    this.set({ state: 'ready', progress: 1 })
  }

  // Swap the app bundle after we quit, then relaunch.
  install() {
    if (this.status.state === 'manual') { shell.openExternal(this.status.url || `https://github.com/${REPO}/releases/latest`); return }
    if (this.status.state !== 'ready' || !this.newApp) return
    const target = this.bundlePath()
    const script = path.join(this.dir, 'install.sh')
    fs.writeFileSync(script, `#!/bin/bash
# Waits for Crescent to quit, swaps in the new version, reopens it.
PID=${process.pid}
NEW=${q(this.newApp)}
TARGET=${q(target)}
for i in $(seq 1 100); do kill -0 $PID 2>/dev/null || break; sleep 0.1; done
OLD="$TARGET.old-$$"
mv "$TARGET" "$OLD" && /usr/bin/ditto "$NEW" "$TARGET" && rm -rf "$OLD" || { rm -rf "$TARGET"; mv "$OLD" "$TARGET"; }
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
open "$TARGET"
rm -rf ${q(path.dirname(this.newApp))}
`, { mode: 0o755 })
    const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' })
    child.unref()
    app.quit()
  }
}

function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }

function run(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 1 << 20 }, (err, out, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve(String(out)))))
}

function cmp(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

module.exports = { Updater, cmp }
