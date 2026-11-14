'use strict'
// Persistence for the sidebar/space state. Writes are debounced and atomic
// (write to a temp file, fsync, rename) so a crash or power loss mid-write
// can never leave a half-written file. The previous good copy is kept as
// state.json.bak and used if the main file is unreadable.

const fs = require('node:fs')
const path = require('node:path')
const M = require('./model')

class Store {
  constructor(dir, name = 'state.json') {
    this.dir = dir
    this.file = path.join(dir, name)
    this.bak = this.file + '.bak'
    this.timer = null
    this.state = null
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true })
    let raw = readJSON(this.file)
    if (raw === undefined) raw = readJSON(this.bak)
    this.state = M.normalize(raw === undefined ? M.defaults() : raw)
    // Keep a copy of the last state that loaded cleanly.
    if (fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.bak) } catch {}
    }
    return this.state
  }

  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush() {
    clearTimeout(this.timer)
    this.timer = null
    if (!this.state) return
    writeAtomic(this.file, JSON.stringify(this.state))
  }
}

function readJSON(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    return JSON.parse(txt)
  } catch {
    return undefined
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp'
  try {
    const fd = fs.openSync(tmp, 'w')
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    console.error('[store] write failed', err)
  }
}

// Small JSON key/value file for things like permissions and downloads.
class JsonFile {
  constructor(file, fallback) {
    this.file = file
    this.data = readJSON(file)
    if (this.data === undefined || typeof this.data !== typeof fallback) this.data = fallback
    this.timer = null
  }
  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 500)
  }
  flush() {
    clearTimeout(this.timer)
    writeAtomic(this.file, JSON.stringify(this.data))
  }
}

module.exports = { Store, JsonFile, writeAtomic, readJSON }
