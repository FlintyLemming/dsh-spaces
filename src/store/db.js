import Database from 'better-sqlite3'
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * 打开数据库并按序执行未应用的 migration。
 * 任何 migration 失败都会抛出——启动方不得吞掉（spec §9：失败即中止启动）。
 */
export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`)
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  )
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  for (const name of files) {
    if (applied.has(name)) continue
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?,?)')
        .run(name, Date.now())
    })()
  }
  return db
}

let singleton = null
export function initDb(file) {
  singleton = openDatabase(file)
  return singleton
}
export function getDb() {
  if (!singleton) throw new Error('store not initialized; call initDb() first')
  return singleton
}
