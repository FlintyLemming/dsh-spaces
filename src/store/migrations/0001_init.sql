CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  handle TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE TABLE spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal','team')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  quota_cpu REAL,
  quota_mem_mb INTEGER,
  quota_instances INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE space_members (
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE volumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('shared','private')),
  user_id INTEGER REFERENCES users(id),
  docker_name TEXT UNIQUE NOT NULL
);
CREATE TABLE instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  container_name TEXT UNIQUE NOT NULL,
  port INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped'
    CHECK (status IN ('stopped','starting','running','error')),
  error TEXT,
  image_digest TEXT,
  last_active_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (space_id, user_id)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_log_query_idx ON audit_log(action, created_at);
