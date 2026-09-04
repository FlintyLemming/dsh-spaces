import { getDb } from './db.js'

export function createIdentity({ userId, issuer, subject }) {
  getDb().prepare(
    'INSERT INTO identities (user_id, issuer, subject) VALUES (?,?,?)',
  ).run(userId, issuer, subject)
}

export function getIdentityByIssuerSubject(issuer, subject) {
  return getDb().prepare(
    'SELECT * FROM identities WHERE issuer = ? AND subject = ?',
  ).get(issuer, subject) ?? null
}

export function userHasIdentity(userId) {
  return getDb().prepare('SELECT 1 FROM identities WHERE user_id = ? LIMIT 1').get(userId) !== undefined
}
