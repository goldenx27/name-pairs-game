-- Authentication hardening for ADMIN/PARENT accounts.
-- CHILD accounts do not require username/password for gameplay.

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_nocase
  ON app_users(lower(username))
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_users_role_active
  ON app_users(global_role, active);
