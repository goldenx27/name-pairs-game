-- RBAC foundation: ADMIN / PARENT / CHILD
-- Existing `players` remain child profiles so current progress is preserved.
-- Managers and parents authenticate with username + password only.

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  global_role TEXT NOT NULL DEFAULT 'PARENT'
    CHECK (global_role IN ('ADMIN','PARENT','CHILD')),
  password_hash TEXT,
  password_salt TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL
);

-- Families are grouping/scope only; there is no family-admin role.
CREATE TABLE IF NOT EXISTS family_memberships (
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PARENT','CHILD')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id, user_id),
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL
);

-- A CHILD account maps to the existing player profile that owns game progress.
CREATE TABLE IF NOT EXISTS child_accounts (
  user_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
);

-- Explicit parent/child relationship. ADMIN bypasses this table and can see all children.
CREATE TABLE IF NOT EXISTS parent_children (
  parent_user_id TEXT NOT NULL,
  child_player_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (parent_user_id, child_player_id),
  FOREIGN KEY (parent_user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (child_player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL
);

-- Server-side sessions; browser/device is no longer the identity.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_memberships_user ON family_memberships(user_id, active);
CREATE INDEX IF NOT EXISTS idx_parent_children_parent ON parent_children(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_children_child ON parent_children(child_player_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
