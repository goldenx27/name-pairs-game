-- Final RBAC model: ADMIN / PARENT / CHILD only.
-- SQLite cannot alter CHECK constraints in place, so rebuild the two role tables.

PRAGMA foreign_keys=OFF;

CREATE TABLE app_users_v2 (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  display_name TEXT NOT NULL,
  global_role TEXT NOT NULL DEFAULT 'PARENT'
    CHECK (global_role IN ('ADMIN','PARENT','CHILD')),
  password_hash TEXT,
  password_salt TEXT,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES app_users_v2(id) ON DELETE SET NULL
);

INSERT INTO app_users_v2(id,username,display_name,global_role,password_hash,password_salt,pin_hash,active,created_by,created_at,updated_at)
SELECT id,username,display_name,
       CASE WHEN global_role IN ('SUPER_ADMIN','FAMILY_ADMIN') THEN 'ADMIN' ELSE global_role END,
       password_hash,password_salt,pin_hash,active,created_by,created_at,updated_at
FROM app_users;

DROP TABLE app_users;
ALTER TABLE app_users_v2 RENAME TO app_users;

CREATE TABLE family_memberships_v2 (
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PARENT','CHILD')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (family_id,user_id),
  FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO family_memberships_v2(family_id,user_id,role,active,created_by,created_at)
SELECT family_id,user_id,
       CASE WHEN role='CHILD' THEN 'CHILD' ELSE 'PARENT' END,
       active,created_by,created_at
FROM family_memberships;

DROP TABLE family_memberships;
ALTER TABLE family_memberships_v2 RENAME TO family_memberships;

CREATE INDEX IF NOT EXISTS idx_family_memberships_user ON family_memberships(user_id,active);
CREATE INDEX IF NOT EXISTS idx_parent_children_parent ON parent_children(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_children_child ON parent_children(child_player_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

PRAGMA foreign_keys=ON;
