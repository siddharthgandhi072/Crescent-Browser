'use strict'
// Browsing history in SQLite (Node's built-in driver, no native module).
// Used by the command bar for instant search and by the importer.

const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

class History {
  constructor(dir) {
    this.db = new DatabaseSync(path.join(dir, 'history.sqlite'))
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS urls (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visits INTEGER NOT NULL DEFAULT 0,
        typed INTEGER NOT NULL DEFAULT 0,
        last INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS urls_last ON urls(last DESC);
    `)
    this.q = {
      visit: this.db.prepare(`INSERT INTO urls(url, title, visits, typed, last) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(url) DO UPDATE SET visits = visits + 1, typed = typed + excluded.typed, last = excluded.last,
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END`),
      title: this.db.prepare(`UPDATE urls SET title = ? WHERE url = ?`),
      search: this.db.prepare(`SELECT url, title, visits, typed, last FROM urls
        WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
        ORDER BY (typed * 4 + visits) * (1.0 / (1 + (? - last) / 86400000.0)) DESC LIMIT ?`),
      recent: this.db.prepare(`SELECT url, title, visits, last FROM urls ORDER BY last DESC LIMIT ? OFFSET ?`),
      importRow: this.db.prepare(`INSERT INTO urls(url, title, visits, typed, last) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET visits = max(visits, excluded.visits), last = max(last, excluded.last),
        title = CASE WHEN title = '' THEN excluded.title ELSE title END`),
      del: this.db.prepare(`DELETE FROM urls WHERE url = ?`),
      count: this.db.prepare(`SELECT count(*) AS n FROM urls`),
    }
  }

  visit(url, title = '', typed = false) {
    if (!/^https?:/i.test(url)) return
    try { this.q.visit.run(url, title || '', typed ? 1 : 0, Date.now()) } catch (e) { console.error('[history]', e.message) }
  }

  setTitle(url, title) {
    if (!title) return
    try { this.q.title.run(title, url) } catch {}
  }

  search(text, limit = 8) {
    const words = String(text).trim()
    if (!words) return []
    const like = '%' + words.replace(/[\\%_]/g, m => '\\' + m) + '%'
    try { return this.q.search.all(like, like, Date.now(), limit) } catch { return [] }
  }

  recent(limit = 100, offset = 0) {
    try { return this.q.recent.all(limit, offset) } catch { return [] }
  }

  remove(url) { try { this.q.del.run(url) } catch {} }

  clear(sinceMs) {
    if (sinceMs) this.db.prepare('DELETE FROM urls WHERE last >= ?').run(Date.now() - sinceMs)
    else this.db.exec('DELETE FROM urls')
  }

  importMany(rows) {
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const r of rows) {
        if (!r.url || !/^https?:/i.test(r.url)) continue
        this.q.importRow.run(r.url, r.title || '', r.visits || 1, r.typed || 0, r.last || 0)
        n++
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return n
  }

  count() { return this.q.count.get().n }
  close() { try { this.db.close() } catch {} }
}

module.exports = { History }
