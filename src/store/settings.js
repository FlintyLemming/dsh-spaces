import { getDb } from './db.js'

export function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row === undefined ? fallback : row.value
}

export function setSetting(key, value) {
  getDb().prepare(
    `INSERT INTO settings (key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value))
}
