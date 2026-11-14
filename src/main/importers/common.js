'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

// Tests point this at a fixture folder.
const home = () => process.env.CRESCENT_IMPORT_HOME || os.homedir()
const appSupport = (...p) => path.join(home(), 'Library', 'Application Support', ...p)

// Browsers keep their databases locked while running, so always read a copy
// (including the WAL file, or recent rows would be missing).
function openCopy(file) {
  if (!fs.existsSync(file)) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crescent-import-'))
  const dest = path.join(dir, path.basename(file))
  fs.copyFileSync(file, dest)
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, dest + ext)
  const db = new DatabaseSync(dest, { readOnly: false })
  const close = () => { try { db.close() } catch {} try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  return { db, close }
}

function tableExists(db, name) {
  try { return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) } catch { return false }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// macOS Keychain lookup. Shows the system "allow access" prompt once.
function keychainPassword(services) {
  if (process.env.CRESCENT_TEST_KEYCHAIN) return Promise.resolve(process.env.CRESCENT_TEST_KEYCHAIN)
  if (process.platform !== 'darwin') return Promise.resolve(null)
  const list = Array.isArray(services) ? services : [services]
  return list.reduce((p, svc) => p.then(found => found || new Promise(resolve => {
    execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', svc], { timeout: 120000 }, (err, out) => {
      resolve(err ? null : String(out).trim() || null)
    })
  })), Promise.resolve(null))
}

// Chromium "v10"/"v11" AES-128-CBC values (macOS and Linux).
function chromiumKey(password) {
  return crypto.pbkdf2Sync(password, 'saltysalt', password === 'peanuts' ? 1 : 1003, 16, 'sha1')
}

function chromiumDecrypt(buf, key, { stripDomainHash = false } = {}) {
  if (!buf || !buf.length) return ''
  const b = Buffer.from(buf)
  const prefix = b.subarray(0, 3).toString()
  if (prefix !== 'v10' && prefix !== 'v11') return b.toString('utf8') // stored unencrypted
  if (!key) return null
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
    let out = Buffer.concat([decipher.update(b.subarray(3)), decipher.final()])
    if (stripDomainHash && out.length >= 32) out = out.subarray(32)
    return out.toString('utf8')
  } catch { return null }
}

function chromiumEncryptForTest(text, key, domainHash = null) {
  const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  const body = domainHash ? Buffer.concat([domainHash, Buffer.from(text)]) : Buffer.from(text)
  return Buffer.concat([Buffer.from('v10'), c.update(body), c.final()])
}

// WebKit/Chromium timestamps: microseconds since 1601-01-01.
const webkitToMs = t => (t ? Math.round(Number(t) / 1000 - 11644473600000) : 0)
const msToWebkit = ms => (ms + 11644473600000) * 1000

module.exports = { home, appSupport, openCopy, tableExists, readJson, keychainPassword, chromiumKey, chromiumDecrypt, chromiumEncryptForTest, webkitToMs, msToWebkit }
